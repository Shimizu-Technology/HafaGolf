# frozen_string_literal: true

class CreateOrganizationPaymentConfigsAndDropSettings < ActiveRecord::Migration[8.1]
  def up
    create_table :organization_payment_configs, id: :uuid, default: -> { "gen_random_uuid()" } do |t|
      t.uuid :organization_id, null: false
      t.string :payment_mode, null: false, default: "offline"
      t.string :processor_provider, null: false, default: "none"
      t.boolean :test_mode, null: false, default: false
      t.string :webhook_endpoint_token
      t.text :encrypted_public_key
      t.text :encrypted_secret_key
      t.text :encrypted_webhook_secret
      t.string :external_checkout_url
      t.string :external_walkin_url
      t.string :external_donation_url
      t.integer :platform_fee_flat_cents, null: false, default: 0
      t.integer :platform_fee_per_registrant_cents, null: false, default: 0
      t.integer :platform_fee_cap_cents
      t.string :payout_payee_name
      t.string :payout_bank_name
      t.text :payout_notes

      t.timestamps
    end

    add_index :organization_payment_configs, :organization_id, unique: true
    add_index :organization_payment_configs, :webhook_endpoint_token,
              unique: true,
              where: "webhook_endpoint_token IS NOT NULL"
    add_foreign_key :organization_payment_configs, :organizations, on_delete: :cascade

    add_check_constraint :organization_payment_configs,
                         "payment_mode IN ('external_link', 'platform_collect', 'client_processor', 'offline')",
                         name: "chk_org_payment_configs_payment_mode"
    add_check_constraint :organization_payment_configs,
                         "processor_provider IN ('stripe', 'swipesimple', 'paypal', 'worldpay_cardpointe', 'none')",
                         name: "chk_org_payment_configs_processor_provider"
    add_check_constraint :organization_payment_configs,
                         "platform_fee_flat_cents >= 0 AND platform_fee_per_registrant_cents >= 0 AND (platform_fee_cap_cents IS NULL OR platform_fee_cap_cents >= 0)",
                         name: "chk_org_payment_configs_non_negative_fees"

    unless column_exists?(:golfers, :stripe_account_origin)
      add_column :golfers, :stripe_account_origin, :string
    end

    drop_table :settings, if_exists: true

    TenantRls.apply!(connection)
  end

  def down
    create_table :settings do |t|
      t.string :admin_email
      t.string :checks_payable_to
      t.string :contact_name
      t.string :contact_phone
      t.string :event_date
      t.string :fee_includes
      t.string :format_name
      t.string :location_address
      t.string :location_name
      t.integer :max_capacity
      t.string :payment_mode, default: "test"
      t.boolean :registration_open, default: true, null: false
      t.string :registration_time
      t.string :start_time
      t.string :stripe_public_key
      t.string :stripe_secret_key
      t.string :stripe_webhook_secret
      t.string :tournament_edition
      t.integer :tournament_entry_fee, default: 12500
      t.string :tournament_name
      t.string :tournament_title
      t.string :tournament_year
      t.timestamps
    end

    remove_column :golfers, :stripe_account_origin if column_exists?(:golfers, :stripe_account_origin)
    drop_table :organization_payment_configs, if_exists: true
    TenantRls.apply!(connection)
  end
end
