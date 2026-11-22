# frozen_string_literal: true

class TournamentPayout < ApplicationRecord
  STATUSES = %w[pending paid voided].freeze
  PROVIDERS = %w[check manual ach].freeze

  belongs_to :organization
  belongs_to :tournament
  belongs_to :settlement, class_name: "TournamentSettlement"
  belongs_to :recorded_by, class_name: "User", optional: true

  validates :amount_cents, presence: true, numericality: { only_integer: true, greater_than: 0 }
  validates :currency, presence: true
  validates :status, presence: true, inclusion: { in: STATUSES }
  validates :provider, presence: true, inclusion: { in: PROVIDERS }
  validates :idempotency_key, uniqueness: { scope: :tournament_id }, allow_nil: true
  validates :void_reason, presence: true, if: :voided?

  validate :associations_share_tournament_and_org
  validate :voided_payout_is_terminal, on: :update

  before_validation :sync_tenant_fields

  scope :recent_first, -> { order(created_at: :desc) }

  def pending?
    status == "pending"
  end

  def paid?
    status == "paid"
  end

  def voided?
    status == "voided"
  end

  def as_payout_json
    {
      id: id,
      organization_id: organization_id,
      tournament_id: tournament_id,
      settlement_id: settlement_id,
      amount_cents: amount_cents,
      currency: currency,
      status: status,
      provider: provider,
      provider_payout_id: provider_payout_id,
      payee_snapshot: payee_snapshot,
      initiated_at: initiated_at&.iso8601,
      paid_at: paid_at&.iso8601,
      voided_at: voided_at&.iso8601,
      void_reason: void_reason,
      recorded_by_name: recorded_by&.name || recorded_by&.email,
      notes: notes,
      idempotency_key: idempotency_key,
      created_at: created_at&.iso8601,
      updated_at: updated_at&.iso8601
    }
  end

  private

  def sync_tenant_fields
    if settlement.present?
      self.tournament_id ||= settlement.tournament_id
      self.organization_id ||= settlement.organization_id
    elsif tournament.present?
      self.organization_id ||= tournament.organization_id
    end
    self.provider_payout_id = provider_payout_id.to_s.strip.presence unless provider_payout_id.nil?
    self.idempotency_key = idempotency_key.to_s.strip.presence unless idempotency_key.nil?
  end

  def associations_share_tournament_and_org
    if settlement.present?
      if tournament_id != settlement.tournament_id
        errors.add(:tournament_id, "must match settlement tournament")
      end
      if organization_id != settlement.organization_id
        errors.add(:organization_id, "must match settlement organization")
      end
    end

    if tournament.present? && organization_id != tournament.organization_id
      errors.add(:organization_id, "must match tournament organization")
    end
  end

  def voided_payout_is_terminal
    return unless status_was == "voided" && status_changed?

    errors.add(:status, "cannot transition out of voided")
  end
end
