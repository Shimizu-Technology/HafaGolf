# frozen_string_literal: true

module Api
  module V1
    class SponsorsController < BaseController
      skip_before_action :authenticate_user!, only: [:index, :show, :by_hole]
      before_action :set_tournament
      before_action :authorize_public_tournament_access!, only: [:index, :show, :by_hole]
      before_action :authorize_tournament_admin!, only: [:manage, :create, :update, :destroy, :reorder, :slots, :update_slot]
      before_action :authorize_org_admin!, only: [:portal_link, :send_portal_invite]
      before_action -> { require_feature!(:sponsors) }
      before_action :set_sponsor, only: [:show, :update, :destroy, :slots, :update_slot, :portal_link, :send_portal_invite]
      before_action :require_portal_ready!, only: [:portal_link, :send_portal_invite]

      # GET /api/v1/tournaments/:tournament_id/sponsors
      # Public - get all sponsors grouped by tier
      def index
        @tournament.sponsor_tiers.load
        sponsors = @tournament.sponsors.active.ordered.includes(logo_attachment: :blob)
        tier_keys = @tournament.sponsor_tier_keys

        grouped = tier_keys.each_with_object({}) do |tier, hash|
          tier_sponsors = sponsors.select { |s| s.tier == tier }
          hash[tier] = tier_sponsors.map { |s| sponsor_response(s) } if tier_sponsors.any?
        end

        render json: {
          sponsors: sponsors.map { |s| sponsor_response(s) },
          by_tier: grouped,
          tier_definitions: @tournament.sponsor_tier_list,
          stats: {
            total: sponsors.count,
            title: sponsors.count { |s| s.tier_priority == 0 },
            major: sponsors.count(&:major?),
            hole: sponsors.count(&:hole_sponsor?)
          }
        }
      end

      # GET /api/v1/tournaments/:tournament_id/sponsors/manage
      # Admin - every sponsor (including inactive) with portal fill progress and
      # invite status, plus the tournament settings the sponsor screen needs.
      # Slot counts are aggregated in one grouped query (no per-sponsor N+1).
      def manage
        @tournament.sponsor_tiers.load
        sponsors = @tournament.sponsors.ordered.includes(:sponsor_tier, logo_attachment: :blob).to_a
        slot_stats = SponsorSlot.where(sponsor_id: sponsors.map(&:id)).group(:sponsor_id).pluck(
          :sponsor_id,
          Arel.sql("COUNT(*)"),
          Arel.sql("COUNT(*) FILTER (WHERE TRIM(COALESCE(player_name, '')) <> '')")
        ).to_h { |sponsor_id, total, filled| [sponsor_id, { total: total.to_i, filled: filled.to_i }] }

        rows = sponsors.map do |sponsor|
          stats = slot_stats.fetch(sponsor.id, { total: 0, filled: 0 })
          admin_sponsor_response(sponsor, filled: stats[:filled])
        end
        active_rows = rows.select { |row| row[:active] }

        render json: {
          sponsors: rows,
          tier_definitions: @tournament.sponsor_tier_list,
          tournament: {
            id: @tournament.id,
            name: @tournament.name,
            slug: @tournament.slug,
            team_size: [@tournament.team_size.to_i, 1].max,
            show_public_sponsors: @tournament.show_public_sponsors,
            sponsor_wall_title: @tournament.sponsor_wall_title,
            public_listed: @tournament.public_listed,
            public_page_url: OrgUrlBuilder.public_url(@tournament.organization, "/#{@tournament.slug}"),
            sponsor_edit_deadline: @tournament.sponsor_edit_deadline&.iso8601,
            course_configs: @tournament.course_configs
          },
          summary: {
            total_sponsors: rows.length,
            active_sponsors: active_rows.length,
            portal_slots_total: active_rows.sum { |row| row[:slot_count].to_i },
            portal_slots_filled: active_rows.sum { |row| [row[:slots_filled], row[:slot_count].to_i].min }
          }
        }
      end

      # POST /api/v1/tournaments/:tournament_id/sponsors/:id/portal_link
      # Admin - returns a direct sponsor portal link to share by text or WhatsApp
      # without sending an email. Reuses a still-valid token (refreshing it to the
      # standard invite expiry) so links already sent keep working. The sponsor
      # still has to confirm their login email before seeing any player data.
      def portal_link
        token = @sponsor.issue_portal_access_token!

        ActivityLog.log(
          admin: current_user,
          action: 'sponsor_portal_link_copied',
          target: @sponsor,
          tournament: @tournament,
          details: "Copied sponsor portal link for #{@sponsor.name}",
          metadata: { sponsor_id: @sponsor.id, expires_at: @sponsor.access_token_expires_at&.iso8601 }
        )

        render json: {
          url: OrgUrlBuilder.sponsor_portal_url(@sponsor, token),
          expires_at: @sponsor.access_token_expires_at&.iso8601,
          portal_link_issued_at: @sponsor.portal_link_issued_at&.iso8601
        }
      end

      # POST /api/v1/tournaments/:tournament_id/sponsors/:id/send_portal_invite
      # Admin - emails the portal link to this one sponsor's login email.
      def send_portal_invite
        token = @sponsor.issue_portal_access_token!
        result = SponsorAccessEmailService.send_access_link(sponsor: @sponsor, token: token)
        result = result.to_h.with_indifferent_access if result.respond_to?(:to_h)
        sent = result.is_a?(Hash) && result[:success]

        ActivityLog.log(
          admin: current_user,
          action: 'sponsor_portal_invite_sent',
          target: @sponsor,
          tournament: @tournament,
          details: sent ? "Emailed sponsor portal invite to #{@sponsor.login_email}" : "Sponsor portal invite email failed for #{@sponsor.login_email}",
          metadata: { sponsor_id: @sponsor.id, success: !!sent, expires_at: @sponsor.access_token_expires_at&.iso8601 }
        )

        if sent
          render json: {
            message: "Portal invite emailed to #{@sponsor.login_email}",
            portal_link_issued_at: @sponsor.portal_link_issued_at&.iso8601
          }
        else
          render json: { error: "The invite email could not be sent. Use Copy Portal Link to share it another way." },
                 status: :unprocessable_entity
        end
      end

      # GET /api/v1/tournaments/:tournament_id/sponsors/:id
      # Public - get single sponsor
      def show
        render json: { sponsor: sponsor_response(@sponsor) }
      end

      # GET /api/v1/tournaments/:tournament_id/sponsors/by_hole
      # Public - get hole sponsors indexed by course and hole number
      def by_hole
        hole_sponsors = @tournament.sponsors.active.hole_sponsors

        by_hole = @tournament.course_configs.each_with_object({}) do |course, hash|
          holes = (1..course['hole_count'].to_i).each_with_object({}) do |hole, course_hash|
            sponsor = hole_sponsors.find { |s| s.course_key == course['key'] && s.hole_number == hole }
            course_hash[hole] = sponsor_response(sponsor) if sponsor
          end
          hash[course['key']] = holes if holes.any?
        end

        render json: { by_hole: by_hole }
      end

      # POST /api/v1/tournaments/:tournament_id/sponsors
      # Admin - create sponsor
      def create
        sponsor = @tournament.sponsors.build(sponsor_params)

        if sponsor.save
          sponsor.reload
          render json: { sponsor: admin_sponsor_response(sponsor), message: 'Sponsor created' }, status: :created
        else
          render json: { error: sponsor.errors.full_messages.join(', ') }, status: :unprocessable_entity
        end
      end

      # PATCH /api/v1/tournaments/:tournament_id/sponsors/:id
      # Admin - update sponsor
      def update
        if @sponsor.update(sponsor_params)
          @sponsor.reload
          render json: { sponsor: admin_sponsor_response(@sponsor), message: 'Sponsor updated' }
        else
          render json: { error: @sponsor.errors.full_messages.join(', ') }, status: :unprocessable_entity
        end
      end

      # DELETE /api/v1/tournaments/:tournament_id/sponsors/:id
      # Admin - delete sponsor
      def destroy
        @sponsor.destroy
        render json: { message: 'Sponsor deleted' }
      end

      # GET /api/v1/tournaments/:tournament_id/sponsors/:id/slots
      # Admin - get sponsor slots with player details
      def slots
        slots = @sponsor.sponsor_slots.order(:slot_number)
        render json: { slots: slots.map(&:portal_json) }
      end

      # PATCH /api/v1/tournaments/:tournament_id/sponsors/:id/slots/:slot_id
      # Admin - update a sponsor slot (admins bypass deadline)
      def update_slot
        slot = @sponsor.sponsor_slots.find(params[:slot_id])
        prev_tshirt = slot.tshirt_size
        prev_handicap = slot.handicap

        attrs = {
          player_name: params[:player_name],
          player_email: params[:player_email],
          player_phone: params[:player_phone],
          confirmed_at: Time.current
        }
        attrs[:tshirt_size] = params[:tshirt_size] if params.key?(:tshirt_size)
        attrs[:handicap] = params[:handicap].presence if params.key?(:handicap)
        slot.update!(attrs)

        cleared_fields = []
        cleared_fields << :tshirt_size if params.key?(:tshirt_size) && prev_tshirt.present? && slot.tshirt_size.nil?
        cleared_fields << :handicap if params.key?(:handicap) && !prev_handicap.nil? && slot.handicap.nil?

        begin
          SponsorSlotSyncer.new(@sponsor).sync_slot(slot, cleared_fields: cleared_fields)
        rescue ActiveRecord::RecordInvalid => e
          render json: { error: "Slot saved but player roster sync failed: #{e.message}" }, status: :unprocessable_entity
          return
        end

        render json: { slot: slot.portal_json }
      end

      # POST /api/v1/tournaments/:tournament_id/sponsors/reorder
      # Admin - reorder sponsors within a tier
      def reorder
        positions = params[:positions] || []
        
        ActiveRecord::Base.transaction do
          positions.each_with_index do |id, index|
            @tournament.sponsors.find(id).update!(position: index)
          end
        end

        render json: { message: 'Sponsors reordered' }
      rescue ActiveRecord::RecordNotFound
        render json: { error: 'Sponsor not found' }, status: :not_found
      end

      private

      def set_tournament
        @tournament = Tournament.find(params[:tournament_id])
      end

      def authorize_public_tournament_access!
        return unless verify_tenant_match!(@tournament.organization_id, status: :not_found, message: 'Tournament not found')

        unless @tournament.public_listed?
          render json: { error: 'Tournament not found' }, status: :not_found
        end
      end

      def authorize_tournament_admin!
        return unless verify_tenant_match!(@tournament.organization_id, status: :not_found, message: 'Tournament not found')

        require_tournament_admin!(@tournament)
      end

      def authorize_org_admin!
        return unless verify_tenant_match!(@tournament.organization_id, status: :not_found, message: 'Tournament not found')

        require_org_admin!(@tournament.organization)
      end

      def set_sponsor
        @sponsor = @tournament.sponsors.find(params[:id])
      end

      def require_portal_ready!
        if @tournament.status == 'archived'
          render json: { error: "This event is archived, so sponsor portal links cannot be shared." }, status: :unprocessable_entity
        elsif @sponsor.login_email.blank?
          render json: { error: "Add a portal login email for this sponsor first." }, status: :unprocessable_entity
        elsif !@sponsor.active?
          render json: { error: "Turn this sponsor on (Active) before sharing the portal." }, status: :unprocessable_entity
        end
      end

      def sponsor_params
        params.require(:sponsor).permit(
          :name, :tier, :logo_url, :website_url, :description,
          :course_key, :hole_number, :position, :active, :login_email, :slot_count, :logo
        )
      end

      def sponsor_logo_url(sponsor)
        if sponsor.logo.attached?
          Rails.application.routes.url_helpers.rails_blob_url(
            sponsor.logo,
            host: ENV.fetch('API_URL', request.base_url)
          )
        else
          sponsor.logo_url
        end
      end

      # Public shape: no login emails, slot fill progress, or payment details.
      def sponsor_response(sponsor)
        {
          id: sponsor.id,
          name: sponsor.name,
          tier: sponsor.tier,
          tier_display: sponsor.tier_display,
          logo_url: sponsor_logo_url(sponsor),
          website_url: sponsor.website_url,
          description: sponsor.description,
          course_key: sponsor.course_key,
          course_name: sponsor.course_name,
          hole_number: sponsor.hole_number,
          position: sponsor.position,
          active: sponsor.active,
          major: sponsor.major?,
          display_label: sponsor.display_label
        }
      end

      def admin_sponsor_response(sponsor, filled: nil)
        filled = sponsor.sponsor_slots.count(&:filled?) if filled.nil?

        {
          id: sponsor.id,
          name: sponsor.name,
          tier: sponsor.tier,
          tier_display: sponsor.tier_display,
          logo_url: sponsor_logo_url(sponsor),
          raw_logo_url: sponsor.logo_url,
          has_uploaded_logo: sponsor.logo.attached?,
          website_url: sponsor.website_url,
          description: sponsor.description,
          course_key: sponsor.course_key,
          course_name: sponsor.course_name,
          hole_number: sponsor.hole_number,
          position: sponsor.position,
          active: sponsor.active,
          major: sponsor.major?,
          display_label: sponsor.display_label,
          slot_count: sponsor.slot_count,
          login_email: sponsor.login_email,
          slots_filled: filled,
          has_active_portal_link: sponsor.access_token_valid?,
          portal_link_issued_at: sponsor.portal_link_issued_at&.iso8601,
          sponsor_tier_id: sponsor.sponsor_tier_id,
          payment_type: sponsor.payment_type,
          payment_status: sponsor.payment_status,
          payment_method: sponsor.payment_method,
          payment_amount_cents: sponsor.payment_amount_cents,
          paid_at: sponsor.paid_at&.iso8601
        }
      end
    end
  end
end
