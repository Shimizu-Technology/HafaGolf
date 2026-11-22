# frozen_string_literal: true

module Api
  module V1
    class SponsorTiersController < BaseController
      skip_before_action :authenticate_user!, only: [:index, :checkout]
      skip_around_action :with_tenant_rls_context, only: [:index, :checkout]
      before_action :authenticate_optional_user, only: [:index]
      before_action :set_tournament
      before_action :authorize_index_access!, only: [:index]
      before_action :authorize_public_checkout_access!, only: [:checkout]
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

      private

      def authenticate_optional_user
        return if request.headers["Authorization"].blank?

        authenticate_user!
      end

      def admin_request?
        current_user.present? && @tournament.present? && current_user.can_manage?(@tournament)
      end

      def set_tournament
        if action_name.in?(%w[index checkout])
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
          description: raw[:description].to_s.strip.presence
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
