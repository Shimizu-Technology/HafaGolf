# frozen_string_literal: true

class EnableTenantRowLevelSecurity < ActiveRecord::Migration[8.1]
  def up
    TenantRls.apply!(connection)
  end

  def down
    TenantRls.remove!(connection)
  end
end
