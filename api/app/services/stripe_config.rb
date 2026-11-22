# frozen_string_literal: true

# Resolves Shimizu Technology's platform-level Stripe credentials exclusively from
# server environment variables. Platform secrets are NEVER stored in tenant rows.
module StripeConfig
  module_function

  def platform_secret_key
    ENV["PLATFORM_STRIPE_SECRET_KEY"].presence ||
      ENV["STRIPE_SECRET_KEY"].presence
  end

  def platform_publishable_key
    ENV["PLATFORM_STRIPE_PUBLISHABLE_KEY"].presence ||
      ENV["STRIPE_PUBLISHABLE_KEY"].presence
  end

  def platform_webhook_secret
    ENV["PLATFORM_STRIPE_WEBHOOK_SECRET"].presence ||
      ENV["STRIPE_WEBHOOK_SECRET"].presence
  end

  # Backwards-compatible aliases (no longer accept legacy Setting)
  def secret_key
    platform_secret_key
  end

  def publishable_key
    platform_publishable_key
  end

  def webhook_secret
    platform_webhook_secret
  end

  def configured?
    platform_secret_key.present? && platform_publishable_key.present?
  end

  def strict_webhook_signatures_required?
    Rails.env.production? ||
      Rails.env.staging? ||
      %w[production staging].include?(ENV["APP_ENV"].to_s.downcase)
  end
end
