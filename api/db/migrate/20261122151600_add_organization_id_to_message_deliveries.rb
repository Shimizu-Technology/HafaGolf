# frozen_string_literal: true

class AddOrganizationIdToMessageDeliveries < ActiveRecord::Migration[8.1]
  def up
    add_reference :message_deliveries, :organization, type: :uuid, null: true, foreign_key: { on_delete: :nullify }

    execute <<~SQL.squish
      UPDATE message_deliveries
      SET organization_id = tournaments.organization_id
      FROM tournaments
      WHERE message_deliveries.tournament_id = tournaments.id
        AND message_deliveries.organization_id IS NULL
    SQL
  end

  def down
    remove_reference :message_deliveries, :organization, type: :uuid, foreign_key: true
  end
end
