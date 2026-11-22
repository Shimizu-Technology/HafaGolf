# frozen_string_literal: true

module Api
  module V1
    class DonationsController < BaseController
      MIN_ONLINE_DONATION_CENTS = 100
      OFFLINE_ADMIN_PAYMENT_TYPES = %w[check cash offline].freeze

      skip_before_action :authenticate_user!, only: [:summary, :checkout]
      skip_around_action :with_tenant_rls_context, only: [:summary, :checkout]
      before_action :set_tournament
      before_action :authorize_public_tournament_access!, only: [:summary, :checkout]
      before_action :authorize_tournament_admin!, only: [:index, :create]
      before_action -> { require_feature!(:donations) }

      # GET /api/v1/tournaments/:tournament_id/donations/summary
      # Public donor wall & total raised
      def summary
        organization = @tournament.organization
        paid_donations = []
        payment_config = nil

        TenantContext.with_organization(organization.id) do
          paid_donations = @tournament.donations.paid.recent.to_a
          payment_config = organization.effective_payment_config
        end

        total_raised_cents = paid_donations.sum { |d| d.tax_deductible_cents }
        external_url = payment_config.external_donation_url.presence

        render json: {
          total_raised_cents: total_raised_cents,
          donor_count: paid_donations.size,
          recent_donations: paid_donations.first(50).map(&:public_wall_json),
          payment_mode: payment_config.payment_mode,
          external_donation_url: payment_config.external_link? ? external_url : nil,
          tax_receipt_enabled: @tournament.tax_receipt_enabled?,
          tax_org_name: @tournament.tax_receipt_enabled? ? (@tournament.tax_org_name.presence || organization.name) : nil,
          tax_org_ein: @tournament.tax_receipt_enabled? ? @tournament.tax_org_ein : nil
        }
      end

      # POST /api/v1/tournaments/:tournament_id/donations/checkout
      # Public open-amount online donation checkout
      def checkout
        organization = @tournament.organization
        payload = donation_checkout_params

        if payload[:donor_name].blank?
          render json: { error: "Donor name is required" }, status: :unprocessable_entity
          return
        end

        amount_cents = payload[:amount_cents].to_i
        if amount_cents < MIN_ONLINE_DONATION_CENTS
          render json: { error: "Donation amount must be at least $1.00 (100 cents)" }, status: :unprocessable_entity
          return
        end

        payment_config = nil
        TenantContext.with_organization(organization.id) do
          payment_config = organization.effective_payment_config
        end

        if payment_config.offline?
          render json: { error: "Online donations are not enabled for this organization." }, status: :unprocessable_entity
          return
        end

        adapter = Payments::Resolver.for(organization, config: payment_config)
        external_url = payment_config.external_donation_url.presence
        use_external_link = payment_config.external_link? ||
                            (!adapter.configured? && !adapter.test_mode? && external_url.present?)

        if use_external_link
          if external_url.blank?
            render json: { error: "External donation URL is not configured for this organization." }, status: :unprocessable_entity
            return
          end

          donation = nil
          TenantContext.with_organization(organization.id) do
            donation = @tournament.donations.create!(
              organization: organization,
              donor_name: payload[:donor_name],
              donor_email: payload[:donor_email],
              donor_phone: payload[:donor_phone],
              amount_cents: amount_cents,
              payment_type: "external_link",
              payment_status: "pending",
              anonymous: payload[:anonymous],
              message: payload[:message]
            )
          end

          receipt = TaxReceiptCalculator.for_donation(tournament: @tournament, amount_cents: donation.amount_cents)

          render json: {
            checkout_url: external_url,
            payment_mode: "external_link",
            external_link: true,
            donation: donation.public_wall_json,
            tax_receipt: receipt.applicable? ? receipt.as_json : nil
          }, status: :created
          return
        end

        if !adapter.test_mode? && !adapter.configured?
          render json: { error: "Stripe is not configured. Please contact the administrator." }, status: :service_unavailable
          return
        end

        donation = nil
        TenantContext.with_organization(organization.id) do
          donation = @tournament.donations.create!(
            organization: organization,
            donor_name: payload[:donor_name],
            donor_email: payload[:donor_email],
            donor_phone: payload[:donor_phone],
            amount_cents: amount_cents,
            payment_type: "stripe",
            payment_status: "pending",
            anonymous: payload[:anonymous],
            message: payload[:message]
          )
        end

        receipt = TaxReceiptCalculator.for_donation(tournament: @tournament, amount_cents: donation.amount_cents)

        if adapter.test_mode?
          test_session_id = "test_donation_#{SecureRandom.hex(16)}"
          TenantContext.with_organization(organization.id) do
            donation.update!(stripe_checkout_session_id: test_session_id)
          end

          render json: {
            checkout_url: OrgUrlBuilder.public_url(
              organization,
              "/#{organization.slug}/tournaments/#{@tournament.slug}/donate?checkout=success&session_id=#{test_session_id}"
            ),
            session_id: test_session_id,
            donation: donation.public_wall_json,
            test_mode: true,
            tax_receipt: receipt.applicable? ? receipt.as_json : nil
          }, status: :created
          return
        end

        begin
          session_payload = {
            payment_method_types: ["card"],
            line_items: [{
              price_data: {
                currency: "usd",
                product_data: {
                  name: "Donation — #{@tournament.name}",
                  description: "Charitable donation supporting #{organization.name}"
                },
                unit_amount: donation.amount_cents
              },
              quantity: 1
            }],
            mode: "payment",
            success_url: OrgUrlBuilder.public_url(
              organization,
              "/#{organization.slug}/tournaments/#{@tournament.slug}/donate?checkout=success&session_id={CHECKOUT_SESSION_ID}"
            ),
            cancel_url: OrgUrlBuilder.public_url(
              organization,
              "/#{organization.slug}/tournaments/#{@tournament.slug}/donate?checkout=cancelled"
            ),
            metadata: {
              organization_id: organization.id.to_s,
              tournament_id: @tournament.id.to_s,
              donation_id: donation.id.to_s,
              item_type: "donation"
            }
          }
          session_payload[:customer_email] = donation.donor_email if donation.donor_email.present?

          session = adapter.create_checkout_session(session_payload)

          TenantContext.with_organization(organization.id) do
            donation.update!(stripe_checkout_session_id: session.id)
          end

          render json: {
            checkout_url: session.url,
            session_id: session.id,
            donation: donation.public_wall_json,
            test_mode: false,
            tax_receipt: receipt.applicable? ? receipt.as_json : nil
          }, status: :created
        rescue Stripe::StripeError => e
          Rails.logger.error("Stripe donation checkout error: #{e.message}")
          TenantContext.with_organization(organization.id) do
            donation.update(payment_status: "failed")
          end
          render json: { error: "Payment processing error: #{e.message}" }, status: :unprocessable_entity
        end
      end

      # GET /api/v1/tournaments/:tournament_id/donations
      # Admin full list + totals
      def index
        donations = @tournament.donations.recent.to_a
        paid = donations.select { |d| d.payment_status == "paid" }
        pending = donations.select { |d| d.payment_status == "pending" }
        stripe_paid = paid.select { |d| d.payment_method == "stripe" || d.payment_type == "stripe" }
        offline_paid = paid - stripe_paid

        render json: {
          donations: donations.map(&:admin_json),
          totals: {
            total_raised_cents: paid.sum(&:tax_deductible_cents),
            paid_count: paid.size,
            pending_count: pending.size,
            refunded_cents: donations.sum { |d| d.refund_amount_cents.to_i },
            stripe_cents: stripe_paid.sum(&:tax_deductible_cents),
            offline_cents: offline_paid.sum(&:tax_deductible_cents)
          }
        }
      end

      # POST /api/v1/tournaments/:tournament_id/donations
      # Admin record offline / cash / check donation
      def create
        attrs = admin_donation_params
        payment_type = (attrs[:payment_type].presence || "offline").to_s.strip.downcase
        unless OFFLINE_ADMIN_PAYMENT_TYPES.include?(payment_type)
          render json: {
            error: "Admin donation payment_type must be one of: #{OFFLINE_ADMIN_PAYMENT_TYPES.join(', ')}"
          }, status: :unprocessable_entity
          return
        end
        payment_method = attrs[:payment_method].presence || payment_type

        donation = @tournament.donations.build(
          organization: @tournament.organization,
          donor_name: attrs[:donor_name],
          donor_email: attrs[:donor_email],
          donor_phone: attrs[:donor_phone],
          amount_cents: attrs[:amount_cents],
          payment_type: payment_type,
          payment_method: payment_method,
          payment_status: "paid",
          anonymous: ActiveModel::Type::Boolean.new.cast(attrs[:anonymous]) || false,
          message: attrs[:message],
          paid_at: attrs[:paid_at].presence || Time.current
        )

        if donation.save
          ActivityLog.log(
            admin: current_admin,
            action: "donation_recorded",
            target: donation,
            details: "Recorded #{payment_method} donation of $#{format('%.2f', donation.amount_cents / 100.0)} from #{donation.donor_name}",
            tournament: @tournament
          )

          receipt = TaxReceiptCalculator.for_donation(tournament: @tournament, amount_cents: donation.amount_cents)

          render json: {
            donation: donation.admin_json,
            tax_receipt: receipt.applicable? ? receipt.as_json : nil,
            message: "Donation recorded"
          }, status: :created
        else
          render json: { error: donation.errors.full_messages.join(", "), errors: donation.errors.full_messages }, status: :unprocessable_entity
        end
      end

      private

      def set_tournament
        if action_name.in?(%w[summary checkout])
          @tournament = if Current.organization.present?
                          TenantContext.with_organization(Current.organization) do
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

      def authorize_public_tournament_access!
        return unless verify_tenant_match!(@tournament.organization_id, status: :not_found, message: "Tournament not found")

        unless @tournament.public_listed?
          render json: { error: "Tournament not found" }, status: :not_found
        end
      end

      def authorize_tournament_admin!
        require_tournament_admin!(@tournament)
      end

      def donation_checkout_params
        raw = params[:donation].present? ? params[:donation] : params
        {
          donor_name: raw[:donor_name].to_s.strip,
          donor_email: raw[:donor_email].to_s.strip.downcase.presence,
          donor_phone: raw[:donor_phone].to_s.strip.presence,
          amount_cents: raw[:amount_cents].to_i,
          anonymous: ActiveModel::Type::Boolean.new.cast(raw[:anonymous]) || false,
          message: raw[:message].to_s.strip.presence
        }
      end

      def admin_donation_params
        raw = params[:donation].present? ? params.require(:donation) : params
        raw.permit(
          :donor_name,
          :donor_email,
          :donor_phone,
          :amount_cents,
          :payment_type,
          :payment_method,
          :anonymous,
          :message,
          :paid_at
        )
      end
    end
  end
end
