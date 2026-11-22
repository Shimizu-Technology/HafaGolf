# frozen_string_literal: true

class CreateEmployeeNumbersAndLinkGolfers < ActiveRecord::Migration[8.1]
  def up
    create_table :employee_numbers do |t|
      t.uuid :organization_id, null: false
      t.references :tournament, null: false, foreign_key: { on_delete: :cascade }
      t.string :employee_number, null: false
      t.string :employee_name
      t.boolean :used, default: false, null: false
      t.references :used_by_golfer, foreign_key: { to_table: :golfers, on_delete: :nullify }, null: true
      t.datetime :used_at
      t.string :legacy_source
      t.string :legacy_id

      t.timestamps
    end

    add_index :employee_numbers, :organization_id
    add_foreign_key :employee_numbers, :organizations, on_delete: :cascade

    add_index :employee_numbers,
              "tournament_id, lower((employee_number)::text)",
              unique: true,
              name: "index_employee_numbers_on_tournament_and_lower_number"

    add_index :employee_numbers,
              [:legacy_source, :legacy_id],
              unique: true,
              where: "legacy_source IS NOT NULL",
              name: "index_employee_numbers_on_legacy_source_and_legacy_id"

    unless column_exists?(:golfers, :employee_number_record_id)
      add_reference :golfers,
                    :employee_number_record,
                    foreign_key: { to_table: :employee_numbers, on_delete: :nullify },
                    null: true
    end

    unless column_exists?(:golfers, :is_employee)
      add_column :golfers, :is_employee, :boolean, default: false, null: false
    end

    unless column_exists?(:tournaments, :employee_entry_fee)
      add_column :tournaments, :employee_entry_fee, :integer
    end

    TenantRls.apply!(connection)
  end

  def down
    if data_source_exists?(:employee_numbers)
      execute "DROP POLICY IF EXISTS #{TenantRls::POLICY_NAME} ON employee_numbers"
      execute "ALTER TABLE employee_numbers NO FORCE ROW LEVEL SECURITY"
      execute "ALTER TABLE employee_numbers DISABLE ROW LEVEL SECURITY"
    end

    if column_exists?(:golfers, :employee_number_record_id)
      remove_reference :golfers, :employee_number_record, foreign_key: { to_table: :employee_numbers }
    end

    drop_table :employee_numbers, if_exists: true
  end
end
