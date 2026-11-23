# frozen_string_literal: true

class AddDirectoryListedToTournaments < ActiveRecord::Migration[8.1]
  def change
    add_column :tournaments, :directory_listed, :boolean, default: false, null: false
    add_index :tournaments, :directory_listed
  end
end
