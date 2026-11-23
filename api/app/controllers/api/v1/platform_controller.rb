# frozen_string_literal: true

require "digest"

module Api
  module V1
    class PlatformController < BaseController
      before_action :require_super_admin!
      skip_around_action :with_tenant_rls_context

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

          latest_settlements_by_tournament = TournamentSettlement.order(version: :desc)
                                                                 .to_a
                                                                 .uniq(&:tournament_id)
                                                                 .index_by(&:tournament_id)

          payouts_paid_by_tournament = TournamentPayout.where(status: "paid")
                                                       .group(:tournament_id)
                                                       .sum(:amount_cents)

          paid_gross_by_tournament = Golfer.where(registration_status: "confirmed", payment_status: "paid")
                                           .group(:tournament_id)
                                           .sum(:payment_amount_cents)

          settlements_rows = []
          org_rows = orgs.map do |org|
            payment_config = org.effective_payment_config
            tournaments = org.tournaments.sort_by { |t| [t.event_date || Date.new(1970, 1, 1), t.id] }.reverse
            active_tournaments = tournaments.select { |t| %w[open in_progress].include?(t.status) }
            domains = org.organization_domains.primary_first
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
                gross = s ? s.gross_cents : paid_gross_by_tournament.fetch(t.id, 0)
                proc_fee = s ? s.processing_fee_cents : 0
                plat_fee = s ? s.platform_fee_cents : 0
                net = s ? s.net_cents : gross
                proceeds = s ? s.organizer_proceeds_cents : (gross - proc_fee - plat_fee)
                paid = s ? s.paid_cents : payouts_paid_by_tournament.fetch(t.id, 0)
                balance = s ? s.payable_cents : [proceeds - paid, 0].max

                settlements_rows << {
                  organization_id: org.id,
                  organization_name: org.name,
                  organization_slug: org.slug,
                  tournament_id: t.id,
                  tournament_name: t.name,
                  tournament_slug: t.slug,
                  tournament_status: t.status,
                  settlement_status: s ? s.status : "uncalculated",
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

          {
            summary: {
              total_orgs: org_rows.size,
              active_orgs: org_rows.count { |o| o[:status] == "active" },
              offseason_orgs: org_rows.count { |o| o[:status] == "offseason" },
              archived_orgs: org_rows.count { |o| o[:status] == "archived" },
              active_tournaments: org_rows.sum { |o| o[:active_tournament_count] },
              total_confirmed_golfers: org_rows.sum { |o| o[:confirmed_golfers_count] },
              pending_payouts_cents: settlements_rows.sum { |s| [s[:balance_due_cents], 0].max },
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
        theme_preset = raw[:theme_preset].to_s.strip.presence
        raw_features = raw[:features].respond_to?(:to_unsafe_h) ? raw[:features].to_unsafe_h : raw[:features]
        feature_overrides = normalize_feature_overrides(raw_features)
        if feature_overrides == :invalid
          return render json: { errors: ["Features must be a JSON object of booleans"] }, status: :unprocessable_entity
        end

        if feature_overrides.any?
          feature_errors = GolfFeaturesCatalog.validate_overrides(feature_overrides, scope: :organization)
          return render json: { errors: feature_errors }, status: :unprocessable_entity if feature_errors.any?
        end

        settings = {}
        settings["accent_color"] = accent_color if accent_color
        settings["theme_preset"] = theme_preset if theme_preset
        settings["features"] = feature_overrides if feature_overrides.any?

        homepage_config = raw.key?(:homepage_config) ? raw[:homepage_config].as_json : {}
        primary_domain_host = raw[:primary_domain].to_s.strip.presence
        admin_emails = Array(raw[:admin_emails])
                         .flat_map { |e| e.to_s.split(/[\s,;]+/) }
                         .map { |e| e.strip.downcase }
                         .reject(&:blank?)
                         .uniq

        payment_raw = raw[:payment_config].respond_to?(:permit) ? raw[:payment_config].permit(
          :payment_mode, :processor_provider, :platform_fee_per_registrant_cents, :payout_payee_name, :test_mode
        ).to_h : {}

        created_org = nil
        TenantContext.with_platform_access do
          ActiveRecord::Base.transaction(requires_new: true) do
            org = Organization.new(org_attrs.merge(settings: settings, homepage_config: homepage_config))
            org.offseason_enabled = true if feature_overrides["offseason_mode"] == true
            org.save!

            if primary_domain_host.present?
              org.organization_domains.create!(hostname: primary_domain_host, is_primary: true)
            end

            if payment_raw.present?
              pc = org.build_organization_payment_config(payment_raw)
              pc.save!
            end

            admin_emails.each do |email|
              user = User.find_by("LOWER(email) = ?", email) || User.create!(
                email: email,
                clerk_id: "pending_#{Digest::SHA256.hexdigest(email)[0..23]}",
                role: "org_admin"
              )
              org.add_admin(user)
            end

            created_org = org
          end
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

        updated = nil
        TenantContext.with_platform_access do
          org = Organization.find_by_slug!(params[:slug])

          ActiveRecord::Base.transaction(requires_new: true) do
            if requested_status
              case requested_status
              when "active"
                org.subscription_status = "active"
                org.offseason_enabled = false
              when "offseason"
                org.subscription_status = "active"
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

            if raw[:payment_config].present?
              pc_params = raw[:payment_config].permit(
                :payment_mode, :processor_provider, :platform_fee_per_registrant_cents, :payout_payee_name
              ).to_h
              pc = org.organization_payment_config || org.build_organization_payment_config
              pc.update!(pc_params)
            end

            updated = org
          end
        end

        render json: {
          organization: {
            id: updated.id,
            slug: updated.slug,
            status: derive_org_status(updated),
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
