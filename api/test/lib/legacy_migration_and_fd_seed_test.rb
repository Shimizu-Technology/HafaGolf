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
          "entry_fee" => 30_000, "raffle_enabled" => true, "config" => course_config_json
        }
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
          "id" => 301, "tournament_id" => 11, "ticket_number" => "SYN26-0001", "sequence_number" => 1,
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
    assert_equal 2, report1.dig("target", "raffle_prizes")
    assert_equal 500, report1.dig("target", "raffle_paid_cents")

    tournament = Tournament.find_by!(slug: "maw-multicourse-2026")
    assert_equal %w[north south], tournament.course_configs.map { |c| c["key"] }
    assert_equal "north", tournament.groups.find_by!(group_number: 1).starting_course_key
    assert_nil tournament.raffle_tickets.find_by!(ticket_number: "SYN26-0001").payment_method

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

    tournament = Tournament.find_by!(slug: "giaa-foursome-2026")
    assert_equal 4, tournament.players_per_start_position
    assert_equal true, tournament.employee_discount_enabled
    assert_equal 5_000, tournament.employee_entry_fee

    emp = EmployeeNumber.find_by!(tournament: tournament, employee_number: "EMP-001")
    reg = Registration.find_by!(legacy_source: "giaa", legacy_id: "401")
    assert_equal reg.id, emp.used_by_registration_id
    assert_equal emp.id, reg.team_members.first.employee_number_record_id
    assert_equal true, reg.team_members.first.is_employee

    report2 = HafagolfMigrations::GiaaImporter.new(source_reader: reader, expected_db_name: @current_db).run!
    assert_equal report1["target"], report2["target"]
  end
end
