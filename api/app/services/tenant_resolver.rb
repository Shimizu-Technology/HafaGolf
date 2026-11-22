# frozen_string_literal: true

# Resolves the requested public tenant host to an Organization.
# IMPORTANT: X-Tenant-Host / Origin is a routing hint only, NEVER a security boundary.
# Admin authorization and resource scoping must always verify user membership and org ownership.
module TenantResolver
  module_function

  def extract_host(request)
    return nil unless request

    candidates = [
      request.headers["X-Tenant-Host"],
      request.headers["Origin"],
      request.host
    ]

    candidates.each do |raw|
      normalized = OrganizationDomain.normalize_host(raw)
      return normalized if normalized.present?
    end

    nil
  end

  def resolve(request)
    host = extract_host(request)
    resolve_host(host)
  end

  def resolve_host(raw_host)
    host = OrganizationDomain.normalize_host(raw_host)
    return nil if host.blank?

    OrganizationDomain.includes(:organization)
                      .find_by("LOWER(hostname) = ?", host)
                      &.organization
  end
end
