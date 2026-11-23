module Api
  module V1
    class SponsorAccessController < BaseController
      include SponsorPortalSession

      skip_before_action :authenticate_user!
      skip_around_action :with_tenant_rls_context
      before_action :authenticate_sponsor!, only: [:sponsorships, :switch]
      around_action :with_tenant_rls_context, only: [:sponsorships, :switch]
      before_action -> { require_feature!(:sponsors, tournament: @sponsor.tournament) }, only: [:sponsorships, :switch]

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
                   .where.not(tournaments: { status: 'archived' })
                   .where("LOWER(login_email) = ?", email)
                   .to_a
          end
        else
          TenantContext.with_closed_access do
            Sponsor.active.includes(tournament: :organization)
                   .joins(:tournament)
                   .where.not(tournaments: { status: 'archived' })
                   .where("LOWER(login_email) = ?", email)
                   .to_a
          end
        end

        # Filter to sponsors on tournaments where the sponsors feature is enabled.
        # Always return the same generic 200 message when no enabled sponsors match
        # so request_link never acts as an email-enumeration oracle.
        enabled_sponsors = sponsors.select do |sponsor|
          sponsor.portal_eligible? &&
            Features.for(sponsor.tournament&.organization, sponsor.tournament).enabled?(:sponsors)
        end

        if enabled_sponsors.empty?
          render json: { message: "If that email is associated with a sponsor account, you will receive an access link." }
          return
        end

        enabled_sponsors.each do |sponsor|
          begin
            token = TenantContext.with_organization(sponsor.tournament.organization_id) do
              sponsor.issue_portal_access_token!
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

        unless sponsor&.portal_eligible? && (Current.organization.blank? || sponsor.tournament.organization_id == Current.organization.id)
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

        unless sponsor&.portal_eligible? && (Current.organization.blank? || sponsor.tournament.organization_id == Current.organization.id)
          render json: { error: "Invalid or expired access link" }, status: :unauthorized
          return
        end

        return unless require_feature!(:sponsors, tournament: sponsor.tournament)

        unless email.present? && sponsor.login_email&.downcase == email
          render json: { error: "Email does not match. Please enter the email associated with this sponsorship." }, status: :forbidden
          return
        end

        render json: portal_payload(sponsor, email)
      end

      # GET /api/v1/sponsor_access/sponsorships
      # Lists every active sponsorship for the verified sponsor email inside the
      # SAME organization as the current portal session, so a sponsor of several
      # events can switch between them. Never crosses organizations.
      def sponsorships
        siblings = sibling_sponsorships(@sponsor)
        filled_counts = SponsorSlot.where(sponsor_id: siblings.map(&:id))
                                   .where("TRIM(COALESCE(player_name, '')) <> ''")
                                   .group(:sponsor_id).count

        render json: {
          current_sponsor_id: @sponsor.id,
          sponsorships: siblings.map do |sponsor|
            tournament = sponsor.tournament
            {
              sponsor_id: sponsor.id,
              sponsor_name: sponsor.name,
              tier_display: sponsor.tier_display,
              slot_count: sponsor.slot_count.to_i,
              filled_count: filled_counts.fetch(sponsor.id, 0),
              tournament_name: tournament.name,
              tournament_year: tournament.year,
              event_date: tournament.event_date,
              current: sponsor.id == @sponsor.id
            }
          end
        }
      end

      # POST /api/v1/sponsor_access/switch { sponsor_id }
      # Mints a portal session for another sponsorship that shares the verified
      # email within the same organization, preserving the original session expiry.
      def switch
        if @sponsor_session_expires_at.nil? || @sponsor_session_expires_at <= Time.current
          render json: { error: "Invalid or expired sponsor session" }, status: :unauthorized
          return
        end

        target = sibling_sponsorships(@sponsor).find { |sponsor| sponsor.id == params[:sponsor_id].to_i }

        unless target
          render json: { error: "That sponsorship is not available for this email." }, status: :not_found
          return
        end

        render json: portal_payload(target, @sponsor.login_email.to_s.downcase, expires_at: @sponsor_session_expires_at)
      end

      private

      def portal_payload(sponsor, email, expires_at: nil)
        session_token = TenantContext.with_organization(sponsor.tournament.organization_id) do
          sponsor.generate_portal_session_token!(verified_email: email, expires_at: expires_at)
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

        {
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
          tournament: portal_tournament_json(tournament),
          organization: {
            name: org&.name.presence || 'HafaGolf',
            primary_color: org&.primary_color.presence || '#0f766e',
            logo_url: org&.logo_url
          },
          session_token: session_token
        }
      end

      # Active sponsorships with the same login email, restricted to the current
      # sponsor's organization, non-archived events, and events with sponsors enabled.
      def sibling_sponsorships(sponsor)
        org = sponsor.tournament.organization
        email = sponsor.login_email.to_s.strip.downcase
        siblings = Sponsor.active.includes(:sponsor_tier, tournament: :organization)
                          .joins(:tournament)
                          .where(tournaments: { organization_id: org.id })
                          .where.not(tournaments: { status: 'archived' })
                          .where("LOWER(sponsors.login_email) = ?", email)
                          .to_a
        siblings = siblings.select do |candidate|
          candidate.portal_eligible? &&
            candidate.tournament.organization_id == org.id &&
            Features.for(org, candidate.tournament).enabled?(:sponsors)
        end
        siblings.sort_by { |candidate| [-candidate.tournament.year.to_i, candidate.tournament.name.to_s, candidate.name.to_s] }
      end
    end
  end
end
