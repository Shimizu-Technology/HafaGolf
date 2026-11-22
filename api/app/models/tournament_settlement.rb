# frozen_string_literal: true

class TournamentSettlement < ApplicationRecord
  STATUSES = %w[draft finalized].freeze

  belongs_to :organization
  belongs_to :tournament
  belongs_to :finalized_by, class_name: "User", optional: true
  has_many :tournament_payouts, foreign_key: :settlement_id, dependent: :restrict_with_error

  validates :version, presence: true, numericality: { only_integer: true, greater_than_or_equal_to: 1 },
                      uniqueness: { scope: :tournament_id }
  validates :status, presence: true, inclusion: { in: STATUSES }
  validates :currency, presence: true
  validates :gross_cents, :refund_cents, :processing_fee_cents, :platform_fee_cents, :paid_cents,
            numericality: { only_integer: true, greater_than_or_equal_to: 0 }
  validates :adjustment_cents, :net_cents, :organizer_proceeds_cents, :payable_cents,
            numericality: { only_integer: true }

  validate :organization_matches_tournament
  validate :finalized_financials_are_immutable, on: :update

  before_validation :sync_organization_from_tournament

  scope :latest_first, -> { order(version: :desc) }

  def draft?
    status == "draft"
  end

  def finalized?
    status == "finalized"
  end

  def pending_payout_cents
    tournament.tournament_payouts.where(status: "pending").sum(:amount_cents)
  end

  def committed_payout_cents
    tournament.tournament_payouts.where(status: %w[pending paid]).sum(:amount_cents)
  end

  def remaining_payout_capacity_cents
    [organizer_proceeds_cents - committed_payout_cents, 0].max
  end

  def recalculate_paid_totals!
    paid = tournament.tournament_payouts.where(status: "paid").sum(:amount_cents)
    update!(
      paid_cents: paid,
      payable_cents: organizer_proceeds_cents - paid
    )
  end

  def finalize!(user:)
    raise ActiveRecord::RecordInvalid.new(self), "Settlement is already finalized" if finalized?

    update!(
      status: "finalized",
      finalized_at: Time.current,
      finalized_by: user
    )
  end

  def as_statement_json(current_source_digest: nil)
    {
      id: id,
      organization_id: organization_id,
      tournament_id: tournament_id,
      version: version,
      status: status,
      currency: currency,
      gross_cents: gross_cents,
      refund_cents: refund_cents,
      processing_fee_cents: processing_fee_cents,
      platform_fee_cents: platform_fee_cents,
      adjustment_cents: adjustment_cents,
      adjustment_notes: adjustment_notes,
      net_cents: net_cents,
      organizer_proceeds_cents: organizer_proceeds_cents,
      paid_cents: paid_cents,
      pending_payout_cents: pending_payout_cents,
      payable_cents: payable_cents,
      remaining_payout_capacity_cents: remaining_payout_capacity_cents,
      breakdown: breakdown_json,
      source_digest: source_digest,
      ledger_changed_since_calculation: current_source_digest.present? && source_digest != current_source_digest,
      calculated_at: calculated_at&.iso8601,
      finalized_at: finalized_at&.iso8601,
      finalized_by_name: finalized_by&.name || finalized_by&.email,
      created_at: created_at&.iso8601,
      updated_at: updated_at&.iso8601
    }
  end

  private

  def sync_organization_from_tournament
    self.organization_id ||= tournament&.organization_id
  end

  def organization_matches_tournament
    return if tournament.nil? || organization_id.nil?
    return if organization_id == tournament.organization_id

    errors.add(:organization_id, "must match tournament organization")
  end

  def finalized_financials_are_immutable
    return unless status_was == "finalized"

    immutable_fields = %w[
      status version currency gross_cents refund_cents processing_fee_cents
      platform_fee_cents adjustment_cents adjustment_notes net_cents
      organizer_proceeds_cents breakdown_json source_digest calculated_at
      finalized_at finalized_by_id
    ]
    changed_immutable = changed & immutable_fields
    return if changed_immutable.empty?

    errors.add(:base, "Finalized settlement financials are immutable (create a new draft version to recalculate)")
  end
end
