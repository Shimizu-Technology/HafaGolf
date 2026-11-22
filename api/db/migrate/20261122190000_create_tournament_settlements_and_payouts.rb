# frozen_string_literal: true

class CreateTournamentSettlementsAndPayouts < ActiveRecord::Migration[8.1]
  def up
    create_table :tournament_settlements, id: :uuid, default: -> { "gen_random_uuid()" } do |t|
      t.uuid :organization_id, null: false
      t.bigint :tournament_id, null: false
      t.integer :version, null: false, default: 1
      t.string :status, null: false, default: "draft"
      t.string :currency, null: false, default: "usd"
      t.integer :gross_cents, null: false, default: 0
      t.integer :refund_cents, null: false, default: 0
      t.integer :processing_fee_cents, null: false, default: 0
      t.integer :platform_fee_cents, null: false, default: 0
      t.integer :adjustment_cents, null: false, default: 0
      t.text :adjustment_notes
      t.integer :net_cents, null: false, default: 0
      t.integer :organizer_proceeds_cents, null: false, default: 0
      t.integer :paid_cents, null: false, default: 0
      t.integer :payable_cents, null: false, default: 0
      t.jsonb :breakdown_json, null: false, default: {}
      t.string :source_digest
      t.datetime :calculated_at
      t.datetime :finalized_at
      t.bigint :finalized_by_id
      t.timestamps
    end

    add_index :tournament_settlements, :organization_id
    add_index :tournament_settlements, :tournament_id
    add_index :tournament_settlements, %i[tournament_id version], unique: true
    add_foreign_key :tournament_settlements, :organizations, on_delete: :cascade
    add_foreign_key :tournament_settlements, :tournaments, on_delete: :cascade
    add_foreign_key :tournament_settlements, :users, column: :finalized_by_id, on_delete: :nullify

    add_check_constraint :tournament_settlements,
                         "status IN ('draft', 'finalized')",
                         name: "chk_tournament_settlements_status"
    add_check_constraint :tournament_settlements,
                         "version >= 1",
                         name: "chk_tournament_settlements_version_positive"
    add_check_constraint :tournament_settlements,
                         "gross_cents >= 0 AND refund_cents >= 0 AND processing_fee_cents >= 0 AND platform_fee_cents >= 0 AND paid_cents >= 0",
                         name: "chk_tournament_settlements_non_negative_totals"

    create_table :tournament_payouts, id: :uuid, default: -> { "gen_random_uuid()" } do |t|
      t.uuid :organization_id, null: false
      t.bigint :tournament_id, null: false
      t.uuid :settlement_id, null: false
      t.integer :amount_cents, null: false
      t.string :currency, null: false, default: "usd"
      t.string :status, null: false, default: "pending"
      t.string :provider, null: false, default: "check"
      t.string :provider_payout_id
      t.jsonb :payee_snapshot, null: false, default: {}
      t.datetime :initiated_at
      t.datetime :paid_at
      t.datetime :voided_at
      t.text :void_reason
      t.bigint :recorded_by_id
      t.text :notes
      t.string :idempotency_key
      t.timestamps
    end

    add_index :tournament_payouts, :organization_id
    add_index :tournament_payouts, :tournament_id
    add_index :tournament_payouts, :settlement_id
    add_index :tournament_payouts, %i[tournament_id idempotency_key],
              unique: true,
              where: "idempotency_key IS NOT NULL",
              name: "index_tournament_payouts_on_tournament_and_idempotency_key"
    add_foreign_key :tournament_payouts, :organizations, on_delete: :cascade
    add_foreign_key :tournament_payouts, :tournaments, on_delete: :cascade
    add_foreign_key :tournament_payouts, :tournament_settlements, column: :settlement_id, on_delete: :restrict
    add_foreign_key :tournament_payouts, :users, column: :recorded_by_id, on_delete: :nullify

    add_check_constraint :tournament_payouts,
                         "amount_cents > 0",
                         name: "chk_tournament_payouts_amount_positive"
    add_check_constraint :tournament_payouts,
                         "status IN ('pending', 'paid', 'voided')",
                         name: "chk_tournament_payouts_status"
    add_check_constraint :tournament_payouts,
                         "provider IN ('check', 'manual', 'ach')",
                         name: "chk_tournament_payouts_provider"

    unless column_exists?(:golfers, :stripe_fee_cents)
      add_column :golfers, :stripe_fee_cents, :integer
      add_check_constraint :golfers,
                           "stripe_fee_cents IS NULL OR stripe_fee_cents >= 0",
                           name: "chk_golfers_stripe_fee_non_negative"
    end

    TenantRls.apply!(connection)
  end

  def down
    if column_exists?(:golfers, :stripe_fee_cents)
      remove_check_constraint :golfers, name: "chk_golfers_stripe_fee_non_negative"
      remove_column :golfers, :stripe_fee_cents
    end

    drop_table :tournament_payouts, if_exists: true
    drop_table :tournament_settlements, if_exists: true
  end
end
