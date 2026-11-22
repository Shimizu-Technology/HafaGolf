# frozen_string_literal: true

class QaFixesEntryFeeDefaultAndRegistrationEmployeeNumbers < ActiveRecord::Migration[8.1]
  def change
    change_column_default :tournaments, :entry_fee_display, from: "$300/team", to: nil

    reversible do |dir|
      dir.up do
        execute <<~SQL.squish
          UPDATE tournaments
          SET entry_fee_display = NULL
          WHERE entry_fee_display = '$300/team'
            AND (entry_fee IS DISTINCT FROM 30000 OR capacity_unit = 'players' OR team_size = 1)
        SQL
      end
    end

    add_reference :employee_numbers, :used_by_registration,
                  null: true,
                  foreign_key: { to_table: :registrations, on_delete: :nullify }
  end
end
