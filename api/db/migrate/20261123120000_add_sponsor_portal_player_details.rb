class AddSponsorPortalPlayerDetails < ActiveRecord::Migration[8.1]
  def change
    change_table :sponsor_slots, bulk: true do |t|
      t.string :tshirt_size
      t.decimal :handicap, precision: 4, scale: 1
    end

    add_column :sponsors, :portal_link_issued_at, :datetime

    reversible do |dir|
      dir.up do
        execute <<~SQL
          UPDATE sponsor_slots
          SET tshirt_size = COALESCE(sponsor_slots.tshirt_size, team_members.tshirt_size),
              handicap = COALESCE(sponsor_slots.handicap, team_members.handicap)
          FROM team_members
          WHERE team_members.sponsor_slot_id = sponsor_slots.id
            AND (team_members.tshirt_size IS NOT NULL OR team_members.handicap IS NOT NULL)
        SQL
      end
    end
  end
end
