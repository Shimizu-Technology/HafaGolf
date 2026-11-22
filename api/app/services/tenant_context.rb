# frozen_string_literal: true

# Manages PostgreSQL session-local Row Level Security (RLS) context via SET LOCAL.
# Uses transaction-scoped settings (`set_config(..., is_local => true)`) so it is
# fully compatible with Neon / PgBouncer transaction pooling.
module TenantContext
  UUID_REGEX = /\A[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\z/i

  module_function

  # Executes the block inside a transaction scoped strictly to a single organization.
  # Any query or write against RLS-protected tables outside this organization is
  # blocked at the PostgreSQL engine level (when running as a non-superuser role).
  def with_organization(organization_or_id, connection: ActiveRecord::Base.connection)
    org_id = organization_or_id.is_a?(Organization) ? organization_or_id.id : organization_or_id.to_s
    raise ArgumentError, "organization_id is required for TenantContext.with_organization" if org_id.blank?

    previous_org = Current.organization
    Current.organization = organization_or_id if organization_or_id.is_a?(Organization)

    with_transaction_config(
      connection: connection,
      organization_id: org_id,
      accessible_org_ids: "",
      rls_bypass: "off"
    ) do
      yield
    end
  ensure
    Current.organization = previous_org
  end

  # Executes the block scoped to an explicit allowlist of organization UUIDs
  # (used for verified org admins & volunteers so Postgres enforces org boundaries).
  # An empty list fails closed (0 rows visible).
  def with_organizations(organization_ids, connection: ActiveRecord::Base.connection)
    sanitized = Array(organization_ids).map(&:to_s).select { |id| id.match?(UUID_REGEX) }.uniq

    with_transaction_config(
      connection: connection,
      organization_id: "",
      accessible_org_ids: sanitized.join(","),
      rls_bypass: "off"
    ) do
      yield
    end
  end

  # Executes the block with explicit fail-closed RLS settings (no org, no allowlist, no bypass).
  def with_closed_access(connection: ActiveRecord::Base.connection)
    with_transaction_config(
      connection: connection,
      organization_id: "",
      accessible_org_ids: "",
      rls_bypass: "off"
    ) do
      yield
    end
  end

  # Executes the block with explicit platform-level RLS bypass inside a transaction.
  # Use ONLY for verified super-admin requests, signature-verified webhooks,
  # cryptographic token lookup before org resolution, or background/maintenance tasks.
  def with_platform_access(connection: ActiveRecord::Base.connection)
    with_transaction_config(
      connection: connection,
      organization_id: "",
      accessible_org_ids: "",
      rls_bypass: "on"
    ) do
      yield
    end
  end

  # Explicit operator wrapper for rails console, rails runner, and maintenance rake tasks.
  def with_console_access(reason: nil, connection: ActiveRecord::Base.connection, &block)
    Rails.logger.info("[TenantContext] Platform console/maintenance access granted#{reason.present? ? ": #{reason}" : ""}")
    with_platform_access(connection: connection, &block)
  end

  def with_transaction_config(connection:, organization_id:, accessible_org_ids:, rls_bypass:)
    if connection.transaction_open?
      previous_org_id = connection.select_value("SELECT current_setting('app.current_organization_id', true)").to_s
      previous_accessible_ids = connection.select_value("SELECT current_setting('app.accessible_organization_ids', true)").to_s
      previous_bypass = connection.select_value("SELECT current_setting('app.rls_bypass', true)").to_s

      apply_local_settings(
        connection,
        organization_id: organization_id,
        accessible_org_ids: accessible_org_ids,
        rls_bypass: rls_bypass
      )
      begin
        yield
      ensure
        unless transaction_aborted?(connection)
          apply_local_settings(
            connection,
            organization_id: previous_org_id,
            accessible_org_ids: previous_accessible_ids,
            rls_bypass: previous_bypass
          )
        end
      end
    else
      ActiveRecord::Base.transaction do
        apply_local_settings(
          connection,
          organization_id: organization_id,
          accessible_org_ids: accessible_org_ids,
          rls_bypass: rls_bypass
        )
        yield
      end
    end
  end
  private_class_method :with_transaction_config

  def apply_local_settings(connection, organization_id:, accessible_org_ids:, rls_bypass:)
    connection.exec_query(
      "SELECT set_config('app.current_organization_id', $1, true), set_config('app.accessible_organization_ids', $2, true), set_config('app.rls_bypass', $3, true)",
      "TenantContext.set_config",
      [organization_id.to_s, accessible_org_ids.to_s, rls_bypass.to_s]
    )
  end
  private_class_method :apply_local_settings

  def transaction_aborted?(connection)
    raw = connection.respond_to?(:raw_connection) ? connection.raw_connection : nil
    return false unless raw.respond_to?(:transaction_status) && defined?(PG::PQTRANS_INERROR)

    raw.transaction_status == PG::PQTRANS_INERROR
  rescue StandardError
    false
  end
  private_class_method :transaction_aborted?
end
