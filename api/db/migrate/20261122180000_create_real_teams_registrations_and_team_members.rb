# frozen_string_literal: true

class CreateRealTeamsRegistrationsAndTeamMembers < ActiveRecord::Migration[8.1]
  def up
    # 1. Add capacity_unit to tournaments with backfill & CHECK constraint
    add_column :tournaments, :capacity_unit, :string, default: "players", null: false

    execute <<~SQL.squish
      UPDATE tournaments
      SET capacity_unit = CASE
        WHEN COALESCE(team_size, 1) > 1 THEN 'teams'
        ELSE 'players'
      END
    SQL

    add_check_constraint :tournaments,
                         "capacity_unit IN ('players', 'teams')",
                         name: "check_tournaments_capacity_unit"

    # 2. Create registrations table
    create_table :registrations do |t|
      t.uuid :organization_id, null: false
      t.references :tournament, null: false, foreign_key: true
      t.references :group, null: true, foreign_key: true
      t.references :sponsor, null: true, foreign_key: true
      t.references :golfer, null: true, foreign_key: true, index: false

      t.string :team_name
      t.string :team_category
      t.string :registration_source, default: "public", null: false
      t.string :registration_status, default: "confirmed", null: false

      # Contact / billing snapshot
      t.string :contact_name
      t.string :contact_email
      t.string :contact_phone
      t.string :company
      t.text :notes

      # Payment fields
      t.string :payment_type
      t.string :payment_status, default: "unpaid"
      t.string :payment_method
      t.integer :payment_amount_cents
      t.datetime :paid_at
      t.datetime :payment_verified_at
      t.integer :payment_verified_by_id
      t.string :payment_verified_by_name
      t.string :payment_token
      t.string :receipt_number
      t.text :payment_notes
      t.string :stripe_checkout_session_id
      t.string :stripe_payment_intent_id
      t.string :stripe_card_brand
      t.string :stripe_card_last4
      t.string :stripe_account_origin
      t.string :stripe_refund_id
      t.integer :refund_amount_cents
      t.text :refund_reason
      t.datetime :refunded_at
      t.bigint :refunded_by_id

      # Raffle fields
      t.integer :raffle_tickets_requested, default: 0, null: false
      t.string :raffle_bundle_label

      # Legacy migration idempotency keys
      t.string :legacy_source
      t.string :legacy_id

      t.timestamps
    end

    add_foreign_key :registrations, :organizations
    add_foreign_key :registrations, :users, column: :refunded_by_id, on_delete: :nullify

    add_index :registrations, :organization_id
    add_index :registrations, [:tournament_id, :registration_status],
              name: "index_registrations_on_tournament_id_and_status"
    add_index :registrations, :golfer_id,
              unique: true,
              where: "golfer_id IS NOT NULL",
              name: "index_registrations_on_golfer_id_unique"
    add_index :registrations, :payment_token,
              unique: true,
              where: "payment_token IS NOT NULL",
              name: "index_registrations_on_payment_token_unique"
    add_index :registrations, :stripe_checkout_session_id,
              unique: true,
              where: "stripe_checkout_session_id IS NOT NULL",
              name: "index_registrations_on_stripe_checkout_session_id_unique"
    add_index :registrations, :stripe_refund_id,
              unique: true,
              where: "stripe_refund_id IS NOT NULL",
              name: "index_registrations_on_stripe_refund_id_unique"
    add_index :registrations, [:legacy_source, :legacy_id],
              unique: true,
              where: "legacy_source IS NOT NULL",
              name: "index_registrations_on_legacy_source_and_id_unique"
    add_index :registrations,
              "tournament_id, LOWER(contact_email)",
              unique: true,
              where: "contact_email IS NOT NULL AND COALESCE(registration_source, 'public') <> 'admin' AND registration_status IS DISTINCT FROM 'cancelled'",
              name: "index_registrations_on_tournament_lower_email_public_unique"

    # 3. Create team_members table
    create_table :team_members do |t|
      t.uuid :organization_id, null: false
      t.references :tournament, null: false, foreign_key: true
      t.references :registration, null: false, foreign_key: true
      t.references :sponsor_slot, null: true, foreign_key: { on_delete: :nullify }, index: false

      t.integer :position, null: false
      t.boolean :is_captain, default: false, null: false

      t.string :name, null: false
      t.string :email
      t.string :phone
      t.string :mobile
      t.string :company
      t.string :address
      t.string :tshirt_size
      t.decimal :handicap, precision: 4, scale: 1

      t.boolean :is_employee, default: false, null: false
      t.bigint :employee_number_record_id

      t.datetime :waiver_accepted_at
      t.datetime :checked_in_at
      t.integer :checked_in_by_id
      t.string :checked_in_by_name

      t.string :magic_link_token
      t.datetime :magic_link_expires_at

      t.string :legacy_source
      t.string :legacy_id

      t.timestamps
    end

    add_foreign_key :team_members, :organizations

    add_check_constraint :team_members,
                         "position >= 1 AND position <= 4",
                         name: "check_team_members_position_range"

    add_index :team_members, :organization_id
    add_index :team_members, [:registration_id, :position], unique: true
    add_index :team_members, :sponsor_slot_id,
              unique: true,
              where: "sponsor_slot_id IS NOT NULL",
              name: "index_team_members_on_sponsor_slot_id_unique"
    add_index :team_members, :magic_link_token,
              unique: true,
              where: "magic_link_token IS NOT NULL",
              name: "index_team_members_on_magic_link_token_unique"
    add_index :team_members, [:legacy_source, :legacy_id],
              unique: true,
              where: "legacy_source IS NOT NULL",
              name: "index_team_members_on_legacy_source_and_id_unique"
    add_index :team_members,
              "tournament_id, LOWER(email)",
              where: "email IS NOT NULL",
              name: "index_team_members_on_tournament_id_and_lower_email"

    # 4. Update scores table with registration_id & team_member_id + CHECK constraint
    add_reference :scores, :registration, null: true, foreign_key: { on_delete: :nullify }
    add_reference :scores, :team_member, null: true, foreign_key: { on_delete: :nullify }

    add_check_constraint :scores,
                         "(registration_id IS NULL AND team_member_id IS NULL) " \
                         "OR (score_type = 'team' AND registration_id IS NOT NULL AND team_member_id IS NULL) " \
                         "OR (score_type = 'individual' AND team_member_id IS NOT NULL AND registration_id IS NULL)",
                         name: "check_scores_registration_or_team_member_by_type"

    # 5. Update raffle_tickets table with registration_id & team_member_id
    add_reference :raffle_tickets, :registration, null: true, foreign_key: { on_delete: :nullify }
    add_reference :raffle_tickets, :team_member, null: true, foreign_key: { on_delete: :nullify }
    add_index :raffle_tickets, [:registration_id, :team_member_id],
              name: "index_raffle_tickets_on_registration_and_team_member"

    # 6. Apply PostgreSQL FORCE ROW LEVEL SECURITY to new direct-org tables
    TenantRls.apply!(connection)
  end

  def down
    remove_index :raffle_tickets, name: "index_raffle_tickets_on_registration_and_team_member"
    remove_reference :raffle_tickets, :team_member, foreign_key: true
    remove_reference :raffle_tickets, :registration, foreign_key: true

    remove_check_constraint :scores, name: "check_scores_registration_or_team_member_by_type"
    remove_reference :scores, :team_member, foreign_key: true
    remove_reference :scores, :registration, foreign_key: true

    %w[team_members registrations].each do |table|
      next unless data_source_exists?(table)

      quoted = connection.quote_table_name(table)
      execute("DROP POLICY IF EXISTS #{TenantRls::POLICY_NAME} ON #{quoted}")
      execute("ALTER TABLE #{quoted} NO FORCE ROW LEVEL SECURITY")
      execute("ALTER TABLE #{quoted} DISABLE ROW LEVEL SECURITY")
    end

    drop_table :team_members
    drop_table :registrations

    remove_check_constraint :tournaments, name: "check_tournaments_capacity_unit"
    remove_column :tournaments, :capacity_unit
  end
end
