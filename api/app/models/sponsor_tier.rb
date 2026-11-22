# frozen_string_literal: true

class SponsorTier < ApplicationRecord
  belongs_to :organization
  belongs_to :tournament
  has_many :sponsors, dependent: :nullify

  before_validation :assign_organization_from_tournament
  before_validation :normalize_fields

  validates :key,
            presence: true,
            format: { with: /\A[a-z0-9_-]+\z/, message: "only allows lowercase letters, numbers, hyphens, and underscores" },
            uniqueness: { scope: :tournament_id, case_sensitive: false }
  validates :label, presence: true
  validates :price_cents, presence: true, numericality: { only_integer: true, greater_than_or_equal_to: 0 }
  validates :included_player_slots, presence: true, numericality: { only_integer: true, greater_than_or_equal_to: 0 }
  validates :max_quantity, numericality: { only_integer: true, greater_than: 0 }, allow_nil: true
  validates :sort_order, presence: true, numericality: { only_integer: true, greater_than_or_equal_to: 0 }
  validate :organization_matches_tournament

  scope :ordered, -> { order(:sort_order, :id) }
  scope :online_enabled, -> { where(online_checkout_enabled: true) }

  def claimed_count
    sponsors.where(payment_status: %w[paid pending])
            .or(sponsors.where(active: true, payment_status: "unpaid"))
            .count
  end

  def sold_count
    sponsors.where(payment_status: "paid").count
  end

  def remaining_quantity
    return nil if max_quantity.nil?

    [max_quantity - claimed_count, 0].max
  end

  def sold_out?
    max_quantity.present? && remaining_quantity <= 0
  end

  def as_public_json
    {
      id: id,
      organization_id: organization_id,
      tournament_id: tournament_id,
      key: key,
      label: label,
      description: description,
      price_cents: price_cents,
      included_player_slots: included_player_slots,
      max_quantity: max_quantity,
      claimed_count: claimed_count,
      sold_count: sold_count,
      remaining_quantity: remaining_quantity,
      sold_out: sold_out?,
      benefits: Array(benefits),
      online_checkout_enabled: online_checkout_enabled,
      sort_order: sort_order,
      created_at: created_at&.iso8601,
      updated_at: updated_at&.iso8601
    }
  end

  private

  def assign_organization_from_tournament
    self.organization_id ||= tournament&.organization_id
  end

  def normalize_fields
    self.label = label.to_s.strip.presence if label.present?
    if key.blank? && label.present?
      self.key = label.downcase.gsub(/[^a-z0-9]+/, "_").gsub(/\A_|_\z/, "")
    elsif key.present?
      self.key = key.to_s.strip.downcase
    end
    self.description = description.to_s.strip.presence
    self.benefits = Array(benefits).map { |item| item.to_s.strip }.reject(&:blank?)
  end

  def organization_matches_tournament
    return if organization_id.blank? || tournament.blank?
    return if organization_id.to_s == tournament.organization_id.to_s

    errors.add(:organization_id, "must match the tournament's organization")
  end
end
