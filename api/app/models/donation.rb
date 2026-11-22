# frozen_string_literal: true

class Donation < ApplicationRecord
  PAYMENT_TYPES = %w[stripe cash check offline external_link].freeze
  PAYMENT_STATUSES = %w[pending paid refunded failed expired cancelled].freeze

  belongs_to :organization
  belongs_to :tournament, optional: true

  before_validation :assign_organization_from_tournament
  before_validation :normalize_fields

  validates :donor_name, presence: true
  validates :donor_email, format: { with: URI::MailTo::EMAIL_REGEXP }, allow_blank: true
  validates :amount_cents, presence: true, numericality: { only_integer: true, greater_than: 0 }
  validates :payment_type, presence: true, inclusion: { in: PAYMENT_TYPES }
  validates :payment_status, presence: true, inclusion: { in: PAYMENT_STATUSES }
  validates :stripe_fee_cents, numericality: { only_integer: true, greater_than_or_equal_to: 0 }, allow_nil: true
  validates :refund_amount_cents, presence: true, numericality: { only_integer: true, greater_than_or_equal_to: 0 }
  validates :message, length: { maximum: 500 }, allow_blank: true
  validate :organization_matches_tournament

  scope :paid, -> { where(payment_status: "paid") }
  scope :recent, -> { order(Arel.sql("COALESCE(paid_at, created_at) DESC, id DESC")) }

  def tax_deductible_cents
    [amount_cents.to_i - refund_amount_cents.to_i, 0].max
  end

  def public_display_name
    anonymous? ? "Anonymous" : donor_name
  end

  def public_wall_json
    {
      id: id,
      display_name: public_display_name,
      anonymous: anonymous?,
      amount_cents: amount_cents,
      message: message,
      paid_at: paid_at&.iso8601
    }
  end

  def admin_json
    {
      id: id,
      organization_id: organization_id,
      tournament_id: tournament_id,
      donor_name: donor_name,
      donor_email: donor_email,
      donor_phone: donor_phone,
      amount_cents: amount_cents,
      tax_deductible_cents: tax_deductible_cents,
      payment_type: payment_type,
      payment_status: payment_status,
      payment_method: payment_method,
      stripe_account_origin: stripe_account_origin,
      stripe_fee_cents: stripe_fee_cents,
      refund_amount_cents: refund_amount_cents,
      refunded_at: refunded_at&.iso8601,
      anonymous: anonymous?,
      message: message,
      paid_at: paid_at&.iso8601,
      tax_receipt_sent_at: tax_receipt_sent_at&.iso8601,
      created_at: created_at&.iso8601,
      updated_at: updated_at&.iso8601
    }
  end

  private

  def assign_organization_from_tournament
    self.organization_id ||= tournament&.organization_id
  end

  def normalize_fields
    self.donor_name = donor_name.to_s.strip.presence
    self.donor_email = donor_email.to_s.strip.downcase.presence
    self.donor_phone = donor_phone.to_s.strip.presence
    self.message = message.to_s.strip.presence
    self.payment_type = payment_type.to_s.strip.downcase.presence || "stripe"
    self.payment_status = payment_status.to_s.strip.downcase.presence || "pending"
    self.payment_method = payment_method.to_s.strip.downcase.presence
  end

  def organization_matches_tournament
    return if organization_id.blank? || tournament.blank?
    return if organization_id.to_s == tournament.organization_id.to_s

    errors.add(:organization_id, "must match the tournament's organization")
  end
end
