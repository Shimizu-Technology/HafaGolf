# frozen_string_literal: true

class TournamentAddOn < ApplicationRecord
  CATEGORIES = %w[mulligans contest super_ticket raffle_bundle other].freeze

  belongs_to :organization
  belongs_to :tournament
  has_many :golfer_add_ons, dependent: :restrict_with_error

  before_validation :assign_organization_from_tournament
  before_validation :normalize_fields

  validates :name, presence: true, length: { maximum: 120 }
  validates :price_cents, presence: true, numericality: { only_integer: true, greater_than_or_equal_to: 0 }
  validates :max_quantity_per_order, presence: true, numericality: { only_integer: true, greater_than: 0, less_than_or_equal_to: 50 }
  validates :max_total_quantity, numericality: { only_integer: true, greater_than: 0 }, allow_nil: true
  validates :category, presence: true, inclusion: { in: CATEGORIES }
  validates :sort_order, presence: true, numericality: { only_integer: true, greater_than_or_equal_to: 0 }
  validates :active, inclusion: { in: [true, false] }
  validate :organization_matches_tournament

  scope :ordered, -> { order(:sort_order, :id) }
  scope :active, -> { where(active: true) }

  def self.sold_quantities_by_add_on_id(add_on_ids)
    ids = Array(add_on_ids).compact
    return {} if ids.empty?

    GolferAddOn
      .where(tournament_add_on_id: ids)
      .left_outer_joins(:golfer, :registration)
      .where("golfers.id IS NULL OR golfers.registration_status IS DISTINCT FROM 'cancelled'")
      .where("registrations.id IS NULL OR registrations.registration_status IS DISTINCT FROM 'cancelled'")
      .group(:tournament_add_on_id)
      .sum(:quantity)
      .transform_values(&:to_i)
  end

  def sold_quantity(precomputed_sold: nil)
    return precomputed_sold.to_i unless precomputed_sold.nil?

    self.class.sold_quantities_by_add_on_id([id]).fetch(id, 0)
  end

  def remaining_quantity(precomputed_sold: nil)
    return nil if max_total_quantity.nil?

    [max_total_quantity - sold_quantity(precomputed_sold: precomputed_sold), 0].max
  end

  def sold_out?(precomputed_sold: nil)
    max_total_quantity.present? && remaining_quantity(precomputed_sold: precomputed_sold) <= 0
  end

  def as_public_json(precomputed_sold: nil, include_admin_fields: false)
    sold = sold_quantity(precomputed_sold: precomputed_sold)
    remaining = max_total_quantity.nil? ? nil : [max_total_quantity - sold, 0].max

    payload = {
      id: id,
      organization_id: organization_id,
      tournament_id: tournament_id,
      name: name,
      description: description,
      price_cents: price_cents,
      max_quantity_per_order: max_quantity_per_order,
      max_total_quantity: max_total_quantity,
      remaining_quantity: remaining,
      sold_out: max_total_quantity.present? && remaining <= 0,
      category: category,
      active: active,
      sort_order: sort_order
    }

    if include_admin_fields
      payload[:sold_quantity] = sold
      payload[:revenue_cents] = sold * price_cents
      payload[:created_at] = created_at&.iso8601
      payload[:updated_at] = updated_at&.iso8601
    end

    payload
  end

  private

  def assign_organization_from_tournament
    self.organization_id ||= tournament&.organization_id
  end

  def normalize_fields
    self.name = name.to_s.strip.presence if name.present?
    self.description = description.to_s.strip.presence
    self.category = category.to_s.strip.downcase.presence || "super_ticket"
  end

  def organization_matches_tournament
    return if organization_id.blank? || tournament.blank?
    return if organization_id.to_s == tournament.organization_id.to_s

    errors.add(:organization_id, "must match the tournament's organization")
  end
end
