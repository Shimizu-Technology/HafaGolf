# frozen_string_literal: true

require "digest"
require_relative "database_guard"
require_relative "verifier"
require_relative "source_reader"

module HafagolfMigrations
  # Idempotent, re-runnable GIAA Memorial Golf importer.
  # Synthesizes the GIAA organization (`memorial-formal` theme pack, `platform_collect`
  # payment mode — NEVER copying plaintext Stripe keys from legacy `settings`),
  # deduplicates admins by LOWER(email), maps individual golfers + employee numbers,
  # tags historical Stripe charges with `stripe_account_origin = "legacy_giaa"`, and
  # verifies exact row counts & cent-exact financial sums.
  class GiaaImporter
    LEGACY_SOURCE = "giaa"
    ORG_SLUG = "giaa"
    PRIMARY_HOST = "giaa-tournament.com"

    def initialize(source_reader:, expected_db_name: ENV["EXPECTED_DB_NAME"])
      @source = source_reader
      @expected_db_name = expected_db_name
    end

    def run!
      DatabaseGuard.verify!(expected_db_name: @expected_db_name)
      DatabaseGuard.verify_source_distinct!(source_db_name: @source.database_name)
      @source.require_non_empty_tables!("tournaments", "golfers")

      report = nil
      TenantContext.with_platform_access do
        ActiveRecord::Base.transaction(requires_new: true) do
          org = import_organization!
          import_domains!(org)
          import_payment_config!(org)
          admin_map = import_admins!(org)
          tournament_map = import_tournaments!(org)
          group_map = import_groups!(tournament_map)
          golfer_map = import_golfers!(org, tournament_map, group_map)
          import_employee_numbers!(org, tournament_map, golfer_map)
          import_activity_logs!(org, tournament_map, admin_map)

          report = verify_import!(org, tournament_map)
        end
      end

      report
    end

    private

    def import_organization!
      legacy_setting = @source.rows("settings").first || {}
      org = Organization.find_or_initialize_by(slug: ORG_SLUG)
      if org.new_record?
        org.assign_attributes(
          name: legacy_setting["organization_name"].presence || "GIAA Memorial Golf Tournament",
          description: "Annual Memorial Golf Classic",
          primary_color: "#1B365D",
          contact_email: legacy_setting["contact_email"].presence,
          contact_phone: legacy_setting["contact_phone"].presence,
          website_url: "https://#{PRIMARY_HOST}",
          subscription_status: "active",
          settings: (org.settings || {}).merge(
            "secondary_color" => "#0F223D",
            "accent_color" => "#C5A059",
            "features" => ((org.settings || {})["features"] || {}).merge(
              "employee_pricing" => true,
              "checkin_alpha_lanes" => true,
              "waitlist" => true,
              "raffle" => false,
              "scoring" => false,
              "live_leaderboard" => false
            )
          )
        )
        org.save!
      end
      org
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

    def import_tournaments!(org)
      map = {}
      @source.rows("tournaments").each do |row|
        slug = row["slug"].presence || "giaa-#{row['year'] || 2026}-#{row['id']}"
        tournament = org.tournaments.find_or_initialize_by(slug: slug)
        if tournament.new_record?
          attrs = {
            name: row["name"].presence || "GIAA Memorial Golf #{row['year'] || 2026}",
            year: (row["year"] || 2026).to_i,
            edition: row["edition"],
            status: Tournament::STATUSES.include?(row["status"]) ? row["status"] : "completed",
            event_date: row["event_date"],
            registration_time: row["registration_time"],
            start_time: row["start_time"],
            location_name: row["location_name"],
            location_address: row["location_address"],
            format_name: row["format_name"],
            fee_includes: row["fee_includes"],
            checks_payable_to: row["checks_payable_to"],
            contact_name: row["contact_name"],
            contact_phone: row["contact_phone"],
            team_size: 1,
            max_capacity: (row["max_capacity"] || 144).to_i,
            reserved_slots: (row["reserved_slots"] || 0).to_i,
            entry_fee: (row["entry_fee"] || 12_500).to_i,
            employee_discount_enabled: row["employee_entry_fee"].present?,
            employee_entry_fee: row["employee_entry_fee"]&.to_i,
            registration_open: ActiveModel::Type::Boolean.new.cast(row["registration_open"]) == true,
            config: { "players_per_start_position" => 4 },
            theme_preset: "memorial-formal"
          }
          attrs[:capacity_unit] = "players" if tournament.respond_to?(:capacity_unit=)
          tournament.assign_attributes(attrs)
          tournament.save!
        end
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
        group.assign_attributes(
          hole_number: row["hole_number"]&.to_i,
          starting_course_key: row["starting_course_key"].presence
        )
        group.save!
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
        golfer = tournament.golfers.where("notes LIKE ?", "%#{legacy_tag}%").first || tournament.golfers.new
        has_stripe = row["stripe_payment_intent_id"].present? || row["stripe_checkout_session_id"].present?
        base_notes = row["notes"].to_s
        notes_with_tag = base_notes.include?(legacy_tag) ? base_notes : [base_notes.presence, legacy_tag].compact.join(" ")

        attrs = {
          name: row["name"].presence || "Player #{row['id']}",
          email: row["email"].presence || "legacy-giaa-#{row['id']}@migrated.invalid",
          phone: row["phone"].presence || "000-000-0000",
          company: row["company"],
          team_category: row["team_category"].presence || "Co-Ed",
          registration_status: valid_registration_status(row["registration_status"]),
          registration_source: row["registration_source"].presence || "public",
          payment_type: row["payment_type"].presence || "pay_on_day",
          payment_status: valid_payment_status(row["payment_status"]),
          payment_method: row["payment_method"],
          payment_amount_cents: row["payment_amount_cents"]&.to_i,
          refund_amount_cents: row["refund_amount_cents"]&.to_i,
          payment_notes: row["payment_notes"],
          refund_reason: row["refund_reason"],
          is_employee: ActiveModel::Type::Boolean.new.cast(row["is_employee"]) == true,
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
          waiver_accepted_at: row["waiver_accepted_at"] || Time.current,
          group: group_map[row["group_id"].to_s],
          notes: notes_with_tag
        }
        attrs[:stripe_account_origin] = "legacy_#{LEGACY_SOURCE}" if golfer.respond_to?(:stripe_account_origin=) && has_stripe
        golfer.assign_attributes(attrs)
        golfer.save!

        sync_real_team_bridge!(org, tournament, golfer, row)
        map[row["id"].to_s] = golfer
      end
      map
    end

    def sync_real_team_bridge!(org, tournament, golfer, row)
      return unless defined?(Registration) && defined?(TeamMember)

      reg = Registration.find_or_initialize_by(legacy_source: LEGACY_SOURCE, legacy_id: row["id"].to_s)
      reg.assign_attributes(
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
        refund_amount_cents: golfer.refund_amount_cents,
        stripe_payment_intent_id: golfer.stripe_payment_intent_id,
        stripe_account_origin: golfer.respond_to?(:stripe_account_origin) ? golfer.stripe_account_origin : nil,
        paid_at: golfer.paid_at,
        refunded_at: golfer.refunded_at
      )

      m1_attrs = {
        organization: org,
        tournament: tournament,
        position: 1,
        is_captain: true,
        name: golfer.name,
        email: golfer.email,
        phone: golfer.phone,
        company: golfer.company,
        is_employee: golfer.is_employee,
        waiver_accepted_at: golfer.waiver_accepted_at,
        checked_in_at: golfer.checked_in_at,
        legacy_source: LEGACY_SOURCE,
        legacy_id: "#{row['id']}:1"
      }

      if reg.new_record?
        reg.team_members.build(m1_attrs)
        reg.save!
      else
        reg.save!

        m1 = TeamMember.find_or_initialize_by(legacy_source: LEGACY_SOURCE, legacy_id: "#{row['id']}:1")
        m1.assign_attributes(m1_attrs.merge(registration: reg))
        m1.save!
      end
    end

    def import_employee_numbers!(org, tournament_map, golfer_map)
      return unless defined?(EmployeeNumber)

      @source.rows("employee_numbers").each do |row|
        tournament = tournament_map[row["tournament_id"].to_s] || tournament_map.values.first
        next unless tournament

        record = EmployeeNumber.find_or_initialize_by(
          tournament: tournament,
          employee_number: row["employee_number"].to_s.strip.upcase
        )
        golfer = golfer_map[row["used_by_golfer_id"].to_s]
        registration = golfer && defined?(Registration) ? Registration.find_by(legacy_source: LEGACY_SOURCE, legacy_id: row["used_by_golfer_id"].to_s) : nil
        record.assign_attributes(
          organization: org,
          employee_name: row["employee_name"],
          used: ActiveModel::Type::Boolean.new.cast(row["used"]) == true,
          used_by_golfer_id: golfer&.id,
          used_by_registration_id: registration&.id,
          used_at: row["used_at"],
          legacy_source: LEGACY_SOURCE,
          legacy_id: row["id"].to_s
        )
        record.save!
        if golfer && golfer.employee_number_record_id != record.id
          golfer.update_column(:employee_number_record_id, record.id)
        end
        if registration && (tm = registration.team_members.find_by(position: 1)) && tm.employee_number_record_id != record.id
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
        "golfers_confirmed" => tgt_golfers.where(registration_status: "confirmed").count,
        "golfers_waitlist" => tgt_golfers.where(registration_status: "waitlist").count,
        "activity_logs" => ActivityLog.where(organization_id: org.id).count,
        "gross_registration_cents" => tgt_golfers.where(payment_status: %w[paid refunded]).sum("COALESCE(payment_amount_cents, 0)").to_i,
        "refund_cents" => tgt_golfers.sum("COALESCE(refund_amount_cents, 0)").to_i,
        "stripe_payment_intents" => tgt_golfers.where.not(stripe_payment_intent_id: [nil, ""]).count,
        "stripe_refunds" => tgt_golfers.where.not(stripe_refund_id: [nil, ""]).count
      }

      if defined?(EmployeeNumber)
        source_metrics["employee_numbers"] = @source.rows("employee_numbers").size
        target_metrics["employee_numbers"] = EmployeeNumber.where(tournament_id: tournament_ids).count
      end

      if defined?(TeamMember) && defined?(Registration)
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
