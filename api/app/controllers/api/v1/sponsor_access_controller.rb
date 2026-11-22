module Api
  module V1
    class SponsorAccessController < BaseController
      skip_before_action :authenticate_user!
      skip_around_action :with_tenant_rls_context

      # POST /api/v1/sponsor_access/request_link
      def request_link
        email = params[:email]&.strip&.downcase
        unless email.present?
          render json: { error: "Email is required" }, status: :unprocessable_entity
          return
        end

        sponsors = if Current.organization.present?
          TenantContext.with_organization(Current.organization) do
            Sponsor.active.includes(tournament: :organization)
                   .joins(:tournament)
                   .where(tournaments: { organization_id: Current.organization.id })
                   .where("LOWER(login_email) = ?", email)
                   .to_a
          end
        else
          TenantContext.with_closed_access do
            Sponsor.active.includes(tournament: :organization)
                   .where("LOWER(login_email) = ?", email)
                   .to_a
          end
        end

        # Filter to sponsors on tournaments where the sponsors feature is enabled.
        # Always return the same generic 200 message when no enabled sponsors match
        # so request_link never acts as an email-enumeration oracle.
        enabled_sponsors = sponsors.select do |sponsor|
          Features.for(sponsor.tournament&.organization, sponsor.tournament).enabled?(:sponsors)
        end

        if enabled_sponsors.empty?
          render json: { message: "If that email is associated with a sponsor account, you will receive an access link." }
          return
        end

        enabled_sponsors.each do |sponsor|
          begin
            token = TenantContext.with_organization(sponsor.tournament.organization_id) do
              sponsor.generate_access_token!
            end
            # Send access links synchronously OUTSIDE DB transaction
            SponsorAccessEmailService.send_access_link(sponsor: sponsor, token: token)
          rescue StandardError => e
            Rails.logger.error("Failed to send sponsor access link for sponsor #{sponsor.id}: #{e.message}")
          end
        end

        render json: { message: "If that email is associated with a sponsor account, you will receive an access link." }
      end

      # GET /api/v1/sponsor_access/verify?token=xxx
      # Step 1: Validates the token and returns minimal info (no slots, no full access).
      # The frontend must then POST to /confirm with the email to get full access.
      def verify
        token = params[:token]
        sponsor = TenantContext.with_platform_access { Sponsor.includes(:tournament).find_by_access_token(token) }

        unless sponsor && (Current.organization.blank? || sponsor.tournament.organization_id == Current.organization.id)
          render json: { error: "Invalid or expired access link" }, status: :unauthorized
          return
        end

        return unless require_feature!(:sponsors, tournament: sponsor.tournament)

        render json: {
          status: "requires_email_verification",
          sponsor_name: sponsor.name,
          token: token
        }
      end

      # POST /api/v1/sponsor_access/confirm
      # Step 2: Token + email verification. Returns full sponsor data only if email matches.
      def confirm
        token = params[:token]
        email = params[:email]&.strip&.downcase

        sponsor = TenantContext.with_platform_access { Sponsor.includes(tournament: :organization).find_by_access_token(token) }

        unless sponsor && (Current.organization.blank? || sponsor.tournament.organization_id == Current.organization.id)
          render json: { error: "Invalid or expired access link" }, status: :unauthorized
          return
        end

        return unless require_feature!(:sponsors, tournament: sponsor.tournament)

        unless email.present? && sponsor.login_email&.downcase == email
          render json: { error: "Email does not match. Please enter the email associated with this sponsorship." }, status: :forbidden
          return
        end

        session_token = TenantContext.with_organization(sponsor.tournament.organization_id) do
          sponsor.generate_portal_session_token!(verified_email: email)
        end
        tournament = sponsor.tournament
        org = tournament&.organization

        logo = if sponsor.logo.attached?
                 Rails.application.routes.url_helpers.rails_blob_url(
                   sponsor.logo,
                   host: ENV.fetch('API_URL', request.base_url)
                 )
               else
                 sponsor.logo_url
               end

        render json: {
          sponsor: {
            id: sponsor.id,
            name: sponsor.name,
            tier: sponsor.tier,
            tier_display: sponsor.tier_display,
            slot_count: sponsor.slot_count,
            tournament_id: sponsor.tournament_id,
            logo_url: logo,
            website_url: sponsor.website_url
          },
          tournament: {
            name: tournament.name,
            event_date: tournament.event_date,
            sponsor_edit_deadline: tournament.sponsor_edit_deadline&.iso8601,
            contact_name: tournament.contact_name,
            contact_email: tournament.contact_email,
            contact_phone: tournament.contact_phone
          },
          organization: {
            name: org&.name.presence || 'HafaGolf',
            primary_color: org&.primary_color.presence || '#0f766e',
            logo_url: org&.logo_url
          },
          session_token: session_token
        }
      end
    end
  end
end
