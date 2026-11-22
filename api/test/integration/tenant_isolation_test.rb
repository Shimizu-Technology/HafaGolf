# frozen_string_literal: true

require "test_helper"

class TenantIsolationTest < ActionDispatch::IntegrationTest
  setup do
    @org_a = Organization.create!(name: "Island Alpha Golf", slug: "island-alpha-#{SecureRandom.hex(3)}")
    @org_b = Organization.create!(name: "Harbor Beta Golf", slug: "harbor-beta-#{SecureRandom.hex(3)}")

    @org_a.organization_domains.create!(hostname: "alpha-iso.example.com", is_primary: true, verified_at: Time.current)
    @org_b.organization_domains.create!(hostname: "beta-iso.example.com", is_primary: true, verified_at: Time.current)

    @tournament_a = @org_a.tournaments.create!(
      name: "Alpha Classic 2027",
      slug: "alpha-classic-2027-#{SecureRandom.hex(2)}",
      year: 2027,
      status: "open",
      registration_open: true,
      public_listed: true,
      raffle_enabled: true,
      entry_fee: 15000,
      max_capacity: 40
    )
    @tournament_b = @org_b.tournaments.create!(
      name: "Beta Charity 2027",
      slug: "beta-charity-2027-#{SecureRandom.hex(2)}",
      year: 2027,
      status: "open",
      registration_open: true,
      public_listed: true,
      raffle_enabled: true,
      entry_fee: 20000,
      max_capacity: 40
    )

    @admin_a = User.create!(
      email: "admin-a-iso-#{SecureRandom.hex(3)}@example.com",
      name: "Admin Alpha",
      role: "org_admin",
      clerk_id: "clerk_admin_a_#{SecureRandom.hex(4)}"
    )
    @org_a.add_admin(@admin_a)

    @volunteer_a = User.create!(
      email: "vol-a-iso-#{SecureRandom.hex(3)}@example.com",
      name: "Volunteer Alpha",
      role: "tournament_admin",
      clerk_id: "clerk_vol_a_#{SecureRandom.hex(4)}"
    )
    @org_a.add_member(@volunteer_a, role: "volunteer")

    @group_a = @tournament_a.groups.create!(group_number: 1, hole_number: 1, starting_course_key: "course-1")
    @group_b = @tournament_b.groups.create!(group_number: 1, hole_number: 1, starting_course_key: "course-1")

    @golfer_a = @tournament_a.golfers.create!(
      name: "Alice Player",
      email: "alice-iso-#{SecureRandom.hex(3)}@example.com",
      phone: "671-555-1001",
      team_category: "Co-Ed",
      payment_type: "pay_on_day",
      payment_status: "unpaid",
      registration_status: "confirmed",
      group: @group_a,
      waiver_accepted_at: Time.current
    )
    @golfer_b = @tournament_b.golfers.create!(
      name: "Bob Player",
      email: "bob-iso-#{SecureRandom.hex(3)}@example.com",
      phone: "671-555-2002",
      team_category: "Co-Ed",
      payment_type: "pay_on_day",
      payment_status: "unpaid",
      registration_status: "confirmed",
      group: @group_b,
      waiver_accepted_at: Time.current
    )

    @sponsor_b = @tournament_b.sponsors.create!(
      name: "Beta Corp",
      tier: "gold",
      login_email: "sponsor-b-#{SecureRandom.hex(3)}@example.com",
      slot_count: 2
    )

    @score_b = @tournament_b.scores.create!(
      golfer: @golfer_b,
      group: @group_b,
      hole: 1,
      strokes: 4,
      score_type: "individual"
    )

    @log_b = ActivityLog.create!(
      tournament: @tournament_b,
      action: "golfer_updated",
      target_type: "Golfer",
      target_id: @golfer_b.id,
      details: "Secret Org B Activity",
      metadata: { golfer_name: @golfer_a.name }
    )
  end

  test "Org A admin cannot read or mutate Org B activity logs, golfer history, or summary" do
    authenticate_as(@admin_a)

    get "/api/v1/activity_logs", params: { tournament_id: @tournament_b.id }, headers: auth_headers
    assert_response :forbidden

    get "/api/v1/activity_logs", params: { all_tournaments: "true" }, headers: auth_headers
    assert_response :success
    ids = JSON.parse(response.body)["activity_logs"].map { |l| l["id"] }
    assert_not_includes ids, @log_b.id

    get "/api/v1/activity_logs/golfer/#{@golfer_b.id}", headers: auth_headers
    assert_response :forbidden

    # Even when Org B has a log with matching metadata golfer_name, Org A golfer_history never sees it
    get "/api/v1/activity_logs/golfer/#{@golfer_a.id}", headers: auth_headers
    assert_response :success
    history_ids = JSON.parse(response.body)["activity_logs"].map { |l| l["id"] }
    assert_not_includes history_ids, @log_b.id

    get "/api/v1/activity_logs/summary", params: { tournament_id: @tournament_b.id }, headers: auth_headers
    assert_response :forbidden
  end

  test "Org A admin cannot create, update, verify, delete, or read scorecards on Org B scores" do
    authenticate_as(@admin_a)

    post "/api/v1/tournaments/#{@tournament_b.id}/scores",
         params: { score: { golfer_id: @golfer_b.id, group_id: @group_b.id, hole: 2, strokes: 3 } },
         headers: auth_headers
    assert_response :forbidden

    patch "/api/v1/tournaments/#{@tournament_b.id}/scores/#{@score_b.id}",
          params: { score: { strokes: 9 } },
          headers: auth_headers
    assert_response :forbidden
    assert_equal 4, @score_b.reload.strokes

    delete "/api/v1/tournaments/#{@tournament_b.id}/scores/#{@score_b.id}", headers: auth_headers
    assert_response :forbidden

    get "/api/v1/tournaments/#{@tournament_b.id}/scores/scorecard",
        params: { group_id: @group_b.id },
        headers: auth_headers
    assert_response :forbidden
  end

  test "Org A admin cannot smuggle Org B golfers or groups into update_positions or golfer update" do
    authenticate_as(@admin_a)

    # First item is Org A golfer, second item is Org B golfer
    post "/api/v1/groups/update_positions",
         params: {
           updates: [
             { golfer_id: @golfer_a.id, group_id: @group_a.id, position: 1 },
             { golfer_id: @golfer_b.id, group_id: @group_a.id, position: 2 }
           ]
         },
         headers: auth_headers
    assert_response :forbidden
    assert_equal @group_b.id, @golfer_b.reload.group_id

    # Cannot attach Org B group to Org A golfer via update_positions
    post "/api/v1/groups/update_positions",
         params: {
           updates: [
             { golfer_id: @golfer_a.id, group_id: @group_b.id, position: 1 }
           ]
         },
         headers: auth_headers
    assert_response :forbidden
    assert_equal @group_a.id, @golfer_a.reload.group_id

    # Cannot attach Org B group or sponsor to Org A golfer via PATCH /golfers/:id
    patch "/api/v1/golfers/#{@golfer_a.id}",
          params: { golfer: { group_id: @group_b.id } },
          headers: auth_headers
    assert_response :unprocessable_entity
    assert_equal @group_a.id, @golfer_a.reload.group_id
  end

  test "Org A admin and volunteer cannot access global settings or Org B resources" do
    authenticate_as(@admin_a)

    get "/api/v1/settings", headers: auth_headers
    assert_response :forbidden

    patch "/api/v1/settings", params: { setting: { payment_mode: "test" } }, headers: auth_headers
    assert_response :forbidden

    get "/api/v1/golfers/#{@golfer_b.id}", headers: auth_headers
    assert_response :forbidden

    get "/api/v1/tournaments/#{@tournament_b.id}/payment_report", headers: auth_headers
    assert_response :forbidden

    authenticate_as(@volunteer_a)
    post "/api/v1/golfers/#{@golfer_b.id}/check_in", headers: auth_headers
    assert_response :forbidden
  end

  test "public token routes reject cross-tenant host mismatches" do
    @golfer_b.generate_payment_token!
    @golfer_b.generate_magic_link!
    sponsor_token_b = @sponsor_b.generate_access_token!
    sponsor_session_b = @sponsor_b.generate_portal_session_token!(verified_email: @sponsor_b.login_email)
    golfer_jwt_b = GolferAuth.generate_token(@golfer_b)

    # Org B payment link on Org A host -> 404
    get "/api/v1/payment_links/#{@golfer_b.payment_token}",
        headers: { "X-Tenant-Host" => "alpha-iso.example.com" }
    assert_response :not_found

    # Org B payment link on Org B host -> 200
    get "/api/v1/payment_links/#{@golfer_b.payment_token}",
        headers: { "X-Tenant-Host" => "beta-iso.example.com" }
    assert_response :success

    # Org B checkout / swipe_simple on Org A host -> 404
    post "/api/v1/checkout/swipe_simple",
         params: { golfer_id: @golfer_b.id },
         headers: { "X-Tenant-Host" => "alpha-iso.example.com" }
    assert_response :not_found

    # Org B golfer magic link on Org A host -> 401 (and token NOT consumed!)
    get "/api/v1/golfer_auth/verify",
        params: { token: @golfer_b.magic_link_token },
        headers: { "X-Tenant-Host" => "alpha-iso.example.com" }
    assert_response :unauthorized
    assert @golfer_b.reload.magic_link_token.present?

    # Org B golfer JWT on Org A host -> 401
    get "/api/v1/golfer_auth/me",
        headers: {
          "X-Tenant-Host" => "alpha-iso.example.com",
          "Authorization" => "Bearer #{golfer_jwt_b}"
        }
    assert_response :unauthorized

    # Org B sponsor token & session on Org A host -> 401
    get "/api/v1/sponsor_access/verify",
        params: { token: sponsor_token_b },
        headers: { "X-Tenant-Host" => "alpha-iso.example.com" }
    assert_response :unauthorized

    get "/api/v1/sponsor_slots",
        headers: {
          "X-Tenant-Host" => "alpha-iso.example.com",
          "X-Sponsor-Session" => sponsor_session_b
        }
    assert_response :unauthorized
  end

  test "public tournament-scoped endpoints reject cross-tenant host mismatches" do
    # Org B raffle board requested via Org A host -> 404
    get "/api/v1/tournaments/#{@tournament_b.id}/raffle/board",
        headers: { "X-Tenant-Host" => "alpha-iso.example.com" }
    assert_response :not_found

    # Org B sponsors requested via Org A host -> 404
    get "/api/v1/tournaments/#{@tournament_b.id}/sponsors",
        headers: { "X-Tenant-Host" => "alpha-iso.example.com" }
    assert_response :not_found

    # Org B leaderboard requested via Org A host -> 404
    get "/api/v1/tournaments/#{@tournament_b.id}/scores/leaderboard",
        headers: { "X-Tenant-Host" => "alpha-iso.example.com" }
    assert_response :not_found

    # /tournaments/current resolves strictly to host's org tournament
    get "/api/v1/tournaments/current", headers: { "X-Tenant-Host" => "alpha-iso.example.com" }
    assert_response :success
    assert_equal @tournament_a.id, JSON.parse(response.body)["id"]

    get "/api/v1/tournaments/current", headers: { "X-Tenant-Host" => "beta-iso.example.com" }
    assert_response :success
    assert_equal @tournament_b.id, JSON.parse(response.body)["id"]

    # Without host or organization_slug, /tournaments/current does NOT leak another org's tournament
    get "/api/v1/tournaments/current"
    assert_response :not_found
  end
end
