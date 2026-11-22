# frozen_string_literal: true

require "test_helper"
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

    fake_conn = Struct.new(:current_database).new("api_development")
    assert_raises(HafagolfMigrations::UnsafeDatabaseError) do
      HafagolfMigrations::DatabaseGuard.verify!(expected_db_name: "api_development", connection: fake_conn)
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
    fixture = {
      "organizations" => [
        { "id" => 1, "name" => "Make-A-Wish Guam & CNMI", "primary_color" => "#0057B8", "contact_email" => "info@maw-synthetic.test" }
      ],
      "users" => [
        { "id" => 10, "name" => "Eric Coordinator", "email" => "ERIC.MIGRATE@MAW-SYNTHETIC.TEST", "role" => "org_admin" }
      ],
      "organization_memberships" => [
        { "user_id" => 10, "role" => "admin" }
      ],
      "tournaments" => [
        { "id" => 1, "slug" => "golf-for-wishes-2026-mig", "name" => "Golf for Wishes 2026", "year" => 2026, "status" => "completed", "team_size" => 2, "entry_fee" => 25_000, "raffle_enabled" => true }
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
          "team_category" => "Co-Ed", "registration_status" => "confirmed", "payment_type" => "swipe_simple",
          "payment_status" => "paid", "payment_method" => "swipe_simple", "payment_amount_cents" => 25_000
        },
        {
          "id" => 301, "tournament_id" => 1, "group_id" => nil, "sponsor_id" => 200,
          "name" => "Waitlist Two", "email" => "wait2@maw-synthetic.test", "phone" => "671-555-2222",
          "team_category" => "Male", "registration_status" => "waitlist", "payment_type" => "stripe",
          "payment_status" => "refunded", "payment_method" => "stripe", "payment_amount_cents" => 25_000,
          "refund_amount_cents" => 25_000, "stripe_payment_intent_id" => "pi_maw_mig_301", "stripe_refund_id" => "re_maw_mig_301"
        }
      ],
      "sponsor_slots" => [
        { "id" => 400, "sponsor_id" => 200, "slot_number" => 1, "player_name" => "Waitlist Two", "golfer_id" => 301 },
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

    # Re-run a second time: MUST be 100% idempotent with zero duplicate records
    report2 = HafagolfMigrations::MawImporter.new(source_reader: reader, expected_db_name: @current_db).run!
    assert_equal true, report2["matched"]
    assert_equal report1["target"], report2["target"]

    # Verify Clerk relink placeholder & org domain & message_delivery org_id backfill
    user = User.find_by("LOWER(email) = ?", "eric.migrate@maw-synthetic.test")
    assert_not_nil user
    assert user.clerk_id.start_with?("pending_")

    org = Organization.find_by!(slug: "make-a-wish-guam")
    assert org.organization_domains.exists?(hostname: "golfforwishes.com", is_primary: true)
    assert_equal org.id, MessageDelivery.find_by!(provider_message_id: "cs-mig-800").organization_id
  end

  test "GiaaImporter imports synthetic snapshot cleanly, never copies plaintext secrets, and is idempotent" do
    fixture = {
      "settings" => [
        {
          "organization_name" => "GIAA Memorial Golf",
          "stripe_secret_key" => "sk_live_MUST_NEVER_BE_MIGRATED",
          "contact_email" => "info@giaa-synthetic.test"
        }
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
          "stripe_payment_intent_id" => "pi_giaa_mig_50"
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

    report2 = HafagolfMigrations::GiaaImporter.new(source_reader: reader, expected_db_name: @current_db).run!
    assert_equal true, report2["matched"]
    assert_equal report1["target"], report2["target"]

    org = Organization.find_by!(slug: "giaa")
    assert org.organization_domains.exists?(hostname: "giaa-tournament.com", is_primary: true)
    assert_equal "memorial-formal", org.tournaments.find_by!(slug: "giaa-2026-mig").theme_preset
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
  end
end
