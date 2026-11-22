# frozen_string_literal: true

class AddSmsSenderIdToOrganizations < ActiveRecord::Migration[8.1]
  def change
    add_column :organizations, :sms_sender_id, :string, limit: 11
  end
end
