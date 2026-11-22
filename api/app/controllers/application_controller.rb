# frozen_string_literal: true

class ApplicationController < ActionController::API
  before_action :resolve_current_tenant

  private

  # Populates Current.tenant_host and Current.organization from host headers.
  # Treated strictly as a routing hint; controllers enforce auth and ownership separately.
  def resolve_current_tenant
    Current.tenant_host = TenantResolver.extract_host(request)
    Current.organization = TenantResolver.resolve_host(Current.tenant_host)
  end
end
