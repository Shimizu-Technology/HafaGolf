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

  # Sets transaction-scoped PostgreSQL RLS session variables (`SET LOCAL`) strictly
  # AFTER authentication has run. Never trusts raw `Authorization` headers or missing hosts.
  # - Verified super_admin -> platform access (`app.rls_bypass = 'on'`)
  # - Verified org admin / volunteer / tournament admin -> org UUID allowlist (`app.accessible_organization_ids`)
  # - Verified golfer / sponsor token -> single org (`app.current_organization_id`)
  # - Public request on resolved tenant host -> single org (`app.current_organization_id`)
  # - Unauthenticated hostless request (including spoofed Bearer headers) -> fail-closed (0 rows)
  def with_tenant_rls_context(&block)
    if respond_to?(:current_user, true) && current_user.present?
      with_user_rls_context(&block)
    elsif instance_variable_defined?(:@current_golfer) && @current_golfer.present?
      TenantContext.with_organization(@current_golfer.tournament.organization_id, &block)
    elsif instance_variable_defined?(:@sponsor) && @sponsor.present?
      TenantContext.with_organization(@sponsor.tournament.organization_id, &block)
    elsif Current.organization.present?
      TenantContext.with_organization(Current.organization, &block)
    else
      TenantContext.with_closed_access(&block)
    end
  end

  def with_user_rls_context(&block)
    if current_user&.super_admin?
      TenantContext.with_platform_access(&block)
    elsif current_user.present?
      TenantContext.with_organizations(current_user.accessible_organization_ids, &block)
    else
      TenantContext.with_closed_access(&block)
    end
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
