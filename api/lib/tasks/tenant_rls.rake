# frozen_string_literal: true

namespace :db do
  namespace :rls do
    desc "Apply idempotent PostgreSQL FORCE ROW LEVEL SECURITY policies across multi-tenant tables"
    task apply: :environment do
      TenantRls.apply!
      puts "Applied HafaGolf tenant RLS policies to #{TenantRls::ALL_TABLES.length} tables."
    end

    desc "Provision non-owner runtime database role (DB_APP_ROLE, optional DB_APP_ROLE_PASSWORD)"
    task setup_app_role: :environment do
      role_name = ENV.fetch("DB_APP_ROLE", "hafagolf_app")
      password = ENV["DB_APP_ROLE_PASSWORD"].presence
      TenantRls.setup_app_role!(ActiveRecord::Base.connection, role_name: role_name, password: password)
      puts "Configured non-owner RLS role: #{role_name}"
    end
  end
end
