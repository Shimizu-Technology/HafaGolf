# frozen_string_literal: true

class TeamMember < ApplicationRecord
  MAGIC_LINK_EXPIRY = 24.hours

  # Associations
  belongs_to :organization
  belongs_to :tournament
  belongs_to :registration, inverse_of: :team_members
  belongs_to :sponsor_slot, optional: true
  belongs_to :checked_in_by, class_name: "User", foreign_key: :checked_in_by_id, optional: true

  has_many :scores, dependent: :destroy
  has_many :raffle_tickets, dependent: :nullify

  before_destroy :release_employee_number_if_claimed!, prepend: true

  # Scopes
  scope :checked_in, -> { where.not(checked_in_at: nil) }
  scope :not_checked_in, -> { where(checked_in_at: nil) }
  scope :captains, -> { where(is_captain: true) }
  scope :ordered, -> { order(:position) }

  # Callbacks
  before_validation :sync_tenant_from_registration
  before_validation :normalize_email

  # Validations
  validates :organization_id, presence: true
  validates :tournament_id, presence: true
  validates :name, presence: true
  validates :position, presence: true,
                       numericality: { only_integer: true, greater_than_or_equal_to: 1, less_than_or_equal_to: 4 }
  validates :position, uniqueness: { scope: :registration_id }
  validates :email, format: { with: URI::MailTo::EMAIL_REGEXP }, allow_blank: true
  validates :handicap, numericality: { greater_than_or_equal_to: -10, less_than_or_equal_to: 54 }, allow_nil: true

  validate :tenant_matches_registration
  validate :group_capacity_not_exceeded, on: :create

  def checked_in?
    checked_in_at.present?
  end

  def check_in!(admin: nil)
    return true if checked_in?

    update!(
      checked_in_at: Time.current,
      checked_in_by_id: admin&.id,
      checked_in_by_name: admin&.name || admin&.email
    )
  end

  def undo_check_in!
    return true unless checked_in?

    update!(
      checked_in_at: nil,
      checked_in_by_id: nil,
      checked_in_by_name: nil
    )
  end

  def generate_magic_link!
    token = SecureRandom.urlsafe_base64(32)
    update!(
      magic_link_token: token,
      magic_link_expires_at: Time.current + MAGIC_LINK_EXPIRY
    )
    token
  end

  def magic_link_valid?
    magic_link_token.present? &&
      magic_link_expires_at.present? &&
      magic_link_expires_at > Time.current
  end

  def clear_magic_link!
    update!(magic_link_token: nil, magic_link_expires_at: nil)
  end

  def self.find_by_magic_link(token)
    return nil if token.blank?

    member = find_by(magic_link_token: token)
    return nil unless member&.magic_link_valid?

    member
  end

  private

  def release_employee_number_if_claimed!
    return if employee_number_record_id.blank?

    record = EmployeeNumber.find_by(id: employee_number_record_id)
    record&.release!(clear_golfer: false, expected_registration_id: registration_id)
  end

  def sync_tenant_from_registration
    return unless registration

    self.organization_id ||= registration.organization_id || registration.tournament&.organization_id
    self.tournament_id ||= registration.tournament_id
  end

  def normalize_email
    self.email = email.strip.downcase if email.present?
  end

  def tenant_matches_registration
    return unless registration

    if registration.organization_id.present? && organization_id.present? && organization_id != registration.organization_id
      errors.add(:organization_id, "must match registration organization")
    end

    if registration.tournament_id.present? && tournament_id.present? && tournament_id != registration.tournament_id
      errors.add(:tournament_id, "must match registration tournament")
    end
  end

  def group_capacity_not_exceeded
    return unless registration&.persisted? && registration.group.present? && !registration.cancelled?

    group = registration.group
    projected_reg_players = if registration.team_members.loaded?
      active = registration.active_team_members
      active.include?(self) ? active.size : active.size + 1
    else
      registration.team_members.count + 1
    end

    if group.player_count_excluding_registration(registration) + projected_reg_players > group.max_golfers
      errors.add(:base, "Adding this player would exceed starting position capacity of #{group.max_golfers} players")
    end
  end
end
