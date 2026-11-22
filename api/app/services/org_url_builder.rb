# frozen_string_literal: true

# Builds outbound public and admin URLs using each organization's primary domain
# (or FRONTEND_URL fallback) and ADMIN_ORIGIN for admin portal links.
module OrgUrlBuilder
  LOCAL_HOSTS = %w[localhost 127.0.0.1].freeze

  module_function

  def public_base_url(organization = nil)
    host = organization&.primary_host
    if host.present?
      scheme = LOCAL_HOSTS.include?(host.downcase) ? "http" : "https"
      "#{scheme}://#{host}"
    else
      fallback_frontend_url
    end
  end

  def public_url(organization, path = "/")
    join_url(public_base_url(organization), path)
  end

  def admin_base_url
    (ENV["ADMIN_ORIGIN"].presence || fallback_frontend_url).sub(%r{/+\z}, "")
  end

  def admin_url(path = "/admin/login")
    join_url(admin_base_url, path)
  end

  def payment_link_url(golfer)
    return nil unless golfer&.payment_token.present?

    public_url(golfer.tournament&.organization, "/pay/#{golfer.payment_token}")
  end

  def sponsor_portal_url(sponsor, token)
    public_url(sponsor&.tournament&.organization, "/sponsor-portal?token=#{token}")
  end

  def golfer_magic_link_url(golfer)
    return nil unless golfer&.magic_link_token.present?

    public_url(golfer.tournament&.organization, "/score/verify?token=#{golfer.magic_link_token}")
  end

  def fallback_frontend_url
    ENV.fetch("FRONTEND_URL", "http://localhost:5173").sub(%r{/+\z}, "")
  end
  private_class_method :fallback_frontend_url

  def join_url(base, path)
    clean_base = base.to_s.sub(%r{/+\z}, "")
    clean_path = path.to_s
    clean_path = "/#{clean_path}" unless clean_path.start_with?("/")
    "#{clean_base}#{clean_path}"
  end
  private_class_method :join_url
end
