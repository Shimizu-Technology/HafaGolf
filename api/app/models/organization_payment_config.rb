# frozen_string_literal: true

require "uri"

class OrganizationPaymentConfig < ApplicationRecord
  PAYMENT_MODES = %w[external_link platform_collect client_processor offline].freeze
  PROCESSOR_PROVIDERS = %w[stripe swipesimple paypal worldpay_cardpointe none].freeze

  belongs_to :organization

  # Rails 8 Active Record Encryption (ciphertext at rest; never copied from platform ENV)
  encrypts :encrypted_public_key
  encrypts :encrypted_secret_key
  encrypts :encrypted_webhook_secret

  validates :organization_id, uniqueness: true
  validates :payment_mode, presence: true, inclusion: { in: PAYMENT_MODES }
  validates :processor_provider, presence: true, inclusion: { in: PROCESSOR_PROVIDERS }
  validates :platform_fee_flat_cents, numericality: { only_integer: true, greater_than_or_equal_to: 0 }
  validates :platform_fee_per_registrant_cents, numericality: { only_integer: true, greater_than_or_equal_to: 0 }
  validates :platform_fee_cap_cents, numericality: { only_integer: true, greater_than_or_equal_to: 0 }, allow_nil: true
  validates :webhook_endpoint_token, uniqueness: true, allow_nil: true

  validate :validate_external_https_urls
  validate :reject_platform_secrets_in_tenant_row

  before_validation :normalize_fields
  before_validation :ensure_webhook_endpoint_token, if: :client_processor?

  def external_link?
    payment_mode == "external_link"
  end

  def platform_collect?
    payment_mode == "platform_collect"
  end

  def client_processor?
    payment_mode == "client_processor"
  end

  def offline?
    payment_mode == "offline"
  end

  def stripe_mode?
    (platform_collect? || client_processor?) && processor_provider == "stripe"
  end

  def effective_test_mode?
    return true if test_mode?
    return false unless platform_collect?

    # Allow simulated test mode in local/test environments when no live Stripe key is configured
    Rails.env.local? && StripeConfig.platform_secret_key.blank?
  end

  def expected_stripe_account_origin
    if platform_collect?
      effective_test_mode? ? "platform_test" : "platform_live"
    elsif client_processor?
      "client_processor:#{organization_id}"
    end
  end

  def rotate_webhook_endpoint_token!
    update!(webhook_endpoint_token: generate_unique_webhook_token)
    webhook_endpoint_token
  end

  def masked_public_key
    key = client_processor? ? encrypted_public_key : nil
    return nil if key.blank?

    return "#{key[0, 7]}...#{key[-4, 4]}" if key.length > 14

    "****"
  end

  def client_webhook_url(api_base_url: nil)
    return nil unless client_processor? && webhook_endpoint_token.present?

    base = (api_base_url.presence || ENV["API_URL"].presence || "https://api.example.com").to_s.sub(%r{/+\z}, "")
    "#{base}/api/v1/webhooks/stripe/orgs/#{webhook_endpoint_token}"
  end

  def safe_as_json(api_base_url: nil)
    {
      id: id,
      organization_id: organization_id,
      payment_mode: payment_mode,
      processor_provider: processor_provider,
      test_mode: test_mode,
      effective_test_mode: effective_test_mode?,
      has_public_key: client_processor? && encrypted_public_key.present?,
      has_secret_key: client_processor? && encrypted_secret_key.present?,
      has_webhook_secret: client_processor? && encrypted_webhook_secret.present?,
      masked_public_key: masked_public_key,
      webhook_url: client_webhook_url(api_base_url: api_base_url),
      external_checkout_url: external_checkout_url,
      external_walkin_url: external_walkin_url,
      external_donation_url: external_donation_url,
      platform_fee_flat_cents: platform_fee_flat_cents,
      platform_fee_per_registrant_cents: platform_fee_per_registrant_cents,
      platform_fee_cap_cents: platform_fee_cap_cents,
      payout_payee_name: payout_payee_name,
      payout_bank_name: payout_bank_name,
      payout_notes: payout_notes,
      stripe_configured: Payments::Resolver.for(organization, config: self).configured?,
      updated_at: updated_at&.iso8601
    }
  end

  private

  def normalize_fields
    self.payment_mode = payment_mode.to_s.strip.downcase.presence || "offline"
    self.processor_provider = processor_provider.to_s.strip.downcase.presence || default_provider_for_mode
    %i[external_checkout_url external_walkin_url external_donation_url payout_payee_name payout_bank_name].each do |attr|
      val = public_send(attr)
      public_send(:"#{attr}=", val.to_s.strip.presence) unless val.nil?
    end
  end

  def default_provider_for_mode
    case payment_mode
    when "platform_collect", "client_processor" then "stripe"
    when "external_link" then "swipesimple"
    else "none"
    end
  end

  def ensure_webhook_endpoint_token
    self.webhook_endpoint_token = generate_unique_webhook_token if webhook_endpoint_token.blank?
  end

  def generate_unique_webhook_token
    loop do
      candidate = SecureRandom.urlsafe_base64(24)
      break candidate unless self.class.exists?(webhook_endpoint_token: candidate)
    end
  end

  def validate_external_https_urls
    %i[external_checkout_url external_walkin_url external_donation_url].each do |attr|
      value = public_send(attr)
      next if value.blank?

      begin
        parsed = URI.parse(value)
        unless parsed.scheme == "https" && parsed.host.present?
          errors.add(attr, "must be a valid https:// URL")
        end
      rescue URI::InvalidURIError
        errors.add(attr, "must be a valid https:// URL")
      end
    end
  end

  def reject_platform_secrets_in_tenant_row
    unless client_processor?
      if encrypted_secret_key.present? || encrypted_webhook_secret.present?
        errors.add(:base, "Tenant secret credentials are only permitted in client_processor mode")
      end
      return
    end

    platform_secret = StripeConfig.platform_secret_key
    if platform_secret.present? && encrypted_secret_key.present? &&
       ActiveSupport::SecurityUtils.secure_compare(
         Digest::SHA256.hexdigest(encrypted_secret_key),
         Digest::SHA256.hexdigest(platform_secret)
       )
      errors.add(:encrypted_secret_key, "cannot duplicate platform Stripe credentials")
    end
  end
end
