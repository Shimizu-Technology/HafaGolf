# frozen_string_literal: true

class GolferAddOn < ApplicationRecord
  belongs_to :organization
  belongs_to :tournament
  belongs_to :golfer, optional: true
  belongs_to :registration, optional: true
  belongs_to :tournament_add_on

  before_validation :assign_scope_from_owner

  validates :quantity, presence: true, numericality: { only_integer: true, greater_than: 0 }
  validates :unit_price_cents, presence: true, numericality: { only_integer: true, greater_than_or_equal_to: 0 }
  validate :owner_present
  validate :associations_match_tournament

  def line_total_cents
    quantity.to_i * unit_price_cents.to_i
  end

  def as_summary_json(include_prices: true)
    payload = {
      id: id,
      tournament_add_on_id: tournament_add_on_id,
      name: tournament_add_on&.name,
      category: tournament_add_on&.category,
      quantity: quantity
    }

    if include_prices
      payload[:unit_price_cents] = unit_price_cents
      payload[:line_total_cents] = line_total_cents
    end

    payload
  end

  private

  def assign_scope_from_owner
    owner = registration || golfer
    self.tournament_id ||= owner&.tournament_id || tournament_add_on&.tournament_id
    self.organization_id ||= tournament&.organization_id || tournament_add_on&.organization_id
    if unit_price_cents.nil? && tournament_add_on.present?
      self.unit_price_cents = tournament_add_on.price_cents
    end
  end

  def owner_present
    return if golfer_id.present? || registration_id.present?

    errors.add(:base, "Add-on purchase must belong to a golfer or registration")
  end

  def associations_match_tournament
    if tournament_add_on.present? && tournament_id.present? && tournament_add_on.tournament_id != tournament_id
      errors.add(:tournament_add_on_id, "must belong to the same tournament")
    end

    if golfer.present? && tournament_id.present? && golfer.tournament_id != tournament_id
      errors.add(:golfer_id, "must belong to the same tournament")
    end

    if registration.present? && tournament_id.present? && registration.tournament_id != tournament_id
      errors.add(:registration_id, "must belong to the same tournament")
    end

    if tournament.present? && organization_id.present? && organization_id.to_s != tournament.organization_id.to_s
      errors.add(:organization_id, "must match the tournament's organization")
    end
  end
end
