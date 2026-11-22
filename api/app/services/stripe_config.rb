# frozen_string_literal: true

# Resolves Stripe credentials with environment variables taking precedence over
# the legacy Setting singleton. Keeps Setting fallback intact until PR-4a replaces
# it with per-organization encrypted payment configs and drops the settings table.
module StripeConfig
  module_function

  def secret_key(setting: nil)
    ENV["PLATFORM_STRIPE_SECRET_KEY"].presence ||
      ENV["STRIPE_SECRET_KEY"].presence ||
      resolved_setting(setting)&.stripe_secret_key.presence
  end

  def publishable_key(setting: nil)
    ENV["PLATFORM_STRIPE_PUBLISHABLE_KEY"].presence ||
      ENV["STRIPE_PUBLISHABLE_KEY"].presence ||
      resolved_setting(setting)&.stripe_public_key.presence
  end

  def webhook_secret(setting: nil)
    ENV["PLATFORM_STRIPE_WEBHOOK_SECRET"].presence ||
      ENV["STRIPE_WEBHOOK_SECRET"].presence ||
      resolved_setting(setting)&.stripe_webhook_secret.presence
  end

  def configured?(setting: nil)
    secret_key(setting: setting).present? && publishable_key(setting: setting).present?
  end

  def resolved_setting(setting)
    return setting if setting

    Setting.instance
  end
  private_class_method :resolved_setting
end
