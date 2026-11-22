# frozen_string_literal: true

module Api
  module V1
    class OrganizationsController < BaseController
      skip_before_action :authenticate_user!, only: [:show, :tournaments, :tournament]
      skip_around_action :with_tenant_rls_context, only: [:show, :tournaments, :tournament]

      # GET /api/v1/organizations/:slug
      # Public endpoint - returns organization info
      def show
        organization = Organization.find_by_slug!(params[:slug])
        tournament_count = TenantContext.with_organization(organization) { organization.tournament_count }
        
        render json: {
          id: organization.id,
          name: organization.name,
          slug: organization.slug,
          description: organization.description,
          logo_url: organization.logo_url,
          primary_color: organization.primary_color,
          banner_url: organization.banner_url,
          contact_email: organization.contact_email,
          contact_phone: organization.contact_phone,
          website_url: organization.website_url,
          primary_host: organization.primary_host,
          offseason_enabled: organization.offseason_enabled,
          offseason_title: organization.offseason_title,
          offseason_message: organization.offseason_message,
          offseason_cta_label: organization.offseason_cta_label,
          offseason_cta_url: organization.offseason_cta_url,
          settings: organization.settings || {},
          features: Features.for(organization).to_h,
          tournament_count: tournament_count
        }
      rescue ActiveRecord::RecordNotFound
        render json: { error: 'Organization not found' }, status: :not_found
      end

      # GET /api/v1/organizations/:slug/tournaments
      # Public endpoint - returns organization's public tournaments
      def tournaments
        organization = Organization.find_by_slug!(params[:slug])
        loaded = TenantContext.with_organization(organization) do
          list = organization.tournaments
                             .includes(:organization, :sponsors)
                             .where(public_listed: true)
                             .where(status: %w[open closed in_progress completed])
                             .order(event_date: :desc)
                             .to_a

          preload_tournament_stats(list) if list.any?
          list
        end

        render json: loaded, each_serializer: TournamentSerializer
      rescue ActiveRecord::RecordNotFound
        render json: { error: 'Organization not found' }, status: :not_found
      end

      # GET /api/v1/organizations/:slug/tournaments/:tournament_slug
      # Public endpoint - returns specific tournament with sponsors
      def tournament
        organization = Organization.find_by_slug!(params[:slug])
        tournament_data = TenantContext.with_organization(organization) do
          tournament = organization.tournaments.where(public_listed: true).find_by!(slug: params[:tournament_slug])
          
          # Get active sponsors grouped by tier
          sponsors = tournament.sponsors.active.ordered.includes(logo_attachment: :blob).map do |s|
            logo = if s.logo.attached?
                     Rails.application.routes.url_helpers.rails_blob_url(
                       s.logo,
                       host: ENV.fetch('API_URL', request.base_url)
                     )
                   else
                     s.logo_url
                   end

            {
              id: s.id,
              name: s.name,
              tier: s.tier,
              tier_display: s.tier_display,
              logo_url: logo,
              website_url: s.website_url,
              description: s.description,
              course_key: s.course_key,
              course_name: s.course_name,
              hole_number: s.hole_number,
              display_label: s.display_label,
              major: s.major?
            }
          end

          # Render tournament with sponsors
          data = TournamentSerializer.new(tournament).as_json
          data[:sponsors] = sponsors
          data
        end
        
        render json: tournament_data
      rescue ActiveRecord::RecordNotFound
        render json: { error: 'Tournament not found' }, status: :not_found
      end

      # GET /api/v1/admin/organizations
      # Returns organizations the current user can access
      def index
        organizations = current_user.accessible_organizations.includes(:organization_domains).order(:name)
        render json: organizations.map { |org| organization_response(org) }
      end

      # POST /api/v1/admin/organizations
      # Super-admin endpoint - create a new organization (with optional primary domain & initial admin)
      def create
        require_super_admin!
        return if performed?

        organization = Organization.new(organization_params)
        primary_domain_host = params.dig(:organization, :primary_domain).presence || params[:primary_domain].presence
        initial_admin_email = (params.dig(:organization, :admin_email).presence || params[:admin_email].presence)&.strip&.downcase

        ActiveRecord::Base.transaction(requires_new: true) do
          organization.save!

          if primary_domain_host.present?
            organization.organization_domains.create!(
              hostname: primary_domain_host,
              is_primary: true
            )
          end

          if initial_admin_email.present?
            user = User.find_by("LOWER(email) = ?", initial_admin_email) || User.create!(
              email: initial_admin_email,
              clerk_id: "pending_#{Digest::SHA256.hexdigest(initial_admin_email)[0..23]}",
              role: "org_admin"
            )
            organization.add_admin(user)
          end
        end

        render json: organization_response(organization.reload), status: :created
      rescue ActiveRecord::RecordInvalid => e
        render json: { errors: e.record.errors.full_messages }, status: :unprocessable_entity
      rescue ActiveRecord::RecordNotUnique
        render json: { errors: ["Organization slug, domain, or admin email is already taken."] }, status: :unprocessable_entity
      end

      # DELETE /api/v1/admin/organizations/:slug
      # Super-admin endpoint - delete an organization (blocked if tournaments exist)
      def destroy
        require_super_admin!
        return if performed?

        organization = Organization.find_by_slug!(params[:slug])
        if organization.destroy
          head :no_content
        else
          render json: { errors: organization.errors.full_messages }, status: :unprocessable_entity
        end
      rescue ActiveRecord::RecordNotFound
        render json: { error: 'Organization not found' }, status: :not_found
      end

      # GET /api/v1/admin/organizations/:slug/domains
      def domains
        organization = Organization.find_by_slug!(params[:slug])
        require_org_admin!(organization)
        return if performed?

        render json: {
          domains: organization.organization_domains.primary_first.map { |d| domain_response(d) }
        }
      rescue ActiveRecord::RecordNotFound
        render json: { error: 'Organization not found' }, status: :not_found
      end

      # POST /api/v1/admin/organizations/:slug/domains
      def create_domain
        require_super_admin!
        return if performed?

        organization = Organization.find_by_slug!(params[:slug])
        domain = nil

        organization.with_lock do
          domain = organization.organization_domains.build(domain_params)
          domain.is_primary = true if organization.organization_domains.empty?

          unless domain.save
            return render json: { errors: domain.errors.full_messages }, status: :unprocessable_entity
          end
        end

        render json: { domain: domain_response(domain) }, status: :created
      rescue ActiveRecord::RecordNotFound
        render json: { error: 'Organization not found' }, status: :not_found
      rescue ActiveRecord::RecordNotUnique
        render json: { errors: ["Domain hostname or primary domain conflict. Please try again."] }, status: :unprocessable_entity
      end

      # PATCH /api/v1/admin/organizations/:slug/domains/:domain_id
      def update_domain
        require_super_admin!
        return if performed?

        organization = Organization.find_by_slug!(params[:slug])
        domain = nil

        organization.with_lock do
          domain = organization.organization_domains.find(params[:domain_id])
          permitted = domain_params

          if domain.is_primary? && permitted.key?(:is_primary) && !ActiveModel::Type::Boolean.new.cast(permitted[:is_primary])
            return render json: {
              errors: ["Cannot unset the primary domain. Promote another domain to primary first."]
            }, status: :unprocessable_entity
          end

          unless domain.update(permitted)
            return render json: { errors: domain.errors.full_messages }, status: :unprocessable_entity
          end
        end

        render json: { domain: domain_response(domain) }
      rescue ActiveRecord::RecordNotFound
        render json: { error: 'Domain not found' }, status: :not_found
      rescue ActiveRecord::RecordNotUnique
        render json: { errors: ["Domain hostname or primary domain conflict. Please try again."] }, status: :unprocessable_entity
      end

      # DELETE /api/v1/admin/organizations/:slug/domains/:domain_id
      def destroy_domain
        require_super_admin!
        return if performed?

        organization = Organization.find_by_slug!(params[:slug])

        organization.with_lock do
          domain = organization.organization_domains.find(params[:domain_id])
          was_primary = domain.is_primary?
          domain.destroy!

          if was_primary
            next_primary = organization.organization_domains.order(created_at: :asc).first
            next_primary&.update!(is_primary: true)
          end
        end

        head :no_content
      rescue ActiveRecord::RecordNotFound
        render json: { error: 'Domain not found' }, status: :not_found
      rescue ActiveRecord::RecordNotUnique
        render json: { errors: ["Domain update conflicted with another request. Please try again."] }, status: :unprocessable_entity
      end

      # GET /api/v1/admin/organizations/:slug/features
      def features
        organization = Organization.find_by_slug!(params[:slug])
        require_org_admin!(organization)
        return if performed?

        render json: features_response(organization)
      rescue ActiveRecord::RecordNotFound
        render json: { error: 'Organization not found' }, status: :not_found
      end

      # GET /api/v1/admin/organizations/:slug/payment_config
      def payment_config
        organization = Organization.find_by_slug!(params[:slug])
        require_org_admin!(organization)
        return if performed?

        config = organization.effective_payment_config
        render json: {
          payment_config: config.safe_as_json(api_base_url: request.base_url),
          can_edit_platform_fees: current_user.super_admin?
        }
      rescue ActiveRecord::RecordNotFound
        render json: { error: 'Organization not found' }, status: :not_found
      end

      # PATCH /api/v1/admin/organizations/:slug/payment_config
      def update_payment_config
        organization = Organization.find_by_slug!(params[:slug])
        require_org_admin!(organization)
        return if performed?

        raw = params.require(:payment_config)
        fee_keys = %w[platform_fee_flat_cents platform_fee_per_registrant_cents platform_fee_cap_cents]
        if !current_user.super_admin? && fee_keys.any? { |k| raw.key?(k) }
          return render json: { error: "Only platform super admins can modify platform fee terms" }, status: :forbidden
        end

        config = organization.organization_payment_config || organization.build_organization_payment_config
        allowed = %i[
          payment_mode processor_provider test_mode
          external_checkout_url external_walkin_url external_donation_url
          payout_payee_name payout_bank_name payout_notes
        ]
        allowed += %i[platform_fee_flat_cents platform_fee_per_registrant_cents platform_fee_cap_cents] if current_user.super_admin?
        attrs = raw.permit(*allowed).to_h

        target_mode = (attrs["payment_mode"].presence || config.payment_mode || "offline").to_s.strip.downcase

        if target_mode == "client_processor"
          attrs["encrypted_public_key"] = nil if ActiveModel::Type::Boolean.new.cast(raw[:clear_public_key])
          attrs["encrypted_secret_key"] = nil if ActiveModel::Type::Boolean.new.cast(raw[:clear_secret_key])
          attrs["encrypted_webhook_secret"] = nil if ActiveModel::Type::Boolean.new.cast(raw[:clear_webhook_secret])

          attrs["encrypted_public_key"] = raw[:public_key].to_s.strip if raw[:public_key].present?
          attrs["encrypted_secret_key"] = raw[:secret_key].to_s.strip if raw[:secret_key].present?
          attrs["encrypted_webhook_secret"] = raw[:webhook_secret].to_s.strip if raw[:webhook_secret].present?
        else
          # Clear client credentials & webhook token when leaving client_processor mode
          attrs["encrypted_public_key"] = nil
          attrs["encrypted_secret_key"] = nil
          attrs["encrypted_webhook_secret"] = nil
          attrs["webhook_endpoint_token"] = nil
        end

        if config.update(attrs)
          ActivityLog.log(
            admin: current_user,
            action: "settings_updated",
            target: organization,
            organization: organization,
            details: "Updated payment configuration (mode: #{config.payment_mode}, provider: #{config.processor_provider})",
            metadata: {
              payment_mode: config.payment_mode,
              processor_provider: config.processor_provider,
              test_mode: config.test_mode
            }
          )
          render json: {
            payment_config: config.safe_as_json(api_base_url: request.base_url),
            can_edit_platform_fees: current_user.super_admin?
          }
        else
          render json: { errors: config.errors.full_messages }, status: :unprocessable_entity
        end
      rescue ActiveRecord::RecordNotFound
        render json: { error: 'Organization not found' }, status: :not_found
      end

      # POST /api/v1/admin/organizations/:slug/payment_config/rotate_webhook_token
      def rotate_webhook_token
        organization = Organization.find_by_slug!(params[:slug])
        require_org_admin!(organization)
        return if performed?

        config = organization.organization_payment_config
        unless config&.client_processor?
          return render json: { error: "Webhook token rotation is only available in client_processor mode" }, status: :unprocessable_entity
        end

        config.rotate_webhook_endpoint_token!
        ActivityLog.log(
          admin: current_user,
          action: "settings_updated",
          target: organization,
          organization: organization,
          details: "Rotated client processor webhook endpoint token"
        )
        render json: {
          payment_config: config.safe_as_json(api_base_url: request.base_url),
          can_edit_platform_fees: current_user.super_admin?
        }
      rescue ActiveRecord::RecordNotFound
        render json: { error: 'Organization not found' }, status: :not_found
      end

      # PATCH /api/v1/admin/organizations/:slug/features
      def update_features
        organization = Organization.find_by_slug!(params[:slug])
        require_org_admin!(organization)
        return if performed?

        org_input = if params.key?(:organization_features)
                      normalize_feature_input(params[:organization_features])
                    elsif params[:tournament_id].blank? && params.key?(:features)
                      normalize_feature_input(params[:features])
                    end

        tournament_input = if params[:tournament_id].present?
                             raw_t = params.key?(:tournament_features) ? params[:tournament_features] : params[:features]
                             normalize_feature_input(raw_t)
                           end

        if org_input.nil? && tournament_input.nil?
          return render json: { error: 'No feature updates provided', errors: ['No feature updates provided'] },
                        status: :unprocessable_entity
        end

        validation_errors = []
        if org_input == :invalid
          validation_errors << 'Organization features payload must be an object'
        elsif org_input.present?
          validation_errors.concat(GolfFeaturesCatalog.validate_overrides(org_input, scope: :organization))
        end

        tournament = nil
        if params[:tournament_id].present?
          tournament = organization.tournaments.find(params[:tournament_id])
          if tournament_input == :invalid
            validation_errors << 'Tournament features payload must be an object'
          elsif tournament_input.present?
            validation_errors.concat(GolfFeaturesCatalog.validate_overrides(tournament_input, scope: :tournament))
          end
        end

        if validation_errors.any?
          return render json: { error: validation_errors.join(', '), errors: validation_errors },
                        status: :unprocessable_entity
        end

        ActiveRecord::Base.transaction do
          if org_input.is_a?(Hash) && org_input.any?
            settings = (organization.settings || {}).deep_dup
            existing_features = settings['features'].is_a?(Hash) ? settings['features'].deep_dup : {}

            org_input.each do |key, value|
              if value.nil?
                existing_features.delete(key)
              else
                existing_features[key] = value
              end
            end

            settings['features'] = existing_features
            org_updates = { settings: settings }

            if org_input.key?('offseason_mode')
              org_updates[:offseason_enabled] = org_input['offseason_mode'].nil? ? GolfFeaturesCatalog.default_for(:offseason_mode) : org_input['offseason_mode']
            end

            organization.update!(org_updates)
          end

          if tournament.present? && tournament_input.is_a?(Hash) && tournament_input.any?
            config = (tournament.config || {}).deep_dup
            existing_features = config['features'].is_a?(Hash) ? config['features'].deep_dup : {}

            tournament_input.each do |key, value|
              if value.nil?
                existing_features.delete(key)
              else
                existing_features[key] = value
              end
            end

            config['features'] = existing_features
            tournament_updates = { config: config }

            if tournament_input.key?('raffle')
              # When clearing a tournament override to nil ("inherit"), set legacy raffle_enabled = true
              # so Features#compute_resolved defers cleanly to the organization setting even if the org
              # later re-enables raffle.
              tournament_updates[:raffle_enabled] = tournament_input['raffle'].nil? ? true : tournament_input['raffle']
            end

            tournament.update!(tournament_updates)
          end
        end

        render json: features_response(organization.reload)
      rescue ActiveRecord::RecordNotFound => e
        message = e.model == 'Tournament' ? 'Tournament not found' : 'Organization not found'
        render json: { error: message }, status: :not_found
      rescue ActiveRecord::RecordInvalid => e
        render json: { error: e.record.errors.full_messages.join(', '), errors: e.record.errors.full_messages },
               status: :unprocessable_entity
      end

      # PATCH /api/v1/admin/organizations/:slug
      # Admin endpoint - update organization settings
      def update
        organization = Organization.find_by_slug!(params[:slug])
        require_org_admin!(organization)
        return if performed?

        attrs = organization_params.to_h
        if attrs.key?('settings') && attrs['settings'].is_a?(Hash)
          incoming_settings = attrs['settings'].deep_stringify_keys
          # /admin/organizations/:slug/features is the sole owner of settings["features"];
          # strip incoming features so generic settings saves cannot clobber concurrent feature edits.
          incoming_settings.delete('features')
          if organization.settings.is_a?(Hash) && organization.settings.key?('features')
            incoming_settings['features'] = organization.settings['features']
          end
          attrs['settings'] = incoming_settings
        end

        if attrs.key?('offseason_enabled')
          offseason_value = ActiveModel::Type::Boolean.new.cast(attrs['offseason_enabled'])
          current_settings = (attrs['settings'] || organization.settings || {}).deep_dup.deep_stringify_keys
          if current_settings['features'].is_a?(Hash) && current_settings['features'].key?('offseason_mode')
            current_settings['features'] = current_settings['features'].merge('offseason_mode' => offseason_value)
            attrs['settings'] = current_settings
          end
        end

        if organization.update(attrs)
          render json: organization_response(organization)
        else
          render json: { errors: organization.errors.full_messages }, status: :unprocessable_entity
        end
      rescue ActiveRecord::RecordNotFound
        render json: { error: 'Organization not found' }, status: :not_found
      end

      # GET /api/v1/admin/organizations/:slug/tournaments
      # Admin/volunteer endpoint - returns all tournaments with stats
      def admin_tournaments
        organization = Organization.find_by_slug!(params[:slug])
        require_volunteer_or_admin!(organization)
        return if performed?

        loaded = organization.tournaments
                              .left_joins(:golfers)
                              .select(
                                "tournaments.*",
                                "SUM(CASE WHEN golfers.registration_status = 'confirmed' THEN 1 ELSE 0 END) AS confirmed_count",
                                "SUM(CASE WHEN golfers.registration_status = 'confirmed' AND golfers.payment_status != 'paid' AND COALESCE(golfers.payment_type, '') != 'sponsor' THEN 1 ELSE 0 END) AS pending_count",
                                "SUM(CASE WHEN golfers.registration_status = 'confirmed' AND golfers.payment_status = 'paid' AND COALESCE(golfers.payment_type, '') != 'sponsor' THEN 1 ELSE 0 END) AS paying_count",
                                "(SELECT COALESCE(SUM(sponsors.slot_count), 0) / 2 FROM sponsors WHERE sponsors.tournament_id = tournaments.id AND sponsors.active = true) AS sponsor_teams_count"
                              )
                              .group("tournaments.id")
                              .order(event_date: :desc)
                              .to_a

        tournament_data = loaded.map do |t|
          confirmed_count = t.read_attribute(:confirmed_count).to_i
          pending_count = t.read_attribute(:pending_count).to_i
          paying_count = t.read_attribute(:paying_count).to_i
          sponsor_teams = t.read_attribute(:sponsor_teams_count).to_i

          {
            id: t.id,
            name: t.name,
            slug: t.slug,
            date: t.event_date,
            event_type: t.event_type,
            status: t.status,
            registration_count: confirmed_count,
            pending_count: pending_count,
            capacity: t.max_capacity,
            revenue: paying_count * (t.entry_fee || 0),
            sponsor_reserved_teams: sponsor_teams,
            walkin_fee: t.walkin_fee,
            walkin_swipe_simple_url: t.walkin_swipe_simple_url,
            entry_fee_display: t.entry_fee_display,
            raffle_enabled: t.raffle_enabled,
            features: Features.for(organization, t).to_h,
            feature_overrides: Features.for(organization, t).tournament_overrides
          }
        end

        total_revenue = loaded.sum { |t| t.read_attribute(:paying_count).to_i * (t.entry_fee || 0) }
        total_registrations = loaded.sum { |t| t.read_attribute(:confirmed_count).to_i }
        active_count = loaded.count { |t| %w[open in_progress].include?(t.status) }

        stats = {
          total_tournaments: loaded.size,
          active_tournaments: active_count,
          total_registrations: total_registrations,
          total_revenue: total_revenue
        }

        render json: { tournaments: tournament_data, stats: stats }
      rescue ActiveRecord::RecordNotFound
        render json: { error: 'Organization not found' }, status: :not_found
      end

      # GET /api/v1/admin/organizations/:slug/tournaments/:tournament_slug
      # Admin/volunteer endpoint - returns tournament details with all golfers
      def admin_tournament
        organization = Organization.find_by_slug!(params[:slug])
        require_volunteer_or_admin!(organization)
        return if performed?

        tournament = organization.tournaments.includes(:organization, :sponsors).find_by!(slug: params[:tournament_slug])
        golfers = tournament.golfers.includes(:group, :sponsor).order(created_at: :desc).to_a

        hole_labels = bulk_hole_position_labels(tournament.id, golfers)

        counts_by_registration = golfers.group_by(&:registration_status).transform_values(&:count)

        active_golfers = golfers.reject { |g| g.registration_status == 'cancelled' }
        confirmed_golfers = active_golfers.select { |g| g.registration_status == 'confirmed' }
        confirmed_and_paid = confirmed_golfers.count { |g| g.payment_status == 'paid' || g.payment_type == 'sponsor' }
        confirmed_pending = confirmed_golfers.count { |g| g.payment_status != 'paid' && g.payment_type != 'sponsor' }
        confirmed_paid = confirmed_golfers.count { |g| g.payment_status == 'paid' }

        confirmed_count = counts_by_registration.fetch('confirmed', 0)
        sponsor_confirmed = confirmed_golfers.count { |g| g.payment_type == 'sponsor' }
        public_confirmed = confirmed_count - sponsor_confirmed

        # Pre-set stats so TournamentSerializer doesn't fire additional queries
        tournament.instance_variable_set(:@golfer_stats, {
          confirmed: confirmed_count,
          public_confirmed: public_confirmed,
          sponsor_confirmed: sponsor_confirmed,
          paid: confirmed_paid,
          pending_payment: confirmed_pending,
          waitlist: counts_by_registration.fetch('waitlist', 0),
          checked_in: golfers.count { |g| g.checked_in_at.present? }
        })

        stats = {
          total_registrations: active_golfers.count,
          registered: confirmed_count,
          confirmed: confirmed_and_paid,
          pending_payment: confirmed_pending,
          public_confirmed: public_confirmed,
          sponsor_confirmed: sponsor_confirmed,
          waitlisted: counts_by_registration.fetch('waitlist', 0),
          cancelled: counts_by_registration.fetch('cancelled', 0),
          paid: confirmed_paid,
          checked_in: golfers.count { |g| g.checked_in_at.present? },
          revenue: golfers.count { |g| g.payment_status == 'paid' && g.payment_type != 'sponsor' } * (tournament.entry_fee || 0),
          max_capacity: tournament.max_capacity,
          sponsor_reserved_teams: tournament.sponsor_reserved_teams,
          public_capacity: tournament.public_capacity,
          capacity_remaining: tournament.capacity_remaining,
          public_capacity_remaining: tournament.public_capacity_remaining,
          at_capacity: tournament.at_capacity?,
          public_at_capacity: tournament.public_at_capacity?
        }

        render json: {
          tournament: TournamentSerializer.new(tournament).as_json,
          golfers: golfers.map { |g|
            g.as_json(
              only: [:id, :name, :email, :phone, :company, :registration_status,
                     :payment_status, :payment_method, :payment_type, :checked_in_at, :created_at,
                     :paid_at, :payment_verified_by_name, :payment_verified_at,
                     :checked_in_by_name, :payment_notes,
                     :partner_name, :partner_email, :partner_phone,
                     :team_name, :team_category, :registration_source, :group_id,
                     :sponsor_id, :sponsor_name, :notes]
            ).merge(
              "hole_position_label" => hole_labels[g.id],
              "starting_hole_description" => g.group&.starting_hole_description,
              "sponsor_display_name" => g.sponsor_name.presence || g.sponsor&.name
            )
          },
          stats: stats
        }
      rescue ActiveRecord::RecordNotFound
        render json: { error: 'Tournament not found' }, status: :not_found
      end

      # POST /api/v1/admin/organizations/:slug/tournaments
      # Create a new tournament for the organization
      def create_tournament
        organization = Organization.find_by_slug!(params[:slug])
        require_org_admin!(organization)
        return if performed?

        attrs = tournament_params.to_h
        if attrs.key?('course_configs')
          courses = Array(attrs.delete('course_configs')).map(&:to_h)
          attrs['config'] = (attrs['config'] || {}).merge('course_configs' => courses)
          attrs['total_holes'] = courses.sum { |course| course['hole_count'].to_i }
        end
        if attrs.key?('teams_per_start_position')
          attrs['config'] = (attrs['config'] || {}).merge(
            'teams_per_start_position' => attrs.delete('teams_per_start_position').to_i
          )
        end
        if attrs.key?('start_positions_per_hole')
          value = attrs.delete('start_positions_per_hole')
          attrs['config'] = (attrs['config'] || {}).merge(
            'start_positions_per_hole' => value.present? ? value.to_i : nil
          ).compact
        end

        tournament = organization.tournaments.build(attrs)
        
        # Generate slug if not provided
        if tournament.slug.blank?
          base_slug = "#{tournament.name.parameterize}-#{tournament.year}"
          tournament.slug = base_slug
          
          # Ensure uniqueness
          counter = 1
          while organization.tournaments.exists?(slug: tournament.slug)
            tournament.slug = "#{base_slug}-#{counter}"
            counter += 1
          end
        end

        if tournament.save
          render json: {
            tournament: tournament.as_json(
              only: [:id, :name, :slug, :year, :edition, :status, :event_date,
                     :location_name, :entry_fee, :max_capacity, :event_type,
                     :theme_preset, :use_org_branding]
            ),
            message: 'Tournament created successfully'
          }, status: :created
        else
          render json: { error: tournament.errors.full_messages.join(', ') }, status: :unprocessable_entity
        end
      rescue ActiveRecord::RecordNotFound
        render json: { error: 'Organization not found' }, status: :not_found
      end

      # POST /api/v1/admin/organizations/:slug/tournaments/:tournament_slug/golfers
      # Admin endpoint - create a golfer (manual registration)
      def create_golfer
        organization = Organization.find_by_slug!(params[:slug])
        require_org_admin!(organization)
        return if performed?

        tournament = organization.tournaments.find_by!(slug: params[:tournament_slug])
        golfer = tournament.golfers.build(golfer_params)

        if golfer.save
          render json: {
            golfer: golfer.as_json(
              only: [:id, :name, :email, :phone, :company, :registration_status,
                     :payment_status, :payment_method, :notes, :created_at]
            ),
            message: 'Golfer added successfully'
          }, status: :created
        else
          render json: { error: golfer.errors.full_messages.join(', ') }, status: :unprocessable_entity
        end
      rescue ActiveRecord::RecordNotFound
        render json: { error: 'Tournament not found' }, status: :not_found
      end

      # PATCH /api/v1/admin/organizations/:slug/tournaments/:tournament_slug/golfers/:golfer_id
      # Admin endpoint - update a golfer
      def update_golfer
        organization = Organization.find_by_slug!(params[:slug])
        require_org_admin!(organization)
        return if performed?

        tournament = organization.tournaments.find_by!(slug: params[:tournament_slug])
        golfer = tournament.golfers.find(params[:golfer_id])

        if golfer.update(golfer_params)
          render json: {
            golfer: golfer_response(golfer),
            message: 'Golfer updated successfully'
          }
        else
          render json: { error: golfer.errors.full_messages.join(', ') }, status: :unprocessable_entity
        end
      rescue ActiveRecord::RecordNotFound
        render json: { error: 'Golfer not found' }, status: :not_found
      end

      # POST /api/v1/admin/organizations/:slug/tournaments/:tournament_slug/golfers/:golfer_id/cancel
      # Admin endpoint - cancel a golfer's registration
      def cancel_golfer
        organization = Organization.find_by_slug!(params[:slug])
        require_org_admin!(organization)
        return if performed?

        tournament = organization.tournaments.find_by!(slug: params[:tournament_slug])
        golfer = tournament.golfers.find(params[:golfer_id])
        reason = params[:reason]

        if golfer.registration_status == 'cancelled'
          render json: { error: 'Registration already cancelled' }, status: :unprocessable_entity
          return
        end

        old_group = golfer.group

        Golfer.transaction do
          golfer.clear_group_assignment! if old_group.present?
          golfer.cancel!(admin: current_admin, reason: reason)
        end

        if old_group.present?
          begin
            ActivityLog.log(
              admin: current_admin,
              action: 'golfer_removed_from_group',
              target: golfer,
              details: "Removed #{golfer.name} from #{old_group.hole_position_label} (cancelled)"
            )
          rescue StandardError => e
            Rails.logger.error("Failed to log group removal: #{e.message}")
          end
        end

        begin
          ActivityLog.log(
            admin: current_admin,
            action: 'golfer_cancelled',
            target: golfer,
            details: "Cancelled registration for #{golfer.name}",
            metadata: { reason: reason }
          )
        rescue StandardError => e
          Rails.logger.error("Failed to log cancellation activity: #{e.message}")
        end

        begin
          GolferMailer.cancellation_email(golfer).deliver_later
        rescue StandardError => e
          Rails.logger.error("Failed to send cancellation email: #{e.message}")
        end

        broadcast_golfer_update(golfer)

        render json: {
          golfer: golfer_response(golfer),
          message: 'Registration cancelled successfully'
        }
      rescue ActiveRecord::RecordNotFound
        render json: { error: 'Golfer not found' }, status: :not_found
      end

      # POST /api/v1/admin/organizations/:slug/tournaments/:tournament_slug/golfers/:golfer_id/refund
      # Admin endpoint - process refund (Stripe for online payments, manual for cash/check)
      def refund_golfer
        organization = Organization.find_by_slug!(params[:slug])
        require_org_admin!(organization)
        return if performed?

        tournament = organization.tournaments.find_by!(slug: params[:tournament_slug])
        golfer = tournament.golfers.find(params[:golfer_id])

        reason = params[:reason]

        if golfer.payment_type == 'stripe'
          if golfer.refunded?
            render json: { error: 'Already refunded' }, status: :unprocessable_entity
            return
          end

          if golfer.payment_status != 'paid'
            render json: { error: 'Cannot refund unpaid registration' }, status: :unprocessable_entity
            return
          end

          unless golfer.can_refund?
            render json: { error: 'Cannot process Stripe refund for this golfer' }, status: :unprocessable_entity
            return
          end

          old_group = golfer.group

          # Process refund first; only detach group after successful refund
          stripe_refund = golfer.process_refund!(
            admin: current_admin,
            reason: reason,
            clear_group_assignment: old_group.present?
          )

          begin
            ActivityLog.log(
              admin: current_admin,
              action: 'golfer_refunded',
              target: golfer,
              details: "Refunded #{golfer.name} - $#{'%.2f' % (stripe_refund.amount / 100.0)}",
              metadata: { reason: reason, refund_id: stripe_refund.id, amount_cents: stripe_refund.amount }
            )
          rescue StandardError => e
            Rails.logger.error("Failed to log refund activity: #{e.message}")
          end

          begin
            ActionCable.server.broadcast("golfers_channel_#{golfer.tournament_id}", {
              action: 'updated',
              golfer: GolferSerializer.new(golfer).as_json
            })
          rescue StandardError => e
            Rails.logger.error("Failed to broadcast golfer update: #{e.message}")
          end

          render json: {
            golfer: golfer_response(golfer),
            refund: {
              id: stripe_refund.id,
              amount: stripe_refund.amount,
              status: stripe_refund.status
            },
            message: 'Refund recorded successfully'
          }
        else
          response_payload = nil

          golfer.with_lock do
            if golfer.refunded?
              render json: { error: 'Already refunded' }, status: :unprocessable_entity
              return
            end

            if golfer.payment_status != 'paid'
              render json: { error: 'Cannot refund unpaid registration' }, status: :unprocessable_entity
              return
            end

            old_group = golfer.group
            golfer.clear_group_assignment! if old_group.present?

            refund_amount = params[:refund_amount_cents] || golfer.payment_amount_cents || golfer.tournament&.entry_fee

            golfer.update!(
              registration_status: 'cancelled',
              payment_status: 'refunded',
              refund_amount_cents: refund_amount,
              refund_reason: reason,
              refunded_at: Time.current,
              refunded_by: current_admin
            )

            response_payload = {
              golfer: golfer_response(golfer),
              message: 'Refund recorded successfully'
            }
          end

          begin
            GolferMailer.refund_confirmation_email(golfer).deliver_later
          rescue StandardError => e
            Rails.logger.error("Failed to send refund email: #{e.message}")
          end

          begin
            ActivityLog.log(
              admin: current_admin,
              action: 'golfer_refunded',
              target: golfer,
              details: "Marked #{golfer.name} as refunded (manual) - $#{'%.2f' % (golfer.refund_amount_cents.to_i / 100.0)}",
              metadata: { reason: reason, amount_cents: golfer.refund_amount_cents }
            )
          rescue StandardError => e
            Rails.logger.error("Failed to log manual refund activity: #{e.message}")
          end

          begin
            ActionCable.server.broadcast("golfers_channel_#{golfer.tournament_id}", {
              action: 'updated',
              golfer: GolferSerializer.new(golfer).as_json
            })
          rescue StandardError => e
            Rails.logger.error("Failed to broadcast golfer update: #{e.message}")
          end

          render json: response_payload
        end
      rescue Stripe::StripeError => e
        Rails.logger.error("Stripe refund error: #{e.message}")
        render json: { error: "Stripe refund failed: #{e.message}" }, status: :unprocessable_entity
      rescue RuntimeError => e
        Rails.logger.error("Refund runtime error: #{e.message}")
        render json: { error: e.message }, status: :unprocessable_entity
      rescue ActiveRecord::RecordNotFound
        render json: { error: 'Golfer not found' }, status: :not_found
      rescue ActiveRecord::RecordInvalid => e
        Rails.logger.error("Refund database error: #{e.message}")
        render json: { error: "Failed to update golfer record: #{e.message}" }, status: :unprocessable_entity
      end

      # GET /api/v1/admin/organizations/:slug/members
      def members
        org = Organization.find_by!(slug: params[:slug])
        require_org_admin!(org)
        return if performed?

        memberships = org.organization_memberships.includes(:user).order(created_at: :asc)

        render json: {
          members: memberships.map { |m| member_response(m) }
        }
      end

      # POST /api/v1/admin/organizations/:slug/members
      def add_member
        org = Organization.find_by!(slug: params[:slug])
        require_org_admin!(org)
        return if performed?

        email = params[:email]&.strip&.downcase

        unless email.present?
          return render json: { error: "Email is required" }, status: :unprocessable_entity
        end

        user = User.where('LOWER(email) = LOWER(?)', email).first

        unless user
          user = User.create!(
            email: email,
            clerk_id: "pending_#{Digest::SHA256.hexdigest(email)[0..23]}",
            role: 'org_admin'
          )
        end

        existing = org.organization_memberships.find_by(user: user)
        if existing
          return render json: { error: "This user is already a member of this organization." }, status: :unprocessable_entity
        end

        role = params[:role].presence || 'admin'
        unless OrganizationMembership::ROLES.include?(role)
          return render json: { error: "Invalid role: #{role}" }, status: :unprocessable_entity
        end
        membership = org.organization_memberships.create!(user: user, role: role)

        SendUserInviteEmailJob.perform_later(user.id, current_user&.id, role, org.id)

        render json: {
          member: member_response(membership),
          invitation_sent: true
        }, status: :created
      end

      # POST /api/v1/admin/organizations/:slug/members/:member_id/resend_invite
      def resend_invite
        org = Organization.find_by!(slug: params[:slug])
        require_org_admin!(org)
        return if performed?

        membership = org.organization_memberships.find(params[:member_id])
        user = membership.user

        unless user.clerk_id&.start_with?('pending_')
          return render json: { error: "This user has already accepted their invitation." }, status: :unprocessable_entity
        end

        SendUserInviteEmailJob.perform_later(user.id, current_user&.id, membership.role, org.id)

        render json: { message: "Invitation email queued for #{user.email}" }
      end

      # PATCH /api/v1/admin/organizations/:slug/members/:member_id
      def update_member
        org = Organization.find_by!(slug: params[:slug])
        require_org_admin!(org)
        return if performed?

        membership = org.organization_memberships.find(params[:member_id])

        unless OrganizationMembership::ROLES.include?(params[:role])
          return render json: { error: "Invalid role" }, status: :unprocessable_entity
        end

        # Don't let the last admin demote themselves
        if membership.admin? && params[:role] != 'admin' && org.organization_memberships.admins.count <= 1
          return render json: { error: "Cannot demote the last admin" }, status: :unprocessable_entity
        end

        membership.update!(role: params[:role])
        render json: { member: member_response(membership) }
      end

      # DELETE /api/v1/admin/organizations/:slug/members/:member_id
      def remove_member
        org = Organization.find_by!(slug: params[:slug])
        require_org_admin!(org)
        return if performed?

        membership = org.organization_memberships.find(params[:member_id])

        # Don't let the last admin remove themselves
        if membership.admin? && org.organization_memberships.admins.count <= 1
          return render json: { error: "Cannot remove the last admin" }, status: :unprocessable_entity
        end

        membership.destroy!
        render json: { success: true }
      end

      private

      # Compute hole position labels for all golfers in one query instead of 2 per golfer
      def bulk_hole_position_labels(tournament_id, golfers)
        groups_by_id = {}
        golfers.each do |g|
          groups_by_id[g.group_id] = g.group if g.group
        end
        return {} if groups_by_id.empty?

        tournament = Tournament.find(tournament_id)

        groups_by_hole = Group.where(tournament_id: tournament_id)
                              .where.not(hole_number: nil)
                              .order(:group_number)
                              .group_by { |group| [group.starting_course_key, group.hole_number] }

        golfers.each_with_object({}) do |g, labels|
          grp = groups_by_id[g.group_id]
          next labels[g.id] = nil unless grp
          next labels[g.id] = "Unassigned" unless grp.assigned_start?

          hole_groups = groups_by_hole[[grp.starting_course_key, grp.hole_number]] || []
          idx = hole_groups.index { |hg| hg.id == grp.id }
          letter = idx ? ('A'..'Z').to_a[idx] || 'X' : 'X'
          prefix = tournament.starting_position_prefix(grp.starting_course_key)
          labels[g.id] = [prefix, "#{grp.hole_number}#{letter}"].compact.join(' ')
        end
      end

      def member_response(membership)
        user = membership.user
        {
          id: membership.id,
          user_id: user.id,
          name: user.name || user.email,
          email: user.email,
          role: membership.role,
          invitation_pending: user.clerk_id&.start_with?('pending_') || false,
          created_at: membership.created_at
        }
      end

      def golfer_response(golfer)
        golfer.as_json(
          only: [:id, :name, :email, :phone, :company, :registration_status,
                 :payment_status, :payment_method, :payment_type, :notes, 
                 :checked_in_at, :created_at, :updated_at]
        )
      end

      def broadcast_golfer_update(golfer)
        ActionCable.server.broadcast("golfers_channel_#{golfer.tournament_id}", {
          action: 'updated',
          golfer: GolferSerializer.new(golfer).as_json
        })
      rescue StandardError => e
        Rails.logger.error("Failed to broadcast golfer update: #{e.message}")
      end

      def golfer_params
        params.require(:golfer).permit(
          :name, :email, :phone, :mobile, :company, :address,
          :payment_type, :payment_status, :payment_method,
          :registration_status, :registration_source, :notes, :waiver_accepted_at,
          :is_team_captain,
          :partner_name, :partner_email, :partner_phone, :team_category
        )
      end

      def tournament_params
        params.require(:tournament).permit(
          :name, :year, :edition, :event_type, :status, :slug,
          :event_date, :registration_time, :start_time, :check_in_time,
          :location_name, :location_address,
          :tournament_format, :scoring_type, :team_size, :teams_per_start_position, :start_positions_per_hole, :shotgun_start,
          :max_capacity, :reserved_slots, :waitlist_enabled, :waitlist_max,
          :entry_fee, :early_bird_fee, :early_bird_deadline,
          :allow_cash, :allow_check, :allow_card, :checks_payable_to, :payment_instructions,
          :registration_deadline,
          :contact_name, :contact_phone, :fee_includes, :tournament_info,
          :walkin_fee, :walkin_registration_open,
          :theme_preset, :use_org_branding,
          course_configs: [:key, :name, :hole_count]
        )
      end

      def organization_params
        params.require(:organization).permit(
          :name, :slug, :description, :logo_url, :primary_color,
          :banner_url, :contact_email, :contact_phone, :website_url,
          :sms_sender_id,
          :offseason_enabled, :offseason_title, :offseason_message,
          :offseason_cta_label, :offseason_cta_url,
          settings: {}
        )
      end

      def domain_params
        params.require(:domain).permit(:hostname, :is_primary, :verified_at)
      end

      def domain_response(domain)
        {
          id: domain.id,
          hostname: domain.hostname,
          is_primary: domain.is_primary,
          verified_at: domain.verified_at,
          created_at: domain.created_at,
          updated_at: domain.updated_at
        }
      end

      def organization_response(org)
        domains = org.organization_domains.primary_first
        {
          id: org.id,
          name: org.name,
          slug: org.slug,
          description: org.description,
          logo_url: org.logo_url,
          primary_color: org.primary_color,
          banner_url: org.banner_url,
          contact_email: org.contact_email,
          contact_phone: org.contact_phone,
          website_url: org.website_url,
          sms_sender_id: org.sms_sender_id,
          primary_host: domains.first&.hostname,
          domains: domains.map { |d| domain_response(d) },
          offseason_enabled: org.offseason_enabled,
          offseason_title: org.offseason_title,
          offseason_message: org.offseason_message,
          offseason_cta_label: org.offseason_cta_label,
          offseason_cta_url: org.offseason_cta_url,
          settings: org.settings || {},
          features: Features.for(org).to_h,
          feature_overrides: Features.for(org).organization_overrides,
          subscription_status: org.subscription_status,
          tournament_count: org.tournament_count,
          admin_count: org.admin_count,
          created_at: org.created_at,
          updated_at: org.updated_at
        }
      end

      def normalize_feature_input(raw)
        return nil if raw.nil?
        return :invalid unless raw.is_a?(ActionController::Parameters) || raw.is_a?(Hash)

        raw.keys.each_with_object({}) do |key, acc|
          val = raw[key]
          acc[key.to_s] = case val
                          when true, "true" then true
                          when false, "false" then false
                          when nil, "" then nil
                          else val
                          end
        end
      end

      def features_response(organization)
        org_features = Features.for(organization)
        tournaments = organization.tournaments.order(year: :desc, created_at: :desc)

        {
          catalog: GolfFeaturesCatalog.as_json,
          organization: {
            id: organization.id,
            name: organization.name,
            slug: organization.slug,
            offseason_enabled: organization.offseason_enabled,
            features: org_features.to_h,
            feature_overrides: org_features.organization_overrides
          },
          tournaments: tournaments.map do |tournament|
            t_features = Features.for(organization, tournament)
            {
              id: tournament.id,
              name: tournament.name,
              slug: tournament.slug,
              year: tournament.year,
              status: tournament.status,
              raffle_enabled: tournament.raffle_enabled,
              features: t_features.to_h,
              feature_overrides: t_features.tournament_overrides
            }
          end
        }
      end
    end
  end
end
