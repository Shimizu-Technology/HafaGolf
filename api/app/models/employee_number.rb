# frozen_string_literal: true

class EmployeeNumber < ApplicationRecord
  class AlreadyClaimedError < StandardError; end
  class TournamentMismatchError < StandardError; end

  belongs_to :organization
  belongs_to :tournament
  belongs_to :used_by_golfer, class_name: "Golfer", optional: true

  before_validation :normalize_fields
  before_validation :sync_organization_from_tournament

  validates :employee_number, presence: true, length: { maximum: 64 }
  validates :employee_number, uniqueness: {
    scope: :tournament_id,
    case_sensitive: false,
    message: "already exists for this tournament"
  }
  validates :organization_id, presence: true
  validates :tournament_id, presence: true
  validate :organization_matches_tournament

  scope :for_tournament, ->(tournament_id) { where(tournament_id: tournament_id) }
  scope :available, -> { where(used: false) }
  scope :used_numbers, -> { where(used: true) }
  scope :search, ->(query) {
    return all if query.blank?

    term = "%#{sanitize_sql_like(query.to_s.strip)}%"
    where("employee_number ILIKE :term OR employee_name ILIKE :term", term: term)
  }

  def self.normalize_number(value)
    value.to_s.strip.upcase.presence
  end

  def self.find_for_tournament(tournament, raw_number)
    normalized = normalize_number(raw_number)
    return nil if normalized.blank? || tournament.nil?

    where(tournament_id: tournament.id)
      .where("LOWER(employee_number) = ?", normalized.downcase)
      .first
  end

  def available?
    !used?
  end

  # Atomically claims this employee number for a persisted golfer using a row lock.
  # Compatible with outer transactions via `requires_new: true`.
  def claim!(golfer)
    raise ArgumentError, "Golfer must be persisted to claim an employee number" unless golfer&.persisted?

    if golfer.tournament_id != tournament_id
      raise TournamentMismatchError, "Employee number does not belong to this tournament"
    end

    ActiveRecord::Base.transaction(requires_new: true) do
      lock!

      if used? && used_by_golfer_id != golfer.id
        raise AlreadyClaimedError, "Employee number #{employee_number} has already been used"
      end

      unless used? && used_by_golfer_id == golfer.id
        update!(
          used: true,
          used_by_golfer: golfer,
          used_at: Time.current
        )
      end

      if golfer.employee_number_record_id != id || !golfer.is_employee?
        golfer.assign_attributes(is_employee: true, employee_number_record_id: id)
        golfer.save!(validate: false)
      end
    end

    self
  end

  # Releases this employee number so it becomes available again.
  # When `expected_golfer_id` is supplied, only releases if currently claimed by that golfer.
  def release!(clear_golfer: true, expected_golfer_id: nil)
    ActiveRecord::Base.transaction(requires_new: true) do
      lock!
      if expected_golfer_id.present? && used_by_golfer_id != expected_golfer_id
        return self
      end

      previous_golfer = used_by_golfer

      update!(
        used: false,
        used_by_golfer: nil,
        used_at: nil
      )

      if clear_golfer && previous_golfer.present? && previous_golfer.employee_number_record_id == id
        previous_golfer.assign_attributes(is_employee: false, employee_number_record_id: nil)
        previous_golfer.save!(validate: false)
      end
    end

    self
  end

  private

  def normalize_fields
    self.employee_number = self.class.normalize_number(employee_number)
    self.employee_name = employee_name.to_s.strip.presence
  end

  def sync_organization_from_tournament
    return if tournament.nil?

    self.organization_id ||= tournament.organization_id
  end

  def organization_matches_tournament
    return if tournament.nil? || organization_id.blank?
    return if organization_id == tournament.organization_id

    errors.add(:organization_id, "must match the tournament's organization")
  end
end
