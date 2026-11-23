# frozen_string_literal: true

class AddRbacToOrganizationMemberships < ActiveRecord::Migration[8.1]
  def up
    add_column :organization_memberships, :permissions, :jsonb, default: {}, null: false
    add_column :organization_memberships, :scoped_tournament_ids, :bigint, array: true, default: [], null: false

    # Backfill existing volunteers to checkin_volunteer + raffle_sell override so no existing volunteer loses access
    execute <<~SQL.squish
      UPDATE organization_memberships
      SET role = 'checkin_volunteer',
          permissions = jsonb_set(COALESCE(permissions, '{}'::jsonb), '{raffle_sell}', 'true'::jsonb)
      WHERE role = 'volunteer'
    SQL
  end

  def down
    execute <<~SQL.squish
      UPDATE organization_memberships
      SET role = 'volunteer'
      WHERE role IN ('checkin_volunteer', 'raffle_volunteer', 'scoring_marshal')
    SQL

    remove_column :organization_memberships, :scoped_tournament_ids
    remove_column :organization_memberships, :permissions
  end
end
