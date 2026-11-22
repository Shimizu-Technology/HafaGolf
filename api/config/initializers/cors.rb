# frozen_string_literal: true

# Be sure to restart your server when you modify this file.
# Dynamically allows platform admin origins (ADMIN_ORIGIN, FRONTEND_URL, CORS_ALLOWED_ORIGINS),
# local dev origins in non-production, and all registered OrganizationDomain hostnames.

Rails.application.config.middleware.insert_before 0, Rack::Cors do
  allow do
    origins { |source, _env| TenantCorsOrigins.allowed?(source) }

    resource "*",
      headers: :any,
      methods: [:get, :post, :put, :patch, :delete, :options, :head],
      credentials: true,
      expose: ["Authorization", "X-Tenant-Host"]
  end
end
