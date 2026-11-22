# frozen_string_literal: true

module Payments
  # Provider-agnostic interface for online payment processors.
  # StripeAdapter implements Stripe now; CardPointeWorldpayAdapter plugs in later.
  class ProviderAdapter
    attr_reader :organization, :payment_config

    def initialize(organization:, payment_config:)
      @organization = organization
      @payment_config = payment_config
    end

    def provider_name
      payment_config&.processor_provider || "none"
    end

    def payment_mode
      payment_config&.payment_mode || "offline"
    end

    def test_mode?
      payment_config&.effective_test_mode? || false
    end

    def configured?
      false
    end

    def publishable_key
      nil
    end

    def account_origin
      payment_config&.expected_stripe_account_origin
    end

    def create_checkout_session(**)
      raise NotImplementedError
    end

    def retrieve_checkout_session(_session_id)
      raise NotImplementedError
    end

    def retrieve_payment_intent(_payment_intent_id)
      raise NotImplementedError
    end

    def retrieve_payment_method(_payment_method_id)
      raise NotImplementedError
    end

    def create_refund(**)
      raise NotImplementedError
    end

    def construct_webhook_event(payload:, sig_header:)
      raise NotImplementedError
    end
  end
end
