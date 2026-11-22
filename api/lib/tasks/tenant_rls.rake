# frozen_string_literal: true

namespace :db do
  namespace :rls do
    desc "Apply idempotent PostgreSQL FORCE ROW LEVEL SECURITY policies across multi-tenant tables"
    task apply: :environment do
      TenantRls.apply!
      puts "Applied HafaGolf tenant RLS policies to #{TenantRls::ALL_TABLES.length} tables."
    end

    desc "Provision non-owner runtime database role (DB_APP_ROLE, DB_APP_ROLE_PASSWORD for LOGIN)"
    task setup_app_role: :environment do
      role_name = ENV.fetch("DB_APP_ROLE", "hafagolf_app")
      password = ENV["DB_APP_ROLE_PASSWORD"].presence
      TenantRls.setup_app_role!(ActiveRecord::Base.connection, role_name: role_name, password: password)
      puts "Configured non-owner RLS role: #{role_name} (#{password.present? ? 'LOGIN' : 'NOLOGIN'})"
    end

    desc "Report PostgreSQL role RLS enforcement and table policy status"
    task status: :environment do
      info = TenantRls.status
      role = info[:role] || {}
      puts "Current DB role: #{role['role_name']} (rolsuper=#{role['rolsuper']}, rolbypassrls=#{role['rolbypassrls']})"
      puts "RLS enforced for current role: #{info[:enforced_for_current_role]}"
      info[:tables].each do |row|
        puts "  #{row['table_name']}: rls_enabled=#{row['rls_enabled']}, rls_forced=#{row['rls_forced']}"
      end
    end
  end
end
