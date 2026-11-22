# frozen_string_literal: true

class Registration < ApplicationRecord
  SOURCES = %w[public admin sponsor walk_in].freeze
  STATUSES = %w[confirmed waitlist pending cancelled].freeze
  PAYMENT_TYPES = %w[stripe pay_on_day swipe_simple walk_in sponsor offline comp].freeze
  PAYMENT_STATUSES = %w[unpaid pending paid refunded].freeze

  # Associations
  belongs_to :organization
  belongs_to :tournament
  belongs_to :group, optional: true
  belongs_to :sponsor, optional: true
  belongs_to :golfer, optional: true
  belongs_to :payment_verified_by, class_name: "User", foreign_key: :payment_verified_by_id, optional: true
  belongs_to :refunded_by, class_name: "User", optional: true

  has_many :team_members, -> { order(:position) }, dependent: :destroy, inverse_of: :registration
  has_many :scores, dependent: :destroy
  has_many :raffle_tickets, dependent: :nullify
  has_one :employee_number_record, class_name: "EmployeeNumber", foreign_key: :used_by_registration_id, dependent: :nullify

  before_destroy :release_claimed_employee_numbers!

  accepts_nested_attributes_for :team_members, allow_destroy: true

  # Scopes
  scope :active, -> { where.not(registration_status: "cancelled") }
  scope :confirmed, -> { where(registration_status: "confirmed") }
  scope :waitlist, -> { where(registration_status: "waitlist") }
  scope :pending, -> { where(registration_status: "pending") }
  scope :cancelled, -> { where(registration_status: "cancelled") }
  scope :paid, -> { where(payment_status: "paid") }
  scope :unpaid, -> { where.not(payment_status: "paid") }
  scope :for_tournament, ->(tournament_id) { where(tournament_id: tournament_id) }

  # Callbacks
  before_validation :assign_organization_from_tournament
  before_validation :sync_team_member_defaults
  before_validation :populate_contact_from_captain
  before_validation :set_registration_status_from_capacity, on: :create
  before_validation :set_default_payment_status, on: :create

  # Validations
  validates :organization_id, presence: true
  validates :tournament_id, presence: true
  validates :registration_source, presence: true, inclusion: { in: SOURCES }
  validates :registration_status, presence: true, inclusion: { in: STATUSES }
  validates :payment_type, inclusion: { in: PAYMENT_TYPES }, allow_blank: true
  validates :payment_status, inclusion: { in: PAYMENT_STATUSES }, allow_blank: true
  validates :contact_email, format: { with: URI::MailTo::EMAIL_REGEXP }, allow_blank: true

  validate :organization_matches_tournament
  validate :group_belongs_to_same_tournament
  validate :group_capacity_not_exceeded
  validate :team_category_matches_tournament_config
  validate :team_members_count_within_tournament_rules
  validate :no_duplicate_emails_in_active_public_tournament
  validate :capacity_available_on_create, on: :create

  # Track explicit status assignment so DB default ("confirmed") does not mask auto-waitlisting
  def registration_status=(value)
    @registration_status_explicitly_set = value.present?
    super
  end

  def active_team_members
    team_members.reject(&:marked_for_destruction?)
  end

  def player_count
    if team_members.loaded? || new_record?
      active_team_members.size
    else
      team_members.count
    end
  end

  def captain
    ordered = team_members.loaded? ? active_team_members.sort_by { |m| m.position || 99 } : team_members.order(:position)
    ordered.find(&:is_captain?) || ordered.first
  end

  def sponsored?
    payment_type == "sponsor"
  end

  def cancelled?
    registration_status == "cancelled"
  end

  def checked_in_count
    if team_members.loaded?
      active_team_members.count(&:checked_in?)
    else
      team_members.checked_in.count
    end
  end

  def all_checked_in?
    total = player_count
    total.positive? && checked_in_count == total
  end

  def partially_checked_in?
    checked_in_count.positive? && !all_checked_in?
  end

  def display_team_name
    team_name.presence ||
      active_team_members.map(&:name).reject(&:blank?).join(" & ").presence ||
      contact_name.presence ||
      "Registration ##{id}"
  end

  # Used by ActivityLog target_name
  def name
    display_team_name
  end

  def generate_payment_token!
    return payment_token if payment_token.present?

    loop do
      token = SecureRandom.urlsafe_base64(24)
      unless Registration.exists?(payment_token: token) || Golfer.exists?(payment_token: token)
        update!(payment_token: token)
        return token
      end
    end
  end

  def expected_entry_fee_cents(player_count_override: nil, employee_discount: nil)
    base_fee = (tournament&.current_fee || tournament&.entry_fee || 0).to_i
    players = [player_count_override || player_count, 1].max
    has_employee = if employee_discount.nil?
                     active_team_members.any?(&:is_employee?) || employee_number_record.present?
                   else
                     employee_discount
                   end
    employee_fee = tournament&.employee_entry_fee

    if tournament&.capacity_unit == "players" || tournament&.team_size.to_i == 1
      if has_employee && employee_fee.present?
        employee_fee.to_i + (base_fee * [players - 1, 0].max)
      else
        base_fee * players
      end
    elsif has_employee && employee_fee.present?
      employee_fee.to_i
    else
      base_fee
    end
  end

  def is_employee?
    active_team_members.any?(&:is_employee?) || employee_number_record.present?
  end

  def employee_number
    employee_number_record&.employee_number
  end

  def verify_payment!(admin:, method: nil, notes: nil, amount_cents: nil)
    attrs = {
      payment_status: "paid",
      paid_at: paid_at || Time.current,
      payment_method: method.presence || payment_method,
      payment_notes: notes.presence || payment_notes,
      payment_verified_by_id: admin&.id,
      payment_verified_by_name: admin&.name || admin&.email,
      payment_verified_at: Time.current
    }
    attrs[:registration_status] = "confirmed" if registration_status == "pending"
    attrs[:payment_amount_cents] = amount_cents || payment_amount_cents || expected_entry_fee_cents

    update!(attrs)
  end

  def cancel!(admin: nil, reason: nil)
    ActiveRecord::Base.transaction(requires_new: true) do
      update!(
        group_id: nil,
        registration_status: "cancelled",
        refund_reason: reason,
        refunded_at: Time.current,
        refunded_by: admin
      )
      release_claimed_employee_numbers!
    end
  end

  def release_claimed_employee_numbers!
    return unless persisted?

    EmployeeNumber.where(used_by_registration_id: id).find_each do |record|
      record.release!(expected_registration_id: id)
    end
  end

  # Creates 1 complimentary raffle ticket per team_member, idempotent via (registration_id, team_member_id)
  def create_raffle_tickets!
    return [] unless tournament&.raffle_enabled?
    return [] unless tournament.raffle_include_with_registration?
    return [] if cancelled? || registration_status == "waitlist"

    synced_tickets = []

    ActiveRecord::Base.transaction(requires_new: true) do
      tournament.lock!
      members = team_members.order(:position).to_a
      active_member_ids = members.map(&:id)

      existing_by_member = tournament.raffle_tickets
        .where(registration_id: id, price_cents: [0, nil])
        .index_by(&:team_member_id)

      # Remove complimentary tickets for members no longer on this registration (unless already a winner)
      existing_by_member.each do |member_id, ticket|
        next if active_member_ids.include?(member_id)
        ticket.destroy! unless ticket.is_winner?
      end

      members.each do |member|
        member_email = member.email.presence || contact_email
        member_phone = normalized_raffle_phone(member.phone.presence || member.mobile.presence || contact_phone)
        existing_ticket = existing_by_member[member.id]

        if existing_ticket
          existing_ticket.update!(
            purchaser_name: member.name,
            purchaser_email: member_email,
            purchaser_phone: member_phone
          )
          synced_tickets << existing_ticket
        else
          ticket = tournament.raffle_tickets.create!(
            registration_id: id,
            team_member_id: member.id,
            purchaser_name: member.name,
            purchaser_email: member_email,
            purchaser_phone: member_phone,
            price_cents: 0,
            payment_status: "paid",
            purchased_at: Time.current
          )
          synced_tickets << ticket
        end
      end
    end

    synced_tickets
  end

  private

  def assign_organization_from_tournament
    self.organization_id ||= tournament&.organization_id
  end

  def sync_team_member_defaults
    members = active_team_members
    return if members.empty?

    used_positions = members.map(&:position).compact
    next_position = 1

    members.each do |member|
      member.organization_id ||= organization_id
      member.tournament_id ||= tournament_id

      if member.position.blank?
        next_position += 1 while used_positions.include?(next_position)
        member.position = next_position
        used_positions << next_position
      end
    end

    unless members.any?(&:is_captain?)
      first_member = members.min_by { |m| m.position || 99 }
      first_member.is_captain = true if first_member
    end
  end

  def populate_contact_from_captain
    cap = captain
    if cap
      self.contact_name = cap.name if contact_name.blank? && cap.name.present?
      self.contact_email = cap.email if contact_email.blank? && cap.email.present?
      self.contact_phone = cap.phone.presence || cap.mobile if contact_phone.blank? && (cap.phone.present? || cap.mobile.present?)
    end

    self.contact_email = contact_email.strip.downcase if contact_email.present?
  end

  def set_registration_status_from_capacity
    return if @registration_status_explicitly_set
    return unless tournament

    if sponsored? || registration_source == "admin"
      write_attribute(:registration_status, "confirmed")
      return
    end

    computed = tournament.registration_status_for_new_entry(
      player_count: [active_team_members.size, 1].max,
      registration_source: registration_source,
      payment_type: payment_type
    )
    write_attribute(:registration_status, computed)
  end

  def set_default_payment_status
    return if payment_status.present?

    self.payment_status = sponsored? ? "paid" : "unpaid"
  end

  def organization_matches_tournament
    return unless tournament && organization_id.present?
    return if organization_id == tournament.organization_id

    errors.add(:organization_id, "must match the tournament organization")
  end

  def group_belongs_to_same_tournament
    return unless group.present? && tournament_id.present?
    return if group.tournament_id == tournament_id

    errors.add(:group, "must belong to the same tournament")
  end

  def group_capacity_not_exceeded
    return unless group.present? && !cancelled?

    return if group.can_add_registration?(self)

    errors.add(:group, "would exceed starting position capacity of #{group.max_golfers} players")
  end

  def team_category_matches_tournament_config
    return unless tournament
    return if sponsored?

    categories = tournament.team_categories
    return if categories.empty?

    if team_category.blank?
      errors.add(:team_category, "can't be blank")
    elsif !categories.include?(team_category)
      errors.add(:team_category, "must be one of: #{categories.join(', ')}")
    end
  end

  def team_members_count_within_tournament_rules
    return unless tournament
    return if cancelled?

    members = active_team_members
    max_size = [tournament.team_size.to_i, 1].max

    if members.empty?
      errors.add(:team_members, "must include at least 1 player")
      return
    end

    if members.size > max_size
      errors.add(:team_members, "cannot exceed tournament team size of #{max_size}")
      return
    end

    positions = members.map(&:position).compact
    if positions.uniq.size != positions.size
      errors.add(:team_members, "must have unique player positions")
    end

    allow_partial = tournament.allow_partial_teams? || registration_source == "admin" || sponsored? || legacy_source.present?
    if !allow_partial && members.size < max_size
      errors.add(:team_members, "must include exactly #{max_size} #{'player'.pluralize(max_size)} (partial teams are not enabled)")
    end
  end

  def no_duplicate_emails_in_active_public_tournament
    return if cancelled? || registration_source == "admin" || tournament_id.blank?

    member_emails = active_team_members
      .filter_map { |m| m.email&.strip&.downcase.presence }

    if member_emails.uniq.size != member_emails.size
      errors.add(:base, "Duplicate player email addresses are not allowed on the same registration")
      return
    end

    emails_to_check = (member_emails + [contact_email&.strip&.downcase.presence]).compact.uniq
    return if emails_to_check.empty?

    # Check active public team_members in the same tournament
    member_scope = TeamMember.joins(:registration)
      .where(tournament_id: tournament_id)
      .where("LOWER(team_members.email) IN (?)", emails_to_check)
      .where("COALESCE(registrations.registration_source, 'public') <> 'admin'")
      .where("registrations.registration_status IS DISTINCT FROM 'cancelled'")
    member_scope = member_scope.where.not(registration_id: id) if persisted?

    if member_scope.exists?
      errors.add(:base, "One or more players are already registered for this tournament")
      return
    end

    # Check active public registrations' contact_email in the same tournament
    if contact_email.present?
      reg_scope = Registration.where(tournament_id: tournament_id)
        .where("LOWER(contact_email) = ?", contact_email.downcase)
        .where("COALESCE(registration_source, 'public') <> 'admin'")
        .where("registration_status IS DISTINCT FROM 'cancelled'")
      reg_scope = reg_scope.where.not(id: id) if persisted?

      if reg_scope.exists?
        errors.add(:contact_email, "has already registered for this tournament")
      end
    end
  end

  def capacity_available_on_create
    return unless tournament
    return if cancelled? || sponsored? || registration_source == "admin"

    incoming_players = [active_team_members.size, 1].max

    if registration_status == "confirmed" && !@registration_status_explicitly_set
      unless tournament.public_capacity_available_for?(player_count: incoming_players)
        errors.add(:base, "Tournament is at capacity and waitlist is closed")
      end
    elsif registration_status == "waitlist"
      if tournament.waitlist_max.to_i.positive? && tournament.registration_waitlist_full?(player_count: incoming_players)
        errors.add(:base, "Waitlist is currently full")
      end
    end
  end

  def normalized_raffle_phone(raw)
    return raw if raw.blank?

    RafflePhoneValidator.normalize(raw).presence || raw
  end
end
