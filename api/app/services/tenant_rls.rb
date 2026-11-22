# frozen_string_literal: true

# Applies defense-in-depth PostgreSQL FORCE ROW LEVEL SECURITY policies across
# multi-tenant tables.
#
# Policy semantics (fail-closed):
# - When `app.rls_bypass = 'on'` (verified super-admin, verified webhook, or explicit
#   platform job/console access), access is allowed.
# - Otherwise, the row's owning organization MUST match either:
#   * `app.current_organization_id` (single-org public/token request), OR
#   * `app.accessible_organization_ids` (comma-separated UUID allowlist for verified org admins/volunteers).
# - When none of those are set, PostgreSQL returns 0 rows on SELECT and rejects INSERT/UPDATE/DELETE.
module TenantRls
  POLICY_NAME = "hafagolf_tenant_isolation"

  # Tables with a direct `organization_id` UUID column (excludes public/auth routing
  # tables `organization_domains` and `organization_memberships` which are queried
  # before tenant resolution or authorization completes).
  DIRECT_ORG_TABLES = %w[
    tournaments
    message_deliveries
    organization_payment_configs
    tournament_settlements
    tournament_payouts
    sponsor_tiers
    donations
    employee_numbers
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
    tournament_assignments
  ].freeze

  # Tables that may carry either a direct `organization_id` (e.g. org-level admin logs)
  # or a `tournament_id` linked to `tournaments.organization_id`.
  HYBRID_ORG_TABLES = %w[
    activity_logs
  ].freeze

  ALL_TABLES = (DIRECT_ORG_TABLES + TOURNAMENT_SCOPED_TABLES + HYBRID_ORG_TABLES).freeze

  module_function

  def apply!(connection = ActiveRecord::Base.connection)
    DIRECT_ORG_TABLES.each do |table|
      next unless connection.data_source_exists?(table)

      apply_policy!(
        connection,
        table: table,
        predicate: <<~SQL.squish
          current_setting('app.rls_bypass', true) = 'on'
          OR #{org_match_sql("organization_id")}
        SQL
      )
    end

    TOURNAMENT_SCOPED_TABLES.each do |table|
      next unless connection.data_source_exists?(table)

      quoted = connection.quote_table_name(table)
      apply_policy!(
        connection,
        table: table,
        predicate: <<~SQL.squish
          current_setting('app.rls_bypass', true) = 'on'
          OR EXISTS (
            SELECT 1
            FROM tournaments t
            WHERE t.id = #{quoted}.tournament_id
              AND #{org_match_sql("t.organization_id")}
          )
        SQL
      )
    end

    HYBRID_ORG_TABLES.each do |table|
      next unless connection.data_source_exists?(table)

      quoted = connection.quote_table_name(table)
      has_org_column = connection.column_exists?(table, :organization_id)
      direct_clause = has_org_column ? "#{org_match_sql("#{quoted}.organization_id")} OR " : ""

      apply_policy!(
        connection,
        table: table,
        predicate: <<~SQL.squish
          current_setting('app.rls_bypass', true) = 'on'
          OR #{direct_clause}EXISTS (
            SELECT 1
            FROM tournaments t
            WHERE t.id = #{quoted}.tournament_id
              AND #{org_match_sql("t.organization_id")}
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

    if exists
      if password.present?
        connection.execute("ALTER ROLE #{quoted_role} WITH LOGIN NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE PASSWORD #{connection.quote(password)}")
      end
    elsif password.present?
      connection.execute("CREATE ROLE #{quoted_role} LOGIN NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE PASSWORD #{connection.quote(password)}")
    else
      connection.execute("CREATE ROLE #{quoted_role} NOLOGIN NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE")
    end

    connection.execute("GRANT USAGE ON SCHEMA public TO #{quoted_role}")
    connection.execute("GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO #{quoted_role}")
    connection.execute("GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO #{quoted_role}")
    connection.execute("ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO #{quoted_role}")
    connection.execute("ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT USAGE, SELECT ON SEQUENCES TO #{quoted_role}")
  end

  def status(connection = ActiveRecord::Base.connection)
    role_row = connection.select_one(<<~SQL.squish)
      SELECT current_user AS role_name, rolsuper, rolbypassrls
      FROM pg_roles
      WHERE rolname = current_user
    SQL

    table_rows = connection.select_all(<<~SQL.squish).to_a
      SELECT relname AS table_name, relrowsecurity AS rls_enabled, relforcerowsecurity AS rls_forced
      FROM pg_class
      WHERE relname IN (#{ALL_TABLES.map { |t| connection.quote(t) }.join(", ")})
      ORDER BY relname
    SQL

    {
      role: role_row,
      enforced_for_current_role: role_row && !role_row["rolsuper"] && !role_row["rolbypassrls"],
      tables: table_rows
    }
  end

  def org_match_sql(column_sql)
    <<~SQL.squish
      (
        (
          NULLIF(current_setting('app.current_organization_id', true), '') IS NOT NULL
          AND #{column_sql} = NULLIF(current_setting('app.current_organization_id', true), '')::uuid
        )
        OR (
          NULLIF(current_setting('app.accessible_organization_ids', true), '') IS NOT NULL
          AND #{column_sql} = ANY(string_to_array(current_setting('app.accessible_organization_ids', true), ',')::uuid[])
        )
      )
    SQL
  end
  private_class_method :org_match_sql

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
