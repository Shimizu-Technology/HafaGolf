# frozen_string_literal: true

class Sponsor < ApplicationRecord
  # Associations
  belongs_to :tournament
  belongs_to :sponsor_tier, optional: true
  has_many :sponsor_slots, dependent: :destroy
  has_many :golfers, dependent: :nullify
  has_many :registrations, dependent: :nullify
  has_many :message_deliveries, as: :messageable, dependent: :nullify
  has_one_attached :logo

  # Legacy constant kept for backwards compatibility with scopes/seeds.
  DEFAULT_TIERS = %w[title platinum gold silver bronze hole].freeze
  TIERS = DEFAULT_TIERS
  PAYMENT_STATUSES = %w[unpaid pending pending_check paid refunded expired cancelled].freeze

  # Validations
  validates :name, presence: true
  validate :tier_must_be_valid
  validate :sponsor_tier_matches_tournament
  validate :course_key_must_exist_in_tournament, if: :hole_sponsor?
  validate :hole_number_within_course_range, if: :hole_sponsor?
  validates :hole_number,
            numericality: { only_integer: true, greater_than: 0 },
            allow_nil: true
  validates :hole_number, presence: true, if: -> { tier == 'hole' && sponsor_tier_id.nil? }
  validates :course_key, presence: true, if: -> { tier == 'hole' && sponsor_tier_id.nil? }
  validates :position, numericality: { only_integer: true, greater_than_or_equal_to: 0 }
  validates :payment_status, inclusion: { in: PAYMENT_STATUSES }, allow_nil: true
  validates :payment_amount_cents, numericality: { only_integer: true, greater_than_or_equal_to: 0 }, allow_nil: true
  validates :stripe_fee_cents, numericality: { only_integer: true, greater_than_or_equal_to: 0 }, allow_nil: true
  validates :refund_amount_cents, numericality: { only_integer: true, greater_than_or_equal_to: 0 }
  validates :logo_url, public_image_url: true, if: :will_save_change_to_logo_url?
  validate :website_url_must_be_http, if: :will_save_change_to_website_url?

  before_validation :normalize_hole_assignment

  # Scopes
  scope :active, -> { where(active: true) }
  scope :by_tier, ->(tier) { where(tier: tier) }
  scope :ordered, -> { order(:tier, :position, :name) }
  scope :title_sponsors, -> { where(tier: 'title') }
  scope :major_sponsors, -> { where(tier: %w[title platinum gold]) }
  scope :hole_sponsors, -> { where(tier: 'hole').order(:course_key, :hole_number, :position, :name) }

  def tier_display
    return sponsor_tier.label if sponsor_tier.present?

    tier_def = tournament&.sponsor_tier_list&.find { |t| t['key'] == tier }
    return tier_def['label'] if tier_def

    tier&.titleize || 'Sponsor'
  end

  def tier_priority
    keys = tournament&.sponsor_tier_keys || DEFAULT_TIERS
    keys.index(tier) || 999
  end

  def major?
    tier_priority <= 1
  end

  def hole_sponsor?
    tier == 'hole'
  end

  def course_name
    return nil unless course_key.present?

    tournament&.course_name_for(course_key)
  end

  # Display label
  def display_label
    return tier_display unless hole_sponsor? && course_key.present? && hole_number.present?

    "#{course_name} #{hole_number}"
  end

  # Auto-sync SponsorSlot records when slot_count changes
  after_save :sync_sponsor_slots

  # Idempotently ensures SponsorSlot rows 1..slot_count exist for this sponsor.
  def provision_sponsor_slots!
    target_count = slot_count.to_i
    return [] if target_count <= 0

    tournament_record = tournament
    (1..target_count).map do |num|
      sponsor_slots.find_or_create_by!(slot_number: num, tournament: tournament_record)
    end
  end

  # Magic link authentication
  ACCESS_TOKEN_EXPIRY = 7.days
  PORTAL_SESSION_EXPIRY = 12.hours

  def generate_access_token!
    token = SecureRandom.urlsafe_base64(32)
    update!(
      access_token: token,
      access_token_expires_at: Time.current + ACCESS_TOKEN_EXPIRY,
      portal_link_issued_at: Time.current
    )
    token
  end

  # Admin-issued portal links (email invite or copied link) reuse a still-valid
  # token and refresh its expiry, so a link the sponsor already received keeps
  # working when an admin shares the portal a second way.
  def issue_portal_access_token!
    with_lock do
      return generate_access_token! unless access_token_valid?

      update!(
        access_token_expires_at: Time.current + ACCESS_TOKEN_EXPIRY,
        portal_link_issued_at: Time.current
      )
      access_token
    end
  end

  def portal_eligible?
    active? && tournament.present? && tournament.status != 'archived'
  end

  def pending_check?
    payment_status == 'pending_check'
  end

  def assign_invoice_number!
    return invoice_number if invoice_number.present?

    year_part = tournament&.year || Time.current.year
    loop do
      candidate = "INV-#{year_part}-#{tournament_id}-#{SecureRandom.hex(3).upcase}"
      unless self.class.exists?(invoice_number: candidate)
        self.invoice_number = candidate
        self.invoiced_at ||= Time.current
        return candidate
      end
    end
  end

  def mark_check_paid!(check_number: nil, check_notes: nil)
    with_lock do
      update!(
        payment_status: 'paid',
        payment_type: payment_type.presence || 'check',
        payment_method: 'check',
        active: true,
        paid_at: paid_at || Time.current,
        check_number: check_number.to_s.strip.presence || self.check_number,
        check_notes: check_notes.to_s.strip.presence || self.check_notes
      )
      provision_sponsor_slots! if slot_count.to_i.positive?
    end
  end

  def generate_portal_session_token!(verified_email:, expires_at: nil)
    normalized_email = verified_email.to_s.strip.downcase
    raise ArgumentError, 'Verified email is required' if normalized_email.blank?

    expiry = expires_at || (Time.current + PORTAL_SESSION_EXPIRY)
    remaining = expiry - Time.current
    raise ArgumentError, 'Portal session has expired' if remaining <= 0

    self.class.portal_session_verifier.generate(
      { 'sponsor_id' => id, 'email' => normalized_email, 'exp' => expiry.to_i },
      expires_at: expiry
    )
  end

  def access_token_valid?
    access_token.present? &&
      access_token_expires_at.present? &&
      access_token_expires_at > Time.current
  end

  def self.find_by_access_token(token)
    return nil if token.blank?
    sponsor = find_by(access_token: token)
    return nil unless sponsor&.access_token_valid?
    sponsor
  end

  def self.verify_portal_session_token(token)
    return [nil, nil] if token.blank?

    payload = portal_session_verifier.verified(token)
    return [nil, nil] unless payload.is_a?(Hash)

    expires_at = payload['exp'].present? ? Time.zone.at(payload['exp'].to_i) : nil
    return [nil, nil] if expires_at.present? && expires_at <= Time.current

    sponsor = find_by(id: payload['sponsor_id'])
    return [nil, nil] unless sponsor

    verified_email = payload['email'].to_s.downcase
    return [nil, nil] unless sponsor.login_email.to_s.downcase == verified_email

    [sponsor, expires_at]
  rescue ActiveSupport::MessageVerifier::InvalidSignature
    [nil, nil]
  end

  def self.find_by_portal_session_token(token)
    verify_portal_session_token(token).first
  end

  def self.portal_session_verifier
    Rails.application.message_verifier('sponsor-portal-session')
  end

  private

  def website_url_must_be_http
    return if website_url.blank?

    uri = URI.parse(website_url.to_s.strip)
    unless uri.is_a?(URI::HTTP) && uri.host.present? && uri.userinfo.nil?
      errors.add(:website_url, 'must be a valid http or https URL')
    end
  rescue URI::InvalidURIError
    errors.add(:website_url, 'must be a valid http or https URL')
  end

  def normalize_hole_assignment
    self.course_key = course_key.presence
    self.hole_number = hole_number.presence

    unless hole_sponsor?
      self.course_key = nil
      self.hole_number = nil
      return
    end

    if course_key.blank? && tournament.present? && !tournament.multi_course_setup?
      self.course_key = tournament.default_course_key
    end
  end

  def tier_must_be_valid
    return if tier.blank?
    return if sponsor_tier.present? && sponsor_tier.key.to_s.downcase == tier.to_s.downcase

    allowed = (tournament&.sponsor_tier_keys || DEFAULT_TIERS).map { |k| k.to_s.downcase }
    return if allowed.include?(tier.to_s.downcase)

    errors.add(:tier, "must be one of: #{allowed.join(', ')}")
  end

  def sponsor_tier_matches_tournament
    return if sponsor_tier.blank? || tournament_id.blank?
    return if sponsor_tier.tournament_id == tournament_id

    errors.add(:sponsor_tier_id, "must belong to the same tournament")
  end

  def course_key_must_exist_in_tournament
    return unless course_key.present? && tournament.present?
    return if tournament.course_config_for(course_key).present?

    errors.add(:course_key, "is not configured for this event")
  end

  def hole_number_within_course_range
    return unless course_key.present? && hole_number.present? && tournament.present?
    return if errors[:course_key].present?

    max_holes = tournament.hole_count_for_course(course_key)
    unless max_holes.positive?
      errors.add(:course_key, "is not configured for a valid hole range")
      return
    end
    return if hole_number <= max_holes

    errors.add(:hole_number, "must be between 1 and #{max_holes} for #{course_name}")
  end

  def sync_sponsor_slots
    return unless saved_change_to_slot_count?
    return if %w[pending pending_check].include?(payment_status) && !active?

    target_count = slot_count.to_i
    excess_slots = sponsor_slots.where("slot_number > ?", target_count).order(slot_number: :desc).to_a

    if excess_slots.any?
      filled_excess = excess_slots.select(&:filled?)
      if filled_excess.any?
        filled_excess.each do |slot|
          slot.update!(player_name: nil, player_email: nil, player_phone: nil, tshirt_size: nil, handicap: nil)
        end
        SponsorSlotSyncer.new(self).sync_slots(filled_excess)
      end
      excess_slots.each(&:destroy!)
    end

    # Ensure slots 1..target_count exist contiguously (also fills any legacy gaps).
    provision_sponsor_slots! if target_count.positive?
  end
end
