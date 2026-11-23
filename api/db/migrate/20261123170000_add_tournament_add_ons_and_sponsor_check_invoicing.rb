# frozen_string_literal: true

class AddTournamentAddOnsAndSponsorCheckInvoicing < ActiveRecord::Migration[8.1]
  def up
    create_table :tournament_add_ons do |t|
      t.uuid :organization_id, null: false
      t.bigint :tournament_id, null: false
      t.string :name, null: false
      t.text :description
      t.integer :price_cents, null: false, default: 0
      t.integer :max_quantity_per_order, null: false, default: 4
      t.integer :max_total_quantity
      t.string :category, null: false, default: "super_ticket"
      t.boolean :active, null: false, default: true
      t.integer :sort_order, null: false, default: 0
      t.timestamps
    end

    add_index :tournament_add_ons, :organization_id
    add_index :tournament_add_ons, :tournament_id
    add_index :tournament_add_ons, [:tournament_id, :active, :sort_order],
              name: "index_tournament_add_ons_on_tournament_active_sort"
    add_foreign_key :tournament_add_ons, :organizations, on_delete: :cascade
    add_foreign_key :tournament_add_ons, :tournaments, on_delete: :cascade

    add_check_constraint :tournament_add_ons,
                         "price_cents >= 0",
                         name: "chk_tournament_add_ons_price_non_negative"
    add_check_constraint :tournament_add_ons,
                         "max_quantity_per_order > 0",
                         name: "chk_tournament_add_ons_max_per_order_positive"
    add_check_constraint :tournament_add_ons,
                         "max_total_quantity IS NULL OR max_total_quantity > 0",
                         name: "chk_tournament_add_ons_max_total_positive"

    create_table :golfer_add_ons do |t|
      t.uuid :organization_id, null: false
      t.bigint :tournament_id, null: false
      t.bigint :golfer_id
      t.bigint :registration_id
      t.bigint :tournament_add_on_id, null: false
      t.integer :quantity, null: false, default: 1
      t.integer :unit_price_cents, null: false, default: 0
      t.timestamps
    end

    add_index :golfer_add_ons, :organization_id
    add_index :golfer_add_ons, :tournament_id
    add_index :golfer_add_ons, :golfer_id
    add_index :golfer_add_ons, :registration_id
    add_index :golfer_add_ons, :tournament_add_on_id
    add_foreign_key :golfer_add_ons, :organizations, on_delete: :cascade
    add_foreign_key :golfer_add_ons, :tournaments, on_delete: :cascade
    add_foreign_key :golfer_add_ons, :golfers, on_delete: :cascade
    add_foreign_key :golfer_add_ons, :registrations, on_delete: :cascade
    add_foreign_key :golfer_add_ons, :tournament_add_ons, on_delete: :restrict

    add_check_constraint :golfer_add_ons,
                         "quantity > 0",
                         name: "chk_golfer_add_ons_quantity_positive"
    add_check_constraint :golfer_add_ons,
                         "unit_price_cents >= 0",
                         name: "chk_golfer_add_ons_unit_price_non_negative"
    add_check_constraint :golfer_add_ons,
                         "golfer_id IS NOT NULL OR registration_id IS NOT NULL",
                         name: "chk_golfer_add_ons_owner_present"

    add_column :sponsors, :invoice_number, :string unless column_exists?(:sponsors, :invoice_number)
    add_column :sponsors, :check_number, :string unless column_exists?(:sponsors, :check_number)
    add_column :sponsors, :check_notes, :text unless column_exists?(:sponsors, :check_notes)
    add_column :sponsors, :invoiced_at, :datetime unless column_exists?(:sponsors, :invoiced_at)

    unless index_exists?(:sponsors, :invoice_number, name: "index_sponsors_on_invoice_number")
      add_index :sponsors,
                :invoice_number,
                unique: true,
                where: "invoice_number IS NOT NULL",
                name: "index_sponsors_on_invoice_number"
    end

    unless column_exists?(:tournaments, :allow_sponsor_check_invoice)
      add_column :tournaments, :allow_sponsor_check_invoice, :boolean, default: true, null: false
    end

    TenantRls.apply!(connection)
  end

  def down
    remove_column :tournaments, :allow_sponsor_check_invoice if column_exists?(:tournaments, :allow_sponsor_check_invoice)

    if index_exists?(:sponsors, :invoice_number, name: "index_sponsors_on_invoice_number")
      remove_index :sponsors, name: "index_sponsors_on_invoice_number"
    end
    %i[invoiced_at check_notes check_number invoice_number].each do |col|
      remove_column :sponsors, col if column_exists?(:sponsors, col)
    end

    drop_table :golfer_add_ons, if_exists: true
    drop_table :tournament_add_ons, if_exists: true
  end
end
