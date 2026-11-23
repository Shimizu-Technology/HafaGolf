# frozen_string_literal: true

class AddHomepageConfigToOrganizationsAndTournaments < ActiveRecord::Migration[8.1]
  def change
    add_column :organizations, :homepage_config, :jsonb, default: {}, null: false
    add_column :tournaments, :homepage_config, :jsonb, default: {}, null: false
  end
end
