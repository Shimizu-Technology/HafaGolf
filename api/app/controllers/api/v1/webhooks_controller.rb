# frozen_string_literal: true

module Api
  module V1
    class WebhooksController < ApplicationController
      # Skip CSRF protection and authentication for webhooks
      skip_before_action :verify_authenticity_token, raise: false
      skip_before_action :authenticate_user!, raise: false

      # POST /api/v1/webhooks/stripe
      # Platform-owned Stripe account (`platform_collect`)
      def stripe
        payload = request.body.read
        sig_header = request.env["HTTP_STRIPE_SIGNATURE"]

        stripe_secret = StripeConfig.platform_secret_key
        unless stripe_secret.present?
          Rails.logger.error("Stripe platform webhook received but platform Stripe is not configured")
          head :service_unavailable
          return
        end

        webhook_secret = StripeConfig.platform_webhook_secret
        event = parse_and_verify_stripe_event(
          payload: payload,
          sig_header: sig_header,
          webhook_secret: webhook_secret,
          context_label: "platform"
        )
        return unless event

        TenantContext.with_platform_access do
          dispatch_stripe_event(event, scope_organization_id: nil, expected_mode: "platform_collect")
        end

        head :ok
      end

      # POST /api/v1/webhooks/stripe/orgs/:webhook_endpoint_token
      # Client-owned Stripe account (`client_processor`), routed via opaque token
      def stripe_org
        token = params[:webhook_endpoint_token].to_s.strip
        if token.blank?
          head :not_found
          return
        end

        payment_config = TenantContext.with_platform_access do
          OrganizationPaymentConfig.includes(:organization).find_by(
            webhook_endpoint_token: token,
            payment_mode: "client_processor"
          )
        end

        unless payment_config&.processor_provider == "stripe"
          head :not_found
          return
        end

        adapter = Payments::Resolver.for(payment_config.organization, config: payment_config)
        unless adapter.configured?
          Rails.logger.error("Client Stripe webhook received for org #{payment_config.organization_id} but credentials are missing")
          head :service_unavailable
          return
        end

        payload = request.body.read
        sig_header = request.env["HTTP_STRIPE_SIGNATURE"]

        event = parse_and_verify_stripe_event(
          payload: payload,
          sig_header: sig_header,
          webhook_secret: adapter.webhook_secret,
          context_label: "org:#{payment_config.organization_id}"
        )
        return unless event

        # Execute strictly inside this organization's RLS boundary so a client webhook
        # can NEVER read or mutate another organization's golfers.
        TenantContext.with_organization(payment_config.organization_id) do
          dispatch_stripe_event(
            event,
            scope_organization_id: payment_config.organization_id,
            expected_mode: "client_processor",
            account_origin: adapter.account_origin
          )
        end

        head :ok
      end

      private

      def parse_and_verify_stripe_event(payload:, sig_header:, webhook_secret:, context_label:)
        if webhook_secret.present?
          Stripe::Webhook.construct_event(payload, sig_header, webhook_secret)
        else
          if StripeConfig.strict_webhook_signatures_required?
            Rails.logger.error("Stripe webhook secret missing (#{context_label}) in staging/production")
            head :bad_request
            return nil
          end

          data = JSON.parse(payload, symbolize_names: true)
          Rails.logger.warn("Stripe webhook (#{context_label}) accepted without signature in local dev/test")
          Stripe::Event.construct_from(data)
        end
      rescue JSON::ParserError => e
        Rails.logger.error("Invalid Stripe webhook payload (#{context_label}): #{e.message}")
        head :bad_request
        nil
      rescue Stripe::SignatureVerificationError => e
        Rails.logger.error("Stripe signature verification failed (#{context_label}): #{e.message}")
        head :bad_request
        nil
      end

      def dispatch_stripe_event(event, scope_organization_id:, expected_mode:, account_origin: nil)
        case event.type
        when "checkout.session.completed"
          resolved_origin = account_origin
          if resolved_origin.nil? && expected_mode == "platform_collect" && event.respond_to?(:livemode) && !event.livemode.nil?
            resolved_origin = event.livemode ? "platform_live" : "platform_test"
          end
          handle_checkout_session_completed(
            event.data.object,
            scope_organization_id: scope_organization_id,
            expected_mode: expected_mode,
            account_origin: resolved_origin
          )
        when "checkout.session.expired"
          handle_checkout_session_expired(event.data.object, scope_organization_id: scope_organization_id)
        when "payment_intent.succeeded"
          Rails.logger.info("Payment intent succeeded: #{event.data.object.id}")
        when "payment_intent.payment_failed"
          handle_payment_intent_failed(event.data.object, scope_organization_id: scope_organization_id)
        else
          Rails.logger.info("Unhandled Stripe event type: #{event.type}")
        end
      end

      def scoped_golfer_relation(scope_organization_id)
        scope = Golfer.includes(tournament: :organization)
        if scope_organization_id.present?
          scope = scope.joins(:tournament).where(tournaments: { organization_id: scope_organization_id })
        end
        scope
      end

      def scoped_registration_relation(scope_organization_id)
        scope = Registration.includes(:team_members, tournament: :organization)
        if scope_organization_id.present?
          scope = scope.where(organization_id: scope_organization_id)
        end
        scope
      end

      def scoped_sponsor_relation(scope_organization_id)
        scope = Sponsor.includes(:sponsor_tier, tournament: :organization)
        if scope_organization_id.present?
          scope = scope.joins(:tournament).where(tournaments: { organization_id: scope_organization_id })
        end
        scope
      end

      def scoped_donation_relation(scope_organization_id)
        scope = Donation.includes(:organization, :tournament)
        if scope_organization_id.present?
          scope = scope.where(organization_id: scope_organization_id)
        end
        scope
      end

      def metadata_value(metadata, key)
        return nil unless metadata

        if metadata.respond_to?(:[])
          metadata[key] || metadata[key.to_s]
        elsif metadata.respond_to?(key)
          metadata.public_send(key)
        end
      end

      def handle_checkout_session_completed(session, scope_organization_id:, expected_mode:, account_origin:)
        Rails.logger.info("Checkout session completed: #{session.id}")

        unless session.respond_to?(:payment_status) && session.payment_status == "paid"
          Rails.logger.info("Ignoring checkout.session.completed #{session.id} with payment_status=#{session.respond_to?(:payment_status) ? session.payment_status.inspect : 'missing'}")
          return
        end

        item_type = metadata_value(session.metadata, :item_type).to_s
        case item_type
        when "sponsorship"
          return handle_sponsorship_checkout_completed(
            session,
            scope_organization_id: scope_organization_id,
            expected_mode: expected_mode,
            account_origin: account_origin
          )
        when "donation"
          return handle_donation_checkout_completed(
            session,
            scope_organization_id: scope_organization_id,
            expected_mode: expected_mode,
            account_origin: account_origin
          )
        end

        scope = scoped_golfer_relation(scope_organization_id)
        golfer = scope.find_by(stripe_checkout_session_id: session.id)

        if golfer.nil?
          golfer_id = metadata_value(session.metadata, :golfer_id)
          golfer = scope.find_by(id: golfer_id) if golfer_id.present?
        end

        unless golfer
          reg_scope = scoped_registration_relation(scope_organization_id)
          registration = reg_scope.find_by(stripe_checkout_session_id: session.id)
          if registration.nil?
            registration_id = metadata_value(session.metadata, :registration_id)
            registration = reg_scope.find_by(id: registration_id) if registration_id.present?
          end

          if registration
            return handle_registration_checkout_completed(
              registration,
              session: session,
              expected_mode: expected_mode,
              account_origin: account_origin
            )
          end

          Rails.logger.error("Golfer or Registration not found for session: #{session.id}")
          return
        end

        org = golfer.tournament.organization
        metadata_org_id = metadata_value(session.metadata, :organization_id)
        if metadata_org_id.present? && metadata_org_id.to_s != org.id.to_s
          Rails.logger.warn("Stripe webhook org metadata mismatch for golfer #{golfer.id}; ignoring")
          return
        end

        payment_config = org.effective_payment_config
        if expected_mode.present? && payment_config.payment_mode != expected_mode
          Rails.logger.warn("Stripe webhook mode mismatch for org #{org.id} (expected #{expected_mode}, got #{payment_config.payment_mode}); ignoring")
          return
        end

        origin_tag = account_origin || payment_config.expected_stripe_account_origin || "platform_live"
        updated = false

        ActiveRecord::Base.transaction(requires_new: true) do
          golfer.lock!
          next if golfer.payment_status == "paid"

          attrs = {
            payment_status: "paid",
            stripe_payment_intent_id: session.payment_intent,
            stripe_account_origin: origin_tag,
            payment_method: "stripe",
            payment_notes: "Paid via Stripe on #{Time.current.strftime('%Y-%m-%d %H:%M:%S')} (webhook confirmed)",
            paid_at: Time.current
          }
          attrs[:payment_amount_cents] = session.amount_total if session.respond_to?(:amount_total) && session.amount_total.present?

          golfer.update!(golfer.paid_registration_attributes(attrs))
          updated = true
        end

        return unless updated

        Rails.logger.info("Golfer #{golfer.id} marked as paid via webhook (#{origin_tag})")

        GolferMailer.payment_confirmation_email(golfer).deliver_later
        AdminMailer.notify_payment_received(golfer).deliver_later(wait: 2.seconds)

        begin
          ActionCable.server.broadcast("golfers_channel_#{golfer.tournament_id}", {
            action: "payment_confirmed",
            golfer: GolferSerializer.new(golfer).as_json
          })
        rescue StandardError => e
          Rails.logger.error("Failed to broadcast payment confirmation (webhook): #{e.message}")
        end
      end

      def handle_registration_checkout_completed(registration, session:, expected_mode:, account_origin:)
        org = registration.tournament.organization
        metadata_org_id = metadata_value(session.metadata, :organization_id)
        if metadata_org_id.present? && metadata_org_id.to_s != org.id.to_s
          Rails.logger.warn("Stripe webhook org metadata mismatch for registration #{registration.id}; ignoring")
          return
        end

        payment_config = org.effective_payment_config
        if expected_mode.present? && payment_config.payment_mode != expected_mode
          Rails.logger.warn("Stripe webhook mode mismatch for registration #{registration.id} org #{org.id}; ignoring")
          return
        end

        origin_tag = account_origin || payment_config.expected_stripe_account_origin || "platform_live"
        updated = false

        ActiveRecord::Base.transaction(requires_new: true) do
          registration.lock!
          next if registration.payment_status == "paid"

          attrs = {
            payment_status: "paid",
            payment_type: "stripe",
            stripe_payment_intent_id: session.payment_intent,
            stripe_account_origin: origin_tag,
            payment_method: "stripe",
            payment_notes: "Paid via Stripe on #{Time.current.strftime('%Y-%m-%d %H:%M:%S')} (webhook confirmed)",
            paid_at: Time.current
          }
          attrs[:registration_status] = "confirmed" if registration.registration_status == "pending"
          attrs[:payment_amount_cents] = session.amount_total if session.respond_to?(:amount_total) && session.amount_total.present?

          registration.update!(attrs)
          updated = true
        end

        return unless updated

        Rails.logger.info("Registration #{registration.id} marked as paid via webhook (#{origin_tag})")

        begin
          registration.create_raffle_tickets!
        rescue StandardError => e
          Rails.logger.warn("Failed to create raffle tickets for registration #{registration.id} (webhook): #{e.message}")
        end
      end

      def handle_sponsorship_checkout_completed(session, scope_organization_id:, expected_mode:, account_origin:)
        scope = scoped_sponsor_relation(scope_organization_id)
        sponsor = scope.find_by(stripe_checkout_session_id: session.id)

        if sponsor.nil?
          sponsor_id = metadata_value(session.metadata, :sponsor_id)
          sponsor = scope.find_by(id: sponsor_id) if sponsor_id.present?
        end

        unless sponsor
          Rails.logger.error("Sponsor not found for session: #{session.id}")
          return
        end

        org = sponsor.tournament.organization
        metadata_org_id = metadata_value(session.metadata, :organization_id)
        if metadata_org_id.present? && metadata_org_id.to_s != org.id.to_s
          Rails.logger.warn("Stripe webhook org metadata mismatch for sponsor #{sponsor.id}; ignoring")
          return
        end

        payment_config = org.effective_payment_config
        if expected_mode.present? && payment_config.payment_mode != expected_mode
          Rails.logger.warn("Stripe webhook mode mismatch for sponsor #{sponsor.id} org #{org.id}; ignoring")
          return
        end

        origin_tag = account_origin || payment_config.expected_stripe_account_origin || "platform_live"
        updated = false
        portal_token = nil

        ActiveRecord::Base.transaction(requires_new: true) do
          sponsor.lock!
          next if sponsor.payment_status == "paid"

          attrs = {
            payment_status: "paid",
            payment_type: "stripe",
            payment_method: "stripe",
            stripe_payment_intent_id: session.payment_intent,
            stripe_account_origin: origin_tag,
            paid_at: Time.current,
            active: true
          }
          if session.respond_to?(:amount_total) && session.amount_total.present?
            attrs[:payment_amount_cents] = session.amount_total.to_i
          end

          sponsor.update!(attrs)
          sponsor.provision_sponsor_slots!
          portal_token = sponsor.access_token_valid? ? sponsor.access_token : sponsor.generate_access_token!
          updated = true
        end

        return unless updated

        Rails.logger.info("Sponsor #{sponsor.id} marked as paid via webhook (#{origin_tag}) with #{sponsor.slot_count} slots provisioned")

        if sponsor.login_email.present? && portal_token.present?
          begin
            SponsorAccessEmailService.send_access_link(sponsor: sponsor, token: portal_token)
          rescue StandardError => e
            Rails.logger.warn("Failed to send sponsor portal invite for sponsor #{sponsor.id}: #{e.message}")
          end
        end
      end

      def handle_donation_checkout_completed(session, scope_organization_id:, expected_mode:, account_origin:)
        scope = scoped_donation_relation(scope_organization_id)
        donation = scope.find_by(stripe_checkout_session_id: session.id)

        if donation.nil?
          donation_id = metadata_value(session.metadata, :donation_id)
          donation = scope.find_by(id: donation_id) if donation_id.present?
        end

        unless donation
          Rails.logger.error("Donation not found for session: #{session.id}")
          return
        end

        org = donation.organization
        metadata_org_id = metadata_value(session.metadata, :organization_id)
        if metadata_org_id.present? && metadata_org_id.to_s != org.id.to_s
          Rails.logger.warn("Stripe webhook org metadata mismatch for donation #{donation.id}; ignoring")
          return
        end

        payment_config = org.effective_payment_config
        if expected_mode.present? && payment_config.payment_mode != expected_mode
          Rails.logger.warn("Stripe webhook mode mismatch for donation #{donation.id} org #{org.id}; ignoring")
          return
        end

        origin_tag = account_origin || payment_config.expected_stripe_account_origin || "platform_live"
        updated = false

        ActiveRecord::Base.transaction(requires_new: true) do
          donation.lock!
          next if donation.payment_status == "paid"

          attrs = {
            payment_status: "paid",
            payment_type: "stripe",
            payment_method: "stripe",
            stripe_payment_intent_id: session.payment_intent,
            stripe_account_origin: origin_tag,
            paid_at: Time.current
          }
          if session.respond_to?(:amount_total) && session.amount_total.to_i.positive?
            attrs[:amount_cents] = session.amount_total.to_i
          end

          donation.update!(attrs)
          updated = true
        end

        Rails.logger.info("Donation #{donation.id} marked as paid via webhook (#{origin_tag})") if updated
      end

      def handle_checkout_session_expired(session, scope_organization_id:)
        Rails.logger.info("Checkout session expired: #{session.id}")

        golfer = scoped_golfer_relation(scope_organization_id).find_by(stripe_checkout_session_id: session.id)
        if golfer
          golfer.update(stripe_checkout_session_id: nil)
          Rails.logger.info("Cleared expired checkout session for golfer #{golfer.id}")
          return
        end

        registration = scoped_registration_relation(scope_organization_id).find_by(stripe_checkout_session_id: session.id)
        if registration
          registration.update(stripe_checkout_session_id: nil)
          Rails.logger.info("Cleared expired checkout session for registration #{registration.id}")
          return
        end

        sponsor = scoped_sponsor_relation(scope_organization_id).find_by(stripe_checkout_session_id: session.id)
        if sponsor && sponsor.payment_status == "pending"
          sponsor.update(payment_status: "expired", stripe_checkout_session_id: nil)
          Rails.logger.info("Expired pending sponsor checkout #{sponsor.id}")
          return
        end

        donation = scoped_donation_relation(scope_organization_id).find_by(stripe_checkout_session_id: session.id)
        if donation && donation.payment_status == "pending"
          donation.update(payment_status: "expired", stripe_checkout_session_id: nil)
          Rails.logger.info("Expired pending donation checkout #{donation.id}")
        end
      end

      def handle_payment_intent_failed(payment_intent, scope_organization_id:)
        Rails.logger.error("Payment intent failed: #{payment_intent.id}")

        golfer = scoped_golfer_relation(scope_organization_id).find_by(stripe_payment_intent_id: payment_intent.id)
        if golfer
          golfer.update(
            payment_notes: "Payment failed on #{Time.current.strftime('%Y-%m-%d %H:%M:%S')}: #{payment_intent.last_payment_error&.message}"
          )
          return
        end

        registration = scoped_registration_relation(scope_organization_id).find_by(stripe_payment_intent_id: payment_intent.id)
        return unless registration

        registration.update(
          payment_notes: "Payment failed on #{Time.current.strftime('%Y-%m-%d %H:%M:%S')}: #{payment_intent.last_payment_error&.message}"
        )
      end
    end
  end
end
