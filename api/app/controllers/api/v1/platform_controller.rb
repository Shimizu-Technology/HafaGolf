# frozen_string_literal: true

require "digest"
require "uri"

module Api
  module V1
    class PlatformController < BaseController
      before_action :require_super_admin!
      skip_around_action :with_tenant_rls_context

      HEX_COLOR_REGEX = /\A#[0-9A-Fa-f]{6}\z/
      THEME_PRESET_REGEX = /\A[a-z0-9_-]{1,50}\z/

      # GET /api/v1/admin/platform/overview
      def overview
        payload = TenantContext.with_platform_access do
          orgs = Organization.includes(
            :organization_domains,
            :organization_payment_config,
            :tournaments,
            organization_memberships: :user
          ).order(:name).to_a

          confirmed_by_org = Golfer.joins(:tournament)
                                   .where(registration_status: "confirmed")
                                   .group("tournaments.organization_id")
                                   .count

          latest_settlements_by_tournament = TournamentSettlement
                                               .select("DISTINCT ON (tournament_id) *")
                                               .order(:tournament_id, version: :desc)
                                               .index_by(&:tournament_id)

          payouts_paid_by_tournament = TournamentPayout.where(status: "paid")
                                                       .group(:tournament_id)
                                                       .sum(:amount_cents)

          settlements_rows = []
          org_rows = orgs.map do |org|
            payment_config = org.effective_payment_config
            tournaments = org.tournaments.sort_by { |t| [t.event_date || Date.new(1970, 1, 1), t.id] }.reverse
            active_tournaments = tournaments.select { |t| %w[open in_progress].include?(t.status) }
            # Sort preloaded domains in memory to avoid per-org N+1 queries
            domains = org.organization_domains.sort_by { |d| [d.is_primary ? 0 : 1, d.hostname.to_s] }
            admins = org.organization_memberships.select { |m| %w[admin org_admin].include?(m.role) }.map do |m|
              {
                id: m.id,
                user_id: m.user_id,
                email: m.user&.email,
                name: m.user&.name,
                role: m.role
              }
            end

            if payment_config.platform_collect?
              tournaments.each do |t|
                s = latest_settlements_by_tournament[t.id]
                if s
                  gross = s.gross_cents
                  proc_fee = s.processing_fee_cents
                  plat_fee = s.platform_fee_cents
                  net = s.net_cents
                  proceeds = s.organizer_proceeds_cents
                  paid = s.paid_cents
                  balance = s.payable_cents
                  settlement_status = s.status
                else
                  calc = Settlements::Calculator.call(t)
                  # Skip unlaunched/cancelled tournaments with zero platform-collected volume
                  next if %w[draft cancelled].include?(t.status) && calc.gross_cents.zero? && calc.refund_cents.zero?

                  gross = calc.gross_cents
                  proc_fee = calc.processing_fee_cents
                  plat_fee = calc.platform_fee_cents
                  net = calc.net_cents
                  proceeds = calc.organizer_proceeds_cents
                  paid = payouts_paid_by_tournament.fetch(t.id, 0)
                  balance = [proceeds - paid, 0].max
                  settlement_status = "uncalculated"
                end

                settlements_rows << {
                  organization_id: org.id,
                  organization_name: org.name,
                  organization_slug: org.slug,
                  tournament_id: t.id,
                  tournament_name: t.name,
                  tournament_slug: t.slug,
                  tournament_status: t.status,
                  settlement_status: settlement_status,
                  gross_cents: gross,
                  processing_fee_cents: proc_fee,
                  platform_fee_cents: plat_fee,
                  net_cents: net,
                  organizer_proceeds_cents: proceeds,
                  paid_cents: paid,
                  balance_due_cents: balance,
                  calculated_at: s&.calculated_at&.iso8601
                }
              end
            end

            org_features = Features.for(org)
            {
              id: org.id,
              name: org.name,
              slug: org.slug,
              status: derive_org_status(org),
              subscription_status: org.subscription_status,
              offseason_enabled: org.offseason_enabled,
              primary_color: org.primary_color,
              accent_color: org.settings&.dig("accent_color"),
              logo_url: org.logo_url,
              reversed_logo_url: org.reversed_logo_url,
              contact_email: org.contact_email,
              website_url: org.website_url,
              primary_host: domains.first&.hostname,
              domains: domains.map { |d| { id: d.id, hostname: d.hostname, is_primary: d.is_primary, verified_at: d.verified_at } },
              homepage_config: org.homepage_config || {},
              features: org_features.to_h,
              feature_overrides: org_features.organization_overrides,
              payment_mode: payment_config.payment_mode,
              processor_provider: payment_config.processor_provider,
              platform_fee_per_registrant_cents: payment_config.platform_fee_per_registrant_cents,
              payout_payee_name: payment_config.payout_payee_name,
              tournament_count: tournaments.size,
              active_tournament_count: active_tournaments.size,
              confirmed_golfers_count: confirmed_by_org.fetch(org.id, 0),
              latest_tournament_slug: (active_tournaments.first || tournaments.first)&.slug,
              admins: admins,
              created_at: org.created_at&.iso8601
            }
          end

          finalized_pending_cents = settlements_rows
                                      .select { |s| s[:settlement_status] == "finalized" }
                                      .sum { |s| [s[:balance_due_cents], 0].max }
          estimated_pending_cents = settlements_rows.sum { |s| [s[:balance_due_cents], 0].max }

          {
            summary: {
              total_orgs: org_rows.size,
              active_orgs: org_rows.count { |o| o[:status] == "active" },
              offseason_orgs: org_rows.count { |o| o[:status] == "offseason" },
              archived_orgs: org_rows.count { |o| o[:status] == "archived" },
              active_tournaments: org_rows.sum { |o| o[:active_tournament_count] },
              total_confirmed_golfers: org_rows.sum { |o| o[:confirmed_golfers_count] },
              pending_payouts_cents: finalized_pending_cents,
              estimated_pending_payouts_cents: estimated_pending_cents,
              platform_collect_org_count: org_rows.count { |o| o[:payment_mode] == "platform_collect" }
            },
            feature_catalog: GolfFeaturesCatalog.as_json,
            organizations: org_rows,
            settlements: settlements_rows
          }
        end

        render json: payload
      end

      # POST /api/v1/admin/platform/organizations
      # Guided 5-step Super Admin onboarding wizard endpoint.
      def create_organization
        raw = params.require(:organization)
        org_attrs = raw.except(:homepage_config, :features, :admin_emails, :payment_config, :primary_domain).permit(
          :name, :slug, :primary_color, :logo_url, :reversed_logo_url,
          :contact_email, :contact_phone, :website_url, :description,
          :offseason_enabled
        ).to_h

        accent_color = raw[:accent_color].to_s.strip.presence
        if accent_color && !accent_color.match?(HEX_COLOR_REGEX)
          return render json: { errors: ["Accent color must be a valid 6-digit hex color (e.g. #C5A059)"] }, status: :unprocessable_entity
        end

        theme_preset = raw[:theme_preset].to_s.strip.presence
        if theme_preset && !theme_preset.match?(THEME_PRESET_REGEX)
          return render json: { errors: ["Theme preset must be a valid slug identifier"] }, status: :unprocessable_entity
        end

        raw_features = raw[:features].respond_to?(:to_unsafe_h) ? raw[:features].to_unsafe_h : raw[:features]
        feature_overrides = normalize_feature_overrides(raw_features)
        if feature_overrides == :invalid
          return render json: { errors: ["Features must be a JSON object of booleans"] }, status: :unprocessable_entity
        end
        feature_overrides = feature_overrides.compact

        if feature_overrides.any?
          feature_errors = GolfFeaturesCatalog.validate_overrides(feature_overrides, scope: :organization)
          return render json: { errors: feature_errors }, status: :unprocessable_entity if feature_errors.any?
        end

        if org_attrs.key?("offseason_enabled") && feature_overrides.key?("offseason_mode")
          offseason_attr = ActiveModel::Type::Boolean.new.cast(org_attrs["offseason_enabled"])
          if offseason_attr != feature_overrides["offseason_mode"]
            return render json: { errors: ["offseason_enabled conflicts with features.offseason_mode"] }, status: :unprocessable_entity
          end
        end

        payment_raw = extract_payment_config_params(raw[:payment_config], allow_test_mode: true)
        if payment_raw == :invalid
          return render json: { errors: ["payment_config must be a JSON object"] }, status: :unprocessable_entity
        end
        if payment_raw.present? && payment_raw["payment_mode"].to_s.strip.downcase != "platform_collect"
          payment_raw.delete("platform_fee_per_registrant_cents")
        end

        admin_emails = Array(raw[:admin_emails])
                         .flat_map { |e| e.to_s.split(/[\s,;]+/) }
                         .map { |e| e.strip.downcase }
                         .reject(&:blank?)
                         .uniq

        invalid_emails = admin_emails.reject { |e| e.match?(URI::MailTo::EMAIL_REGEXP) }
        if invalid_emails.any?
          return render json: { errors: ["Invalid admin email address(es): #{invalid_emails.join(', ')}"] }, status: :unprocessable_entity
        end

        settings = {}
        settings["accent_color"] = accent_color if accent_color
        settings["theme_preset"] = theme_preset if theme_preset
        settings["features"] = feature_overrides if feature_overrides.any?

        homepage_config = raw.key?(:homepage_config) ? raw[:homepage_config].as_json : {}
        primary_domain_host = raw[:primary_domain].to_s.strip.presence

        created_org = nil
        invited_users = []

        TenantContext.with_platform_access do
          ActiveRecord::Base.transaction(requires_new: true) do
            org = Organization.new(org_attrs.merge(settings: settings, homepage_config: homepage_config))
            org.offseason_enabled = feature_overrides["offseason_mode"] if feature_overrides.key?("offseason_mode")
            org.save!

            if primary_domain_host.present?
              org.organization_domains.create!(hostname: primary_domain_host, is_primary: true)
            end

            if payment_raw.present?
              pc = org.build_organization_payment_config(payment_raw)
              pc.save!
            end

            admin_emails.each do |email|
              user = User.find_by("LOWER(email) = ?", email)
              unless user
                user = User.create!(
                  email: email,
                  clerk_id: "pending_#{Digest::SHA256.hexdigest(email)[0..23]}",
                  role: "org_admin"
                )
              end
              org.add_admin(user)
              invited_users << user if user.clerk_id&.start_with?("pending_")
            end

            ActivityLog.log(
              admin: current_user,
              action: "organization_created",
              target: org,
              organization: org,
              details: "Created organization #{org.name} (#{org.slug}) via Platform Console",
              metadata: {
                primary_domain: primary_domain_host,
                payment_mode: payment_raw["payment_mode"],
                admin_count: admin_emails.size
              }
            )

            created_org = org
          end
        end

        invited_users.each do |user|
          SendUserInviteEmailJob.perform_later(user.id, current_user&.id, "admin", created_org.id)
        end

        render json: { organization: { id: created_org.id, name: created_org.name, slug: created_org.slug } }, status: :created
      rescue ActiveRecord::RecordInvalid => e
        render json: { errors: e.record.errors.full_messages }, status: :unprocessable_entity
      rescue ActiveRecord::RecordNotUnique
        render json: { errors: ["Organization slug, custom domain, or admin email is already in use."] }, status: :unprocessable_entity
      end

      # PATCH /api/v1/admin/platform/organizations/:slug
      # Per-Org Control Panel updates (status, features, payment_mode, homepage_config).
      def update_organization
        raw = params.require(:organization)

        requested_status = nil
        if raw.key?(:status)
          requested_status = raw[:status].to_s.strip.downcase
          unless %w[active offseason archived].include?(requested_status)
            return render json: { errors: ["status must be active, offseason, or archived"] }, status: :unprocessable_entity
          end
        end

        feature_overrides = nil
        if raw.key?(:features)
          raw_features = raw[:features].respond_to?(:to_unsafe_h) ? raw[:features].to_unsafe_h : raw[:features]
          feature_overrides = normalize_feature_overrides(raw_features)
          if feature_overrides == :invalid
            return render json: { errors: ["Features must be a JSON object"] }, status: :unprocessable_entity
          end

          feature_errors = GolfFeaturesCatalog.validate_overrides(feature_overrides, scope: :organization)
          return render json: { errors: feature_errors }, status: :unprocessable_entity if feature_errors.any?
        end

        if requested_status && feature_overrides&.key?("offseason_mode") && !feature_overrides["offseason_mode"].nil?
          expected_offseason = requested_status == "offseason"
          if feature_overrides["offseason_mode"] != expected_offseason
            return render json: { errors: ["status '#{requested_status}' conflicts with features.offseason_mode=#{feature_overrides['offseason_mode']}"] }, status: :unprocessable_entity
          end
        end

        pc_params = nil
        if raw.key?(:payment_config) && !raw[:payment_config].nil?
          pc_params = extract_payment_config_params(raw[:payment_config], allow_test_mode: false)
          if pc_params == :invalid
            return render json: { errors: ["payment_config must be a JSON object"] }, status: :unprocessable_entity
          end
        end

        updated = nil
        TenantContext.with_platform_access do
          org = Organization.find_by_slug!(params[:slug])

          ActiveRecord::Base.transaction(requires_new: true) do
            if requested_status
              case requested_status
              when "active"
                org.subscription_status = "active" if org.subscription_status == "canceled"
                org.offseason_enabled = false
              when "offseason"
                org.subscription_status = "active" if org.subscription_status == "canceled"
                org.offseason_enabled = true
              when "archived"
                org.subscription_status = "canceled"
                org.offseason_enabled = false
              end
            end

            if raw.key?(:homepage_config)
              org.homepage_config = raw[:homepage_config].as_json
            end

            if feature_overrides
              next_settings = (org.settings || {}).deep_dup.deep_stringify_keys
              merged_features = (next_settings["features"] || {}).merge(feature_overrides).compact
              next_settings["features"] = merged_features
              org.settings = next_settings
              org.offseason_enabled = feature_overrides["offseason_mode"] if feature_overrides.key?("offseason_mode") && !feature_overrides["offseason_mode"].nil?
            elsif requested_status
              next_settings = (org.settings || {}).deep_dup.deep_stringify_keys
              if next_settings["features"].is_a?(Hash) && next_settings["features"].key?("offseason_mode")
                next_settings["features"] = next_settings["features"].merge("offseason_mode" => org.offseason_enabled)
                org.settings = next_settings
              end
            end

            org.save!

            if pc_params.present?
              pc = org.organization_payment_config || org.build_organization_payment_config
              target_mode = (pc_params["payment_mode"].presence || pc.payment_mode || "offline").to_s.strip.downcase
              update_attrs = pc_params.dup
              if target_mode != "client_processor"
                update_attrs.merge!(OrganizationPaymentConfig.clear_client_credentials_attrs)
              end
              pc.update!(update_attrs)
            end

            ActivityLog.log(
              admin: current_user,
              action: "settings_updated",
              target: org,
              organization: org,
              details: "Updated organization #{org.slug} via Platform Console",
              metadata: {
                status: derive_org_status(org),
                subscription_status: org.subscription_status,
                features_changed: feature_overrides&.keys,
                payment_mode: pc_params&.dig("payment_mode"),
                homepage_config_updated: raw.key?(:homepage_config)
              }.compact
            )

            updated = org
          end
        end

        render json: {
          organization: {
            id: updated.id,
            slug: updated.slug,
            status: derive_org_status(updated),
            subscription_status: updated.subscription_status,
            offseason_enabled: updated.offseason_enabled,
            features: Features.for(updated).to_h,
            payment_mode: updated.effective_payment_config.payment_mode,
            homepage_config: updated.homepage_config || {}
          }
        }
      rescue ActiveRecord::RecordNotFound
        render json: { error: "Organization not found" }, status: :not_found
      rescue ActiveRecord::RecordInvalid => e
        render json: { errors: e.record.errors.full_messages }, status: :unprocessable_entity
      end

      private

      def derive_org_status(org)
        return "archived" if org.subscription_status == "canceled"
        return "offseason" if org.offseason_enabled?

        "active"
      end

      def extract_payment_config_params(raw_pc, allow_test_mode:)
        return {} if raw_pc.nil?

        allowed = %i[payment_mode processor_provider platform_fee_per_registrant_cents payout_payee_name]
        allowed << :test_mode if allow_test_mode

        if raw_pc.is_a?(ActionController::Parameters)
          raw_pc.permit(*allowed).to_h
        elsif raw_pc.is_a?(Hash)
          ActionController::Parameters.new(raw_pc).permit(*allowed).to_h
        else
          :invalid
        end
      end

      def normalize_feature_overrides(raw)
        return {} if raw.nil?
        return :invalid unless raw.is_a?(Hash)

        raw.each_with_object({}) do |(k, v), acc|
          acc[k.to_s] = case v
                        when true, "true" then true
                        when false, "false" then false
                        when nil, "" then nil
                        else v
                        end
        end
      end
    end
  end
end
