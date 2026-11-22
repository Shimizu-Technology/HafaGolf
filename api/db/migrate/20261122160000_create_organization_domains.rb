# frozen_string_literal: true

class CreateOrganizationDomains < ActiveRecord::Migration[8.1]
  def change
    create_table :organization_domains, id: :uuid, default: -> { "gen_random_uuid()" } do |t|
      t.references :organization, null: false, foreign_key: true, type: :uuid
      t.string :hostname, null: false
      t.boolean :is_primary, null: false, default: false
      t.datetime :verified_at

      t.timestamps
    end

    add_index :organization_domains, "LOWER(hostname)", unique: true, name: "index_organization_domains_on_lower_hostname"
    add_index :organization_domains, :organization_id, unique: true, where: "is_primary = true", name: "index_organization_domains_on_org_primary"
  end
end
