# frozen_string_literal: true

# Dynamically evaluates allowed CORS origins from static platform origins
# (ADMIN_ORIGIN, FRONTEND_URL, CORS_ALLOWED_ORIGINS, local dev) plus registered
# OrganizationDomain hostnames, cached briefly to avoid DB lookups per preflight.
module TenantCorsOrigins
  CACHE_KEY = "hafagolf:cors_allowed_hosts:v1"
  CACHE_TTL = 60.seconds

  DEV_HOSTS = %w[localhost 127.0.0.1].freeze
  DEV_PORTS = [3000, 3001, 5173, 5174, 5175, 5176].freeze

  module_function

  def allowed?(origin)
    return false if origin.blank?

    uri = URI.parse(origin.to_s)
    return false unless %w[http https].include?(uri.scheme) && uri.host.present?

    normalized_origin = normalize_origin(uri)
    return true if static_allowed_origins.include?(normalized_origin)

    if !Rails.env.production? && DEV_HOSTS.include?(uri.host.downcase)
      return true if uri.port.nil? || DEV_PORTS.include?(uri.port)
    end

    host = uri.host.downcase
    return false unless registered_hosts.include?(host)

    Rails.env.production? ? uri.scheme == "https" : true
  rescue URI::InvalidURIError
    false
  end

  def registered_hosts
    Rails.cache.fetch(CACHE_KEY, expires_in: CACHE_TTL) do
      if ActiveRecord::Base.connection.data_source_exists?("organization_domains")
        OrganizationDomain.pluck(:hostname).map(&:downcase).uniq
      else
        []
      end
    end
  rescue ActiveRecord::ActiveRecordError
    []
  end

  def invalidate!
    Rails.cache.delete(CACHE_KEY)
  end

  def static_allowed_origins
    configured = ENV.fetch("CORS_ALLOWED_ORIGINS", "")
                    .split(",")
                    .map(&:strip)
                    .reject(&:blank?)

    raw_origins = ([ENV["ADMIN_ORIGIN"], ENV["FRONTEND_URL"], ENV["FRONTEND_URL_ALT"]] + configured).compact
    raw_origins.filter_map do |entry|
      uri = URI.parse(entry)
      next unless %w[http https].include?(uri.scheme) && uri.host.present?

      normalize_origin(uri)
    rescue URI::InvalidURIError
      nil
    end.uniq
  end

  def normalize_origin(uri)
    default_port = uri.scheme == "https" ? 443 : 80
    port_suffix = uri.port && uri.port != default_port ? ":#{uri.port}" : ""
    "#{uri.scheme.downcase}://#{uri.host.downcase}#{port_suffix}"
  end
  private_class_method :normalize_origin
end
