# frozen_string_literal: true

# Manages PostgreSQL session-local Row Level Security (RLS) context via SET LOCAL.
# Uses transaction-scoped settings (`set_config(..., is_local => true)`) so it is
# fully compatible with Neon / PgBouncer transaction pooling.
module TenantContext
  module_function

  # Executes the block inside a transaction scoped strictly to the given organization.
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
      rls_bypass: "off"
    ) do
      yield
    end
  ensure
    Current.organization = previous_org
  end

  # Executes the block with explicit platform-level RLS bypass inside a transaction.
  # Use ONLY for platform/super-admin operations, multi-org admin queries authorized
  # via current_user.accessible_tournaments, webhook lookup before org resolution,
  # or background/maintenance tasks.
  def with_platform_access(connection: ActiveRecord::Base.connection)
    with_transaction_config(
      connection: connection,
      organization_id: "",
      rls_bypass: "on"
    ) do
      yield
    end
  end

  def with_transaction_config(connection:, organization_id:, rls_bypass:)
    if connection.transaction_open?
      previous_org_id = connection.select_value("SELECT current_setting('app.current_organization_id', true)").to_s
      previous_bypass = connection.select_value("SELECT current_setting('app.rls_bypass', true)").to_s

      apply_local_settings(connection, organization_id: organization_id, rls_bypass: rls_bypass)
      begin
        yield
      ensure
        apply_local_settings(connection, organization_id: previous_org_id, rls_bypass: previous_bypass)
      end
    else
      ActiveRecord::Base.transaction do
        apply_local_settings(connection, organization_id: organization_id, rls_bypass: rls_bypass)
        yield
      end
    end
  end
  private_class_method :with_transaction_config

  def apply_local_settings(connection, organization_id:, rls_bypass:)
    connection.exec_query(
      "SELECT set_config('app.current_organization_id', $1, true), set_config('app.rls_bypass', $2, true)",
      "TenantContext.set_config",
      [organization_id.to_s, rls_bypass.to_s]
    )
  end
  private_class_method :apply_local_settings
end
