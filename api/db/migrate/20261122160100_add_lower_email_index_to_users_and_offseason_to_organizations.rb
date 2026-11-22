# frozen_string_literal: true

class AddLowerEmailIndexToUsersAndOffseasonToOrganizations < ActiveRecord::Migration[8.1]
  def up
    duplicates = select_values(<<~SQL.squish)
      SELECT LOWER(TRIM(email))
      FROM users
      WHERE email IS NOT NULL
      GROUP BY LOWER(TRIM(email))
      HAVING COUNT(*) > 1
    SQL

    if duplicates.any?
      raise StandardError,
            "Cannot add unique case-insensitive email index on users; duplicate emails found: #{duplicates.join(', ')}"
    end

    # Normalize existing emails to lowercase trimmed values before creating unique index
    execute <<~SQL.squish
      UPDATE users
      SET email = LOWER(TRIM(email))
      WHERE email IS NOT NULL AND email <> LOWER(TRIM(email))
    SQL

    add_index :users, "LOWER(email)", unique: true, where: "email IS NOT NULL", name: "index_users_on_lower_email"

    add_column :organizations, :offseason_enabled, :boolean, default: false, null: false
    add_column :organizations, :offseason_title, :string
    add_column :organizations, :offseason_message, :text
    add_column :organizations, :offseason_cta_label, :string
    add_column :organizations, :offseason_cta_url, :string
  end

  def down
    remove_column :organizations, :offseason_cta_url
    remove_column :organizations, :offseason_cta_label
    remove_column :organizations, :offseason_message
    remove_column :organizations, :offseason_title
    remove_column :organizations, :offseason_enabled

    remove_index :users, name: "index_users_on_lower_email"
  end
end
