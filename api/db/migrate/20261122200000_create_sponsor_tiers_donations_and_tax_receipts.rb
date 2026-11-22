# frozen_string_literal: true

class CreateSponsorTiersDonationsAndTaxReceipts < ActiveRecord::Migration[8.1]
  def up
    create_table :sponsor_tiers do |t|
      t.uuid :organization_id, null: false
      t.bigint :tournament_id, null: false
      t.string :key, null: false
      t.string :label, null: false
      t.text :description
      t.integer :price_cents, null: false, default: 0
      t.integer :included_player_slots, null: false, default: 0
      t.integer :max_quantity
      t.jsonb :benefits, null: false, default: []
      t.boolean :online_checkout_enabled, null: false, default: true
      t.integer :sort_order, null: false, default: 0
      t.timestamps
    end

    add_index :sponsor_tiers, :organization_id
    add_index :sponsor_tiers, :tournament_id
    add_index :sponsor_tiers,
              "tournament_id, lower((key)::text)",
              unique: true,
              name: "index_sponsor_tiers_on_tournament_id_and_lower_key"
    add_foreign_key :sponsor_tiers, :organizations, on_delete: :cascade
    add_foreign_key :sponsor_tiers, :tournaments, on_delete: :cascade

    add_check_constraint :sponsor_tiers,
                         "price_cents >= 0",
                         name: "chk_sponsor_tiers_price_non_negative"
    add_check_constraint :sponsor_tiers,
                         "included_player_slots >= 0",
                         name: "chk_sponsor_tiers_slots_non_negative"
    add_check_constraint :sponsor_tiers,
                         "max_quantity IS NULL OR max_quantity > 0",
                         name: "chk_sponsor_tiers_max_quantity_positive"

    add_column :sponsors, :sponsor_tier_id, :bigint unless column_exists?(:sponsors, :sponsor_tier_id)
    add_column :sponsors, :payment_type, :string unless column_exists?(:sponsors, :payment_type)
    add_column :sponsors, :payment_status, :string, default: "unpaid", null: false unless column_exists?(:sponsors, :payment_status)
    add_column :sponsors, :payment_method, :string unless column_exists?(:sponsors, :payment_method)
    add_column :sponsors, :payment_amount_cents, :integer unless column_exists?(:sponsors, :payment_amount_cents)
    add_column :sponsors, :paid_at, :datetime unless column_exists?(:sponsors, :paid_at)
    add_column :sponsors, :stripe_checkout_session_id, :string unless column_exists?(:sponsors, :stripe_checkout_session_id)
    add_column :sponsors, :stripe_payment_intent_id, :string unless column_exists?(:sponsors, :stripe_payment_intent_id)
    add_column :sponsors, :stripe_account_origin, :string unless column_exists?(:sponsors, :stripe_account_origin)
    add_column :sponsors, :stripe_fee_cents, :integer unless column_exists?(:sponsors, :stripe_fee_cents)
    add_column :sponsors, :refund_amount_cents, :integer, default: 0, null: false unless column_exists?(:sponsors, :refund_amount_cents)
    add_column :sponsors, :refunded_at, :datetime unless column_exists?(:sponsors, :refunded_at)

    add_index :sponsors, :sponsor_tier_id unless index_exists?(:sponsors, :sponsor_tier_id)
    unless index_exists?(:sponsors, :stripe_checkout_session_id, name: "index_sponsors_on_stripe_checkout_session_id")
      add_index :sponsors,
                :stripe_checkout_session_id,
                unique: true,
                where: "stripe_checkout_session_id IS NOT NULL",
                name: "index_sponsors_on_stripe_checkout_session_id"
    end
    unless foreign_key_exists?(:sponsors, :sponsor_tiers)
      add_foreign_key :sponsors, :sponsor_tiers, on_delete: :nullify
    end
    unless check_constraint_exists?(:sponsors, name: "chk_sponsors_stripe_fee_non_negative")
      add_check_constraint :sponsors,
                           "stripe_fee_cents IS NULL OR stripe_fee_cents >= 0",
                           name: "chk_sponsors_stripe_fee_non_negative"
    end
    unless check_constraint_exists?(:sponsors, name: "chk_sponsors_refund_non_negative")
      add_check_constraint :sponsors,
                           "refund_amount_cents >= 0",
                           name: "chk_sponsors_refund_non_negative"
    end

    create_table :donations do |t|
      t.uuid :organization_id, null: false
      t.bigint :tournament_id
      t.string :donor_name, null: false
      t.string :donor_email
      t.string :donor_phone
      t.integer :amount_cents, null: false
      t.string :payment_type, null: false, default: "stripe"
      t.string :payment_status, null: false, default: "pending"
      t.string :payment_method
      t.string :stripe_checkout_session_id
      t.string :stripe_payment_intent_id
      t.string :stripe_account_origin
      t.integer :stripe_fee_cents
      t.integer :refund_amount_cents, null: false, default: 0
      t.datetime :refunded_at
      t.boolean :anonymous, null: false, default: false
      t.text :message
      t.datetime :paid_at
      t.datetime :tax_receipt_sent_at
      t.timestamps
    end

    add_index :donations, :organization_id
    add_index :donations, :tournament_id
    add_index :donations,
              :stripe_checkout_session_id,
              unique: true,
              where: "stripe_checkout_session_id IS NOT NULL",
              name: "index_donations_on_stripe_checkout_session_id"
    add_foreign_key :donations, :organizations, on_delete: :cascade
    add_foreign_key :donations, :tournaments, on_delete: :cascade

    add_check_constraint :donations,
                         "amount_cents > 0",
                         name: "chk_donations_amount_positive"
    add_check_constraint :donations,
                         "stripe_fee_cents IS NULL OR stripe_fee_cents >= 0",
                         name: "chk_donations_stripe_fee_non_negative"
    add_check_constraint :donations,
                         "refund_amount_cents >= 0",
                         name: "chk_donations_refund_non_negative"

    add_column :tournaments, :tax_receipt_enabled, :boolean, default: false, null: false unless column_exists?(:tournaments, :tax_receipt_enabled)
    add_column :tournaments, :tax_org_name, :string unless column_exists?(:tournaments, :tax_org_name)
    add_column :tournaments, :tax_org_ein, :string unless column_exists?(:tournaments, :tax_org_ein)
    add_column :tournaments, :fmv_per_player_cents, :integer, default: 0, null: false unless column_exists?(:tournaments, :fmv_per_player_cents)
    add_column :tournaments, :tax_receipt_disclaimer, :text unless column_exists?(:tournaments, :tax_receipt_disclaimer)

    unless check_constraint_exists?(:tournaments, name: "chk_tournaments_fmv_non_negative")
      add_check_constraint :tournaments,
                           "fmv_per_player_cents >= 0",
                           name: "chk_tournaments_fmv_non_negative"
    end

    TenantRls.apply!(connection)
  end

  def down
    if check_constraint_exists?(:tournaments, name: "chk_tournaments_fmv_non_negative")
      remove_check_constraint :tournaments, name: "chk_tournaments_fmv_non_negative"
    end
    remove_column :tournaments, :tax_receipt_disclaimer if column_exists?(:tournaments, :tax_receipt_disclaimer)
    remove_column :tournaments, :fmv_per_player_cents if column_exists?(:tournaments, :fmv_per_player_cents)
    remove_column :tournaments, :tax_org_ein if column_exists?(:tournaments, :tax_org_ein)
    remove_column :tournaments, :tax_org_name if column_exists?(:tournaments, :tax_org_name)
    remove_column :tournaments, :tax_receipt_enabled if column_exists?(:tournaments, :tax_receipt_enabled)

    drop_table :donations, if_exists: true

    remove_check_constraint :sponsors, name: "chk_sponsors_refund_non_negative" if check_constraint_exists?(:sponsors, name: "chk_sponsors_refund_non_negative")
    remove_check_constraint :sponsors, name: "chk_sponsors_stripe_fee_non_negative" if check_constraint_exists?(:sponsors, name: "chk_sponsors_stripe_fee_non_negative")
    remove_foreign_key :sponsors, :sponsor_tiers if foreign_key_exists?(:sponsors, :sponsor_tiers)
    remove_index :sponsors, name: "index_sponsors_on_stripe_checkout_session_id" if index_exists?(:sponsors, :stripe_checkout_session_id, name: "index_sponsors_on_stripe_checkout_session_id")
    remove_index :sponsors, :sponsor_tier_id if index_exists?(:sponsors, :sponsor_tier_id)
    %i[
      refunded_at refund_amount_cents stripe_fee_cents stripe_account_origin
      stripe_payment_intent_id stripe_checkout_session_id paid_at payment_amount_cents
      payment_method payment_status payment_type sponsor_tier_id
    ].each do |col|
      remove_column :sponsors, col if column_exists?(:sponsors, col)
    end

    drop_table :sponsor_tiers, if_exists: true
  end
end
