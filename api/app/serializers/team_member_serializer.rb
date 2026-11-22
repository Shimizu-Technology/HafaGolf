# frozen_string_literal: true

class TeamMemberSerializer < ActiveModel::Serializer
  attributes :id, :organization_id, :tournament_id, :registration_id, :sponsor_slot_id,
             :position, :is_captain, :name, :email, :phone, :mobile,
             :company, :address, :tshirt_size, :handicap,
             :is_employee, :employee_number_record_id,
             :waiver_accepted_at, :waiver_signed,
             :checked_in_at, :checked_in, :checked_in_by_id, :checked_in_by_name,
             :created_at, :updated_at

  def waiver_signed
    object.waiver_accepted_at.present?
  end

  def checked_in
    object.checked_in?
  end

  def handicap
    object.handicap&.to_f
  end
end
