# frozen_string_literal: true

module Payments
  module Resolver
    module_function

    def for(organization, config: nil)
      payment_config = config || organization&.effective_payment_config
      if payment_config&.stripe_mode?
        StripeAdapter.new(organization: organization, payment_config: payment_config)
      else
        ProviderAdapter.new(organization: organization, payment_config: payment_config)
      end
    end
  end
end
