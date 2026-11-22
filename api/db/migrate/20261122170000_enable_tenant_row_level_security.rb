# frozen_string_literal: true

class EnableTenantRowLevelSecurity < ActiveRecord::Migration[8.1]
  def up
    unless column_exists?(:activity_logs, :organization_id)
      add_column :activity_logs, :organization_id, :uuid
      add_index :activity_logs, :organization_id
    end

    execute <<~SQL.squish
      UPDATE activity_logs
      SET organization_id = tournaments.organization_id
      FROM tournaments
      WHERE activity_logs.tournament_id = tournaments.id
        AND activity_logs.organization_id IS NULL
    SQL

    TenantRls.apply!(connection)
  end

  def down
    TenantRls.remove!(connection)

    if column_exists?(:activity_logs, :organization_id)
      remove_index :activity_logs, :organization_id if index_exists?(:activity_logs, :organization_id)
      remove_column :activity_logs, :organization_id
    end
  end
end
