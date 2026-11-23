# frozen_string_literal: true

require "digest"
require_relative "database_guard"
require_relative "verifier"
require_relative "source_reader"
require_relative "backfill"
require_relative "legacy_assets"

module HafagolfMigrations
  # Idempotent, re-runnable GIAA Memorial Golf importer.
  # Synthesizes the GIAA organization (`memorial-formal` theme pack, `platform_collect`
  # payment mode — NEVER copying plaintext Stripe keys from legacy `settings`),
  # deduplicates admins by LOWER(email), maps individual golfers + employee numbers,
  # tags historical Stripe charges with `stripe_account_origin = "legacy_giaa"`, and
  # verifies exact row counts & cent-exact financial sums.
  class GiaaImporter
    include Backfill

    LEGACY_SOURCE = "giaa"
    ORG_SLUG = "giaa"
    PRIMARY_HOST = "giaa-tournament.com"

    def initialize(source_reader:, expected_db_name: ENV["EXPECTED_DB_NAME"],
                   brand_assets_dir: ENV["LEGACY_BRAND_ASSETS_DIR"], asset_host: ENV["ASSET_HOST"] || ENV["API_URL"])
      @source = source_reader
      @expected_db_name = expected_db_name
      @asset_options = { brand_assets_dir: brand_assets_dir, asset_host: asset_host }
    end

    def run!
      DatabaseGuard.verify!(expected_db_name: @expected_db_name)
      DatabaseGuard.verify_source_distinct!(source_db_name: @source.database_name)
      @source.require_non_empty_tables!("tournaments", "golfers")

      report = nil
      TenantContext.with_platform_access do
        ActiveRecord::Base.transaction(requires_new: true) do
          lock_destination!
          settings = @source.rows("settings").first || {}
          org = import_organization!(settings)
          import_domains!(org)
          import_payment_config!(org)
          admin_map = import_admins!(org)
          tournament_map = import_tournaments!(org, settings)
          group_map = import_groups!(tournament_map)
          golfer_map = import_golfers!(org, tournament_map, group_map)
          import_employee_numbers!(org, tournament_map, golfer_map)
          import_activity_logs!(org, tournament_map, admin_map)

          report = verify_import!(org, tournament_map)
          import_brand_assets!(org, tournament_map.values)
        end
      end

      report
    end

    private

    def import_organization!(settings)
      org = Organization.find_or_initialize_by(slug: ORG_SLUG)
      attrs = organization_brand_attributes(settings).merge(
        "name" => settings["organization_name"].presence || "GIAA Memorial Golf Tournament",
        "description" => "Annual Memorial Golf Classic",
        "primary_color" => "#1B365D",
        "contact_email" => settings["contact_email"].presence,
        "contact_phone" => settings["contact_phone"].presence,
        "website_url" => "https://#{PRIMARY_HOST}",
        "subscription_status" => "active"
      )
      assign_backfill(org, attrs)
      defaults = {
        "secondary_color" => "#0F223D",
        "accent_color" => "#C5A059",
        "features" => {
          "employee_pricing" => true,
          "checkin_alpha_lanes" => true,
          "waitlist" => true,
          "raffle" => false,
          "scoring" => false,
          "live_leaderboard" => false
        }
      }
      org.settings = merge_missing_json(defaults, org.settings || {})
      org.save! if org.new_record? || org.changed?
      org
    end

    def import_brand_assets!(org, tournaments)
      assets = LegacyAssets.new(source: @source, **@asset_options)
      assets.wire_brand_asset("giaa-logo.png", [[org, :logo_url]])
      headers = tournaments.map { |t| [t, :commemorative_banner_url] }
      headers << [org, :banner_url] if org.banner_url.blank?
      assets.wire_brand_asset("giaa-50-header.png", headers)
      assets.wire_brand_asset("pete-silhouette.png", tournaments.map { |t| [t, :signature_image_url_override] })
    end

    def import_domains!(org)
      return unless defined?(OrganizationDomain)

      domain = org.organization_domains.find_or_initialize_by(hostname: PRIMARY_HOST)
      if domain.new_record?
        domain.is_primary = true
        domain.save!
      end
    end

    def import_payment_config!(org)
      return unless defined?(OrganizationPaymentConfig)

      # Intentionally NEVER copies plaintext Stripe keys from legacy `settings`
      config = org.organization_payment_config || org.build_organization_payment_config
      return unless config.new_record?

      config.assign_attributes(
        payment_mode: "platform_collect",
        processor_provider: "stripe",
        platform_fee_flat_cents: 30_000,
        platform_fee_per_registrant_cents: 300,
        encrypted_public_key: nil,
        encrypted_secret_key: nil,
        encrypted_webhook_secret: nil
      )
      config.save!
    end

    def import_admins!(org)
      map = {}
      source_admins = @source.rows("admins")
      source_admins = @source.rows("users") if source_admins.empty?

      source_admins.each do |row|
        email = row["email"].to_s.strip.downcase
        next if email.blank?

        user = User.where("LOWER(email) = ?", email).first || User.new(email: email)
        if user.new_record?
          user.name = row["name"].presence || email.split("@").first
          user.role = "org_admin"
          user.clerk_id = "pending_#{Digest::SHA256.hexdigest(email)[0, 32]}"
          user.save!
        end

        membership = OrganizationMembership.find_or_initialize_by(user: user, organization: org)
        if membership.new_record?
          membership.role = "admin"
          membership.save!
        end

        map[row["id"].to_s] = user
      end
      map
    end

    def import_tournaments!(org, settings)
      map = {}
      @source.rows("tournaments").each do |row|
        slug = row["slug"].presence || "giaa-#{row['year'] || 2026}-#{row['id']}"
        tournament = org.tournaments.find_or_initialize_by(slug: slug)
        subtitle = row["tribute_subtitle"].presence || settings["tribute_subtitle"].presence
        assign_backfill(tournament, {
          name: row["name"].presence || "GIAA Memorial Golf #{row['year'] || 2026}",
          year: (row["year"] || 2026).to_i,
          edition: row["edition"],
          status: Tournament::STATUSES.include?(row["status"]) ? row["status"] : "completed",
          event_date: row["event_date"],
          registration_time: row["registration_time"],
          check_in_time: row["check_in_time"],
          start_time: row["start_time"],
          location_name: row["location_name"],
          location_address: row["location_address"],
          format_name: row["format_name"],
          fee_includes: row["fee_includes"],
          checks_payable_to: row["checks_payable_to"],
          contact_name: row["contact_name"],
          contact_email: row["contact_email"],
          contact_phone: row["contact_phone"],
          team_size: 1,
          max_capacity: (row["max_capacity"] || 144).to_i,
          reserved_slots: (row["reserved_slots"] || 0).to_i,
          entry_fee: (row["entry_fee"] || 12_500).to_i,
          employee_discount_enabled: row["employee_entry_fee"].present?,
          employee_entry_fee: row["employee_entry_fee"]&.to_i,
          registration_open: truthy?(row["registration_open"]),
          waiver_enabled: row["waiver_enabled"].nil? ? true : truthy?(row["waiver_enabled"]),
          waiver_text: row["waiver_text"],
          banner_url_override: row["banner_url_override"].presence,
          logo_url_override: row["logo_url_override"].presence,
          commemorative_banner_url: row["commemorative_banner_url"].presence || settings["commemorative_banner_url"].presence,
          signature_image_url_override: row["signature_image_url_override"].presence || settings["signature_image_url_override"].presence,
          tribute_title: settings["tournament_title"].presence || row["tribute_title"].presence || subtitle || tournament.tribute_subtitle.presence,
          tribute_subtitle: subtitle,
          capacity_unit: "players"
        })
        if tournament.new_record? || tournament.theme_preset.blank? || tournament.theme_preset == "classic"
          tournament.theme_preset = "memorial-formal"
        end
        tournament.config = merge_missing_json({ "players_per_start_position" => 4 }, tournament.config || {})
        tournament.save! if tournament.new_record? || tournament.changed?
        map[row["id"].to_s] = tournament
      end
      map
    end

    def import_groups!(tournament_map)
      map = {}
      @source.rows("groups").each do |row|
        tournament = tournament_map[row["tournament_id"].to_s]
        next unless tournament

        group = tournament.groups.find_or_initialize_by(group_number: (row["group_number"] || row["id"]).to_i)
        save_backfill!(group,
          hole_number: row["hole_number"]&.to_i,
          starting_course_key: row["starting_course_key"].presence
        )
        map[row["id"].to_s] = group
      end
      map
    end

    def import_golfers!(org, tournament_map, group_map)
      map = {}
      @source.rows("golfers").each do |row|
        tournament = tournament_map[row["tournament_id"].to_s]
        next unless tournament

        legacy_tag = "[legacy:#{LEGACY_SOURCE}:#{row['id']}]"
        registration = bridge_registration(tournament, row["id"])
        golfer = legacy_golfer(tournament, registration, legacy_tag)
        token = import_payment_token(golfer, registration, row["payment_token"])
        has_stripe = row["stripe_payment_intent_id"].present? || row["stripe_checkout_session_id"].present?
        base_notes = row["notes"].to_s
        notes_with_tag = base_notes.include?(legacy_tag) ? base_notes : [base_notes.presence, legacy_tag].compact.join(" ")

        attrs = {
          name: row["name"].presence || "Player #{row['id']}",
          email: row["email"].presence || "legacy-giaa-#{row['id']}@migrated.invalid",
          phone: row["phone"].presence || "000-000-0000",
          company: row["company"],
          address: row["address"],
          mobile: row["mobile"],
          tshirt_size: row["tshirt_size"],
          team_category: row["team_category"].presence || "Co-Ed",
          registration_status: valid_registration_status(row["registration_status"]),
          registration_source: row["registration_source"].presence || "public",
          payment_type: row["payment_type"].presence || "pay_on_day",
          payment_status: valid_payment_status(row["payment_status"]),
          payment_method: row["payment_method"],
          payment_amount_cents: row["payment_amount_cents"]&.to_i,
          refund_amount_cents: row["refund_amount_cents"]&.to_i,
          payment_notes: row["payment_notes"],
          payment_token: token,
          stripe_fee_cents: row["stripe_fee_cents"],
          refund_reason: row["refund_reason"],
          is_employee: truthy?(row["is_employee"]),
          position: row["position"]&.to_i,
          hole_number: row["hole_number"]&.to_i,
          stripe_checkout_session_id: row["stripe_checkout_session_id"].presence,
          stripe_payment_intent_id: row["stripe_payment_intent_id"].presence,
          stripe_card_brand: row["stripe_card_brand"].presence,
          stripe_card_last4: row["stripe_card_last4"].presence,
          stripe_refund_id: row["stripe_refund_id"].presence,
          receipt_number: row["receipt_number"],
          paid_at: row["paid_at"],
          refunded_at: row["refunded_at"],
          checked_in_at: row["checked_in_at"],
          waiver_accepted_at: row["waiver_accepted_at"],
          group: group_map[row["group_id"].to_s],
          notes: notes_with_tag
        }
        attrs[:stripe_account_origin] = "legacy_#{LEGACY_SOURCE}" if golfer.respond_to?(:stripe_account_origin=) && has_stripe
        golfer.historical_import = true
        save_backfill!(golfer, attrs)
        sync_real_team_bridge!(registration, org, tournament, golfer, row, token)
        map[row["id"].to_s] = golfer
      end
      map
    end

    def sync_real_team_bridge!(reg, org, tournament, golfer, row, token)
      assign_backfill(reg,
        organization: org,
        tournament: tournament,
        golfer_id: golfer.id,
        group_id: golfer.group_id,
        contact_name: golfer.name,
        contact_email: golfer.email,
        contact_phone: golfer.phone,
        company: golfer.company,
        team_category: golfer.team_category,
        registration_source: golfer.registration_source,
        registration_status: golfer.registration_status,
        payment_type: golfer.payment_type,
        payment_status: golfer.payment_status,
        payment_method: golfer.payment_method,
        payment_amount_cents: golfer.payment_amount_cents,
        payment_token: token,
        receipt_number: golfer.receipt_number,
        payment_notes: golfer.payment_notes,
        refund_amount_cents: golfer.refund_amount_cents,
        refund_reason: golfer.refund_reason,
        stripe_checkout_session_id: golfer.stripe_checkout_session_id,
        stripe_payment_intent_id: golfer.stripe_payment_intent_id,
        stripe_card_brand: golfer.stripe_card_brand,
        stripe_card_last4: golfer.stripe_card_last4,
        stripe_refund_id: golfer.stripe_refund_id,
        stripe_account_origin: golfer.stripe_account_origin,
        paid_at: golfer.paid_at,
        refunded_at: golfer.refunded_at,
        notes: row["notes"]
      )

      member = {
        organization: org,
        tournament: tournament,
        position: 1,
        is_captain: true,
        name: golfer.name,
        email: golfer.email,
        phone: golfer.phone,
        company: golfer.company,
        address: golfer.address,
        mobile: golfer.mobile,
        tshirt_size: golfer.tshirt_size,
        is_employee: golfer.is_employee,
        waiver_accepted_at: golfer.waiver_accepted_at,
        checked_in_at: golfer.checked_in_at,
        legacy_source: LEGACY_SOURCE,
        legacy_id: "#{row['id']}:1"
      }

      sync_members!(reg, [member])
    end

    def import_employee_numbers!(org, tournament_map, golfer_map)
      return unless defined?(EmployeeNumber)

      registrations_by_legacy_id = if defined?(Registration)
                                     Registration.where(legacy_source: LEGACY_SOURCE, tournament_id: tournament_map.values.map(&:id))
                                                 .index_by(&:legacy_id)
                                   else
                                     {}
                                   end

      @source.rows("employee_numbers").each do |row|
        tournament = tournament_map[row["tournament_id"].to_s] || tournament_map.values.first
        next unless tournament

        record = EmployeeNumber.find_or_initialize_by(
          tournament: tournament,
          employee_number: row["employee_number"].to_s.strip.upcase
        )
        golfer = golfer_map[row["used_by_golfer_id"].to_s]
        registration = golfer ? registrations_by_legacy_id[row["used_by_golfer_id"].to_s] : nil
        save_backfill!(record,
          organization: org,
          employee_name: row["employee_name"],
          used: truthy?(row["used"]),
          used_by_golfer_id: golfer&.id,
          used_by_registration_id: registration&.id,
          used_at: row["used_at"],
          legacy_source: LEGACY_SOURCE,
          legacy_id: row["id"].to_s
        )
        if golfer && record.used_by_golfer_id == golfer.id && golfer.employee_number_record_id.nil?
          golfer.update_column(:employee_number_record_id, record.id)
        end
        if registration && record.used_by_registration_id == registration.id &&
            (tm = registration.team_members.find_by(position: 1)) && tm.employee_number_record_id.nil?
          tm.update_column(:employee_number_record_id, record.id)
        end
      end
    end

    def import_activity_logs!(org, tournament_map, admin_map)
      @source.rows("activity_logs").each do |row|
        tournament = tournament_map[row["tournament_id"].to_s]
        marker = "[legacy:#{LEGACY_SOURCE}:log:#{row['id']}]"
        next if ActivityLog.where(organization: org).where("details LIKE ?", "%#{marker}%").exists?

        action = ActivityLog::ACTIONS.include?(row["action"]) ? row["action"] : "tournament_updated"
        ActivityLog.create!(
          organization: org,
          tournament: tournament,
          admin_id: admin_map[row["admin_id"].to_s]&.id,
          action: action,
          target_type: row["target_type"],
          target_name: row["target_name"],
          details: [row["details"].presence, marker].compact.join(" ")
        )
      end
    end

    def verify_import!(org, tournament_map)
      src_golfers = @source.rows("golfers")
      tournament_ids = tournament_map.values.map(&:id)
      tgt_golfers = Golfer.where(tournament_id: tournament_ids)

      source_metrics = {
        "tournaments" => @source.rows("tournaments").size,
        "groups" => @source.rows("groups").size,
        "golfers" => src_golfers.size,
        "golfers_with_address" => src_golfers.count { |g| g["address"].present? },
        "waivers_signed" => src_golfers.count { |g| g["waiver_accepted_at"].present? },
        "golfers_with_receipt" => src_golfers.count { |g| g["receipt_number"].present? },
        "golfers_confirmed" => src_golfers.count { |g| valid_registration_status(g["registration_status"]) == "confirmed" },
        "golfers_waitlist" => src_golfers.count { |g| valid_registration_status(g["registration_status"]) == "waitlist" },
        "activity_logs" => @source.rows("activity_logs").size,
        "gross_registration_cents" => src_golfers.select { |g| valid_payment_status(g["payment_status"]).in?(%w[paid refunded]) }.sum { |g| g["payment_amount_cents"].to_i },
        "refund_cents" => src_golfers.sum { |g| g["refund_amount_cents"].to_i },
        "stripe_payment_intents" => src_golfers.count { |g| g["stripe_payment_intent_id"].present? },
        "stripe_refunds" => src_golfers.count { |g| g["stripe_refund_id"].present? }
      }

      target_metrics = {
        "tournaments" => Tournament.where(id: tournament_ids).count,
        "groups" => Group.where(tournament_id: tournament_ids).count,
        "golfers" => tgt_golfers.count,
        "golfers_with_address" => tgt_golfers.where("address ~ '[^[:space:]]'").count,
        "waivers_signed" => tgt_golfers.where.not(waiver_accepted_at: nil).count,
        "golfers_with_receipt" => tgt_golfers.where("receipt_number ~ '[^[:space:]]'").count,
        "golfers_confirmed" => tgt_golfers.where(registration_status: "confirmed").count,
        "golfers_waitlist" => tgt_golfers.where(registration_status: "waitlist").count,
        "activity_logs" => ActivityLog.where(organization_id: org.id).count,
        "gross_registration_cents" => tgt_golfers.where(payment_status: %w[paid refunded]).sum("COALESCE(payment_amount_cents, 0)").to_i,
        "refund_cents" => tgt_golfers.sum("COALESCE(refund_amount_cents, 0)").to_i,
        "stripe_payment_intents" => tgt_golfers.where.not(stripe_payment_intent_id: [nil, ""]).count,
        "stripe_refunds" => tgt_golfers.where.not(stripe_refund_id: [nil, ""]).count
      }

      if defined?(EmployeeNumber)
        src_numbers = @source.rows("employee_numbers")
        tgt_numbers = EmployeeNumber.where(tournament_id: tournament_ids)
        source_metrics["employee_numbers"] = src_numbers.size
        target_metrics["employee_numbers"] = tgt_numbers.count
        source_metrics["employee_numbers_used"] = src_numbers.count { |row| truthy?(row["used"]) }
        target_metrics["employee_numbers_used"] = tgt_numbers.where(used: true).count
      end

      if defined?(TeamMember) && defined?(Registration)
        source_metrics["registrations"] = src_golfers.size
        target_metrics["registrations"] = Registration.where(tournament_id: tournament_ids).count
        source_metrics["team_members"] = src_golfers.size
        target_metrics["team_members"] = TeamMember.where(tournament_id: tournament_ids).count
      end

      orphans = {
        "golfer_groups" => tgt_golfers.where.not(group_id: nil).where.not(group_id: Group.where(tournament_id: tournament_ids).select(:id)).count
      }

      Verifier.verify!(source_metrics: source_metrics, target_metrics: target_metrics, orphans: orphans)
    end

    def valid_registration_status(status)
      %w[confirmed waitlist pending cancelled].include?(status) ? status : "confirmed"
    end

    def valid_payment_status(status)
      %w[paid unpaid pending refunded].include?(status) ? status : "unpaid"
    end
  end
end
