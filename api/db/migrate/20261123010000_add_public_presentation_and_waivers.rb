class AddPublicPresentationAndWaivers < ActiveRecord::Migration[8.1]
  def change
    change_table :tournaments, bulk: true do |t|
      t.string :commemorative_banner_url
      t.string :tribute_title
      t.string :tribute_subtitle
      t.jsonb :story_photos, default: [], null: false
      t.boolean :waiver_enabled, default: true, null: false
      t.text :waiver_text
      t.boolean :show_public_sponsors, default: true, null: false
      t.string :sponsor_wall_title
    end

    change_table :organizations, bulk: true do |t|
      t.string :reversed_logo_url
      t.boolean :show_homepage_sponsors, default: false, null: false
    end
  end
end
