# frozen_string_literal: true

module Api
  module V1
    class CheckoutController < BaseController
      skip_before_action :authenticate_user!
      skip_around_action :with_tenant_rls_context

      # POST /api/v1/checkout
      # Create a Stripe checkout session for a golfer (or simulate in test mode).
      # Keyed on the golfer-bound cryptographic `payment_token` (never raw sequential golfer_id).
      def create
        golfer = find_golfer_by_payment_token!
        return unless golfer

        if golfer.payment_status == "paid"
          render json: { error: "Golfer has already paid" }, status: :unprocessable_entity
          return
        end

        tournament = golfer.tournament
        organization = tournament.organization
        payment_config = organization.effective_payment_config
        adapter = Payments::Resolver.for(organization, config: payment_config)

        if payment_config.offline? || payment_config.external_link?
          render json: { error: "Online card checkout is not enabled for this organization." }, status: :unprocessable_entity
          return
        end

        if adapter.test_mode?
          return handle_test_mode_checkout(golfer)
        end

        unless adapter.configured?
          render json: { error: "Stripe is not configured. Please contact the administrator." }, status: :service_unavailable
          return
        end

        entry_fee = golfer.expected_entry_fee_cents

        begin
          # External Stripe HTTP call runs OUTSIDE any DB transaction using per-request api_key
          session = adapter.create_checkout_session({
            payment_method_types: ["card"],
            line_items: [{
              price_data: {
                currency: "usd",
                product_data: {
                  name: "#{tournament&.name || 'Golf Tournament'} Entry Fee",
                  description: "Golf Tournament Registration - #{golfer.name}",
                },
                unit_amount: entry_fee,
              },
              quantity: 1,
            }],
            mode: "payment",
            success_url: OrgUrlBuilder.public_url(organization, "/payment/success?session_id={CHECKOUT_SESSION_ID}"),
            cancel_url: OrgUrlBuilder.public_url(organization, "/payment/cancel?golfer_id=#{golfer.id}"),
            customer_email: golfer.email,
            metadata: {
              organization_id: organization.id.to_s,
              tournament_id: tournament.id.to_s,
              golfer_id: golfer.id.to_s,
              item_type: "registration",
              golfer_name: golfer.name,
              golfer_email: golfer.email,
            },
            billing_address_collection: "required",
          })

          TenantContext.with_organization(organization.id) do
            golfer.update!(stripe_checkout_session_id: session.id)
          end

          render json: {
            checkout_url: session.url,
            session_id: session.id,
            golfer_id: golfer.id,
            test_mode: false,
          }
        rescue Stripe::StripeError => e
          Rails.logger.error("Stripe error: #{e.message}")
          render json: { error: "Payment processing error: #{e.message}" }, status: :unprocessable_entity
        end
      end

      # POST /api/v1/checkout/embedded
      # Create a checkout session for embedded checkout (golfer not created yet)
      def create_embedded
        org = resolve_public_organization
        tournament = nil
        email_taken = false

        golfer_data = params[:golfer]
        unless golfer_data[:name].present? && golfer_data[:email].present? && golfer_data[:phone].present?
          render json: { error: "Name, email, and phone are required" }, status: :unprocessable_entity
          return
        end

        rls_runner = org.present? ? ->(&b) { TenantContext.with_organization(org, &b) } : ->(&b) { TenantContext.with_closed_access(&b) }
        rls_runner.call do
          tournament = resolve_public_tournament(tournament_id: params[:tournament_id])
          email_taken = tournament.golfers.exists?(email: golfer_data[:email]) if tournament&.can_register?
        end

        unless tournament&.can_register?
          render json: { error: "Registration is currently closed." }, status: :unprocessable_entity
          return
        end

        if email_taken
          render json: { error: "This email is already registered for this tournament" }, status: :unprocessable_entity
          return
        end

        organization = tournament.organization
        payment_config = organization.effective_payment_config
        adapter = Payments::Resolver.for(organization, config: payment_config)

        if payment_config.offline? || payment_config.external_link?
          render json: { error: "Online card checkout is not enabled for this organization." }, status: :unprocessable_entity
          return
        end

        entry_fee = tournament.entry_fee || 12500

        if adapter.test_mode?
          return handle_test_mode_embedded(golfer_data, tournament)
        end

        unless adapter.configured?
          render json: { error: "Stripe is not configured. Please contact the administrator." }, status: :service_unavailable
          return
        end

        begin
          session = adapter.create_checkout_session({
            ui_mode: "embedded",
            payment_method_types: ["card"],
            line_items: [{
              price_data: {
                currency: "usd",
                product_data: {
                  name: "#{tournament.name} Entry Fee",
                  description: "Golf Tournament Registration - #{golfer_data[:name]}",
                },
                unit_amount: entry_fee,
              },
              quantity: 1,
            }],
            mode: "payment",
            return_url: OrgUrlBuilder.public_url(organization, "/registration/success?session_id={CHECKOUT_SESSION_ID}"),
            customer_email: golfer_data[:email],
            metadata: {
              organization_id: organization.id.to_s,
              tournament_id: tournament.id.to_s,
              item_type: "registration",
              golfer_name: golfer_data[:name],
              golfer_email: golfer_data[:email],
              golfer_phone: golfer_data[:phone],
              golfer_mobile: golfer_data[:mobile] || "",
              golfer_company: golfer_data[:company] || "",
              golfer_address: golfer_data[:address] || "",
              waiver_accepted: "true",
              payment_type: "stripe",
            },
            billing_address_collection: "required",
          })

          render json: {
            client_secret: session.client_secret,
            session_id: session.id,
            test_mode: false,
            entry_fee: entry_fee,
          }
        rescue Stripe::StripeError => e
          Rails.logger.error("Stripe embedded checkout error: #{e.message}")
          render json: { error: "Payment processing error: #{e.message}" }, status: :unprocessable_entity
        end
      end

      # POST /api/v1/checkout/confirm
      # Called after successful payment - verifies with Stripe and creates/updates golfer
      def confirm
        session_id = params[:session_id]

        unless session_id.present?
          render json: { error: "Session ID is required" }, status: :bad_request
          return
        end

        if session_id.start_with?("test_session_") || session_id.start_with?("test_embedded_")
          return handle_test_mode_confirm(session_id)
        end

        existing_golfer = TenantContext.with_platform_access do
          Golfer.includes(tournament: :organization).find_by(stripe_checkout_session_id: session_id)
        end

        org_for_adapter = existing_golfer&.tournament&.organization || resolve_public_organization
        adapter = if org_for_adapter.present?
                    Payments::Resolver.for(org_for_adapter)
                  else
                    Payments::StripeAdapter.new(
                      organization: nil,
                      payment_config: OrganizationPaymentConfig.new(payment_mode: "platform_collect", processor_provider: "stripe")
                    )
                  end

        unless adapter.configured?
          render json: { error: "Stripe is not configured" }, status: :service_unavailable
          return
        end

        begin
          session = adapter.retrieve_checkout_session(session_id)

          unless session.payment_status == "paid"
            render json: {
              success: false,
              payment_status: session.payment_status,
              message: "Payment has not been completed yet"
            }, status: :payment_required
            return
          end

          golfer = if existing_golfer.present?
                     existing_golfer
                   else
                     unless org_for_adapter.present?
                       render json: { error: "Session not found" }, status: :not_found
                       return
                     end

                     metadata_org_id = session_metadata_value(session.metadata, :organization_id)
                     if metadata_org_id.blank? || metadata_org_id.to_s != org_for_adapter.id.to_s
                       Rails.logger.warn(
                         "Blocked cross-tenant checkout confirm: adapter org=#{org_for_adapter.id} metadata org=#{metadata_org_id.inspect}"
                       )
                       render json: { error: "Session not found" }, status: :not_found
                       return
                     end

                     TenantContext.with_organization(org_for_adapter.id) do
                       create_golfer_from_session(session, organization: org_for_adapter)
                     end
                   end

          unless golfer
            render json: { error: "Could not find or create golfer for this session" }, status: :unprocessable_entity
            return
          end

          if org_for_adapter.present? && golfer.tournament.organization_id != org_for_adapter.id
            render json: { error: "Session not found" }, status: :not_found
            return
          end

          return unless verify_tenant_match!(golfer.tournament.organization_id, status: :not_found, message: "Session not found")

          # Fetch card details from Stripe OUTSIDE the DB transaction
          payment_intent_id = session.payment_intent
          payment_amount = session.amount_total
          card_brand = nil
          card_last4 = nil
          begin
            if payment_intent_id.present?
              payment_intent = adapter.retrieve_payment_intent(payment_intent_id)
              if payment_intent.payment_method.present?
                payment_method = adapter.retrieve_payment_method(payment_intent.payment_method)
                if payment_method.card.present?
                  card_brand = payment_method.card.brand
                  card_last4 = payment_method.card.last4
                end
              end
            end
          rescue Stripe::StripeError => e
            Rails.logger.warn("Could not retrieve card details: #{e.message}")
          end

          should_send_emails = false
          already_paid = false
          origin_tag = adapter.account_origin || golfer.tournament.organization.effective_payment_config.expected_stripe_account_origin

          TenantContext.with_organization(golfer.tournament.organization_id) do
            ActiveRecord::Base.transaction(requires_new: true) do
              golfer.lock!

              if golfer.payment_status == "paid" && golfer.stripe_payment_intent_id.present?
                already_paid = true
                next
              end

              formatted_time = Time.current.in_time_zone("Pacific/Guam").strftime("%B %d, %Y at %I:%M %p")

              golfer.update!(
                golfer.paid_registration_attributes(
                  payment_status: "paid",
                  payment_type: "stripe",
                  stripe_payment_intent_id: payment_intent_id,
                  stripe_account_origin: origin_tag,
                  payment_method: "stripe",
                  payment_amount_cents: payment_amount,
                  stripe_card_brand: card_brand,
                  stripe_card_last4: card_last4,
                  payment_notes: "Paid via Stripe on #{formatted_time} (Guam Time)"
                )
              )

              ActivityLog.log(
                admin: nil,
                action: "payment_completed",
                target: golfer,
                details: "Payment of $#{format('%.2f', payment_amount / 100.0)} completed via Stripe",
                tournament: golfer.tournament
              )

              should_send_emails = true
            end
          end

          serialized_golfer = TenantContext.with_organization(golfer.tournament.organization_id) do
            GolferSerializer.new(golfer).as_json
          end

          if already_paid
            render json: {
              success: true,
              golfer: serialized_golfer,
              message: "Payment already confirmed!"
            }
            return
          end

          render json: {
            success: true,
            golfer: serialized_golfer,
            message: "Payment confirmed successfully!"
          }

          if should_send_emails
            begin
              TenantContext.with_organization(golfer.tournament.organization_id) do
                golfer.create_raffle_tickets!
                golfer.create_purchased_raffle_tickets!
              end
            rescue => e
              Rails.logger.warn("Failed to create raffle tickets for #{golfer.name}: #{e.message}")
            end

            GolferMailer.confirmation_with_payment_email(golfer).deliver_later
            AdminMailer.notify_new_registration_with_payment(golfer).deliver_later(wait: 2.seconds)

            begin
              ActionCable.server.broadcast("golfers_channel_#{golfer.tournament_id}", {
                action: "payment_confirmed",
                golfer: serialized_golfer
              })
            rescue StandardError => e
              Rails.logger.error("Failed to broadcast payment confirmation: #{e.message}")
            end
          end
        rescue Stripe::StripeError => e
          Rails.logger.error("Stripe verification error: #{e.message}")
          render json: { error: "Unable to verify payment: #{e.message}" }, status: :unprocessable_entity
        end
      end

      # POST /api/v1/checkout/swipe_simple
      # Redirect golfer or registration to external payment link (tournament override -> org config).
      # Keyed on the record-bound cryptographic `payment_token` (never raw sequential IDs).
      def swipe_simple_redirect
        token = params[:payment_token].to_s.strip
        if token.blank?
          render json: { error: "Missing payment token" }, status: :bad_request
          return
        end

        record = TenantContext.with_platform_access do
          Golfer.includes(tournament: :organization).find_by(payment_token: token) ||
            Registration.includes(tournament: :organization).find_by(payment_token: token)
        end

        unless record
          render json: { error: "Invalid payment token" }, status: :not_found
          return
        end

        return unless verify_tenant_match!(
          record.tournament.organization_id,
          status: :not_found,
          message: "Invalid payment token"
        )

        tournament = record.tournament
        org_config = tournament.organization.effective_payment_config
        payment_url = nil
        already_paid = false

        TenantContext.with_organization(tournament.organization_id) do
          ActiveRecord::Base.transaction(requires_new: true) do
            record.lock!
            if record.payment_status == "paid"
              already_paid = true
              next
            end

            original_payment_type = record.payment_type
            payment_url = if original_payment_type == "walk_in"
                            tournament.walkin_swipe_simple_url.presence ||
                              tournament.swipe_simple_url.presence ||
                              org_config.external_walkin_url.presence ||
                              org_config.external_checkout_url.presence
                          else
                            tournament.swipe_simple_url.presence ||
                              org_config.external_checkout_url.presence
                          end

            next if payment_url.blank?

            record.update!(payment_type: "swipe_simple", payment_status: "pending")
          end
        end

        if already_paid
          render json: { error: "Already paid" }, status: :unprocessable_entity
          return
        end

        if payment_url.blank?
          render json: { error: "External checkout URL is not configured for this event." }, status: :unprocessable_entity
          return
        end

        payload = { redirect_url: payment_url }
        if record.is_a?(Registration)
          payload[:registration_id] = record.id
        else
          payload[:golfer_id] = record.id
        end

        render json: payload
      end

      # GET /api/v1/checkout/session/:session_id
      def session_status
        session_id = params[:session_id]

        golfer = TenantContext.with_platform_access do
          Golfer.includes(tournament: :organization).find_by(stripe_checkout_session_id: session_id)
        end
        if golfer
          return unless verify_tenant_match!(golfer.tournament.organization_id, status: :not_found, message: "Session not found")
        end

        org_for_adapter = golfer&.tournament&.organization || resolve_public_organization
        adapter = if org_for_adapter.present?
                    Payments::Resolver.for(org_for_adapter)
                  else
                    Payments::StripeAdapter.new(
                      organization: nil,
                      payment_config: OrganizationPaymentConfig.new(payment_mode: "platform_collect", processor_provider: "stripe")
                    )
                  end

        return render json: { error: "Stripe not configured" }, status: :service_unavailable unless adapter.configured?

        begin
          session = adapter.retrieve_checkout_session(session_id)

          render json: {
            session_id: session.id,
            payment_status: session.payment_status,
            status: session.status,
            golfer_id: golfer&.id,
            golfer_name: golfer&.name,
            amount_total: session.amount_total,
          }
        rescue Stripe::StripeError => e
          render json: { error: e.message }, status: :not_found
        end
      end

      private

      def find_golfer_by_payment_token!
        token = params[:payment_token].to_s.strip
        if token.blank?
          render json: { error: "Payment token is required" }, status: :bad_request
          return nil
        end

        golfer = TenantContext.with_platform_access do
          Golfer.includes(tournament: :organization).find_by(payment_token: token)
        end

        unless golfer
          render json: { error: "Golfer not found" }, status: :not_found
          return nil
        end

        return nil unless verify_tenant_match!(golfer.tournament.organization_id, status: :not_found, message: "Golfer not found")

        golfer
      end

      def session_metadata_value(metadata, key)
        return nil unless metadata

        if metadata.respond_to?(:[])
          metadata[key] || metadata[key.to_s]
        elsif metadata.respond_to?(key)
          metadata.public_send(key)
        end
      end

      def create_golfer_from_session(session, organization:)
        return nil unless organization

        metadata = session.metadata
        tournament_id = session_metadata_value(metadata, :tournament_id)
        golfer_email = session_metadata_value(metadata, :golfer_email)
        metadata_org_id = session_metadata_value(metadata, :organization_id)
        return nil unless tournament_id.present? && golfer_email.present?
        return nil unless metadata_org_id.present? && metadata_org_id.to_s == organization.id.to_s

        # Strictly scope tournament lookup to the adapter's owning organization
        tournament = organization.tournaments.find_by(id: tournament_id)
        return nil unless tournament

        golfer = nil

        ActiveRecord::Base.transaction(requires_new: true) do
          tournament.lock!

          existing = tournament.golfers.lock
            .where(email: golfer_email)
            .where.not(registration_status: "cancelled")
            .where.not(registration_source: "admin")
            .first
          if existing
            golfer = existing
            raise ActiveRecord::Rollback
          end

          golfer = tournament.golfers.create!(
            name: session_metadata_value(metadata, :golfer_name),
            email: golfer_email,
            phone: session_metadata_value(metadata, :golfer_phone),
            mobile: session_metadata_value(metadata, :golfer_mobile).presence,
            company: session_metadata_value(metadata, :golfer_company).presence,
            address: session_metadata_value(metadata, :golfer_address).presence,
            payment_type: "stripe",
            payment_status: "unpaid",
            waiver_accepted_at: Time.current,
            stripe_checkout_session_id: session.id
          )

          Rails.logger.info("Created golfer #{golfer.id} from embedded checkout session #{session.id}")
        end

        golfer
      rescue ActiveRecord::RecordInvalid => e
        Rails.logger.error("Failed to create golfer from session: #{e.message}")
        nil
      end

      def handle_test_mode_embedded(golfer_data, tournament)
        test_session_id = "test_embedded_#{SecureRandom.hex(16)}"
        entry_fee = tournament.entry_fee || 12500

        Rails.cache.write(
          "test_embedded_#{test_session_id}",
          {
            tournament_id: tournament.id,
            golfer_data: golfer_data.to_unsafe_h,
          },
          expires_in: 1.hour
        )

        render json: {
          client_secret: "test_secret_#{test_session_id}",
          session_id: test_session_id,
          test_mode: true,
          entry_fee: entry_fee,
        }
      end

      def handle_test_mode_checkout(golfer)
        test_session_id = "test_session_#{SecureRandom.hex(16)}"
        TenantContext.with_organization(golfer.tournament.organization_id) do
          golfer.update!(stripe_checkout_session_id: test_session_id)
        end

        render json: {
          checkout_url: OrgUrlBuilder.public_url(golfer.tournament&.organization, "/payment/success?session_id=#{test_session_id}"),
          session_id: test_session_id,
          golfer_id: golfer.id,
          test_mode: true,
        }
      end

      def handle_test_mode_confirm(session_id)
        golfer = TenantContext.with_platform_access do
          found = Golfer.includes(tournament: :organization).find_by(stripe_checkout_session_id: session_id)

          if found.nil? && session_id.start_with?("test_embedded_")
            cached_data = Rails.cache.read("test_embedded_#{session_id}")
            if cached_data
              tournament = Tournament.find_by(id: cached_data[:tournament_id])
              if tournament
                golfer_data = cached_data[:golfer_data]

                found = tournament.golfers.create!(
                  name: golfer_data["name"],
                  email: golfer_data["email"],
                  phone: golfer_data["phone"],
                  mobile: golfer_data["mobile"].presence,
                  company: golfer_data["company"].presence,
                  address: golfer_data["address"].presence,
                  payment_type: "stripe",
                  payment_status: "unpaid",
                  waiver_accepted_at: Time.current,
                  stripe_checkout_session_id: session_id
                )

                Rails.cache.delete("test_embedded_#{session_id}")
              end
            end
          end

          found
        end

        unless golfer
          render json: { error: "Golfer not found for this test session" }, status: :not_found
          return
        end

        return unless verify_tenant_match!(golfer.tournament.organization_id, status: :not_found, message: "Golfer not found for this test session")

        unless golfer.tournament.organization.effective_payment_config.effective_test_mode?
          render json: { error: "Test mode checkout is disabled for this organization" }, status: :forbidden
          return
        end

        entry_fee = golfer.tournament&.entry_fee || 12500
        emails_sent = false
        already_paid = false

        TenantContext.with_organization(golfer.tournament.organization_id) do
          ActiveRecord::Base.transaction(requires_new: true) do
            golfer.lock!

            if golfer.payment_status == "paid"
              already_paid = true
              next
            end

            golfer.update!(
              golfer.paid_registration_attributes(
                payment_status: "paid",
                payment_type: "stripe",
                stripe_payment_intent_id: "test_pi_#{SecureRandom.hex(8)}",
                stripe_account_origin: "platform_test",
                payment_method: "stripe",
                payment_amount_cents: entry_fee,
                payment_notes: "SIMULATED PAYMENT (Test Mode) - #{Time.current.strftime('%Y-%m-%d %H:%M:%S')}"
              )
            )

            ActivityLog.log(
              admin: nil,
              action: "payment_completed",
              target: golfer,
              details: "Payment of $#{format('%.2f', entry_fee / 100.0)} completed via Stripe (Test Mode)",
              tournament: golfer.tournament
            )

            emails_sent = true
          end
        end

        serialized_golfer = TenantContext.with_organization(golfer.tournament.organization_id) do
          GolferSerializer.new(golfer).as_json
        end

        if already_paid
          render json: {
            success: true,
            golfer: serialized_golfer,
            message: "Payment already confirmed (test mode)"
          }
          return
        end

        render json: {
          success: true,
          golfer: serialized_golfer,
          message: "Payment confirmed (test mode - no actual charge)",
          test_mode: true
        }

        if emails_sent
          begin
            TenantContext.with_organization(golfer.tournament.organization_id) do
              golfer.create_raffle_tickets!
              golfer.create_purchased_raffle_tickets!
            end
          rescue => e
            Rails.logger.warn("Failed to create raffle tickets for #{golfer.name}: #{e.message}")
          end

          GolferMailer.confirmation_with_payment_email(golfer).deliver_later
          AdminMailer.notify_new_registration_with_payment(golfer).deliver_later(wait: 2.seconds)
        end

        begin
          ActionCable.server.broadcast("golfers_channel_#{golfer.tournament_id}", {
            action: "payment_confirmed",
            golfer: serialized_golfer
          })
        rescue StandardError => e
          Rails.logger.error("Failed to broadcast payment confirmation (test mode): #{e.message}")
        end
      end
    end
  end
end
