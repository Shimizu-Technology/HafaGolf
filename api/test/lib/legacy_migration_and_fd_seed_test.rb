# frozen_string_literal: true

require "test_helper"
require "base64"
require "tmpdir"
require "zlib"
require_relative "../../lib/hafagolf_migrations/maw_importer"
require_relative "../../lib/hafagolf_migrations/giaa_importer"
require_relative "../../lib/hafagolf_seeds/fd_alumni_golf_seeder"

class LegacyMigrationAndFdSeedTest < ActiveSupport::TestCase
  setup do
    @current_db = ActiveRecord::Base.connection.current_database
  end

  test "DatabaseGuard rejects missing, mismatched, and forbidden database names" do
    assert_raises(HafagolfMigrations::UnsafeDatabaseError) do
      HafagolfMigrations::DatabaseGuard.verify!(expected_db_name: "")
    end

    assert_raises(HafagolfMigrations::UnsafeDatabaseError) do
      HafagolfMigrations::DatabaseGuard.verify!(expected_db_name: "wrong_db_name")
    end

    %w[api_development hafagolf_development].each do |forbidden|
      fake_conn = Struct.new(:current_database).new(forbidden)
      assert_raises(HafagolfMigrations::UnsafeDatabaseError) do
        HafagolfMigrations::DatabaseGuard.verify!(expected_db_name: forbidden, connection: fake_conn)
      end
    end

    assert_raises(HafagolfMigrations::UnsafeDatabaseError) do
      HafagolfMigrations::DatabaseGuard.verify_source_distinct!(source_db_name: @current_db)
    end

    assert_equal @current_db, HafagolfMigrations::DatabaseGuard.verify!(expected_db_name: @current_db)
  end

  test "Verifier raises VerificationMismatchError on any count, cent, or orphan drift" do
    err = assert_raises(HafagolfMigrations::VerificationMismatchError) do
      HafagolfMigrations::Verifier.verify!(
        source_metrics: { golfers: 10, gross_registration_cents: 125_000 },
        target_metrics: { golfers: 10, gross_registration_cents: 124_999 },
        orphans: { golfer_groups: 1 }
      )
    end

    assert_equal false, err.report["matched"]
    assert_equal 2, err.report["mismatches"].size
    assert_includes err.message, "gross_registration_cents"
    assert_includes err.message, "orphan_golfer_groups"
  end

  test "MawImporter imports synthetic snapshot with 100% verification and is idempotent on re-run" do
    captain_waiver = Time.utc(2026, 1, 1, 12, 0, 1)
    partner_waiver = Time.utc(2026, 1, 1, 12, 0, 2)
    checked_in = Time.utc(2026, 2, 1, 12, 0, 1)
    verified = Time.utc(2026, 2, 1, 12, 0, 2)
    brand = {
      "logo_url" => "https://assets.example.test/logo.png",
      "banner_url" => "https://assets.example.test/banner.png",
      "reversed_logo_url" => "https://assets.example.test/reversed.png",
      "offseason_enabled" => true, "offseason_title" => "See you next year",
      "offseason_message" => "Thanks for coming", "offseason_cta_label" => "Learn more",
      "offseason_cta_url" => "https://info.example.test/next"
    }
    tournament_fields = {
      "primary_color_override" => "#AABBCC", "accent_color_override" => "#CCDDEE",
      "use_org_branding" => false, "course_rating" => 71.3, "slope_rating" => 122,
      "handicap_required" => true, "handicap_max" => 26, "tee_times_enabled" => true,
      "tee_time_interval_minutes" => 13, "use_flights" => true, "event_type" => "golf_tournament",
      "waiver_enabled" => true, "waiver_text" => "Synthetic waiver text",
      "commemorative_banner_url" => "https://assets.example.test/commemorative.png",
      "tribute_title" => "Synthetic tribute", "tribute_subtitle" => "Synthetic subtitle",
      "show_public_sponsors" => false, "sponsor_wall_title" => "Synthetic sponsors"
    }
    config = {
      "sponsor_tiers" => [{ "key" => "gold", "name" => "Gold" }],
      "course_configs" => [{ "key" => "test-course", "name" => "Test Course", "hole_count" => 9 }],
      "raffle_bundles" => [{ "quantity" => 3, "price_cents" => 200, "label" => "Synthetic bundle" }],
      "teams_per_start_position" => 2, "raffle_include_with_registration" => true
    }
    fixture = {
      "organizations" => [
        brand.merge(
          "id" => 1, "name" => "Synthetic Charity", "primary_color" => "#0057B8",
          "description" => "Synthetic organization description",
          "contact_email" => "info@maw-synthetic.test", "contact_phone" => "671-555-0100",
          "settings" => {
            "homepage_stats" => { "players" => 42, "amount" => 17 },
            "homepage_mission" => ["Synthetic mission", { "api_key" => "fixture-only", "text" => "Public" }],
            "homepage_tagline" => "Synthetic tagline",
            "secondary_color" => "#123456", "accent_color" => "#789ABC",
            "features" => { "raffle" => false, "scoring" => true, "stripeWebhookSecret" => "fixture-only" },
            "stripe_secret_key" => "fixture-only", "stripe_webhook_secret" => "fixture-only",
            "stripe_public_key" => "fixture-only"
          }.to_json
        )
      ],
      "users" => [
        { "id" => 10, "name" => "Eric Coordinator", "email" => "ERIC.MIGRATE@MAW-SYNTHETIC.TEST", "role" => "org_admin" }
      ],
      "organization_memberships" => [
        { "user_id" => 10, "role" => "admin" }
      ],
      "tournaments" => [
        tournament_fields.merge(
          "id" => 1, "slug" => "maw-synthetic", "name" => "Synthetic Charity Tournament", "year" => 2026,
          "status" => "completed", "team_size" => 2, "entry_fee" => 25_000, "raffle_enabled" => true,
          "raffle_hold_winner_on_screen" => "f", "config" => config.to_json
        )
      ],
      "groups" => [
        { "id" => 100, "tournament_id" => 1, "group_number" => 1, "hole_number" => 1, "hole_position_label" => "1A" }
      ],
      "sponsors" => [
        { "id" => 200, "tournament_id" => 1, "name" => "Island Sponsor Co", "tier" => "gold", "slot_count" => 2, "active" => true }
      ],
      "golfers" => [
        {
          "id" => 300, "tournament_id" => 1, "group_id" => 100, "sponsor_id" => nil,
          "name" => "Captain One", "email" => "cap1@maw-synthetic.test", "phone" => "671-555-1111",
          "partner_name" => "Partner One", "partner_email" => "p1@maw-synthetic.test", "partner_phone" => "671-555-1112",
          "address" => "123 Test Lane", "mobile" => "671-555-0101", "tshirt_size" => "L",
          "partner_tshirt_size" => "M", "partner_waiver_accepted_at" => partner_waiver,
          "team_name" => "Synthetic Pair", "receipt_number" => "TEST-300", "payment_notes" => "Payment note",
          "refund_reason" => "Test reason", "payment_token" => "fixture-payment-token",
          "checked_in_at" => checked_in, "checked_in_by_id" => 10, "checked_in_by_name" => "Synthetic Check-in",
          "payment_verified_at" => verified, "payment_verified_by_id" => 10, "payment_verified_by_name" => "Synthetic Verifier",
          "stripe_checkout_session_id" => "cs_fixture_300", "stripe_card_brand" => "visa", "stripe_card_last4" => "4242",
          "raffle_tickets_requested" => 3, "raffle_bundle_label" => "Synthetic bundle", "notes" => "Synthetic registration",
          "team_category" => "Co-Ed", "registration_status" => "confirmed", "payment_type" => "swipe_simple",
          "payment_status" => "paid", "payment_method" => "swipe_simple", "payment_amount_cents" => 25_000
        },
        {
          "id" => 301, "tournament_id" => 1, "group_id" => nil, "sponsor_id" => 200,
          "name" => "Waitlist Two", "email" => "wait2@maw-synthetic.test", "phone" => "671-555-2222",
          "team_category" => "Male", "registration_status" => "waitlist", "payment_type" => "stripe",
          "payment_status" => "refunded", "payment_method" => "stripe", "payment_amount_cents" => 25_000,
          "waiver_accepted_at" => captain_waiver, "payment_token" => "fixture-payment-token",
          "refund_amount_cents" => 25_000, "stripe_payment_intent_id" => "pi_maw_mig_301", "stripe_refund_id" => "re_maw_mig_301"
        }
      ],
      "sponsor_slots" => [
        { "id" => 400, "sponsor_id" => 200, "slot_number" => 1, "player_name" => "Waitlist Two", "golfer_id" => 301, "tshirt_size" => "XL", "handicap" => "12.4" },
        { "id" => 401, "sponsor_id" => 200, "slot_number" => 2, "player_name" => nil, "golfer_id" => nil }
      ],
      "raffle_sale_batches" => [
        { "id" => 500, "tournament_id" => 1, "purchaser_name" => "Captain One", "purchaser_phone" => "+16715551111", "ticket_count" => 2, "total_cents" => 2_000, "payment_method" => "cash", "payment_status" => "paid", "sold_by_user_id" => 10 }
      ],
      "raffle_prizes" => [
        { "id" => 600, "tournament_id" => 1, "name" => "Grand Resort Stay", "position" => 1, "value_cents" => 100_000, "tier" => "grand", "drawn" => true, "winning_ticket_id" => 700 }
      ],
      "raffle_tickets" => [
        { "id" => 700, "tournament_id" => 1, "raffle_sale_batch_id" => 500, "golfer_id" => 300, "raffle_prize_id" => 600, "ticket_number" => "MAW26-0001", "sequence_number" => 1, "purchaser_name" => "Captain One", "purchaser_phone" => "+16715551111", "price_cents" => 1_000, "payment_status" => "paid", "payment_method" => "cash", "is_winner" => true, "sold_by_user_id" => 10 },
        { "id" => 701, "tournament_id" => 1, "raffle_sale_batch_id" => 500, "golfer_id" => 300, "ticket_number" => "MAW26-0002", "sequence_number" => 2, "purchaser_name" => "Captain One", "purchaser_phone" => "+16715551111", "price_cents" => 1_000, "payment_status" => "paid", "payment_method" => "cash", "is_winner" => false, "sold_by_user_id" => 10 }
      ],
      "message_deliveries" => [
        { "id" => 800, "tournament_id" => 1, "golfer_id" => 300, "raffle_ticket_id" => 700, "channel" => "sms", "provider" => "clicksend", "purpose" => "raffle_purchase_confirmation", "recipient" => "+16715551111", "status" => "delivered", "provider_message_id" => "cs-mig-800" }
      ],
      "activity_logs" => [
        { "id" => 900, "tournament_id" => 1, "admin_id" => 10, "action" => "raffle_prize_drawn", "target_type" => "RafflePrize", "target_name" => "Grand Resort Stay", "details" => "Drew winner" }
      ]
    }

    reader = HafagolfMigrations::SourceReader.from_hash(fixture)
    report1 = HafagolfMigrations::MawImporter.new(source_reader: reader, expected_db_name: @current_db).run!
    assert_equal true, report1["matched"]
    assert_equal 2, report1.dig("target", "golfers")
    assert_equal 50_000, report1.dig("target", "gross_registration_cents")
    assert_equal 25_000, report1.dig("target", "refund_cents")
    assert_equal 2_000, report1.dig("target", "raffle_paid_cents")
    assert_equal 1, report1.dig("target", "message_deliveries")

    assert_equal 2, report1.dig("target", "registrations")
    assert_equal 1, report1.dig("target", "waivers_signed")
    assert_equal 1, report1.dig("target", "partner_waivers_signed")
    assert_equal 1, report1.dig("target", "checked_in_golfers")
    assert_equal 1, report1.dig("target", "payment_verified_golfers")

    user = User.find_by!("LOWER(email) = ?", "eric.migrate@maw-synthetic.test")
    assert user.clerk_id.start_with?("pending_")
    org = Organization.find_by!(slug: "make-a-wish-guam")
    tournament = org.tournaments.find_by!(slug: "maw-synthetic")
    assert org.organization_domains.exists?(hostname: "golfforwishes.com", is_primary: true)
    assert_equal org.id, MessageDelivery.find_by!(provider_message_id: "cs-mig-800").organization_id
    assert_equal brand, org.attributes.slice(*brand.keys)
    assert_equal tournament_fields.transform_values { |v| v.is_a?(Float) ? BigDecimal(v.to_s) : v },
                 tournament.attributes.slice(*tournament_fields.keys)
    assert_equal "charity-bright", tournament.theme_preset
    assert_equal false, tournament.raffle_hold_winner_on_screen?
    assert_equal %w[test-course], tournament.course_configs.map { |course| course["key"] }
    assert_equal config.except("course_configs"), tournament.config.slice(*config.except("course_configs").keys)

    settings = org.settings
    assert_equal({ "players" => 42, "amount" => 17 }, settings["homepage_stats"])
    assert_equal ["Synthetic mission", { "text" => "Public" }], settings["homepage_mission"]
    assert_equal "Synthetic tagline", settings["homepage_tagline"]
    assert_equal "#123456", settings["secondary_color"]
    assert_equal "#789ABC", settings["accent_color"]
    assert_equal false, settings.dig("features", "raffle")
    assert_equal true, settings.dig("features", "scoring")
    assert_equal true, settings.dig("features", "sponsor_portal")
    refute_includes settings.to_json, "fixture-only"

    reg = Registration.find_by!(legacy_source: "maw", legacy_id: "300")
    golfer = reg.golfer
    captain, partner = reg.team_members
    assert_nil golfer.waiver_accepted_at
    assert_nil captain.waiver_accepted_at
    assert_equal partner_waiver, golfer.partner_waiver_accepted_at
    assert_equal partner_waiver, partner.waiver_accepted_at
    assert_equal "L", captain.tshirt_size
    assert_equal "M", partner.tshirt_size
    [golfer, captain].each do |player|
      assert_equal "123 Test Lane", player.address
      assert_equal "671-555-0101", player.mobile
    end
    [golfer, captain, partner].each do |player|
      assert_equal checked_in, player.checked_in_at
      assert_equal user.id, player.checked_in_by_id
      assert_equal "Synthetic Check-in", player.checked_in_by_name
    end
    [golfer, reg].each do |record|
      assert_equal "Synthetic Pair", record.team_name
      assert_equal "TEST-300", record.receipt_number
      assert_equal "Payment note", record.payment_notes
      assert_equal "Test reason", record.refund_reason
      assert_equal "fixture-payment-token", record.payment_token
      assert_equal verified, record.payment_verified_at
      assert_equal user.id, record.payment_verified_by_id
      assert_equal "Synthetic Verifier", record.payment_verified_by_name
      assert_equal "cs_fixture_300", record.stripe_checkout_session_id
      assert_equal "visa", record.stripe_card_brand
      assert_equal "4242", record.stripe_card_last4
      assert_equal 3, record.raffle_tickets_requested
      assert_equal "Synthetic bundle", record.raffle_bundle_label
    end
    assert_equal "Synthetic registration", reg.notes

    sponsored_reg = Registration.find_by!(legacy_source: "maw", legacy_id: "301")
    sponsored_member = sponsored_reg.team_members.sole
    slots = tournament.sponsors.sole.sponsor_slots.order(:slot_number)
    assert_equal [1, 2], slots.pluck(:slot_number)
    assert_equal slots.first, sponsored_member.sponsor_slot
    assert_equal "XL", slots.first.tshirt_size
    assert_equal BigDecimal("12.4"), slots.first.handicap
    assert_equal "re_maw_mig_301", sponsored_reg.stripe_refund_id
    assert_equal captain_waiver, sponsored_member.waiver_accepted_at
    assert_nil sponsored_reg.payment_token
    assert_nil sponsored_reg.golfer.payment_token

    org.update!(logo_url: "https://manual.example.test/logo.png", reversed_logo_url: nil, contact_email: "",
                offseason_title: "", contact_phone: "671-555-0102",
                settings: { "homepage_stats" => { "players" => 50 }, "features" => { "scoring" => false } })
    tournament.update!(theme_preset: "classic", course_rating: nil, tribute_subtitle: "Edited",
                       config: { "teams_per_start_position" => 3, "raffle_hold_winner_on_screen" => true })
    golfer.update!(notes: "Edited golfer notes", address: "Edited address")
    reg.update!(payment_notes: "Edited payment note", receipt_number: nil)
    partner.update!(tshirt_size: "XL")
    report2 = HafagolfMigrations::MawImporter.new(source_reader: reader, expected_db_name: @current_db).run!
    assert_equal report1["target"], report2["target"]
    assert_equal "https://manual.example.test/logo.png", org.reload.logo_url
    assert_equal brand["reversed_logo_url"], org.reversed_logo_url
    assert_equal "info@maw-synthetic.test", org.contact_email
    assert_equal "671-555-0102", org.contact_phone
    assert_equal brand["offseason_title"], org.offseason_title
    assert_equal({ "players" => 50, "amount" => 17 }, org.settings["homepage_stats"])
    assert_equal false, org.settings.dig("features", "scoring")
    assert_equal "charity-bright", tournament.reload.theme_preset
    assert_equal BigDecimal("71.3"), tournament.course_rating
    assert_equal "Edited", tournament.tribute_subtitle
    assert_equal 3, tournament.config["teams_per_start_position"]
    assert_equal config["raffle_bundles"], tournament.config["raffle_bundles"]
    assert_equal true, tournament.raffle_hold_winner_on_screen?
    assert_equal "Edited golfer notes", golfer.reload.notes
    assert_equal "Edited address", golfer.address
    assert_equal "TEST-300", reg.reload.receipt_number
    assert_equal "Edited payment note", reg.payment_notes
    assert_equal "XL", partner.reload.tshirt_size

    tournament.update!(theme_preset: "crest-classic")
    assert_equal report1["target"], HafagolfMigrations::MawImporter.new(source_reader: reader, expected_db_name: @current_db).run!["target"]
    assert_equal "crest-classic", tournament.reload.theme_preset
  end

  test "GiaaImporter imports registry and branding parity without copying plaintext secrets" do
    checked_in = Time.utc(2026, 1, 1, 12, 0, 1)
    brand = {
      "logo_url" => "https://assets.example.test/memorial-logo.png",
      "banner_url" => "https://assets.example.test/memorial-banner.png",
      "reversed_logo_url" => "https://assets.example.test/memorial-reversed.png",
      "offseason_enabled" => true, "offseason_title" => "Closed for the season",
      "offseason_message" => "Thanks for playing", "offseason_cta_label" => "More information",
      "offseason_cta_url" => "https://info.example.test/next"
    }
    fixture = {
      "settings" => [
        brand.merge(
          "organization_name" => "Synthetic Memorial",
          "stripe_secret_key" => "fixture-only",
          "contact_email" => "info@giaa-synthetic.test",
          "tournament_title" => "Synthetic Memorial Week",
          "tribute_subtitle" => "Synthetic tribute"
        )
      ],
      "admins" => [
        { "id" => 1, "name" => "GIAA Coordinator", "email" => "admin@giaa-synthetic.test" }
      ],
      "tournaments" => [
        { "id" => 1, "slug" => "giaa-2026-mig", "name" => "5th Annual GIAA Memorial", "year" => 2026, "status" => "completed", "entry_fee" => 12_500 }
      ],
      "groups" => [
        { "id" => 10, "tournament_id" => 1, "group_number" => 1, "hole_number" => 7, "hole_position_label" => "7A" }
      ],
      "golfers" => [
        {
          "id" => 50, "tournament_id" => 1, "group_id" => 10,
          "name" => "Memorial Player", "email" => "player@giaa-synthetic.test", "phone" => "671-555-3333",
          "team_category" => "Male", "registration_status" => "confirmed", "payment_type" => "stripe",
          "payment_status" => "paid", "payment_method" => "stripe", "payment_amount_cents" => 12_500,
          "stripe_payment_intent_id" => "pi_giaa_mig_50", "stripe_checkout_session_id" => "cs_fixture_50",
          "stripe_card_brand" => "visa", "stripe_card_last4" => "4242", "stripe_refund_id" => "re_fixture_50",
          "address" => "123 Test Avenue", "mobile" => "671-555-0103", "tshirt_size" => "M",
          "payment_token" => "synthetic-memorial-payment-token", "receipt_number" => "TEST-50",
          "payment_notes" => "Synthetic payment", "refund_reason" => "Synthetic refund", "notes" => "Synthetic registration",
          "checked_in_at" => checked_in
        }
      ],
      "activity_logs" => [
        { "id" => 60, "tournament_id" => 1, "admin_id" => 1, "action" => "golfer_checked_in", "target_type" => "Golfer", "target_name" => "Memorial Player", "details" => "Checked in" }
      ]
    }

    reader = HafagolfMigrations::SourceReader.from_hash(fixture)
    report1 = HafagolfMigrations::GiaaImporter.new(source_reader: reader, expected_db_name: @current_db).run!
    assert_equal true, report1["matched"]
    assert_equal 1, report1.dig("target", "golfers")
    assert_equal 12_500, report1.dig("target", "gross_registration_cents")

    assert_equal 1, report1.dig("target", "registrations")
    assert_equal 1, report1.dig("target", "golfers_with_address")
    assert_equal 1, report1.dig("target", "golfers_with_receipt")
    assert_equal 0, report1.dig("target", "waivers_signed")
    assert_equal 0, report1.dig("target", "employee_numbers_used")

    org = Organization.find_by!(slug: "giaa")
    tournament = org.tournaments.find_by!(slug: "giaa-2026-mig")
    assert org.organization_domains.exists?(hostname: "giaa-tournament.com", is_primary: true)
    assert_equal brand, org.attributes.slice(*brand.keys)
    refute_includes org.settings.to_json, "fixture-only"
    assert_nil org.organization_payment_config.encrypted_secret_key
    assert_equal "memorial-formal", tournament.theme_preset
    assert_equal "Synthetic Memorial Week", tournament.tribute_title
    assert_equal "Synthetic tribute", tournament.tribute_subtitle

    reg = Registration.find_by!(legacy_source: "giaa", legacy_id: "50")
    golfer = reg.golfer
    member = reg.team_members.sole
    [golfer, member].each do |player|
      assert_equal "123 Test Avenue", player.address
      assert_equal "671-555-0103", player.mobile
      assert_equal "M", player.tshirt_size
      assert_nil player.waiver_accepted_at
      assert_equal checked_in, player.checked_in_at
    end
    [golfer, reg].each do |record|
      assert_equal "synthetic-memorial-payment-token", record.payment_token
      assert_equal "TEST-50", record.receipt_number
      assert_equal "Synthetic payment", record.payment_notes
      assert_equal "Synthetic refund", record.refund_reason
      assert_equal "cs_fixture_50", record.stripe_checkout_session_id
      assert_equal "visa", record.stripe_card_brand
      assert_equal "4242", record.stripe_card_last4
      assert_equal "re_fixture_50", record.stripe_refund_id
    end
    assert_equal "Synthetic registration", reg.notes
    assert tournament.waiver_enabled?

    org.update!(logo_url: "https://manual.example.test/logo.png", banner_url: nil, offseason_title: "",
                offseason_enabled: false, offseason_message: "Edited message")
    tournament.update!(theme_preset: "classic", tribute_title: nil, tribute_subtitle: "Edited tribute")
    reg.update!(notes: "Edited registration", stripe_card_brand: nil)
    member.update!(mobile: "671-555-0104", address: nil)
    report2 = HafagolfMigrations::GiaaImporter.new(source_reader: reader, expected_db_name: @current_db).run!
    assert_equal report1["target"], report2["target"]

    assert_equal "https://manual.example.test/logo.png", org.reload.logo_url
    assert_equal brand["banner_url"], org.banner_url
    assert_equal brand["offseason_title"], org.offseason_title
    assert_equal false, org.offseason_enabled
    assert_equal "Edited message", org.offseason_message
    assert_equal "memorial-formal", tournament.reload.theme_preset
    assert_equal "Synthetic Memorial Week", tournament.tribute_title
    assert_equal "Edited tribute", tournament.tribute_subtitle
    assert_equal "Edited registration", reg.reload.notes
    assert_equal "visa", reg.stripe_card_brand
    assert_equal "123 Test Avenue", member.reload.address
    assert_equal "671-555-0104", member.mobile
  end

  test "FdAlumniGolfSeeder idempotently seeds FD Alumni Golf org, domain, crest-classic maroon/gold, and foursome tournament" do
    res1 = HafagolfSeeds::FdAlumniGolfSeeder.seed!(expected_db_name: @current_db)
    res2 = HafagolfSeeds::FdAlumniGolfSeeder.seed!(expected_db_name: @current_db)

    assert_equal res1, res2
    assert_equal "fd-alumni-golf", res1[:organization_slug]
    assert_equal "fd-golf.shimizu-technology.com", res1[:primary_host]
    assert_equal "crest-classic", res1[:theme_preset]
    assert_equal 4, res1[:team_size]

    org = Organization.find_by!(slug: "fd-alumni-golf")
    assert_equal "#6B1D2F", org.primary_color
    assert_equal "#C5A059", org.settings["accent_color"]
    assert_equal true, Features.for(org).enabled?(:sponsor_checkout)
    assert_equal true, Features.for(org).enabled?(:donations)
    assert org.organization_domains.exists?(hostname: "fd-golf.shimizu-technology.com", is_primary: true)
    assert_equal 1, org.tournaments.where(slug: "fd-alumni-golf-2027").count

    # Live admin edits MUST survive re-running the seeder
    tournament = org.tournaments.find_by!(slug: "fd-alumni-golf-2027")
    tournament.update!(status: "open", registration_open: true, entry_fee: 17_500)
    org.update!(name: "FD Alumni Golf Custom")

    HafagolfSeeds::FdAlumniGolfSeeder.seed!(expected_db_name: @current_db)
    tournament.reload
    org.reload
    assert_equal "open", tournament.status
    assert_equal true, tournament.registration_open
    assert_equal 17_500, tournament.entry_fee
    assert_equal "FD Alumni Golf Custom", org.name
  end

  test "importers cap legacy super_admin to org_admin, refuse empty/same-DB sources, default blank delivery status to pending, and preserve live edits on rerun" do
    # 1. Empty / missing core tables refused (never silent 0 == 0)
    empty_reader = HafagolfMigrations::SourceReader.from_hash({})
    assert_raises(HafagolfMigrations::InvalidSourceError) do
      HafagolfMigrations::MawImporter.new(source_reader: empty_reader, expected_db_name: @current_db).run!
    end
    assert_raises(HafagolfMigrations::InvalidSourceError) do
      HafagolfMigrations::GiaaImporter.new(source_reader: empty_reader, expected_db_name: @current_db).run!
    end

    # 2. Same source DB as target DB refused
    same_db_reader = HafagolfMigrations::SourceReader.from_hash(
      { "tournaments" => [{ "id" => 1 }], "golfers" => [{ "id" => 1 }] },
      database_name: @current_db
    )
    assert_raises(HafagolfMigrations::UnsafeDatabaseError) do
      HafagolfMigrations::MawImporter.new(source_reader: same_db_reader, expected_db_name: @current_db).run!
    end

    # 3. Legacy super_admin capped at org_admin + blank delivery status -> pending + reruns preserve live edits
    fixture = {
      "users" => [
        { "id" => 77, "name" => "Legacy Super", "email" => "legacy-super@maw-sec.test", "role" => "super_admin" }
      ],
      "tournaments" => [
        { "id" => 77, "slug" => "maw-sec-2026", "name" => "MAW Security 2026", "year" => 2026, "status" => "draft", "registration_open" => false, "entry_fee" => 25_000 }
      ],
      "golfers" => [
        { "id" => 770, "tournament_id" => 77, "name" => "Sec Golfer", "email" => "sec@maw-sec.test", "phone" => "671-555-7700", "payment_status" => "paid", "payment_amount_cents" => 25_000 }
      ],
      "message_deliveries" => [
        { "id" => 771, "tournament_id" => 77, "golfer_id" => 770, "recipient" => "+16715557700", "status" => "", "provider_message_id" => "cs-blank-status-771" }
      ]
    }
    reader = HafagolfMigrations::SourceReader.from_hash(fixture)
    HafagolfMigrations::MawImporter.new(source_reader: reader, expected_db_name: @current_db).run!

    imported_user = User.find_by!(email: "legacy-super@maw-sec.test")
    assert_equal "org_admin", imported_user.role, "Importer must NEVER escalate a legacy user to super_admin"

    delivery = MessageDelivery.find_by!(provider_message_id: "cs-blank-status-771")
    assert_equal "pending", delivery.status, "Blank legacy status must default to pending, not delivered"

    org = Organization.find_by!(slug: "make-a-wish-guam")
    tournament = org.tournaments.find_by!(slug: "maw-sec-2026")
    membership = OrganizationMembership.find_by!(user: imported_user, organization: org)
    tournament.update!(status: "open", registration_open: true, entry_fee: 30_000)
    membership.update!(role: "volunteer")

    # Re-run MUST preserve live edits
    HafagolfMigrations::MawImporter.new(source_reader: reader, expected_db_name: @current_db).run!
    tournament.reload
    membership.reload
    assert_equal "open", tournament.status
    assert_equal true, tournament.registration_open
    assert_equal 30_000, tournament.entry_fee
    assert_equal "volunteer", membership.role
  end

  test "SourceReader encodes libpq read-only options with %20 (never +) and opens a real read-only PG session" do
    reader = HafagolfMigrations::SourceReader.from_database_url("postgresql://localhost/#{@current_db}")
    encoded = reader.send(:readonly_connection_url, "postgresql://localhost/#{@current_db}")
    assert_includes encoded, "options=-c%20default_transaction_read_only%3Don"
    assert_not_includes encoded, "+"

    # Verify real libpq connection succeeds and enforces read-only transaction mode
    cfg = ActiveRecord::Base.connection_db_config.configuration_hash
    host = cfg[:host].presence || "localhost"
    port = cfg[:port].presence || 5432
    user_part = cfg[:username].present? ? "#{cfg[:username]}#{cfg[:password].present? ? ":#{cfg[:password]}" : ''}@" : ""
    live_url = "postgresql://#{user_part}#{host}:#{port}/#{@current_db}"

    live_reader = HafagolfMigrations::SourceReader.from_database_url(live_url)
    begin
      assert_equal @current_db, live_reader.database_name
      ro_setting = live_reader.send(:pg_connection).exec("SHOW default_transaction_read_only").getvalue(0, 0)
      assert_equal "on", ro_setting
    ensure
      live_reader.close
    end
  end

  test "MawImporter imports JSON-string multi-course config, groups with starting_course_key, duplicate public emails, and blank-method raffle tickets" do
    course_config_json = {
      "course_configs" => [
        { "key" => "north", "name" => "North Nine", "hole_count" => 9 },
        { "key" => "south", "name" => "South Nine", "hole_count" => 9 }
      ],
      "teams_per_start_position" => 2
    }.to_json

    fixture = {
      "organizations" => [{ "id" => 1, "name" => "Synthetic Charity Org" }],
      "tournaments" => [
        {
          "id" => 11, "slug" => "maw-multicourse-2026", "name" => "Multi Course 2026",
          "year" => 2026, "status" => "open", "team_size" => 2, "max_capacity" => 1,
          "entry_fee" => 30_000, "raffle_enabled" => true, "config" => course_config_json,
          "event_schedule" => "7:00 AM Registration\n8:00 AM Shotgun Start"
        }
      ],
      "sponsors" => [
        { "id" => 151, "tournament_id" => 11, "name" => "Duplicate Tier Sponsor", "tier" => "hole", "hole_number" => 1, "course_key" => "north", "slot_count" => 0, "active" => true },
        { "id" => 152, "tournament_id" => 11, "name" => "Duplicate Tier Sponsor", "tier" => "hole", "hole_number" => 2, "course_key" => "south", "slot_count" => 0, "active" => true }
      ],
      "groups" => [
        { "id" => 101, "tournament_id" => 11, "group_number" => 1, "hole_number" => 1, "starting_course_key" => "north" },
        { "id" => 102, "tournament_id" => 11, "group_number" => 2, "hole_number" => 4, "starting_course_key" => "south" }
      ],
      "golfers" => [
        {
          "id" => 201, "tournament_id" => 11, "group_id" => 101,
          "name" => "Avery Lindqvist", "email" => "shared-coord@example.test", "phone" => "671-555-0101",
          "partner_name" => "Bram Okafor", "partner_email" => "bram@example.test",
          "registration_source" => "public", "registration_status" => "confirmed",
          "payment_status" => "paid", "payment_amount_cents" => 30_000
        },
        {
          "id" => 202, "tournament_id" => 11, "group_id" => 102,
          "name" => "Calla Yorke", "email" => "shared-coord@example.test", "phone" => "671-555-0102",
          "registration_source" => "admin", "registration_status" => "confirmed",
          "payment_status" => "paid", "payment_amount_cents" => 30_000
        }
      ],
      "raffle_prizes" => [
        { "id" => 401, "tournament_id" => 11, "name" => "Gift Certificate", "position" => 0, "value_cents" => 10_000, "tier" => "standard" },
        { "id" => 402, "tournament_id" => 11, "name" => "Gift Certificate", "position" => 0, "value_cents" => 10_000, "tier" => "standard" }
      ],
      "raffle_tickets" => [
        {
          "id" => 301, "tournament_id" => 11, "golfer_id" => 201, "ticket_number" => "SYN26-0001", "sequence_number" => 1,
          "purchaser_name" => "Avery Lindqvist", "purchaser_phone" => "+16715550101",
          "price_cents" => 500, "payment_status" => "paid", "payment_method" => nil
        },
        {
          "id" => 302, "tournament_id" => 11, "ticket_number" => "SYN26-0002", "sequence_number" => 2,
          "purchaser_name" => "Avery Lindqvist", "purchaser_phone" => "+16715550101",
          "price_cents" => 500, "payment_status" => "voided", "payment_method" => ""
        }
      ]
    }

    reader = HafagolfMigrations::SourceReader.from_hash(fixture)
    report1 = HafagolfMigrations::MawImporter.new(source_reader: reader, expected_db_name: @current_db).run!
    assert_equal true, report1["matched"]
    assert_equal 2, report1.dig("target", "groups")
    assert_equal 2, report1.dig("target", "golfers")
    assert_equal 3, report1.dig("target", "team_members")
    assert_equal 2, report1.dig("target", "sponsors")
    assert_equal 2, report1.dig("target", "raffle_prizes")
    assert_equal 500, report1.dig("target", "raffle_paid_cents")

    tournament = Tournament.find_by!(slug: "maw-multicourse-2026")
    assert_equal %w[north south], tournament.course_configs.map { |c| c["key"] }
    assert_equal "7:00 AM Registration\n8:00 AM Shotgun Start", tournament.event_schedule
    assert_equal "north", tournament.groups.find_by!(group_number: 1).starting_course_key
    ticket1 = tournament.raffle_tickets.find_by!(ticket_number: "SYN26-0001")
    assert_nil ticket1.payment_method
    assert_equal Registration.find_by!(legacy_source: "maw", legacy_id: "201").id, ticket1.registration_id
    assert_equal %w[151 152], tournament.sponsors.where(legacy_source: "maw").order(:legacy_id).pluck(:legacy_id)

    report2 = HafagolfMigrations::MawImporter.new(source_reader: reader, expected_db_name: @current_db).run!
    assert_equal report1["target"], report2["target"]
  end

  test "GiaaImporter imports 4-player foursomes under team_size 1, duplicate public emails, and links employee_numbers to registrations and team_members" do
    fixture = {
      "settings" => [{ "organization_name" => "Synthetic Memorial Org" }],
      "tournaments" => [
        {
          "id" => 21, "slug" => "giaa-foursome-2026", "name" => "Synthetic Memorial 2026",
          "year" => 2026, "status" => "open", "max_capacity" => 2, "entry_fee" => 12_500,
          "employee_entry_fee" => 5_000
        }
      ],
      "groups" => [
        { "id" => 201, "tournament_id" => 21, "group_number" => 1, "hole_number" => 1 }
      ],
      "golfers" => [1, 2, 3, 4].map do |n|
        {
          "id" => 400 + n, "tournament_id" => 21, "group_id" => 201,
          "name" => "Synthetic Player #{n}",
          "email" => "player#{n}@example.test",
          "phone" => "671-555-011#{n}", "registration_status" => "confirmed",
          "payment_status" => "paid", "payment_type" => "pay_on_day", "payment_method" => "cash",
          "payment_amount_cents" => n == 1 ? 5_000 : 12_500, "is_employee" => (n == 1)
        }
      end,
      "employee_numbers" => [
        { "id" => 501, "tournament_id" => 21, "employee_number" => "EMP-001", "employee_name" => "Synthetic Player 1", "used" => true, "used_by_golfer_id" => 401 }
      ]
    }

    reader = HafagolfMigrations::SourceReader.from_hash(fixture)
    report1 = HafagolfMigrations::GiaaImporter.new(source_reader: reader, expected_db_name: @current_db).run!
    assert_equal true, report1["matched"]
    assert_equal 4, report1.dig("target", "golfers")
    assert_equal 4, report1.dig("target", "team_members")
    assert_equal 1, report1.dig("target", "employee_numbers")
    assert_equal 1, report1.dig("target", "employee_numbers_used")

    tournament = Tournament.find_by!(slug: "giaa-foursome-2026")
    assert_equal 4, tournament.players_per_start_position
    assert_equal true, tournament.employee_discount_enabled
    assert_equal 5_000, tournament.employee_entry_fee

    emp = EmployeeNumber.find_by!(tournament: tournament, employee_number: "EMP-001")
    reg = Registration.find_by!(legacy_source: "giaa", legacy_id: "401")
    golfer = Golfer.find(emp.used_by_golfer_id)
    assert_equal reg.id, emp.used_by_registration_id
    assert_equal emp.id, golfer.employee_number_record_id
    assert_equal emp.id, reg.team_members.first.employee_number_record_id
    assert_equal true, reg.team_members.first.is_employee

    report2 = HafagolfMigrations::GiaaImporter.new(source_reader: reader, expected_db_name: @current_db).run!
    assert_equal report1["target"], report2["target"]
  end

  test "MawImporter migrates local attachments and brand assets once and preserves updated URLs" do
    with_synthetic_asset_directories do |blob_dir, brand_dir|
      %w[sponsor-blob prize-blob banner-blob other-banner-blob].each_with_index do |key, i|
        File.binwrite(File.join(blob_dir, key), synthetic_png(i))
      end
      %w[maw-logo.png maw-logo-rev.png maw-hero.jpg maw-star-icon.png].each do |filename|
        File.binwrite(File.join(brand_dir, filename), synthetic_png(9))
      end
      legacy_host = "https://old-api.onrender.com"
      legacy_blob_token = Base64.urlsafe_encode64({ "_rails" => { "data" => 3, "pur" => "blob_id" } }.to_json)
      legacy_banner = "#{legacy_host}/rails/active_storage/blobs/redirect/#{legacy_blob_token}--legacy-signature/synthetic-banner.png"
      legacy_logo = "#{legacy_host}/rails/active_storage/blobs/redirect/unreadable-token/synthetic-logo.png"
      fixture = {
        "organizations" => [{ "logo_url" => "#{legacy_host}/old-logo.png" }],
        "tournaments" => [
          { "id" => 1, "slug" => "synthetic-assets", "banner_url_override" => legacy_banner, "logo_url_override" => legacy_logo },
          { "id" => 2, "slug" => "synthetic-hero-fallback" }
        ],
        "golfers" => [{ "id" => 1, "tournament_id" => 1 }],
        "sponsors" => [
          { "id" => 1, "tournament_id" => 1, "logo_url" => "#{legacy_host}/sponsor.png" },
          { "id" => 2, "tournament_id" => 1, "logo_url" => "#{legacy_host}/missing.png" }
        ],
        "raffle_prizes" => [{ "id" => 1, "tournament_id" => 1, "image_url" => legacy_banner }],
        "active_storage_blobs" => [
          { "id" => 1, "key" => "sponsor-blob", "filename" => "sponsor.png", "content_type" => "image/png" },
          { "id" => 2, "key" => "prize-blob", "filename" => "prize.png", "content_type" => "image/png" },
          { "id" => 3, "key" => "banner-blob", "filename" => "synthetic-banner.png", "content_type" => "image/png" },
          { "id" => 4, "key" => "other-banner-blob", "filename" => "synthetic-banner.png", "content_type" => "image/png" },
          { "id" => 5, "key" => "missing-blob", "filename" => "missing.png", "content_type" => "image/png" },
          { "id" => 6, "key" => "banner-blob", "filename" => "synthetic-logo.png", "content_type" => "image/png" }
        ],
        "active_storage_attachments" => [
          { "record_type" => "Sponsor", "record_id" => 1, "name" => "logo", "blob_id" => 1 },
          { "record_type" => "Sponsor", "record_id" => 2, "name" => "logo", "blob_id" => 5 },
          { "record_type" => "RafflePrize", "record_id" => 1, "name" => "image", "blob_id" => 2 }
        ]
      }
      strict_importer = HafagolfMigrations::MawImporter.new(
        source_reader: HafagolfMigrations::SourceReader.from_hash(fixture), expected_db_name: @current_db,
        blob_dir: blob_dir, brand_assets_dir: brand_dir, asset_host: "https://api.example.test"
      )
      assert_no_difference ["ActiveStorage::Blob.count", "ActiveStorage::Attachment.count"] do
        assert_raises(HafagolfMigrations::VerificationMismatchError) { strict_importer.run! }
      end

      importer = HafagolfMigrations::MawImporter.new(
        source_reader: HafagolfMigrations::SourceReader.from_hash(fixture), expected_db_name: @current_db,
        blob_dir: blob_dir, brand_assets_dir: brand_dir, asset_host: "https://api.example.test",
        allow_missing_attachments: true
      )

      report = nil
      assert_difference "ActiveStorage::Blob.count", 7 do
        assert_difference "ActiveStorage::Attachment.count", 2 do
          report = importer.run!
        end
      end
      assert_equal 8, report["attachments_migrated"]
      assert_equal 5, report["attachments_expected"]
      assert_equal 4, report["attachments_present"]
      assert_equal 1, report["attachments_missing"].size

      org = Organization.find_by!(slug: "make-a-wish-guam")
      tournament = org.tournaments.find_by!(slug: "synthetic-assets")
      fallback = org.tournaments.find_by!(slug: "synthetic-hero-fallback")
      sponsor = tournament.sponsors.find_by!(legacy_id: "1")
      missing_sponsor = tournament.sponsors.find_by!(legacy_id: "2")
      prize = tournament.raffle_prizes.sole
      assert_equal synthetic_png(0), sponsor.logo.download
      assert_equal synthetic_png(1), prize.image.download
      assert_nil sponsor.logo_url
      assert_nil prize.image_url
      refute missing_sponsor.logo.attached?
      assert_equal "#{legacy_host}/missing.png", missing_sponsor.logo_url

      assert_match(%r{\Ahttps://api\.example\.test/rails/active_storage/blobs/redirect/}, tournament.banner_url_override)
      assert_equal synthetic_png(2), uploaded_url_blob(tournament.banner_url_override).download
      assert_equal tournament.banner_url_override, tournament.logo_url_override
      assert_equal "maw-logo.png", uploaded_url_blob(org.logo_url).filename.to_s
      assert_equal "maw-logo-rev.png", uploaded_url_blob(org.reversed_logo_url).filename.to_s
      assert_equal "maw-hero.jpg", uploaded_url_blob(org.banner_url).filename.to_s
      assert_equal org.banner_url, fallback.banner_url_override
      assert_equal "maw-star-icon.png", uploaded_url_blob(tournament.signature_image_url_override).filename.to_s

      sponsor.update!(logo_url: "https://manual.example.test/sponsor.png")
      tournament.update!(signature_image_url_override: "https://manual.example.test/signature.png")
      assert_no_difference ["ActiveStorage::Blob.count", "ActiveStorage::Attachment.count"] do
        assert_equal 0, importer.run!["attachments_migrated"]
      end
      assert_equal "https://manual.example.test/sponsor.png", sponsor.reload.logo_url
      assert_equal "https://manual.example.test/signature.png", tournament.reload.signature_image_url_override

      # Reuse existing blobs when a blank field needs the same asset again.
      fallback.update!(banner_url_override: nil)
      assert_no_difference "ActiveStorage::Blob.count" do
        assert_equal 1, importer.run!["attachments_migrated"]
      end
      assert_equal org.banner_url, fallback.reload.banner_url_override
    end
  end

  test "GiaaImporter wires static brand assets with relative paths and reuses blobs by checksum" do
    with_synthetic_asset_directories do |_blob_dir, brand_dir|
      File.binwrite(File.join(brand_dir, "giaa-logo.png"), synthetic_png(4))
      File.binwrite(File.join(brand_dir, "giaa-50-header.png"), synthetic_png(5))
      File.binwrite(File.join(brand_dir, "pete-silhouette.png"), synthetic_png(4))
      fixture = {
        "settings" => [{ "tournament_title" => "", "tribute_subtitle" => "Synthetic tribute fallback" }],
        "tournaments" => [{ "id" => 1, "slug" => "synthetic-memorial-assets" }],
        "golfers" => [{ "id" => 1, "tournament_id" => 1, "payment_token" => " " }]
      }
      importer = HafagolfMigrations::GiaaImporter.new(
        source_reader: HafagolfMigrations::SourceReader.from_hash(fixture), expected_db_name: @current_db,
        brand_assets_dir: brand_dir, asset_host: nil
      )
      assert_difference "ActiveStorage::Blob.count", 2 do
        assert importer.run!["matched"]
      end

      org = Organization.find_by!(slug: "giaa")
      tournament = org.tournaments.sole
      registration = tournament.registrations.sole
      assert_equal "Synthetic tribute fallback", tournament.tribute_title
      assert_nil registration.payment_token
      assert_nil registration.golfer.payment_token
      assert_match(%r{\A/rails/active_storage/blobs/redirect/}, org.logo_url)
      assert_equal synthetic_png(4), uploaded_url_blob(org.logo_url).download
      assert_equal org.logo_url, tournament.signature_image_url_override
      assert_equal synthetic_png(5), uploaded_url_blob(tournament.commemorative_banner_url).download
      assert_equal org.banner_url, tournament.commemorative_banner_url

      org.update!(banner_url: "https://manual.example.test/memorial.png")
      tournament.update!(theme_preset: "crest-classic", commemorative_banner_url: nil)
      assert_no_difference ["ActiveStorage::Blob.count", "ActiveStorage::Attachment.count"] do
        assert importer.run!["matched"]
      end
      assert_equal "https://manual.example.test/memorial.png", org.reload.banner_url
      assert_equal "crest-classic", tournament.reload.theme_preset
      assert_equal synthetic_png(5), uploaded_url_blob(tournament.commemorative_banner_url).download
    end
  end

  private

  def with_synthetic_asset_directories
    Dir.mktmpdir do |root|
      blob_dir = File.join(root, "blobs")
      brand_dir = File.join(root, "branding")
      Dir.mkdir(blob_dir)
      Dir.mkdir(brand_dir)
      service = ActiveStorage::Blob.service
      original_storage_root = service.root
      service.root = File.join(root, "uploaded")
      yield blob_dir, brand_dir
    ensure
      service.root = original_storage_root if service
    end
  end

  def synthetic_png(red)
    header = [1, 1, 8, 2, 0, 0, 0].pack("N2C5")
    pixels = Zlib::Deflate.deflate([0, red, 0, 0].pack("C4"))
    chunks = { "IHDR" => header, "IDAT" => pixels, "IEND" => "".b }.map do |type, bytes|
      [bytes.bytesize].pack("N") + type + bytes + [Zlib.crc32(type + bytes)].pack("N")
    end
    "\x89PNG\r\n\x1a\n".b + chunks.join
  end

  def uploaded_url_blob(url)
    ActiveStorage::Blob.find_signed!(URI.parse(url).path.split("/")[-2])
  end
end
