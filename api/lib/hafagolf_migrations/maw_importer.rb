# frozen_string_literal: true

require "digest"
require_relative "database_guard"
require_relative "verifier"
require_relative "source_reader"
require_relative "backfill"
require_relative "legacy_assets"

module HafagolfMigrations
  # Idempotent, re-runnable Make-A-Wish Guam & CNMI importer.
  # Maps legacy MAW snapshot data into HafaGolf with:
  # - `EXPECTED_DB_NAME` guard
  # - `pending_<sha256(email)>` Clerk placeholders deduplicated by LOWER(email)
  # - `stripe_account_origin = "legacy_maw"` tagging on historical Stripe charges
  # - Composite "<golfer_id>:<position>" keys for `team_members` when Real Teams tables exist
  # - `message_deliveries.organization_id` backfill
  # - Cent-exact JSON verification report (rolls back on any mismatch)
  class MawImporter
    include Backfill

    LEGACY_SOURCE = "maw"
    ORG_SLUG = "make-a-wish-guam"
    PRIMARY_HOST = "golfforwishes.com"
    WWW_HOST = "www.golfforwishes.com"

    BRAND_OVERRIDES = %i[banner_url_override logo_url_override signature_image_url_override].freeze
    TOURNAMENT_PARITY_FIELDS = %w[
      primary_color_override accent_color_override use_org_branding course_rating slope_rating
      handicap_required handicap_max tee_times_enabled tee_time_interval_minutes use_flights event_type
      waiver_enabled waiver_text commemorative_banner_url tribute_title tribute_subtitle
      show_public_sponsors sponsor_wall_title
    ].freeze

    def initialize(source_reader:, expected_db_name: ENV["EXPECTED_DB_NAME"], blob_dir: ENV["LEGACY_BLOB_DIR"],
                   brand_assets_dir: ENV["LEGACY_BRAND_ASSETS_DIR"], asset_host: ENV["ASSET_HOST"] || ENV["API_URL"],
                   allow_missing_attachments: ActiveModel::Type::Boolean.new.cast(ENV["ALLOW_MISSING_ATTACHMENTS"]) == true)
      @source = source_reader
      @expected_db_name = expected_db_name
      @allow_missing_attachments = allow_missing_attachments
      @asset_options = { blob_dir: blob_dir, brand_assets_dir: brand_assets_dir, asset_host: asset_host }
    end

    def run!
      DatabaseGuard.verify!(expected_db_name: @expected_db_name)
      DatabaseGuard.verify_source_distinct!(source_db_name: @source.database_name)
      @source.require_non_empty_tables!("tournaments", "golfers")

      report = nil
      TenantContext.with_platform_access do
        ActiveRecord::Base.transaction(requires_new: true) do
          lock_destination!
          org = import_organization!
          import_domains!(org)
          import_payment_config!(org)
          user_map = import_users!(org)
          tournament_map = import_tournaments!(org)
          group_map = import_groups!(tournament_map)
          sponsor_map = import_sponsors!(tournament_map)
          golfer_map = import_golfers!(org, tournament_map, group_map, sponsor_map, user_map)
          import_sponsor_slots!(sponsor_map, golfer_map)
          batch_map = import_raffle_batches!(tournament_map, user_map)
          prize_map = import_raffle_prizes!(tournament_map)
          ticket_map = import_raffle_tickets!(tournament_map, golfer_map, batch_map, prize_map, user_map)
          link_winning_tickets!(prize_map, ticket_map)
          import_message_deliveries!(org, tournament_map, golfer_map, ticket_map, sponsor_map)
          import_activity_logs!(org, tournament_map, user_map)

          assets = import_assets!(org, tournament_map.values, sponsor_map, prize_map)
          report = verify_import!(org, tournament_map, assets: assets)
          report["attachments_migrated"] = assets.migrated_count
          report["attachments_expected"] = assets.expected_attachments
          report["attachments_present"] = assets.attached_attachments
          report["attachments_missing"] = assets.missing_attachments
        end
      end

      report
    end

    private

    def import_organization!
      src_org = @source.rows("organizations").first || {}
      org = Organization.find_or_initialize_by(slug: ORG_SLUG)
      attrs = organization_brand_attributes(src_org).merge(
        "name" => src_org["name"].presence || "Make-A-Wish Guam & CNMI",
        "description" => src_org["description"].presence || "Golf for Wishes Charity Tournament",
        "primary_color" => valid_hex(src_org["primary_color"], "#0057B8"),
        "contact_email" => src_org["contact_email"].presence,
        "contact_phone" => src_org["contact_phone"].presence,
        "website_url" => src_org["website_url"].presence || "https://golfforwishes.com",
        "subscription_status" => "active"
      )
      assign_backfill(org, attrs)
      org.settings = merge_missing_json(organization_settings(src_org), org.settings || {})
      org.save! if org.new_record? || org.changed?
      org
    end

    def organization_settings(row)
      settings = sanitize_settings(parse_json(row["settings"], {}, expected_type: Hash))
      defaults = {
        "secondary_color" => valid_hex(row["secondary_color"], "#003D82"),
        "accent_color" => valid_hex(row["accent_color"], "#F5A623"),
        "features" => {
          "raffle" => true,
          "sponsor_portal" => true,
          "sms_notifications" => true,
          "waitlist" => true,
          "scoring" => false,
          "live_leaderboard" => false
        }
      }
      merge_missing_json(defaults, settings)
    end

    def sanitize_settings(value)
      case value
      when Hash
        value.each_with_object({}) do |(key, item), clean|
          next if key.to_s.match?(/stripe|secret|password|smtp_pass|credential|publishable|(?:api|access|private|public|webhook|signing)[_-]?key|token/i)
          next if item.is_a?(String) && item.match?(/\A(?:sk|pk|rk|whsec)_(?:live|test)?/i)

          clean[key.to_s] = sanitize_settings(item)
        end
      when Array
        value.map { |item| sanitize_settings(item) }
      else
        value
      end
    end

    def import_assets!(org, tournaments, sponsors, prizes)
      assets = LegacyAssets.new(source: @source, **@asset_options)
      assets.import_attachments(sponsors: sponsors, prizes: prizes)
      assets.replace_blob_urls(tournaments, BRAND_OVERRIDES)
      assets.wire_brand_asset("maw-logo.png", [[org, :logo_url]], match_filename: true)
      assets.wire_brand_asset("maw-logo-rev.png", [[org, :reversed_logo_url]], match_filename: true)
      hero_targets = [[org, :banner_url]] + tournaments.filter_map { |t| [t, :banner_url_override] if t.banner_url_override.blank? }
      assets.wire_brand_asset("maw-hero.jpg", hero_targets, match_filename: true)
      assets.wire_brand_asset("maw-star-icon.png", tournaments.map { |t| [t, :signature_image_url_override] }, match_filename: true)
      assets
    end

    def import_domains!(org)
      return unless defined?(OrganizationDomain)

      [
        [PRIMARY_HOST, true],
        [WWW_HOST, false]
      ].each do |hostname, is_primary|
        domain = org.organization_domains.find_or_initialize_by(hostname: hostname)
        if domain.new_record?
          domain.is_primary = is_primary
          domain.save!
        end
      end
    end

    def import_payment_config!(org)
      return unless defined?(OrganizationPaymentConfig)

      config = org.organization_payment_config || org.build_organization_payment_config
      return unless config.new_record?

      # Never migrate plaintext Stripe secrets from legacy `settings`
      config.assign_attributes(
        payment_mode: "external_link",
        processor_provider: "swipesimple",
        platform_fee_flat_cents: 0,
        platform_fee_per_registrant_cents: 500
      )
      config.save!
    end

    def import_users!(org)
      user_map = {}
      memberships_by_user = @source.rows("organization_memberships").index_by { |m| m["user_id"].to_s }

      @source.rows("users").each do |row|
        email = row["email"].to_s.strip.downcase
        next if email.blank?

        user = User.where("LOWER(email) = ?", email).first || User.new(email: email)
        if user.new_record?
          user.name = row["name"].presence || email.split("@").first
          # Never grant platform-wide super_admin during tenant import
          user.role = %w[org_admin tournament_admin].include?(row["role"]) ? row["role"] : "org_admin"
          user.clerk_id = "pending_#{Digest::SHA256.hexdigest(email)[0, 32]}"
          user.save!
        end

        membership_row = memberships_by_user[row["id"].to_s]
        role = membership_row && %w[admin volunteer].include?(membership_row["role"]) ? membership_row["role"] : "admin"
        membership = OrganizationMembership.find_or_initialize_by(user: user, organization: org)
        if membership.new_record?
          membership.role = role
          membership.save!
        end

        user_map[row["id"].to_s] = user
      end

      user_map
    end

    def import_tournaments!(org)
      map = {}
      @source.rows("tournaments").each do |row|
        slug = row["slug"].presence || "maw-#{row['year'] || 2026}-#{row['id']}"
        tournament = org.tournaments.find_or_initialize_by(slug: slug)
        attrs = {
          name: row["name"].presence || "Golf for Wishes #{row['year'] || 2026}",
          year: (row["year"] || 2026).to_i,
          edition: row["edition"],
          status: valid_tournament_status(row["status"]),
          event_date: row["event_date"],
          registration_time: row["registration_time"],
          check_in_time: row["check_in_time"],
          start_time: row["start_time"],
          location_name: row["location_name"],
          location_address: row["location_address"],
          format_name: row["format_name"],
          tournament_format: row["tournament_format"],
          scoring_type: row["scoring_type"],
          team_size: (row["team_size"] || 2).to_i,
          max_capacity: (row["max_capacity"] || 144).to_i,
          reserved_slots: (row["reserved_slots"] || 0).to_i,
          entry_fee: (row["entry_fee"] || 25_000).to_i,
          entry_fee_display: row["entry_fee_display"],
          early_bird_fee: row["early_bird_fee"]&.to_i,
          early_bird_deadline: row["early_bird_deadline"],
          walkin_fee: row["walkin_fee"]&.to_i,
          walkin_registration_open: truthy?(row["walkin_registration_open"]),
          registration_open: truthy?(row["registration_open"]),
          registration_deadline: row["registration_deadline"],
          sponsor_edit_deadline: row["sponsor_edit_deadline"],
          waitlist_enabled: row["waitlist_enabled"].nil? ? true : truthy?(row["waitlist_enabled"]),
          waitlist_max: row["waitlist_max"]&.to_i,
          allow_cash: row["allow_cash"].nil? ? true : truthy?(row["allow_cash"]),
          allow_check: row["allow_check"].nil? ? true : truthy?(row["allow_check"]),
          allow_card: row["allow_card"].nil? ? true : truthy?(row["allow_card"]),
          allow_partial_teams: truthy?(row["allow_partial_teams"]),
          checks_payable_to: row["checks_payable_to"],
          payment_instructions: row["payment_instructions"],
          fee_includes: row["fee_includes"],
          swipe_simple_url: row["swipe_simple_url"],
          walkin_swipe_simple_url: row["walkin_swipe_simple_url"],
          contact_name: row["contact_name"],
          contact_email: row["contact_email"],
          contact_phone: row["contact_phone"],
          course_name: row["course_name"],
          tee_name: row["tee_name"],
          total_holes: row["total_holes"]&.to_i,
          total_par: row["total_par"]&.to_i,
          shotgun_start: row["shotgun_start"].nil? ? true : truthy?(row["shotgun_start"]),
          public_listed: row["public_listed"].nil? ? true : truthy?(row["public_listed"]),
          banner_url_override: row["banner_url_override"],
          logo_url_override: row["logo_url_override"],
          signature_image_url_override: row["signature_image_url_override"],
          tournament_info: row["tournament_info"],
          event_schedule: row["event_schedule"],
          flights_config: parse_json(row["flights_config"], nil),
          hole_pars: parse_json(row["hole_pars"], nil),
          hole_handicaps: parse_json(row["hole_handicaps"], nil),
          raffle_enabled: truthy?(row["raffle_enabled"]),
          raffle_ticket_price_cents: row["raffle_ticket_price_cents"]&.to_i,
          raffle_tickets_per_purchase: row["raffle_tickets_per_purchase"]&.to_i,
          raffle_max_tickets_per_person: row["raffle_max_tickets_per_person"]&.to_i,
          raffle_description: row["raffle_description"],
          raffle_draw_time: row["raffle_draw_time"],
          raffle_auto_draw: truthy?(row["raffle_auto_draw"])
        }.compact
        attrs.merge!(row.slice(*TOURNAMENT_PARITY_FIELDS).compact.symbolize_keys)
        attrs[:waiver_enabled] = true if row["waiver_enabled"].nil?
        if tournament.new_record?
          attrs[:capacity_unit] = attrs[:team_size] > 1 ? "teams" : "players"
        end
        assign_backfill(
          tournament,
          attrs,
          %i[handicap_required use_flights tee_times_enabled raffle_enabled walkin_registration_open]
        )
        if tournament.new_record? || tournament.theme_preset.blank? || tournament.theme_preset == "classic"
          tournament.theme_preset = "charity-bright"
        end
        config = sanitize_settings(parse_json(row["config"], {}, expected_type: Hash))
        unless row["raffle_hold_winner_on_screen"].nil?
          config = config.merge("raffle_hold_winner_on_screen" => truthy?(row["raffle_hold_winner_on_screen"]))
        end
        tournament.config = merge_missing_json(config, tournament.config || {})
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

        group = tournament.groups.find_or_initialize_by(
          group_number: (row["group_number"] || row["id"]).to_i
        )
        save_backfill!(group,
          hole_number: row["hole_number"]&.to_i,
          starting_course_key: row["starting_course_key"].presence
        )
        map[row["id"].to_s] = group
      end
      map
    end

    def import_sponsors!(tournament_map)
      map = {}
      @source.rows("sponsors").each do |row|
        tournament = tournament_map[row["tournament_id"].to_s]
        next unless tournament

        sponsor = tournament.sponsors.find_or_initialize_by(
          legacy_source: LEGACY_SOURCE,
          legacy_id: row["id"].to_s
        )
        assign_backfill(sponsor,
          name: row["name"].presence || "Sponsor #{row['id']}",
          tier: row["tier"].presence || "silver",
          description: row["description"],
          login_email: row["login_email"] || row["contact_email"],
          website_url: row["website_url"],
          logo_url: (row["logo_url"].presence unless sponsor.logo.attached?),
          course_key: row["course_key"],
          slot_count: (row["slot_count"] || 0).to_i,
          hole_number: row["hole_number"]&.to_i,
          position: (row["position"] || 0).to_i,
          active: row["active"].nil? ? true : truthy?(row["active"])
        )
        # Expire historical portal tokens on archived/completed past events
        if sponsor.new_record? && tournament.status.in?(%w[completed archived])
          sponsor.access_token = nil
        end
        sponsor.save! if sponsor.new_record? || sponsor.changed?
        map[row["id"].to_s] = sponsor
      end
      map
    end

    def import_golfers!(org, tournament_map, group_map, sponsor_map, user_map)
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
          email: row["email"].presence || "legacy-maw-#{row['id']}@migrated.invalid",
          phone: row["phone"].presence || "000-000-0000",
          company: row["company"],
          address: row["address"],
          mobile: row["mobile"],
          team_name: row["team_name"],
          tshirt_size: row["tshirt_size"],
          partner_name: row["partner_name"],
          partner_email: row["partner_email"],
          partner_phone: row["partner_phone"],
          partner_tshirt_size: row["partner_tshirt_size"],
          partner_waiver_accepted_at: row["partner_waiver_accepted_at"],
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
          payment_verified_at: row["payment_verified_at"],
          payment_verified_by_id: user_map[row["payment_verified_by_id"].to_s]&.id,
          payment_verified_by_name: row["payment_verified_by_name"],
          refund_reason: row["refund_reason"],
          refunded_by_id: user_map[row["refunded_by_id"].to_s]&.id,
          stripe_fee_cents: row["stripe_fee_cents"],
          position: row["position"]&.to_i,
          hole_number: row["hole_number"]&.to_i,
          raffle_tickets_requested: (row["raffle_tickets_requested"] || 0).to_i,
          raffle_bundle_label: row["raffle_bundle_label"],
          stripe_checkout_session_id: row["stripe_checkout_session_id"].presence,
          stripe_payment_intent_id: row["stripe_payment_intent_id"].presence,
          stripe_card_brand: row["stripe_card_brand"].presence,
          stripe_card_last4: row["stripe_card_last4"].presence,
          stripe_refund_id: row["stripe_refund_id"].presence,
          receipt_number: row["receipt_number"],
          paid_at: row["paid_at"],
          refunded_at: row["refunded_at"],
          checked_in_at: row["checked_in_at"],
          checked_in_by_id: user_map[row["checked_in_by_id"].to_s]&.id,
          checked_in_by_name: row["checked_in_by_name"],
          waiver_accepted_at: row["waiver_accepted_at"],
          group: group_map[row["group_id"].to_s],
          sponsor: sponsor_map[row["sponsor_id"].to_s],
          notes: notes_with_tag
        }
        if golfer.respond_to?(:stripe_account_origin=) && has_stripe
          attrs[:stripe_account_origin] = "legacy_#{LEGACY_SOURCE}"
        end

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
        sponsor_id: golfer.sponsor_id,
        contact_name: golfer.name,
        contact_email: golfer.email,
        contact_phone: golfer.phone,
        company: golfer.company,
        team_name: golfer.team_name,
        team_category: golfer.team_category,
        registration_source: golfer.registration_source,
        registration_status: golfer.registration_status,
        payment_type: golfer.payment_type,
        payment_status: golfer.payment_status,
        payment_method: golfer.payment_method,
        payment_amount_cents: golfer.payment_amount_cents,
        receipt_number: golfer.receipt_number,
        payment_notes: golfer.payment_notes,
        payment_verified_at: golfer.payment_verified_at,
        payment_verified_by_id: golfer.payment_verified_by_id,
        payment_verified_by_name: golfer.payment_verified_by_name,
        payment_token: token,
        refund_amount_cents: golfer.refund_amount_cents,
        refund_reason: golfer.refund_reason,
        refunded_by_id: golfer.refunded_by_id,
        stripe_checkout_session_id: golfer.stripe_checkout_session_id,
        stripe_payment_intent_id: golfer.stripe_payment_intent_id,
        stripe_card_brand: golfer.stripe_card_brand,
        stripe_card_last4: golfer.stripe_card_last4,
        stripe_refund_id: golfer.stripe_refund_id,
        stripe_account_origin: golfer.stripe_account_origin,
        paid_at: golfer.paid_at,
        refunded_at: golfer.refunded_at,
        raffle_tickets_requested: golfer.raffle_tickets_requested,
        raffle_bundle_label: golfer.raffle_bundle_label,
        notes: row["notes"]
      )

      member_defaults = {
        organization: org,
        tournament: tournament,
        company: golfer.company,
        checked_in_at: golfer.checked_in_at,
        checked_in_by_id: golfer.checked_in_by_id,
        checked_in_by_name: golfer.checked_in_by_name,
        legacy_source: LEGACY_SOURCE
      }
      members = [member_defaults.merge(
        position: 1,
        is_captain: true,
        name: golfer.name,
        email: golfer.email,
        phone: golfer.phone,
        mobile: golfer.mobile,
        address: golfer.address,
        tshirt_size: golfer.tshirt_size,
        waiver_accepted_at: golfer.waiver_accepted_at,
        legacy_id: "#{row['id']}:1"
      )]
      if golfer.partner_name.present?
        members << member_defaults.merge(
          position: 2,
          is_captain: false,
          name: golfer.partner_name,
          email: golfer.partner_email,
          phone: golfer.partner_phone,
          tshirt_size: golfer.partner_tshirt_size,
          waiver_accepted_at: golfer.partner_waiver_accepted_at,
          legacy_id: "#{row['id']}:2"
        )
      end
      sync_members!(reg, members)
    end

    def import_sponsor_slots!(sponsor_map, golfer_map)
      @source.rows("sponsor_slots").sort_by { |row| row["slot_number"].to_i }.each do |row|
        sponsor = sponsor_map[row["sponsor_id"].to_s]
        next unless sponsor

        slot = sponsor.sponsor_slots.find_or_initialize_by(slot_number: (row["slot_number"] || 1).to_i)
        assign_backfill(slot,
          tournament_id: sponsor.tournament_id,
          player_name: row["player_name"],
          player_email: row["player_email"],
          player_phone: row["player_phone"],
          confirmed_at: row["confirmed_at"],
          tshirt_size: row["tshirt_size"],
          handicap: row["handicap"]
        )
        if slot.new_record? || slot.changed?
          # Legacy filled slots can predate the handicap requirement.
          slot.historical_import = true
          slot.save!
        end

        link_sponsor_slot!(slot, golfer_map[row["golfer_id"].to_s])
      end
    end

    def link_sponsor_slot!(slot, golfer)
      return if slot.team_member

      members = TeamMember.joins(:registration).where(
        legacy_source: LEGACY_SOURCE, tournament_id: slot.tournament_id,
        registrations: { sponsor_id: slot.sponsor_id }
      )
      members = members.where(registrations: { golfer_id: golfer.id }) if golfer

      matches = if slot.player_email.present?
                  members.where("LOWER(team_members.email) = ?", slot.player_email.downcase)
                elsif slot.player_name.present?
                  members.where("LOWER(team_members.name) = ?", slot.player_name.downcase)
                else
                  members.none
                end
      candidates = matches.limit(2).to_a
      member = candidates.first if candidates.one?
      member ||= members.find_by(position: 1) if golfer && candidates.empty?
      member.update!(sponsor_slot: slot) if member && member.sponsor_slot_id.nil?
    end

    def import_raffle_batches!(tournament_map, user_map)
      map = {}
      @source.rows("raffle_sale_batches").each do |row|
        tournament = tournament_map[row["tournament_id"].to_s]
        next unless tournament

        batch_key = "[legacy:#{LEGACY_SOURCE}:batch:#{row['id']}]"
        batch = tournament.raffle_sale_batches.where("payment_notes LIKE ?", "%#{batch_key}%").first ||
                tournament.raffle_sale_batches.new
        notes = (row["payment_notes"] || row["notes"]).to_s
        save_backfill!(batch,
          buyer_name: (row["buyer_name"] || row["purchaser_name"]).presence || "Raffle Buyer",
          buyer_email: row["buyer_email"] || row["purchaser_email"],
          buyer_phone: row["buyer_phone"] || row["purchaser_phone"],
          quantity: (row["quantity"] || row["ticket_count"] || 1).to_i,
          total_cents: (row["total_cents"] || 0).to_i,
          payment_method: row["payment_method"].presence || "cash",
          receipt_number: row["receipt_number"],
          purchased_at: row["purchased_at"] || Time.current,
          sold_by_user: user_map[row["sold_by_user_id"].to_s],
          payment_notes: notes.include?(batch_key) ? notes : [notes.presence, batch_key].compact.join(" ")
        )
        map[row["id"].to_s] = batch
      end
      map
    end

    def import_raffle_prizes!(tournament_map)
      map = {}
      @source.rows("raffle_prizes").each do |row|
        tournament = tournament_map[row["tournament_id"].to_s]
        next unless tournament

        prize = tournament.raffle_prizes.find_or_initialize_by(
          legacy_source: LEGACY_SOURCE,
          legacy_id: row["id"].to_s
        )
        save_backfill!(prize,
          name: row["name"].presence || "Prize #{row['id']}",
          position: (row["position"] || row["id"]).to_i,
          description: row["description"],
          value_cents: (row["value_cents"] || 0).to_i,
          tier: row["tier"].presence || "standard",
          image_url: (row["image_url"].presence unless prize.image.attached?),
          sponsor_name: row["sponsor_name"],
          sponsor_logo_url: row["sponsor_logo_url"],
          winner_name: row["winner_name"],
          winner_email: row["winner_email"],
          winner_phone: row["winner_phone"],
          won: truthy?(row["won"].nil? ? row["drawn"] : row["won"]),
          claimed: truthy?(row["claimed"]),
          won_at: row["won_at"] || row["drawn_at"],
          claimed_at: row["claimed_at"]
        )
        map[row["id"].to_s] = prize
      end
      map
    end

    def import_raffle_tickets!(tournament_map, golfer_map, batch_map, prize_map, user_map)
      map = {}
      registrations_by_legacy_id = if defined?(Registration)
                                     Registration.where(legacy_source: LEGACY_SOURCE, tournament_id: tournament_map.values.map(&:id))
                                                 .index_by(&:legacy_id)
                                   else
                                     {}
                                   end
      @source.rows("raffle_tickets").each do |row|
        tournament = tournament_map[row["tournament_id"].to_s]
        next unless tournament

        ticket_num = row["ticket_number"].presence || "MAW-#{row['id']}"
        ticket = tournament.raffle_tickets.find_or_initialize_by(ticket_number: ticket_num)
        golfer = golfer_map[row["golfer_id"].to_s]
        registration = golfer ? registrations_by_legacy_id[row["golfer_id"].to_s] : nil
        save_backfill!(ticket,
          sequence_number: (row["sequence_number"] || row["id"]).to_i,
          purchaser_name: row["purchaser_name"].presence || "Raffle Buyer",
          purchaser_email: row["purchaser_email"],
          purchaser_phone: row["purchaser_phone"],
          price_cents: (row["price_cents"] || 0).to_i,
          payment_status: row["payment_status"].presence || "paid",
          payment_method: row["payment_method"].presence,
          receipt_number: row["receipt_number"],
          payment_notes: row["payment_notes"],
          stripe_payment_intent_id: row["stripe_payment_intent_id"].presence,
          is_winner: truthy?(row["is_winner"]),
          drawn_at: row["drawn_at"],
          voided_at: row["voided_at"],
          void_reason: row["void_reason"],
          purchased_at: row["purchased_at"] || Time.current,
          golfer: golfer,
          registration: registration,
          raffle_sale_batch: batch_map[row["raffle_sale_batch_id"].to_s],
          raffle_prize: prize_map[row["raffle_prize_id"].to_s],
          sold_by_user: user_map[row["sold_by_user_id"].to_s]
        )
        map[row["id"].to_s] = ticket
      end
      map
    end

    def link_winning_tickets!(prize_map, ticket_map)
      @source.rows("raffle_prizes").each do |row|
        next if row["winning_ticket_id"].blank?

        prize = prize_map[row["id"].to_s]
        ticket = ticket_map[row["winning_ticket_id"].to_s]
        next unless prize && ticket

        save_backfill!(prize, winning_ticket_id: ticket.id)
      end
    end

    def import_message_deliveries!(org, tournament_map, golfer_map, ticket_map, sponsor_map)
      @source.rows("message_deliveries").each do |row|
        tournament = tournament_map[row["tournament_id"].to_s]
        ext_id = row["provider_message_id"].presence || "legacy-#{LEGACY_SOURCE}-#{row['id']}"
        delivery = MessageDelivery.find_or_initialize_by(
          organization: org,
          provider_message_id: ext_id
        )
        messageable = case row["messageable_type"]
                      when "Golfer" then golfer_map[row["messageable_id"].to_s]
                      when "RaffleTicket" then ticket_map[row["messageable_id"].to_s]
                      when "Sponsor" then sponsor_map[row["messageable_id"].to_s]
                      else ticket_map[row["raffle_ticket_id"].to_s] || golfer_map[row["golfer_id"].to_s] || sponsor_map[row["sponsor_id"].to_s]
                      end
        save_backfill!(delivery,
          tournament: tournament,
          channel: row["channel"].presence || "sms",
          provider: row["provider"].presence || "clicksend",
          purpose: row["purpose"].presence || "raffle_purchase_confirmation",
          recipient: row["recipient"].presence || "unknown",
          status: row["status"].presence || "pending",
          messageable: messageable
        )
      end
    end

    def import_activity_logs!(org, tournament_map, user_map)
      @source.rows("activity_logs").each do |row|
        tournament = tournament_map[row["tournament_id"].to_s]
        marker = "[legacy:#{LEGACY_SOURCE}:log:#{row['id']}]"
        existing = ActivityLog.where(organization: org).where("details LIKE ?", "%#{marker}%").first
        next if existing

        action = ActivityLog::ACTIONS.include?(row["action"]) ? row["action"] : "tournament_updated"
        details = [row["details"].presence, marker].compact.join(" ")
        ActivityLog.create!(
          organization: org,
          tournament: tournament,
          admin_id: user_map[row["admin_id"].to_s]&.id,
          action: action,
          target_type: row["target_type"],
          target_name: row["target_name"],
          details: details
        )
      end
    end

    def verify_import!(org, tournament_map, assets: nil)
      src_golfers = @source.rows("golfers")
      src_tickets = @source.rows("raffle_tickets")
      tournament_ids = tournament_map.values.map(&:id)
      tgt_golfers = Golfer.where(tournament_id: tournament_ids)
      tgt_tickets = RaffleTicket.where(tournament_id: tournament_ids)

      source_metrics = {
        "tournaments" => @source.rows("tournaments").size,
        "groups" => @source.rows("groups").size,
        "golfers" => src_golfers.size,
        "waivers_signed" => src_golfers.count { |g| g["waiver_accepted_at"].present? },
        "partner_waivers_signed" => src_golfers.count { |g| g["partner_waiver_accepted_at"].present? },
        "checked_in_golfers" => src_golfers.count { |g| g["checked_in_at"].present? },
        "payment_verified_golfers" => src_golfers.count { |g| g["payment_verified_at"].present? },
        "golfers_confirmed" => src_golfers.count { |g| valid_registration_status(g["registration_status"]) == "confirmed" },
        "golfers_waitlist" => src_golfers.count { |g| valid_registration_status(g["registration_status"]) == "waitlist" },
        "golfers_cancelled" => src_golfers.count { |g| valid_registration_status(g["registration_status"]) == "cancelled" },
        "sponsors" => @source.rows("sponsors").size,
        "sponsor_slots" => @source.rows("sponsor_slots").size,
        "raffle_sale_batches" => @source.rows("raffle_sale_batches").size,
        "raffle_prizes" => @source.rows("raffle_prizes").size,
        "raffle_tickets" => src_tickets.size,
        "message_deliveries" => @source.rows("message_deliveries").size,
        "activity_logs" => @source.rows("activity_logs").size,
        "gross_registration_cents" => src_golfers.select { |g| valid_payment_status(g["payment_status"]).in?(%w[paid refunded]) }.sum { |g| g["payment_amount_cents"].to_i },
        "refund_cents" => src_golfers.sum { |g| g["refund_amount_cents"].to_i },
        "raffle_paid_cents" => src_tickets.select { |t| (t["payment_status"].presence || "paid") == "paid" }.sum { |t| t["price_cents"].to_i },
        "stripe_payment_intents" => src_golfers.count { |g| g["stripe_payment_intent_id"].present? },
        "stripe_refunds" => src_golfers.count { |g| g["stripe_refund_id"].present? }
      }

      target_metrics = {
        "tournaments" => Tournament.where(id: tournament_ids).count,
        "groups" => Group.where(tournament_id: tournament_ids).count,
        "golfers" => tgt_golfers.count,
        "waivers_signed" => tgt_golfers.where.not(waiver_accepted_at: nil).count,
        "partner_waivers_signed" => tgt_golfers.where.not(partner_waiver_accepted_at: nil).count,
        "checked_in_golfers" => tgt_golfers.where.not(checked_in_at: nil).count,
        "payment_verified_golfers" => tgt_golfers.where.not(payment_verified_at: nil).count,
        "golfers_confirmed" => tgt_golfers.where(registration_status: "confirmed").count,
        "golfers_waitlist" => tgt_golfers.where(registration_status: "waitlist").count,
        "golfers_cancelled" => tgt_golfers.where(registration_status: "cancelled").count,
        "sponsors" => Sponsor.where(tournament_id: tournament_ids).count,
        "sponsor_slots" => SponsorSlot.where(tournament_id: tournament_ids).count,
        "raffle_sale_batches" => RaffleSaleBatch.where(tournament_id: tournament_ids).count,
        "raffle_prizes" => RafflePrize.where(tournament_id: tournament_ids).count,
        "raffle_tickets" => tgt_tickets.count,
        "message_deliveries" => MessageDelivery.where(organization_id: org.id).count,
        "activity_logs" => ActivityLog.where(organization_id: org.id).count,
        "gross_registration_cents" => tgt_golfers.where(payment_status: %w[paid refunded]).sum("COALESCE(payment_amount_cents, 0)").to_i,
        "refund_cents" => tgt_golfers.sum("COALESCE(refund_amount_cents, 0)").to_i,
        "raffle_paid_cents" => tgt_tickets.where(payment_status: "paid").sum("COALESCE(price_cents, 0)").to_i,
        "stripe_payment_intents" => tgt_golfers.where.not(stripe_payment_intent_id: [nil, ""]).count,
        "stripe_refunds" => tgt_golfers.where.not(stripe_refund_id: [nil, ""]).count
      }

      if defined?(TeamMember) && defined?(Registration)
        source_metrics["registrations"] = src_golfers.size
        target_metrics["registrations"] = Registration.where(tournament_id: tournament_ids).count
        expected_members = src_golfers.sum { |g| g["partner_name"].present? ? 2 : 1 }
        source_metrics["team_members"] = expected_members
        target_metrics["team_members"] = TeamMember.where(tournament_id: tournament_ids).count
      end

      if assets && assets.expected_attachments.positive? && !@allow_missing_attachments
        source_metrics["attachments"] = assets.expected_attachments
        target_metrics["attachments"] = assets.attached_attachments
      end

      orphans = {
        "golfer_groups" => tgt_golfers.where.not(group_id: nil).where.not(group_id: Group.where(tournament_id: tournament_ids).select(:id)).count,
        "golfer_sponsors" => tgt_golfers.where.not(sponsor_id: nil).where.not(sponsor_id: Sponsor.where(tournament_id: tournament_ids).select(:id)).count,
        "prize_winning_tickets" => RafflePrize.where(tournament_id: tournament_ids).where.not(winning_ticket_id: nil).where.not(winning_ticket_id: tgt_tickets.select(:id)).count
      }
      orphans["missing_attachments"] = assets.missing_attachments.size if assets && !@allow_missing_attachments

      Verifier.verify!(source_metrics: source_metrics, target_metrics: target_metrics, orphans: orphans)
    end

    def valid_hex(val, fallback)
      val.to_s.match?(/\A#[0-9A-Fa-f]{6}\z/) ? val : fallback
    end

    def valid_tournament_status(status)
      Tournament::STATUSES.include?(status) ? status : "completed"
    end

    def valid_registration_status(status)
      %w[confirmed waitlist pending cancelled].include?(status) ? status : "confirmed"
    end

    def valid_payment_status(status)
      %w[paid unpaid pending refunded].include?(status) ? status : "unpaid"
    end

    def parse_json(val, fallback, expected_type: nil)
      return fallback if val.nil?

      parsed = if val.is_a?(Hash) || val.is_a?(Array)
                 val
               else
                 JSON.parse(val.to_s)
               end
      return fallback if expected_type && !parsed.is_a?(expected_type)

      parsed
    rescue JSON::ParserError => e
      Rails.logger.warn("[MawImporter] Failed to parse JSON column: #{e.class}")
      fallback
    end
  end
end
