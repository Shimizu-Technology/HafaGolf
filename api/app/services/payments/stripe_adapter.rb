# frozen_string_literal: true

module Payments
  # Thread-safe Stripe adapter that passes `{ api_key: ... }` on every Stripe API call
  # instead of mutating global `Stripe.api_key`, preventing cross-org credential leakage
  # under multithreaded Puma.
  class StripeAdapter < ProviderAdapter
    def configured?
      secret_key.present?
    end

    def secret_key
      if payment_config.platform_collect?
        StripeConfig.platform_secret_key
      elsif payment_config.client_processor?
        payment_config.encrypted_secret_key.presence
      end
    end

    def publishable_key
      if payment_config.platform_collect?
        StripeConfig.platform_publishable_key
      elsif payment_config.client_processor?
        payment_config.encrypted_public_key.presence
      end
    end

    def webhook_secret
      if payment_config.platform_collect?
        StripeConfig.platform_webhook_secret
      elsif payment_config.client_processor?
        payment_config.encrypted_webhook_secret.presence
      end
    end

    def create_checkout_session(params)
      require_secret_key!
      Stripe::Checkout::Session.create(params, request_opts)
    end

    def retrieve_checkout_session(session_id)
      require_secret_key!
      Stripe::Checkout::Session.retrieve(session_id, request_opts)
    end

    def retrieve_payment_intent(payment_intent_id)
      require_secret_key!
      Stripe::PaymentIntent.retrieve(payment_intent_id, request_opts)
    end

    def retrieve_payment_method(payment_method_id)
      require_secret_key!
      Stripe::PaymentMethod.retrieve(payment_method_id, request_opts)
    end

    def create_refund(payment_intent:, reason: "requested_by_customer")
      require_secret_key!
      Stripe::Refund.create(
        { payment_intent: payment_intent, reason: reason },
        request_opts
      )
    end

    def construct_webhook_event(payload:, sig_header:)
      secret = webhook_secret
      if secret.present?
        Stripe::Webhook.construct_event(payload, sig_header, secret)
      else
        if StripeConfig.strict_webhook_signatures_required?
          raise Stripe::SignatureVerificationError.new(
            "Stripe webhook secret is required in staging and production",
            sig_header
          )
        end

        data = JSON.parse(payload, symbolize_names: true)
        Stripe::Event.construct_from(data)
      end
    end

    private

    def request_opts
      { api_key: secret_key }
    end

    def require_secret_key!
      raise "Stripe is not configured for this organization" if secret_key.blank?
    end
  end
end
