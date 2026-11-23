# frozen_string_literal: true

class RegistrationSerializer < ActiveModel::Serializer
  attributes :id, :organization_id, :tournament_id, :group_id, :sponsor_id, :golfer_id,
             :team_name, :display_team_name, :team_category,
             :registration_source, :registration_status,
             :contact_name, :contact_email, :contact_phone, :company, :notes,
             :payment_type, :payment_status, :payment_method, :payment_amount_cents,
             :expected_entry_fee_cents, :is_employee, :employee_number,
             :paid_at, :payment_verified_at, :payment_verified_by_id, :payment_verified_by_name,
             :payment_token, :receipt_number, :payment_notes,
             :stripe_card_brand, :stripe_card_last4, :stripe_account_origin,
             :refund_amount_cents, :refund_reason, :refunded_at,
             :raffle_tickets_requested, :raffle_bundle_label,
             :add_ons_summary, :add_ons_total_cents, :add_ons,
             :player_count, :checked_in_count, :all_checked_in, :partially_checked_in,
             :starting_position_label, :starting_hole_description,
             :team_members,
             :created_at, :updated_at

  def display_team_name
    object.display_team_name
  end

  def expected_entry_fee_cents
    object.expected_entry_fee_cents
  end

  def is_employee
    object.is_employee?
  end

  def employee_number
    object.employee_number
  end

  def player_count
    object.player_count
  end

  def checked_in_count
    object.checked_in_count
  end

  def all_checked_in
    object.all_checked_in?
  end

  def partially_checked_in
    object.partially_checked_in?
  end

  def starting_position_label
    object.group&.starting_position_label
  end

  def starting_hole_description
    object.group&.starting_hole_description
  end

  def add_ons_summary
    object.add_ons_summary
  end

  def add_ons_total_cents
    object.add_ons_total_cents
  end

  def add_ons
    object.add_ons_breakdown
  end

  def team_members
    members = object.team_members.loaded? ? object.team_members.sort_by { |m| m.position || 99 } : object.team_members.order(:position)
    members.map { |member| TeamMemberSerializer.new(member).as_json }
  end
end
