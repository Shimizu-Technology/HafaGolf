# frozen_string_literal: true

module Api
  module V1
    class SponsorTiersController < BaseController
      ALLOWED_LOGO_CONTENT_TYPES = %w[image/png image/jpeg image/webp image/gif image/svg+xml].freeze
      MAX_LOGO_SIZE_BYTES = 5.megabytes

      skip_before_action :authenticate_user!, only: [:index, :checkout, :reserve_check]
      skip_around_action :with_tenant_rls_context, only: [:index, :checkout, :reserve_check]
      before_action :authenticate_optional_user, only: [:index]
      before_action :set_tournament
      before_action :authorize_index_access!, only: [:index]
      before_action :authorize_public_checkout_access!, only: [:checkout, :reserve_check]
      before_action :authorize_org_admin!, only: [:create, :update, :destroy]
      before_action :set_sponsor_tier, only: [:update, :destroy]

      # GET /api/v1/tournaments/:tournament_id/sponsor_tiers
      def index
        organization = @tournament.organization
        tiers_json = nil
        payment_config = nil

        with_resolved_org_rls(organization) do
          tiers = @tournament.sponsor_tiers.ordered.to_a
          tiers = tiers.select(&:online_checkout_enabled?) unless admin_request?
          tiers_json = tiers.map(&:as_public_json)
          payment_config = organization.effective_payment_config
        end

        external_url = resolve_external_sponsor_url(@tournament, payment_config)

        render json: {
          sponsor_tiers: tiers_json,
          payment_mode: payment_config.payment_mode,
          external_checkout_url: payment_config.external_link? ? external_url : nil,
          allow_sponsor_check_invoice: @tournament.allow_sponsor_check_invoice?,
          checks_payable_to: @tournament.checks_payable_to.presence || organization.name,
          contact_name: @tournament.contact_name.presence,
          contact_email: @tournament.contact_email.presence || organization.contact_email.presence,
          contact_phone: @tournament.contact_phone.presence || organization.contact_phone.presence,
          organization_name: organization.name,
          tournament_name: @tournament.name,
          event_date: @tournament.event_date,
          location_name: @tournament.location_name,
          tax_receipt_enabled: @tournament.tax_receipt_enabled?,
          fmv_per_player_cents: @tournament.fmv_per_player_cents,
          tax_org_name: @tournament.tax_receipt_enabled? ? (@tournament.tax_org_name.presence || organization.name) : nil,
          tax_org_ein: @tournament.tax_receipt_enabled? ? @tournament.tax_org_ein : nil
        }
      end

      # POST /api/v1/tournaments/:tournament_id/sponsor_tiers
      def create
        tier = @tournament.sponsor_tiers.build(sponsor_tier_params)
        tier.organization = @tournament.organization

        if tier.save
          render json: { sponsor_tier: tier.as_public_json, message: "Sponsor tier created" }, status: :created
        else
          render json: { error: tier.errors.full_messages.join(", "), errors: tier.errors.full_messages }, status: :unprocessable_entity
        end
      end

      # PATCH /api/v1/tournaments/:tournament_id/sponsor_tiers/:id
      def update
        if @sponsor_tier.update(sponsor_tier_params)
          render json: { sponsor_tier: @sponsor_tier.as_public_json, message: "Sponsor tier updated" }
        else
          render json: { error: @sponsor_tier.errors.full_messages.join(", "), errors: @sponsor_tier.errors.full_messages }, status: :unprocessable_entity
        end
      end

      # DELETE /api/v1/tournaments/:tournament_id/sponsor_tiers/:id
      def destroy
        @sponsor_tier.destroy!
        render json: { message: "Sponsor tier deleted" }
      end

      # POST /api/v1/tournaments/:tournament_id/sponsor_tiers/:id/checkout
      def checkout
        organization = @tournament.organization
        buyer = checkout_params

        if buyer[:name].blank? || buyer[:email].blank?
          render json: { error: "Sponsor name and contact email are required" }, status: :unprocessable_entity
          return
        end

        unless buyer[:email].match?(URI::MailTo::EMAIL_REGEXP)
          render json: { error: "Please provide a valid contact email address" }, status: :unprocessable_entity
          return
        end

        tier = nil
        payment_config = nil

        with_resolved_org_rls(organization) do
          tier = @tournament.sponsor_tiers.find_by(id: params[:id])
          payment_config = organization.effective_payment_config
        end

        unless tier
          render json: { error: "Sponsor tier not found" }, status: :not_found
          return
        end

        unless tier.online_checkout_enabled?
          render json: { error: "Online checkout is not enabled for this sponsor tier" }, status: :unprocessable_entity
          return
        end

        if payment_config.offline?
          render json: { error: "Online checkout is not enabled for this organization." }, status: :unprocessable_entity
          return
        end

        adapter = Payments::Resolver.for(organization, config: payment_config)
        external_url = resolve_external_sponsor_url(@tournament, payment_config)
        use_external_link = payment_config.external_link? ||
                            (!adapter.configured? && !adapter.test_mode? && external_url.present?)

        if use_external_link
          if external_url.blank?
            render json: { error: "External checkout URL is not configured for this event." }, status: :unprocessable_entity
            return
          end

          sponsor = create_pending_sponsor_under_lock(
            organization: organization,
            tier: tier,
            buyer: buyer,
            payment_type: "external_link"
          )
          return if performed?

          receipt = TaxReceiptCalculator.for_sponsorship(
            tournament: @tournament,
            amount_cents: tier.price_cents,
            included_player_slots: tier.included_player_slots
          )

          render json: {
            checkout_url: external_url,
            payment_mode: "external_link",
            external_link: true,
            sponsor: sponsor_checkout_response(sponsor),
            tax_receipt: receipt.applicable? ? receipt.as_json : nil
          }, status: :created
          return
        end

        if tier.price_cents.to_i <= 0
          render json: { error: "This sponsor tier must have a price greater than $0 for online card checkout." }, status: :unprocessable_entity
          return
        end

        if !adapter.test_mode? && !adapter.configured?
          render json: { error: "Stripe is not configured. Please contact the administrator." }, status: :service_unavailable
          return
        end

        # Step 1: Reserve capacity & create pending sponsor under tier row lock
        sponsor = create_pending_sponsor_under_lock(
          organization: organization,
          tier: tier,
          buyer: buyer,
          payment_type: "stripe"
        )
        return if performed?

        receipt = TaxReceiptCalculator.for_sponsorship(
          tournament: @tournament,
          amount_cents: tier.price_cents,
          included_player_slots: tier.included_player_slots
        )

        # Step 2: Create Stripe Checkout Session OUTSIDE any DB transaction (per-request api_key)
        if adapter.test_mode?
          test_session_id = "test_sponsor_#{SecureRandom.hex(16)}"
          with_resolved_org_rls(organization) do
            sponsor.update!(stripe_checkout_session_id: test_session_id)
          end

          render json: {
            checkout_url: OrgUrlBuilder.public_url(
              organization,
              "/#{organization.slug}/tournaments/#{@tournament.slug}/sponsor?checkout=success&session_id=#{test_session_id}"
            ),
            session_id: test_session_id,
            sponsor: sponsor_checkout_response(sponsor),
            test_mode: true,
            tax_receipt: receipt.applicable? ? receipt.as_json : nil
          }, status: :created
          return
        end

        begin
          session = adapter.create_checkout_session({
            payment_method_types: ["card"],
            line_items: [{
              price_data: {
                currency: "usd",
                product_data: {
                  name: "#{@tournament.name} — #{tier.label}",
                  description: tier.description.presence || "#{tier.label} sponsorship (#{tier.included_player_slots} player slots)"
                },
                unit_amount: tier.price_cents
              },
              quantity: 1
            }],
            mode: "payment",
            success_url: OrgUrlBuilder.public_url(
              organization,
              "/#{organization.slug}/tournaments/#{@tournament.slug}/sponsor?checkout=success&session_id={CHECKOUT_SESSION_ID}"
            ),
            cancel_url: OrgUrlBuilder.public_url(
              organization,
              "/#{organization.slug}/tournaments/#{@tournament.slug}/sponsor?checkout=cancelled"
            ),
            customer_email: sponsor.login_email,
            metadata: {
              organization_id: organization.id.to_s,
              tournament_id: @tournament.id.to_s,
              sponsor_id: sponsor.id.to_s,
              sponsor_tier_id: tier.id.to_s,
              item_type: "sponsorship"
            }
          })

          with_resolved_org_rls(organization) do
            sponsor.update!(stripe_checkout_session_id: session.id)
          end

          render json: {
            checkout_url: session.url,
            session_id: session.id,
            sponsor: sponsor_checkout_response(sponsor),
            test_mode: false,
            tax_receipt: receipt.applicable? ? receipt.as_json : nil
          }, status: :created
        rescue Stripe::StripeError => e
          Rails.logger.error("Stripe sponsor checkout error: #{e.message}")
          with_resolved_org_rls(organization) do
            sponsor.update(payment_status: "cancelled")
          end
          render json: { error: "Payment processing error: #{e.message}" }, status: :unprocessable_entity
        end
      end

      # POST /api/v1/tournaments/:tournament_id/sponsor_tiers/:id/reserve_check
      # Public - reserves tier capacity under lock and generates an itemized check invoice
      def reserve_check
        organization = @tournament.organization
        buyer = checkout_params

        unless @tournament.allow_sponsor_check_invoice?
          render json: { error: "Reserve & pay by check is not enabled for this event." }, status: :unprocessable_entity
          return
        end

        if buyer[:name].blank? || buyer[:email].blank?
          render json: { error: "Sponsor name and contact email are required" }, status: :unprocessable_entity
          return
        end

        unless buyer[:email].match?(URI::MailTo::EMAIL_REGEXP)
          render json: { error: "Please provide a valid contact email address" }, status: :unprocessable_entity
          return
        end

        uploaded_logo = params[:logo] || params.dig(:sponsor, :logo)
        if uploaded_logo.present?
          unless uploaded_logo.respond_to?(:content_type) && ALLOWED_LOGO_CONTENT_TYPES.include?(uploaded_logo.content_type)
            render json: { error: "Sponsor logo must be a PNG, JPEG, WebP, GIF, or SVG image." }, status: :unprocessable_entity
            return
          end
          if uploaded_logo.respond_to?(:size) && uploaded_logo.size.to_i > MAX_LOGO_SIZE_BYTES
            render json: { error: "Sponsor logo must be smaller than 5 MB." }, status: :unprocessable_entity
            return
          end
        end

        tier = nil
        with_resolved_org_rls(organization) do
          tier = @tournament.sponsor_tiers.find_by(id: params[:id])
        end

        unless tier
          render json: { error: "Sponsor tier not found" }, status: :not_found
          return
        end

        unless tier.online_checkout_enabled?
          render json: { error: "Self-service reservations are not enabled for this sponsor tier" }, status: :unprocessable_entity
          return
        end

        sponsor = nil
        tier_snapshot = nil
        validation_error = nil

        with_resolved_org_rls(organization) do
          ActiveRecord::Base.transaction(requires_new: true) do
            locked_tier = SponsorTier.lock.find(tier.id)
            if locked_tier.sold_out?
              render json: { error: "This sponsor tier is sold out" }, status: :unprocessable_entity
              raise ActiveRecord::Rollback
            end

            tier_snapshot = {
              label: locked_tier.label,
              description: locked_tier.description,
              included_player_slots: locked_tier.included_player_slots,
              benefits: Array(locked_tier.benefits),
              price_cents: locked_tier.price_cents
            }

            sponsor = @tournament.sponsors.new(
              sponsor_tier: locked_tier,
              tier: locked_tier.key,
              name: buyer[:name],
              login_email: buyer[:email],
              website_url: buyer[:website_url],
              description: buyer[:description],
              logo_url: buyer[:logo_url],
              slot_count: tier_snapshot[:included_player_slots],
              payment_type: "check",
              payment_status: "pending_check",
              payment_method: "check",
              payment_amount_cents: tier_snapshot[:price_cents],
              active: false,
              invoiced_at: Time.current
            )
            sponsor.assign_invoice_number!
            sponsor.logo.attach(uploaded_logo) if uploaded_logo.present?

            unless sponsor.save
              validation_error = sponsor.errors.full_messages.join(", ")
              raise ActiveRecord::Rollback
            end

            ActivityLog.log(
              admin: nil,
              action: "sponsor_check_reserved",
              target: sponsor,
              tournament: @tournament,
              details: "#{sponsor.name} reserved #{tier_snapshot[:label]} via check invoice #{sponsor.invoice_number}",
              metadata: {
                sponsor_id: sponsor.id,
                sponsor_tier_id: locked_tier.id,
                invoice_number: sponsor.invoice_number,
                amount_cents: sponsor.payment_amount_cents
              }
            )
          end
        end

        return if performed?

        if validation_error.present?
          render json: { error: validation_error }, status: :unprocessable_entity
          return
        end

        receipt = TaxReceiptCalculator.for_sponsorship(
          tournament: @tournament,
          amount_cents: sponsor.payment_amount_cents,
          included_player_slots: sponsor.slot_count
        )

        logo_url = with_resolved_org_rls(organization) do
          if sponsor.logo.attached?
            Rails.application.routes.url_helpers.rails_blob_url(
              sponsor.logo,
              host: ENV.fetch("API_URL", request.base_url)
            )
          else
            sponsor.logo_url
          end
        end

        render json: {
          sponsor: sponsor_checkout_response(sponsor).merge(
            invoice_number: sponsor.invoice_number,
            invoiced_at: sponsor.invoiced_at&.iso8601,
            logo_url: logo_url
          ),
          invoice: {
            invoice_number: sponsor.invoice_number,
            invoiced_at: sponsor.invoiced_at&.iso8601,
            status: sponsor.payment_status,
            organization_name: organization.name,
            tournament_name: @tournament.name,
            event_date: @tournament.event_date,
            location_name: @tournament.location_name,
            checks_payable_to: @tournament.checks_payable_to.presence || organization.name,
            contact_name: @tournament.contact_name.presence,
            contact_email: @tournament.contact_email.presence || organization.contact_email.presence,
            contact_phone: @tournament.contact_phone.presence || organization.contact_phone.presence,
            sponsor_name: sponsor.name,
            sponsor_email: sponsor.login_email,
            sponsor_website_url: sponsor.website_url,
            sponsor_logo_url: logo_url,
            tier_label: tier_snapshot[:label],
            tier_description: tier_snapshot[:description],
            included_player_slots: sponsor.slot_count,
            benefits: tier_snapshot[:benefits],
            amount_cents: sponsor.payment_amount_cents,
            tax_receipt: receipt.applicable? ? receipt.as_json : nil
          },
          message: "Sponsorship reserved. Print or save your invoice to submit with your check."
        }, status: :created
      end

      private

      def authenticate_optional_user
        return if request.headers["Authorization"].blank?

        authenticate_user!
      end

      def admin_request?
        current_user.present? && @tournament.present? && current_user.can_manage?(@tournament)
      end

      def set_tournament
        if action_name.in?(%w[index checkout reserve_check])
          @tournament = if Current.organization.present?
                          TenantContext.with_organization(Current.organization) do
                            Tournament.includes(:organization).find(params[:tournament_id])
                          end
                        elsif current_user.present?
                          with_user_rls_context do
                            Tournament.includes(:organization).find(params[:tournament_id])
                          end
                        else
                          TenantContext.with_platform_access do
                            Tournament.includes(:organization).find(params[:tournament_id])
                          end
                        end
        else
          @tournament = Tournament.includes(:organization).find(params[:tournament_id])
        end
      end

      def set_sponsor_tier
        @sponsor_tier = @tournament.sponsor_tiers.find(params[:id])
      end

      def authorize_index_access!
        return if admin_request?

        return unless authorize_public_tournament_access!

        require_feature!(:sponsor_checkout)
      end

      def authorize_public_checkout_access!
        return unless authorize_public_tournament_access!

        require_feature!(:sponsor_checkout)
      end

      def authorize_public_tournament_access!
        return false unless verify_tenant_match!(@tournament.organization_id, status: :not_found, message: "Tournament not found")

        unless @tournament.public_listed?
          render json: { error: "Tournament not found" }, status: :not_found
          return false
        end

        true
      end

      def authorize_org_admin!
        require_org_admin!(@tournament.organization)
      end

      def with_resolved_org_rls(organization, &block)
        if current_user.present?
          with_user_rls_context(&block)
        else
          TenantContext.with_organization(organization.id, &block)
        end
      end

      def create_pending_sponsor_under_lock(organization:, tier:, buyer:, payment_type:)
        sponsor = nil

        with_resolved_org_rls(organization) do
          ActiveRecord::Base.transaction(requires_new: true) do
            locked_tier = SponsorTier.lock.find(tier.id)
            if locked_tier.sold_out?
              render json: { error: "This sponsor tier is sold out" }, status: :unprocessable_entity
              raise ActiveRecord::Rollback
            end

            sponsor = @tournament.sponsors.create!(
              sponsor_tier: locked_tier,
              tier: locked_tier.key,
              name: buyer[:name],
              login_email: buyer[:email],
              website_url: buyer[:website_url],
              description: buyer[:description],
              slot_count: locked_tier.included_player_slots,
              payment_type: payment_type,
              payment_status: "pending",
              payment_amount_cents: locked_tier.price_cents,
              active: false
            )
          end
        end

        sponsor
      end

      def resolve_external_sponsor_url(tournament, payment_config)
        tournament.swipe_simple_url.presence || payment_config.external_checkout_url.presence
      end

      def sponsor_tier_params
        raw = params[:sponsor_tier].present? ? params.require(:sponsor_tier) : params
        raw.permit(
          :key,
          :label,
          :description,
          :price_cents,
          :included_player_slots,
          :max_quantity,
          :online_checkout_enabled,
          :sort_order,
          benefits: []
        )
      end

      def checkout_params
        raw = params[:sponsor].present? ? params[:sponsor] : params
        {
          name: (raw[:name] || raw[:company_name]).to_s.strip,
          email: (raw[:email] || raw[:login_email] || raw[:contact_email]).to_s.strip.downcase,
          website_url: raw[:website_url].to_s.strip.presence,
          description: raw[:description].to_s.strip.presence,
          logo_url: raw[:logo_url].to_s.strip.presence
        }
      end

      def sponsor_checkout_response(sponsor)
        {
          id: sponsor.id,
          name: sponsor.name,
          tier: sponsor.tier,
          tier_display: sponsor.tier_display,
          sponsor_tier_id: sponsor.sponsor_tier_id,
          login_email: sponsor.login_email,
          slot_count: sponsor.slot_count,
          payment_type: sponsor.payment_type,
          payment_status: sponsor.payment_status,
          payment_amount_cents: sponsor.payment_amount_cents
        }
      end
    end
  end
end
