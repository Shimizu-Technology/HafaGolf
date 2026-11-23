module Api
  module V1
    class TournamentsController < BaseController
      skip_before_action :authenticate_user!, only: [:current]
      skip_around_action :with_tenant_rls_context, only: [:current]
      before_action :set_tournament, only: [:show, :update, :destroy, :archive, :clone, :copy, :open, :close, :complete]
      before_action :authorize_tournament_access!, only: [:show, :update, :destroy, :archive, :clone, :copy, :open, :close, :complete]

      # GET /api/v1/tournaments
      # List all tournaments (for admin dropdown)
      def index
        tournaments = current_user.accessible_tournaments.includes(:organization, :sponsors).recent
        tournaments = tournaments.where(status: params[:status]) if params[:status].present?

        loaded = tournaments.to_a
        preload_tournament_stats(loaded)

        render json: loaded, each_serializer: TournamentSerializer
      end

      # GET /api/v1/tournaments/current
      # Get the current open tournament for the resolved tenant organization
      def current
        org = resolve_public_organization
        tournament = if org.present?
          TenantContext.with_organization(org) do
            resolve_public_tournament(tournament_id: params[:tournament_id], require_listed: true)
          end
        else
          TenantContext.with_closed_access do
            resolve_public_tournament(tournament_id: params[:tournament_id], require_listed: true)
          end
        end
        
        if tournament
          TenantContext.with_organization(tournament.organization) do
            render json: tournament, serializer: TournamentSerializer
          end
        else
          render json: { error: "No active tournament found" }, status: :not_found
        end
      end

      # GET /api/v1/tournaments/:id
      def show
        render json: @tournament, serializer: TournamentSerializer
      end

      # POST /api/v1/tournaments
      def create
        organization = Organization.find_by(id: params.dig(:tournament, :organization_id))
        unless organization
          render json: { errors: ["Organization is required"] }, status: :unprocessable_entity
          return
        end

        require_org_admin!(organization)
        return if performed?

        attrs = tournament_params.except(:organization_id, :course_configs, :teams_per_start_position, :start_positions_per_hole, :raffle_include_with_registration, :raffle_hold_winner_on_screen, :team_categories)
        if params[:tournament]&.key?(:team_categories)
          attrs[:config] = (attrs[:config] || {}).merge(
            'team_categories' => Array(tournament_params[:team_categories]).map { |c| c.to_s.strip }.reject(&:blank?).uniq
          )
        end
        if params[:tournament]&.key?(:raffle_include_with_registration)
          attrs[:config] = (attrs[:config] || {}).merge(
            'raffle_include_with_registration' => ActiveModel::Type::Boolean.new.cast(params[:tournament][:raffle_include_with_registration])
          )
        end
        if params[:tournament]&.key?(:raffle_hold_winner_on_screen)
          attrs[:config] = (attrs[:config] || {}).merge(
            'raffle_hold_winner_on_screen' => ActiveModel::Type::Boolean.new.cast(params[:tournament][:raffle_hold_winner_on_screen])
          )
        end
        if params[:tournament]&.key?(:course_configs)
          courses = Array(tournament_params[:course_configs]).map(&:to_h)
          attrs[:config] = (attrs[:config] || {}).merge('course_configs' => courses)
          attrs[:total_holes] = courses.sum { |course| course['hole_count'].to_i }
        end
        if params[:tournament]&.key?(:teams_per_start_position)
          attrs[:config] = (attrs[:config] || {}).merge(
            'teams_per_start_position' => tournament_params[:teams_per_start_position].to_i
          )
        end
        if params[:tournament]&.key?(:start_positions_per_hole)
          value = tournament_params[:start_positions_per_hole]
          attrs[:config] = (attrs[:config] || {}).merge(
            'start_positions_per_hole' => value.present? ? value.to_i : nil
          ).compact
        end

        tournament = organization.tournaments.new(attrs)
        
        if tournament.save
          ActivityLog.log(
            admin: current_admin,
            action: 'tournament_created',
            target: tournament,
            details: "Created tournament: #{tournament.display_name}"
          )
          render json: tournament, serializer: TournamentSerializer, status: :created
        else
          render json: { errors: tournament.errors.full_messages }, status: :unprocessable_entity
        end
      end

      # PATCH /api/v1/tournaments/:id
      def update
        raffle_snapshot_before = raffle_settings_snapshot(@tournament)
        attrs = tournament_params.except(:organization_id, :sponsor_tiers,
                                         :raffle_include_with_registration, :raffle_hold_winner_on_screen, :raffle_bundles,
                                         :course_configs, :teams_per_start_position, :start_positions_per_hole, :team_categories)

        merged_config = (@tournament.config || {}).deep_dup

        if params[:tournament]&.key?(:team_categories)
          merged_config['team_categories'] = Array(tournament_params[:team_categories]).map { |c| c.to_s.strip }.reject(&:blank?).uniq
        end

        if params.dig(:tournament, :sponsor_tiers).present?
          tiers = tournament_params[:sponsor_tiers]&.map(&:to_h)
          merged_config['sponsor_tiers'] = tiers
        end

        if params[:tournament].key?(:raffle_include_with_registration)
          merged_config['raffle_include_with_registration'] =
            ActiveModel::Type::Boolean.new.cast(params[:tournament][:raffle_include_with_registration])
        end

        if params[:tournament].key?(:raffle_hold_winner_on_screen)
          merged_config['raffle_hold_winner_on_screen'] =
            ActiveModel::Type::Boolean.new.cast(params[:tournament][:raffle_hold_winner_on_screen])
        end

        if params.dig(:tournament, :raffle_bundles).present?
          merged_config['raffle_bundles'] = tournament_params[:raffle_bundles]&.map(&:to_h)
        end

        if params[:tournament]&.key?(:course_configs)
          courses = Array(tournament_params[:course_configs]).map(&:to_h)
          merged_config['course_configs'] = courses
          attrs[:total_holes] = courses.sum { |course| course['hole_count'].to_i }
        end
        if params[:tournament]&.key?(:teams_per_start_position)
          merged_config['teams_per_start_position'] = tournament_params[:teams_per_start_position].to_i
        end
        if params[:tournament]&.key?(:start_positions_per_hole)
          value = tournament_params[:start_positions_per_hole]
          if value.present?
            merged_config['start_positions_per_hole'] = value.to_i
          else
            merged_config.delete('start_positions_per_hole')
          end
        end

        if params[:tournament]&.key?(:raffle_enabled) && merged_config.dig('features').is_a?(Hash) && merged_config['features'].key?('raffle')
          merged_config['features'] = merged_config['features'].merge(
            'raffle' => ActiveModel::Type::Boolean.new.cast(params[:tournament][:raffle_enabled])
          )
        end

        attrs[:config] = merged_config if merged_config != @tournament.config

        if @tournament.update(attrs)
          ActivityLog.log(
            admin: current_admin,
            action: 'tournament_updated',
            target: @tournament,
            details: "Updated tournament: #{@tournament.display_name}"
          )
          log_raffle_settings_update(raffle_snapshot_before)
          render json: @tournament, serializer: TournamentSerializer
        else
          render json: { errors: @tournament.errors.full_messages }, status: :unprocessable_entity
        end
      end

      # DELETE /api/v1/tournaments/:id
      def destroy
        if @tournament.golfers.any? || @tournament.registrations.any? || @tournament.groups.any?
          render json: { 
            error: "Cannot delete tournament with existing golfers, registrations, or groups. Archive it instead." 
          }, status: :unprocessable_entity
          return
        end
        
        @tournament.destroy!
        head :no_content
      end

      # POST /api/v1/tournaments/:id/archive
      def archive
        @tournament.archive!
        
        ActivityLog.log(
          admin: current_admin,
          action: 'tournament_archived',
          target: @tournament,
          details: "Archived tournament: #{@tournament.display_name}"
        )
        
        render json: @tournament, serializer: TournamentSerializer
      end

      # POST /api/v1/tournaments/:id/clone
      # POST /api/v1/tournaments/:id/copy
      # Clone this tournament for next year (same org) or as a template to another org (super_admin only)
      def clone
        options = clone_params

        if options[:target_organization_id].present? &&
           options[:target_organization_id].to_s != @tournament.organization_id.to_s
          require_super_admin!
          return if performed?
        end

        result = Tournaments::CloneService.call(
          source: @tournament,
          actor: current_user,
          **options
        )

        # Pre-populate empty stats so TournamentSerializer avoids an extra count query
        result.tournament.instance_variable_set(:@golfer_stats, {
          confirmed: 0,
          public_confirmed: 0,
          sponsor_confirmed: 0,
          paid: 0,
          pending_payment: 0,
          waitlist: 0,
          checked_in: 0
        })

        render json: {
          tournament: TournamentSerializer.new(result.tournament).as_json,
          clone_warnings: result.warnings,
          clone_metadata: result.metadata
        }, status: :created
      rescue Tournaments::CloneService::AuthorizationError => e
        render json: { error: e.message }, status: :forbidden
      rescue Tournaments::CloneService::TargetOrganizationNotFoundError => e
        render json: { error: e.message }, status: :not_found
      rescue ActiveRecord::RecordInvalid => e
        render json: { errors: e.record.errors.full_messages }, status: :unprocessable_entity
      end

      def copy
        clone
      end

      # POST /api/v1/tournaments/:id/open
      # Open tournament for registration
      def open
        unless @tournament.can_open_registration?
          render json: { error: "Only draft or closed events can be opened for registration." }, status: :unprocessable_entity
          return
        end

        # Close any other open tournaments in the same organization first
        Tournament.where(status: 'open', organization_id: @tournament.organization_id)
                  .where.not(id: @tournament.id)
                  .update_all(status: 'closed')
        
        @tournament.open_registration!
        
        ActivityLog.log(
          admin: current_admin,
          action: 'tournament_updated',
          target: @tournament,
          details: "Opened tournament for registration: #{@tournament.display_name}"
        )
        
        render json: @tournament, serializer: TournamentSerializer
      end

      # POST /api/v1/tournaments/:id/close
      # Close tournament registration
      def close
        @tournament.update!(status: 'closed', registration_open: false, walkin_registration_open: false)
        
        ActivityLog.log(
          admin: current_admin,
          action: 'tournament_updated',
          target: @tournament,
          details: "Closed tournament: #{@tournament.display_name}"
        )
        
        render json: @tournament, serializer: TournamentSerializer
      end

      # POST /api/v1/tournaments/:id/complete
      # Mark event complete and shut off all registration paths
      def complete
        unless @tournament.can_complete?
          render json: { error: "Only open, closed, or in-progress events can be marked complete." }, status: :unprocessable_entity
          return
        end

        @tournament.complete!

        ActivityLog.log(
          admin: current_admin,
          action: 'tournament_updated',
          target: @tournament,
          details: "Marked tournament completed: #{@tournament.display_name}"
        )

        render json: @tournament, serializer: TournamentSerializer
      end

      private

      def set_tournament
        @tournament = Tournament.find(params[:id])
      end

      def authorize_tournament_access!
        require_tournament_admin!(@tournament)
      end

      def raffle_settings_snapshot(tournament)
        config = tournament.config || {}
        {
          raffle_enabled: tournament.raffle_enabled,
          raffle_ticket_price_cents: tournament.raffle_ticket_price_cents,
          raffle_draw_time: tournament.raffle_draw_time&.iso8601,
          raffle_description: tournament.raffle_description,
          raffle_auto_draw: tournament.raffle_auto_draw,
          raffle_max_tickets_per_person: tournament.raffle_max_tickets_per_person,
          raffle_tickets_per_purchase: tournament.raffle_tickets_per_purchase,
          raffle_include_with_registration: config['raffle_include_with_registration'],
          raffle_hold_winner_on_screen: tournament.raffle_hold_winner_on_screen?,
          raffle_bundles: config['raffle_bundles']
        }
      end

      def log_raffle_settings_update(before_snapshot)
        after_snapshot = raffle_settings_snapshot(@tournament)
        changed_fields = after_snapshot.keys.select { |field| before_snapshot[field] != after_snapshot[field] }
        return if changed_fields.empty?

        ActivityLog.log(
          admin: current_admin,
          action: 'raffle_settings_updated',
          target: @tournament,
          details: "Updated raffle settings: #{changed_fields.join(', ')}",
          metadata: {
            changed_fields: changed_fields.map(&:to_s),
            before: before_snapshot,
            after: after_snapshot
          },
          tournament: @tournament
        )
      end

      def clone_params
        allowed_keys = %i[
          name
          year
          edition
          event_date
          registration_deadline
          early_bird_deadline
          sponsor_edit_deadline
          raffle_draw_time
          copy_sponsor_shells
          copy_raffle_prizes
          target_organization_id
        ]

        sources = []
        sources << params[:tournament].permit(*allowed_keys) if params[:tournament].is_a?(ActionController::Parameters)
        sources << params[:clone].permit(*allowed_keys) if params[:clone].is_a?(ActionController::Parameters)
        sources << params.permit(*allowed_keys)

        sources.each_with_object({}) do |permitted, options|
          allowed_keys.each do |key|
            options[key] = permitted[key] if permitted.key?(key)
          end
        end
      end

      def tournament_params
        raw = params.require(:tournament)
        attributes = raw.except(:story_photos, :homepage_config).permit(
          :organization_id,
          :event_type,
          :name, :year, :edition, :status,
          :event_date, :registration_time, :start_time,
          :location_name, :location_address,
          :tournament_format, :team_size, :capacity_unit, :allow_partial_teams, :teams_per_start_position, :start_positions_per_hole,
          :max_capacity, :reserved_slots, :entry_fee, :employee_entry_fee,
          :format_name, :fee_includes, :checks_payable_to,
          :contact_name, :contact_phone, :contact_email,
          :registration_open, :registration_deadline,
          :waitlist_enabled, :waitlist_max,
          :swipe_simple_url, :walkin_swipe_simple_url,
          :entry_fee_display,
          :raffle_enabled, :raffle_ticket_price_cents, :raffle_draw_time,
          :raffle_description, :raffle_auto_draw,
          :raffle_max_tickets_per_person, :raffle_tickets_per_purchase,
          :walkin_fee, :walkin_registration_open,
          :sponsor_edit_deadline,
          :tax_receipt_enabled, :tax_org_name, :tax_org_ein,
          :fmv_per_player_cents, :tax_receipt_disclaimer,
          :event_schedule, :tournament_info, :payment_instructions,
          :check_in_time,
          :banner_url_override, :logo_url_override,
          :primary_color_override, :accent_color_override, :signature_image_url_override,
          :theme_preset, :use_org_branding,
          :commemorative_banner_url, :tribute_title, :tribute_subtitle,
          :waiver_enabled, :waiver_text, :show_public_sponsors, :sponsor_wall_title,
          :allow_sponsor_check_invoice,
          :raffle_include_with_registration, :raffle_hold_winner_on_screen,
          config: {},
          team_categories: [],
          course_configs: [:key, :name, :hole_count],
          sponsor_tiers: [:key, :label, :sort_order],
          raffle_bundles: [:quantity, :price_cents, :label]
        )
        # Keep the JSON shape intact so the model can reject malformed entries.
        attributes[:story_photos] = raw[:story_photos].as_json if raw.key?(:story_photos)
        attributes[:homepage_config] = raw[:homepage_config].as_json if raw.key?(:homepage_config)
        attributes
      end
    end
  end
end
