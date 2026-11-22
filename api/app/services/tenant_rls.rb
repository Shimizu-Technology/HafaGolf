# frozen_string_literal: true

# Applies defense-in-depth PostgreSQL FORCE ROW LEVEL SECURITY policies across
# multi-tenant tables.
#
# Policy semantics (fail-closed):
# - When `app.rls_bypass = 'on'` (platform/admin/webhook explicitly opted in), access is allowed.
# - Otherwise, `app.current_organization_id` MUST be set to a non-empty UUID matching the row's
#   owning organization (either directly via `organization_id` or through `tournaments.organization_id`).
# - When neither is set, PostgreSQL returns 0 rows on SELECT and rejects INSERT/UPDATE/DELETE.
module TenantRls
  POLICY_NAME = "hafagolf_tenant_isolation"

  # Tables with a direct `organization_id` UUID column (excludes public/auth routing
  # tables `organization_domains` and `organization_memberships` which are queried
  # before tenant resolution or authorization completes).
  DIRECT_ORG_TABLES = %w[
    tournaments
    message_deliveries
  ].freeze

  # Tables scoped to an organization through `tournament_id -> tournaments.organization_id`
  TOURNAMENT_SCOPED_TABLES = %w[
    golfers
    groups
    sponsors
    sponsor_slots
    raffle_prizes
    raffle_tickets
    raffle_sale_batches
    scores
    activity_logs
  ].freeze

  ALL_TABLES = (DIRECT_ORG_TABLES + TOURNAMENT_SCOPED_TABLES).freeze

  module_function

  def apply!(connection = ActiveRecord::Base.connection)
    DIRECT_ORG_TABLES.each do |table|
      next unless connection.data_source_exists?(table)

      apply_policy!(
        connection,
        table: table,
        predicate: <<~SQL.squish
          current_setting('app.rls_bypass', true) = 'on'
          OR (
            NULLIF(current_setting('app.current_organization_id', true), '') IS NOT NULL
            AND organization_id = NULLIF(current_setting('app.current_organization_id', true), '')::uuid
          )
        SQL
      )
    end

    TOURNAMENT_SCOPED_TABLES.each do |table|
      next unless connection.data_source_exists?(table)

      apply_policy!(
        connection,
        table: table,
        predicate: <<~SQL.squish
          current_setting('app.rls_bypass', true) = 'on'
          OR (
            NULLIF(current_setting('app.current_organization_id', true), '') IS NOT NULL
            AND EXISTS (
              SELECT 1
              FROM tournaments t
              WHERE t.id = #{connection.quote_table_name(table)}.tournament_id
                AND t.organization_id = NULLIF(current_setting('app.current_organization_id', true), '')::uuid
            )
          )
        SQL
      )
    end
  end

  def remove!(connection = ActiveRecord::Base.connection)
    ALL_TABLES.each do |table|
      next unless connection.data_source_exists?(table)

      quoted = connection.quote_table_name(table)
      connection.execute("DROP POLICY IF EXISTS #{POLICY_NAME} ON #{quoted}")
      connection.execute("ALTER TABLE #{quoted} NO FORCE ROW LEVEL SECURITY")
      connection.execute("ALTER TABLE #{quoted} DISABLE ROW LEVEL SECURITY")
    end
  end

  # Provisions a non-superuser, non-table-owner role for runtime app queries so
  # PostgreSQL enforces FORCE ROW LEVEL SECURITY even outside Neon's default owner role.
  def setup_app_role!(connection = ActiveRecord::Base.connection, role_name: "hafagolf_app", password: nil)
    unless role_name.match?(/\A[a-z_][a-z0-9_]*\z/)
      raise ArgumentError, "Invalid PostgreSQL role name: #{role_name}"
    end

    quoted_role = connection.quote_column_name(role_name)
    exists = connection.select_value("SELECT 1 FROM pg_roles WHERE rolname = #{connection.quote(role_name)}")

    unless exists
      if password.present?
        connection.execute("CREATE ROLE #{quoted_role} LOGIN NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE PASSWORD #{connection.quote(password)}")
      else
        connection.execute("CREATE ROLE #{quoted_role} NOLOGIN NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE")
      end
    end

    connection.execute("GRANT USAGE ON SCHEMA public TO #{quoted_role}")
    connection.execute("GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO #{quoted_role}")
    connection.execute("GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO #{quoted_role}")
    connection.execute("ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO #{quoted_role}")
    connection.execute("ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT USAGE, SELECT ON SEQUENCES TO #{quoted_role}")
  end

  def apply_policy!(connection, table:, predicate:)
    quoted = connection.quote_table_name(table)
    connection.execute("ALTER TABLE #{quoted} ENABLE ROW LEVEL SECURITY")
    connection.execute("ALTER TABLE #{quoted} FORCE ROW LEVEL SECURITY")
    connection.execute("DROP POLICY IF EXISTS #{POLICY_NAME} ON #{quoted}")
    connection.execute(<<~SQL.squish)
      CREATE POLICY #{POLICY_NAME} ON #{quoted}
      FOR ALL
      USING (#{predicate})
      WITH CHECK (#{predicate})
    SQL
  end
  private_class_method :apply_policy!
end
