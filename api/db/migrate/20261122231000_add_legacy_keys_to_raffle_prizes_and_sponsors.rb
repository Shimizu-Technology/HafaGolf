# frozen_string_literal: true

class AddLegacyKeysToRafflePrizesAndSponsors < ActiveRecord::Migration[8.1]
  def change
    add_column :raffle_prizes, :legacy_source, :string
    add_column :raffle_prizes, :legacy_id, :string
    add_index :raffle_prizes, %i[tournament_id legacy_source legacy_id],
              unique: true,
              where: "legacy_source IS NOT NULL AND legacy_id IS NOT NULL",
              name: "idx_raffle_prizes_tournament_legacy"

    add_column :sponsors, :legacy_source, :string
    add_column :sponsors, :legacy_id, :string
    add_index :sponsors, %i[tournament_id legacy_source legacy_id],
              unique: true,
              where: "legacy_source IS NOT NULL AND legacy_id IS NOT NULL",
              name: "idx_sponsors_tournament_legacy"
  end
end
