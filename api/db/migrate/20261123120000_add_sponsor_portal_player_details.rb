class AddSponsorPortalPlayerDetails < ActiveRecord::Migration[8.1]
  def change
    change_table :sponsor_slots, bulk: true do |t|
      t.string :tshirt_size
      t.decimal :handicap, precision: 4, scale: 1
    end

    add_column :sponsors, :portal_link_issued_at, :datetime
  end
end
