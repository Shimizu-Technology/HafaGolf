# frozen_string_literal: true

class CreateBroadcastAnnouncements < ActiveRecord::Migration[8.1]
  def up
    create_table :broadcast_announcements do |t|
      t.uuid :organization_id, null: false
      t.bigint :tournament_id, null: false
      t.bigint :sender_id
      t.string :audience, null: false
      t.bigint :target_group_ids, array: true, null: false, default: []
      t.string :channel, null: false
      t.string :subject
      t.text :message, null: false
      t.integer :recipient_count, null: false, default: 0
      t.integer :email_recipient_count, null: false, default: 0
      t.integer :sms_recipient_count, null: false, default: 0
      t.integer :sent_count, null: false, default: 0
      t.integer :failed_count, null: false, default: 0
      t.boolean :dry_run, null: false, default: false
      t.string :status, null: false, default: "completed"
      t.datetime :sent_at
      t.timestamps
    end

    add_index :broadcast_announcements, :organization_id
    add_index :broadcast_announcements, [:tournament_id, :created_at],
              name: "index_broadcast_announcements_on_tournament_created_at"
    add_index :broadcast_announcements, :sender_id

    add_foreign_key :broadcast_announcements, :organizations, on_delete: :cascade
    add_foreign_key :broadcast_announcements, :tournaments, on_delete: :cascade
    add_foreign_key :broadcast_announcements, :users, column: :sender_id, on_delete: :nullify

    add_check_constraint :broadcast_announcements,
                         "recipient_count >= 0",
                         name: "chk_broadcast_announcements_recipient_count_non_negative"
    add_check_constraint :broadcast_announcements,
                         "sent_count >= 0",
                         name: "chk_broadcast_announcements_sent_count_non_negative"
    add_check_constraint :broadcast_announcements,
                         "failed_count >= 0",
                         name: "chk_broadcast_announcements_failed_count_non_negative"

    TenantRls.apply!(connection)
  end

  def down
    drop_table :broadcast_announcements, if_exists: true
  end
end
