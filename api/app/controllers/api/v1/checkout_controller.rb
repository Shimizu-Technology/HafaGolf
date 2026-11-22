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

        # Ensure golfer hasn't already paid
        if golfer.payment_status == "paid"
          render json: { error: "Golfer has already paid" }, status: :unprocessable_entity
          return
        end

        setting = Setting.instance

        # TEST MODE: Simulate payment without Stripe
        if setting.test_mode?
          return handle_test_mode_checkout(golfer, setting)
        end

        # PRODUCTION MODE: Real Stripe checkout (external HTTP call runs OUTSIDE any DB transaction)
        stripe_secret = StripeConfig.secret_key(setting: setting)
        unless stripe_secret.present?
          render json: { error: "Stripe is not configured. Please contact the administrator." }, status: :service_unavailable
          return
        end

        # Set Stripe API key (ENV first, legacy Setting fallback)
        Stripe.api_key = stripe_secret

        # Entry fee from the golfer's tournament
        tournament = golfer.tournament
        entry_fee = tournament&.entry_fee || 12500

        begin
          # Create a Stripe Checkout Session
          session = Stripe::Checkout::Session.create({
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
            success_url: OrgUrlBuilder.public_url(tournament&.organization, "/payment/success?session_id={CHECKOUT_SESSION_ID}"),
            cancel_url: OrgUrlBuilder.public_url(tournament&.organization, "/payment/cancel?golfer_id=#{golfer.id}"),
            customer_email: golfer.email,
            metadata: {
              golfer_id: golfer.id.to_s,
              golfer_name: golfer.name,
              golfer_email: golfer.email,
            },
            billing_address_collection: "required",
          })

          # Save the session ID inside an org-scoped transaction
          TenantContext.with_organization(tournament.organization_id) do
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
        setting = Setting.instance
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

        entry_fee = tournament.entry_fee || 12500

        # TEST MODE: Return a simulated embedded session
        if setting.test_mode?
          return handle_test_mode_embedded(golfer_data, tournament)
        end

        # PRODUCTION MODE: Real Stripe embedded checkout
        stripe_secret = StripeConfig.secret_key(setting: setting)
        unless stripe_secret.present?
          render json: { error: "Stripe is not configured. Please contact the administrator." }, status: :service_unavailable
          return
        end

        Stripe.api_key = stripe_secret

        begin
          # Create a Stripe Checkout Session for embedded checkout
          session = Stripe::Checkout::Session.create({
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
            return_url: OrgUrlBuilder.public_url(tournament.organization, "/registration/success?session_id={CHECKOUT_SESSION_ID}"),
            customer_email: golfer_data[:email],
            metadata: {
              tournament_id: tournament.id.to_s,
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

        setting = Setting.instance

        # Handle test mode confirmation
        if session_id.start_with?("test_session_") || session_id.start_with?("test_embedded_")
          return handle_test_mode_confirm(session_id)
        end
        
        stripe_secret = StripeConfig.secret_key(setting: setting)
        unless stripe_secret.present?
          render json: { error: "Stripe is not configured" }, status: :service_unavailable
          return
        end

        Stripe.api_key = stripe_secret

        begin
          # Retrieve the session from Stripe to verify payment
          session = Stripe::Checkout::Session.retrieve(session_id)

          # Check if payment was successful first
          unless session.payment_status == "paid"
            render json: {
              success: false,
              payment_status: session.payment_status,
              message: "Payment has not been completed yet"
            }, status: :payment_required
            return
          end

          # Find the golfer by verified Stripe session ID (for legacy redirect flow)
          golfer = TenantContext.with_platform_access do
            Golfer.includes(tournament: :organization).find_by(stripe_checkout_session_id: session_id) ||
              create_golfer_from_session(session)
          end

          unless golfer
            render json: { error: "Could not find or create golfer for this session" }, status: :unprocessable_entity
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
              payment_intent = Stripe::PaymentIntent.retrieve(payment_intent_id)
              if payment_intent.payment_method.present?
                payment_method = Stripe::PaymentMethod.retrieve(payment_intent.payment_method)
                if payment_method.card.present?
                  card_brand = payment_method.card.brand
                  card_last4 = payment_method.card.last4
                end
              end
            end
          rescue Stripe::StripeError => e
            Rails.logger.warn("Could not retrieve card details: #{e.message}")
          end

          # Use database-level locking inside org-scoped RLS transaction
          should_send_emails = false
          already_paid = false

          TenantContext.with_organization(golfer.tournament.organization_id) do
            ActiveRecord::Base.transaction(requires_new: true) do
              golfer.lock!

              # Skip if already marked as paid (idempotency check after lock)
              if golfer.payment_status == "paid" && golfer.stripe_payment_intent_id.present?
                already_paid = true
                next
              end

              formatted_time = Time.current.in_time_zone('Pacific/Guam').strftime('%B %d, %Y at %I:%M %p')

              golfer.update!(
                golfer.paid_registration_attributes(
                  payment_status: "paid",
                  payment_type: "stripe",
                  stripe_payment_intent_id: payment_intent_id,
                  payment_method: "stripe",
                  payment_amount_cents: payment_amount,
                  stripe_card_brand: card_brand,
                  stripe_card_last4: card_last4,
                  payment_notes: "Paid via Stripe on #{formatted_time} (Guam Time)"
                )
              )

              ActivityLog.log(
                admin: nil,
                action: 'payment_completed',
                target: golfer,
                details: "Payment of $#{format('%.2f', payment_amount / 100.0)} completed via Stripe",
                tournament: golfer.tournament
              )

              should_send_emails = true
            end
          end

          if already_paid
            render json: {
              success: true,
              golfer: GolferSerializer.new(golfer),
              message: "Payment already confirmed!"
            }
            return
          end

          render json: {
            success: true,
            golfer: GolferSerializer.new(golfer),
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
                golfer: GolferSerializer.new(golfer).as_json
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
      # Redirect golfer to SwipeSimple payment link.
      # Keyed on the golfer-bound cryptographic `payment_token` (never raw sequential golfer_id).
      def swipe_simple_redirect
        golfer = find_golfer_by_payment_token!
        return unless golfer

        if golfer.payment_status == "paid"
          render json: { error: "Already paid" }, status: :unprocessable_entity
          return
        end

        original_payment_type = golfer.payment_type
        tournament = golfer.tournament

        TenantContext.with_organization(tournament.organization_id) do
          golfer.update!(payment_type: "swipe_simple", payment_status: "pending")
        end

        payment_url = if original_payment_type == 'walk_in'
                        tournament.walkin_swipe_simple_url.presence || tournament.swipe_simple_url.presence
                      else
                        tournament.swipe_simple_url.presence
                      end
        payment_url ||= ENV.fetch('SWIPE_SIMPLE_PAYMENT_URL', 'https://swipesimple.com/links/lnk_e1c8f45f9c401c93552781ef3d52fdfc')

        render json: {
          redirect_url: payment_url,
          golfer_id: golfer.id
        }
      end

      # GET /api/v1/checkout/session/:session_id
      def session_status
        session_id = params[:session_id]

        setting = Setting.instance
        stripe_secret = StripeConfig.secret_key(setting: setting)
        return render json: { error: "Stripe not configured" }, status: :service_unavailable unless stripe_secret.present?

        Stripe.api_key = stripe_secret

        begin
          session = Stripe::Checkout::Session.retrieve(session_id)
          golfer = TenantContext.with_platform_access do
            Golfer.includes(:tournament).find_by(stripe_checkout_session_id: session_id)
          end
          if golfer
            return unless verify_tenant_match!(golfer.tournament.organization_id, status: :not_found, message: "Session not found")
          end

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

      # Looks up a golfer strictly by cryptographic payment_token and verifies tenant host match.
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

      # Create a golfer from Stripe session metadata (for embedded checkout flow)
      def create_golfer_from_session(session)
        metadata = session.metadata
        return nil unless metadata.tournament_id.present? && metadata.golfer_email.present?

        tournament = Tournament.find_by(id: metadata.tournament_id)
        return nil unless tournament

        golfer = nil
        
        ActiveRecord::Base.transaction(requires_new: true) do
          tournament.lock!
          
          existing = tournament.golfers.lock
            .where(email: metadata.golfer_email)
            .where.not(registration_status: "cancelled")
            .where.not(registration_source: "admin")
            .first
          if existing
            golfer = existing
            raise ActiveRecord::Rollback
          end

          golfer = tournament.golfers.create!(
            name: metadata.golfer_name,
            email: metadata.golfer_email,
            phone: metadata.golfer_phone,
            mobile: metadata.golfer_mobile.presence,
            company: metadata.golfer_company.presence,
            address: metadata.golfer_address.presence,
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

      # Handle embedded checkout in test mode
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

      # Handle checkout in test mode (no real Stripe calls)
      def handle_test_mode_checkout(golfer, setting)
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

      # Handle payment confirmation in test mode
      def handle_test_mode_confirm(session_id)
        golfer = TenantContext.with_platform_access do
          found = Golfer.includes(:tournament).find_by(stripe_checkout_session_id: session_id)

          # For embedded test mode, create golfer from cached data
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
                payment_method: "stripe",
                payment_amount_cents: entry_fee,
                payment_notes: "SIMULATED PAYMENT (Test Mode) - #{Time.current.strftime('%Y-%m-%d %H:%M:%S')}"
              )
            )

            ActivityLog.log(
              admin: nil,
              action: 'payment_completed',
              target: golfer,
              details: "Payment of $#{format('%.2f', entry_fee / 100.0)} completed via Stripe (Test Mode)",
              tournament: golfer.tournament
            )

            emails_sent = true
          end
        end

        if already_paid
          render json: {
            success: true,
            golfer: GolferSerializer.new(golfer),
            message: "Payment already confirmed (test mode)"
          }
          return
        end

        render json: {
          success: true,
          golfer: GolferSerializer.new(golfer),
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
            golfer: GolferSerializer.new(golfer).as_json
          })
        rescue StandardError => e
          Rails.logger.error("Failed to broadcast payment confirmation (test mode): #{e.message}")
        end
      end
    end
  end
end
