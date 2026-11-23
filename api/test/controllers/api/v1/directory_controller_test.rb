# frozen_string_literal: true

require "test_helper"

module Api
  module V1
    class DirectoryControllerTest < ActionDispatch::IntegrationTest
      setup do
        @org = organizations(:org_one)
        @org.organization_domains.find_or_create_by!(hostname: "club-directory.example.test") do |d|
          d.is_primary = true
        end

        @org_no_host = Organization.create!(
          name: "Hostless Club",
          slug: "hostless-club",
          subscription_status: "active"
        )
      end

      test "returns only explicitly directory_listed public tournaments with an org primary host" do
        open_event = @org.tournaments.create!(
          name: "Island Open 2027",
          slug: "island-open-2027",
          year: 2027,
          status: "open",
          registration_open: true,
          public_listed: true,
          directory_listed: true,
          event_date: "May 10, 2027",
          location_name: "Lagoon Golf Club",
          entry_fee: 15000,
          team_size: 4
        )

        past_event = @org.tournaments.create!(
          name: "Island Open 2025",
          slug: "island-open-2025",
          year: 2025,
          status: "completed",
          registration_open: false,
          public_listed: true,
          directory_listed: true,
          event_date: "May 12, 2025",
          location_name: "Lagoon Golf Club",
          entry_fee: 12500
        )

        # Should be excluded: directory_listed is false (default)
        @org.tournaments.create!(
          name: "Private Invitational",
          slug: "private-invitational",
          year: 2027,
          status: "open",
          registration_open: true,
          public_listed: true,
          directory_listed: false
        )

        # Should be excluded: draft status even if directory_listed is true
        @org.tournaments.create!(
          name: "Draft Classic",
          slug: "draft-classic",
          year: 2028,
          status: "draft",
          public_listed: true,
          directory_listed: true
        )

        # Should be excluded: org has no primary_host
        @org_no_host.tournaments.create!(
          name: "Unrouted Classic",
          slug: "unrouted-classic",
          year: 2027,
          status: "open",
          registration_open: true,
          public_listed: true,
          directory_listed: true
        )

        get "/api/v1/directory/tournaments"

        assert_response :success
        assert_includes response.headers["Cache-Control"], "public"

        body = JSON.parse(response.body)
        upcoming_slugs = body["upcoming"].map { |item| item["slug"] }
        past_slugs = body["past"].map { |item| item["slug"] }

        assert_equal [open_event.slug], upcoming_slugs
        assert_equal [past_event.slug], past_slugs

        card = body["upcoming"].first
        assert_equal "open", card["availability"]
        assert_equal "https://club-directory.example.test/island-open-2027", card["public_url"]
        assert_equal "https://club-directory.example.test/island-open-2027/register", card["register_url"]
        assert_equal @org.name, card.dig("organization", "name")
        assert_not card.key?("id"), "Public directory should not expose internal numeric IDs"
        assert_not card.key?("contact_email"), "Public directory should not leak private contact details"
      end

      test "rejects reserved platform root paths as tournament slugs case-insensitively" do
        %w[privacy PRIVACY terms contact about platform admin].each do |reserved|
          tournament = @org.tournaments.build(
            name: "Reserved Route Event",
            slug: reserved,
            year: 2027,
            status: "draft"
          )
          assert_not tournament.valid?, "Expected slug '#{reserved}' to be rejected"
          assert_includes tournament.errors[:slug].join(" "), "reserved"
        end
      end
    end
  end
end
