# frozen_string_literal: true

class QaFixesEntryFeeDefaultAndRegistrationEmployeeNumbers < ActiveRecord::Migration[8.1]
  def change
    change_column_default :tournaments, :entry_fee_display, from: "$300/team", to: nil

    add_reference :employee_numbers, :used_by_registration,
                  null: true,
                  foreign_key: { to_table: :registrations, on_delete: :nullify }
  end
end
