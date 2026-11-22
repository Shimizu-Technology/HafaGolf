# frozen_string_literal: true

class ApplicationController < ActionController::API
  before_action :resolve_current_tenant
  around_action :with_tenant_rls_context

  private

  # Populates Current.tenant_host and Current.organization from host headers.
  # Treated strictly as a routing hint; controllers enforce auth and ownership separately.
  def resolve_current_tenant
    Current.tenant_host = TenantResolver.extract_host(request)
    Current.organization = TenantResolver.resolve_host(Current.tenant_host)
  end

  # Sets transaction-scoped PostgreSQL RLS session variables (`SET LOCAL`) for each request.
  # Public requests on a resolved tenant host run strictly inside that org's RLS boundary.
  # Admin / webhook / hostless requests run with platform RLS access and enforce
  # fine-grained authorization via current_user.accessible_tournaments / webhook signatures.
  def with_tenant_rls_context(&block)
    if Current.organization.present? && !admin_or_webhook_request?
      TenantContext.with_organization(Current.organization, &block)
    else
      TenantContext.with_platform_access(&block)
    end
  end

  def admin_or_webhook_request?
    request.headers["Authorization"].present? ||
      request.path.start_with?("/api/v1/admin/", "/api/v1/webhooks/")
  end

  # Verifies that a record's organization matches the resolved tenant host when present.
  # Returns true when valid, or renders 404/401 and returns false on cross-tenant mismatch.
  def verify_tenant_match!(organization_id, status: :not_found, message: "Resource not found")
    return true unless Current.organization.present?
    return true if organization_id.to_s == Current.organization.id.to_s

    render json: { error: message }, status: status
    false
  end

  # Resolves an organization for public endpoints from Current.organization or an explicit slug.
  def resolve_public_organization
    return Current.organization if Current.organization.present?
    return Organization.find_by(slug: params[:organization_slug].to_s.downcase) if params[:organization_slug].present?

    nil
  end

  # Resolves a public tournament scoped to Current.organization when resolved.
  # Never falls back to a global tournament across other organizations.
  def resolve_public_tournament(tournament_id: params[:tournament_id], require_listed: false)
    scope = Current.organization.present? ? Current.organization.tournaments : Tournament.all
    scope = scope.where(public_listed: true) if require_listed

    if tournament_id.present?
      scope.find_by(id: tournament_id)
    else
      org = resolve_public_organization
      return nil unless org

      candidate = Tournament.current_for(org)
      return nil if require_listed && candidate && !candidate.public_listed?

      candidate
    end
  end
end
