# frozen_string_literal: true

require "test_helper"

class Api::V1::TournamentsCloneControllerTest < ActionDispatch::IntegrationTest
  setup do
    @org_a = Organization.create!(
      name: "Coral Reef Golf",
      slug: "coral-reef-#{SecureRandom.hex(3)}",
      primary_color: "#0f766e"
    )
    @org_b = Organization.create!(
      name: "Tradewinds Golf",
      slug: "tradewinds-#{SecureRandom.hex(3)}",
      primary_color: "#1d4ed8"
    )

    @admin_a = User.create!(
      email: "admin-a-clone-#{SecureRandom.hex(3)}@example.com",
      name: "Admin A",
      role: "org_admin",
      clerk_id: "clerk_admin_a_#{SecureRandom.hex(4)}"
    )
    @org_a.add_admin(@admin_a)

    @volunteer_a = User.create!(
      email: "vol-a-clone-#{SecureRandom.hex(3)}@example.com",
      name: "Volunteer A",
      role: "tournament_admin",
      clerk_id: "clerk_vol_a_#{SecureRandom.hex(4)}"
    )
    @org_a.add_member(@volunteer_a, role: "volunteer")

    @super_admin = User.create!(
      email: "super-clone-#{SecureRandom.hex(3)}@example.com",
      name: "Super Admin",
      role: "super_admin",
      clerk_id: "clerk_super_#{SecureRandom.hex(4)}"
    )

    @tournament_a = @org_a.tournaments.create!(
      name: "Coral Reef Classic",
      year: 2026,
      edition: "4th Annual",
      status: "open",
      registration_open: true,
      walkin_registration_open: true,
      event_date: "April 18, 2026",
      registration_deadline: 3.days.ago,
      sponsor_edit_deadline: 2.days.ago,
      contact_name: "Casey Organizer",
      contact_phone: "671-555-0123",
      checks_payable_to: "Coral Reef Golf",
      swipe_simple_url: "https://swipesimple.com/links/coral-2026",
      primary_color_override: "#0d9488",
      theme_preset: "charity-bright",
      use_org_branding: false,
      team_size: 2,
      entry_fee: 25000,
      max_capacity: 60
    )

    @sponsor_a = @tournament_a.sponsors.create!(
      name: "Lagoon Motors",
      tier: "gold",
      login_email: "lagoon@example.com",
      slot_count: 2,
      active: true
    )
    @sponsor_a.generate_access_token!
    @sponsor_a.sponsor_slots.first.update!(player_name: "Existing VIP", confirmed_at: Time.current)

    @tournament_a.raffle_prizes.create!(
      name: "Golf Bag Set",
      tier: "gold",
      description: "Tour stand bag",
      value_cents: 45_000,
      won: true,
      winner_name: "Past Winner"
    )

    @tournament_b = @org_b.tournaments.create!(
      name: "Tradewinds Cup",
      year: 2026,
      edition: "2nd Annual",
      status: "open",
      registration_open: true,
      entry_fee: 20000,
      max_capacity: 40
    )
  end

  test "org admin can clone own tournament with options and receives clone_warnings" do
    authenticate_as(@admin_a)

    assert_difference "Tournament.count", 1 do
      post "/api/v1/tournaments/#{@tournament_a.id}/clone",
           params: {
             name: "Coral Reef Classic 2027",
             year: 2027,
             edition: "5th Annual",
             copy_sponsor_shells: true,
             copy_raffle_prizes: true
           },
           headers: auth_headers,
           as: :json
    end

    assert_response :created
    json = JSON.parse(response.body)

    cloned_json = json["tournament"]
    assert_equal "Coral Reef Classic 2027", cloned_json["name"]
    assert_equal 2027, cloned_json["year"]
    assert_equal "5th Annual", cloned_json["edition"]
    assert_equal "draft", cloned_json["status"]
    assert_equal false, cloned_json["registration_open"]
    assert_nil cloned_json["event_date"]
    assert_nil cloned_json["swipe_simple_url"]
    assert_equal @org_a.id, cloned_json["organization_id"]

    assert_kind_of Array, json["clone_warnings"]
    assert json["clone_warnings"].any? { |w| w.include?("External payment URLs were cleared") }
    assert_equal true, json.dig("clone_metadata", "requires_payment_url_review")
    assert_equal 1, json.dig("clone_metadata", "copied_sponsor_shells_count")
    assert_equal 1, json.dig("clone_metadata", "copied_raffle_prizes_count")

    cloned = Tournament.find(cloned_json["id"])
    assert_equal 1, cloned.sponsors.count
    assert_nil cloned.sponsors.first.access_token
    assert_equal false, cloned.sponsors.first.active
    assert cloned.sponsors.first.sponsor_slots.all? { |s| s.player_name.nil? }

    assert_equal 1, cloned.raffle_prizes.count
    assert_equal false, cloned.raffle_prizes.first.won
    assert_nil cloned.raffle_prizes.first.winner_name
  end

  test "legacy copy route delegates cleanly to clone service" do
    authenticate_as(@admin_a)

    assert_difference "Tournament.count", 1 do
      post "/api/v1/tournaments/#{@tournament_a.id}/copy", headers: auth_headers
    end

    assert_response :created
    json = JSON.parse(response.body)
    assert_equal "draft", json.dig("tournament", "status")
    assert_equal 2027, json.dig("tournament", "year")
    assert_equal "5th Annual", json.dig("tournament", "edition")
    assert_nil json.dig("tournament", "swipe_simple_url")
    assert_kind_of Array, json["clone_warnings"]
  end

  test "super_admin can perform cross-org template clone stripping source branding, contacts, payment URLs, and sponsors" do
    authenticate_as(@super_admin)

    assert_difference "Tournament.count", 1 do
      post "/api/v1/tournaments/#{@tournament_a.id}/clone",
           params: {
             name: "Tradewinds Template Event",
             year: 2027,
             target_organization_id: @org_b.id,
             copy_sponsor_shells: true,
             copy_raffle_prizes: true
           },
           headers: auth_headers,
           as: :json
    end

    assert_response :created
    json = JSON.parse(response.body)

    assert_equal "cross_org_template", json.dig("clone_metadata", "mode")
    assert_equal @org_b.id, json.dig("tournament", "organization_id")
    assert_equal true, json.dig("tournament", "use_org_branding")
    assert_nil json.dig("tournament", "primary_color_override")
    assert_nil json.dig("tournament", "contact_name")
    assert_nil json.dig("tournament", "contact_phone")
    assert_nil json.dig("tournament", "checks_payable_to")
    assert_nil json.dig("tournament", "swipe_simple_url")
    assert_equal 0, json.dig("clone_metadata", "copied_sponsor_shells_count")
    assert_equal 1, json.dig("clone_metadata", "copied_raffle_prizes_count")

    cloned = Tournament.find(json.dig("tournament", "id"))
    assert_equal @org_b.id, cloned.organization_id
    assert_equal 0, cloned.sponsors.count
    assert_equal 1, cloned.raffle_prizes.count
  end

  test "non-super-admin attempting cross-org clone returns 403 Forbidden and creates zero records" do
    authenticate_as(@admin_a)

    assert_no_difference ["Tournament.count", "Sponsor.count", "RafflePrize.count", "ActivityLog.count"] do
      post "/api/v1/tournaments/#{@tournament_a.id}/clone",
           params: {
             name: "Unauthorized Cross-Org Clone",
             year: 2027,
             target_organization_id: @org_b.id
           },
           headers: auth_headers,
           as: :json
    end

    assert_response :forbidden
  end

  test "tenant isolation: Org A admin cannot clone Org B tournament" do
    authenticate_as(@admin_a)

    assert_no_difference ["Tournament.count", "ActivityLog.count"] do
      post "/api/v1/tournaments/#{@tournament_b.id}/clone",
           params: { name: "Stolen Clone", year: 2027 },
           headers: auth_headers,
           as: :json
    end

    assert_includes [403, 404], response.status
  end

  test "volunteer cannot clone a tournament" do
    authenticate_as(@volunteer_a)

    assert_no_difference "Tournament.count" do
      post "/api/v1/tournaments/#{@tournament_a.id}/clone",
           params: { name: "Volunteer Clone", year: 2027 },
           headers: auth_headers,
           as: :json
    end

    assert_response :forbidden
  end

  test "unauthenticated request returns 401 Unauthorized" do
    assert_no_difference "Tournament.count" do
      post "/api/v1/tournaments/#{@tournament_a.id}/clone",
           params: { name: "Anon Clone", year: 2027 },
           as: :json
    end

    assert_response :unauthorized
  end
end
