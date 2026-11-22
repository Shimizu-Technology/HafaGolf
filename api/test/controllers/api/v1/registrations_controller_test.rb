# frozen_string_literal: true

require "test_helper"

class Api::V1::RegistrationsControllerTest < ActionDispatch::IntegrationTest
  setup do
    @org_a = organizations(:org_one)
    @org_a.organization_domains.find_or_create_by!(hostname: "alpha.golf.test") { |d| d.is_primary = true }

    @org_b = Organization.create!(name: "Beta Golf Club", slug: "beta-golf-#{SecureRandom.hex(3)}")
    @org_b.organization_domains.create!(hostname: "beta.golf.test", is_primary: true)

    @admin_a = users(:user_one)
    @admin_a.update!(clerk_id: "clerk_admin_a_#{@admin_a.id}") if @admin_a.clerk_id.blank?

    @volunteer_a = User.create!(
      email: "vol-a-#{SecureRandom.hex(3)}@example.com",
      name: "Volunteer A",
      role: "tournament_admin",
      clerk_id: "clerk_vol_a_#{SecureRandom.hex(3)}"
    )
    @org_a.organization_memberships.create!(user: @volunteer_a, role: "volunteer")

    @admin_b = User.create!(
      email: "admin-b-#{SecureRandom.hex(3)}@example.com",
      name: "Admin B",
      role: "org_admin",
      clerk_id: "clerk_admin_b_#{SecureRandom.hex(3)}"
    )
    @org_b.organization_memberships.create!(user: @admin_b, role: "admin")

    @tournament_a = @org_a.tournaments.create!(
      name: "Alpha Foursome Classic",
      year: 2027,
      status: "open",
      registration_open: true,
      team_size: 4,
      capacity_unit: "players",
      max_capacity: 8,
      allow_partial_teams: true,
      waitlist_enabled: true,
      entry_fee: 40000,
      swipe_simple_url: "https://swipesimple.com/links/test-alpha",
      raffle_enabled: true,
      config: { "raffle_include_with_registration" => true, "features" => { "raffle" => true } }
    )

    @tournament_b = @org_b.tournaments.create!(
      name: "Beta Pairs Invitational",
      year: 2027,
      status: "open",
      registration_open: true,
      team_size: 2,
      capacity_unit: "teams",
      max_capacity: 10,
      entry_fee: 30000
    )

    @reg_b = @tournament_b.registrations.create!(
      organization: @org_b,
      team_name: "Beta Pair",
      payment_type: "stripe",
      team_members_attributes: [
        { name: "Beta One", email: "b1-#{SecureRandom.hex(3)}@example.com", phone: "+16715551111" },
        { name: "Beta Two", email: "b2-#{SecureRandom.hex(3)}@example.com", phone: "+16715551112" }
      ]
    )
  end

  def team_payload(count, prefix: "reg")
    (1..count).map do |i|
      {
        name: "Player #{prefix.upcase}#{i}",
        email: "#{prefix}#{i}-#{SecureRandom.hex(3)}@example.com",
        phone: "+1671555#{format('%04d', rand(1000..9999))}",
        tshirt_size: "M",
        waiver_accepted: true
      }
    end
  end

  # =========================================================================
  # POST /api/v1/tournaments/:tournament_id/registrations (Public)
  # =========================================================================

  test "public create registers 4-player foursome, partial team, and waitlists overflow under players capacity" do
    headers = { "X-Tenant-Host" => "alpha.golf.test" }

    # 1) Full foursome (4 players <= 8) -> confirmed + payment_token generated
    post "/api/v1/tournaments/#{@tournament_a.id}/registrations",
         params: {
           registration: {
             team_name: "Foursome One",
             payment_type: "swipe_simple",
             team_members: team_payload(4, prefix: "f1")
           }
         },
         headers: headers,
         as: :json

    assert_response :created
    body1 = JSON.parse(response.body)
    assert_equal "confirmed", body1.dig("registration", "registration_status")
    assert_equal 4, body1.dig("registration", "player_count")
    assert_equal 4, body1.dig("registration", "team_members").length
    assert body1.dig("registration", "payment_token").present?
    assert_equal 4, body1.dig("capacity_summary", "confirmed_units")

    # SwipeSimple redirect accepts the new registration payment_token!
    post "/api/v1/checkout/swipe_simple",
         params: { payment_token: body1.dig("registration", "payment_token") },
         headers: headers,
         as: :json
    assert_response :success
    assert JSON.parse(response.body)["redirect_url"].present?

    # 2) Partial 2-player team (4 + 2 = 6 <= 8) -> confirmed
    post "/api/v1/tournaments/#{@tournament_a.id}/registrations",
         params: {
           registration: {
             team_name: "Partial Duo",
             payment_type: "stripe",
             team_members: team_payload(2, prefix: "f2")
           }
         },
         headers: headers,
         as: :json

    assert_response :created
    body2 = JSON.parse(response.body)
    assert_equal "confirmed", body2.dig("registration", "registration_status")
    assert_equal 2, body2.dig("registration", "player_count")

    # 3) Another 4-player foursome (6 + 4 = 10 > 8) -> waitlist!
    post "/api/v1/tournaments/#{@tournament_a.id}/registrations",
         params: {
           registration: {
             team_name: "Overflow Foursome",
             payment_type: "stripe",
             team_members: team_payload(4, prefix: "f3")
           }
         },
         headers: headers,
         as: :json

    assert_response :created
    body3 = JSON.parse(response.body)
    assert_equal "waitlist", body3.dig("registration", "registration_status")
    assert_equal "You have been added to the waitlist.", body3["message"]
  end

  test "public create rejects cross-tenant tournament ID with 404" do
    post "/api/v1/tournaments/#{@tournament_b.id}/registrations",
         params: {
           registration: {
             team_name: "Cross Tenant Attempt",
             team_members: team_payload(2, prefix: "xt")
           }
         },
         headers: { "X-Tenant-Host" => "alpha.golf.test" },
         as: :json

    assert_response :not_found
  end

  # =========================================================================
  # Index, Show, Update, Verify Payment, Assign Group, Sync Raffle, Check-In
  # =========================================================================

  test "index returns registrations with nested team_members, filters, and capacity_summary for admin and volunteer" do
    reg = @tournament_a.registrations.create!(
      organization: @org_a,
      team_name: "Searchable Squad",
      payment_type: "swipe_simple",
      team_members_attributes: [
        { name: "Captain Alpha", email: "cap-a@example.com", phone: "+16715550001" },
        { name: "Unique Teammate", email: "uniq-t@example.com", phone: "+16715550002" }
      ]
    )

    authenticate_as(@volunteer_a)
    get "/api/v1/tournaments/#{@tournament_a.id}/registrations",
        params: { search: "Unique Teammate", registration_status: "confirmed" },
        headers: auth_headers

    assert_response :success
    body = JSON.parse(response.body)
    assert_equal 1, body["registrations"].length
    assert_equal reg.id, body["registrations"].first["id"]
    assert_equal 2, body["registrations"].first["team_members"].length
    assert_equal "players", body.dig("capacity_summary", "capacity_unit")
  end

  test "verify_payment, assign_group player cap, sync_raffle_tickets, and per-player check_in / undo_check_in" do
    reg_a = @tournament_a.registrations.create!(
      organization: @org_a,
      team_name: "Trio Squad",
      payment_type: "swipe_simple",
      payment_status: "pending",
      team_members_attributes: team_payload(3, prefix: "tr").map { |m| m.except(:waiver_accepted) }
    )
    reg_b = @tournament_a.registrations.create!(
      organization: @org_a,
      team_name: "Duo Squad",
      payment_type: "stripe",
      team_members_attributes: team_payload(2, prefix: "du").map { |m| m.except(:waiver_accepted) }
    )
    group = @tournament_a.groups.create!(group_number: 1, hole_number: 1)

    # 1) Volunteer verifies payment
    authenticate_as(@volunteer_a)
    post "/api/v1/registrations/#{reg_a.id}/verify_payment",
         params: { payment_method: "swipe_simple_confirmed", notes: "Verified at desk" },
         headers: auth_headers,
         as: :json
    assert_response :success
    assert_equal "paid", JSON.parse(response.body).dig("registration", "payment_status")

    # 2) Volunteer checks in individual players (1/3, then undo -> 0/3)
    member1 = reg_a.team_members.order(:position).first
    post "/api/v1/team_members/#{member1.id}/check_in", headers: auth_headers
    assert_response :success
    chk_body = JSON.parse(response.body)
    assert_equal true, chk_body.dig("team_member", "checked_in")
    assert_equal 1, chk_body.dig("registration", "checked_in_count")
    assert_equal false, chk_body.dig("registration", "all_checked_in")

    post "/api/v1/team_members/#{member1.id}/undo_check_in", headers: auth_headers
    assert_response :success
    assert_equal 0, JSON.parse(response.body).dig("registration", "checked_in_count")

    # 3) Admin assigns Trio (3 players) to Group 1 -> succeeds; Duo (2 players) -> 3 + 2 = 5 rejected (422)
    authenticate_as(@admin_a)
    post "/api/v1/registrations/#{reg_a.id}/assign_group",
         params: { group_id: group.id },
         headers: auth_headers,
         as: :json
    assert_response :success
    assert_equal group.id, JSON.parse(response.body).dig("registration", "group_id")

    post "/api/v1/registrations/#{reg_b.id}/assign_group",
         params: { group_id: group.id },
         headers: auth_headers,
         as: :json
    assert_response :unprocessable_entity
    assert_includes JSON.parse(response.body)["errors"].join, "already has 3/4 players"

    # 4) Admin updates registration
    patch "/api/v1/registrations/#{reg_a.id}",
          params: { registration: { team_name: "Renamed Trio" } },
          headers: auth_headers,
          as: :json
    assert_response :success
    assert_equal "Renamed Trio", JSON.parse(response.body).dig("registration", "team_name")

    # 5) Admin syncs raffle tickets (3 tickets for 3 members, idempotent)
    post "/api/v1/registrations/#{reg_a.id}/sync_raffle_tickets", headers: auth_headers
    assert_response :success
    assert_equal 3, JSON.parse(response.body)["raffle_tickets"].length
  end

  # =========================================================================
  # Cross-Tenant Isolation (Org A admin cannot access Org B -> 403)
  # =========================================================================

  test "Org A admin receives 403 forbidden on all Org B registration and team_member endpoints" do
    authenticate_as(@admin_a)
    member_b = @reg_b.team_members.first

    get "/api/v1/tournaments/#{@tournament_b.id}/registrations", headers: auth_headers
    assert_response :forbidden

    get "/api/v1/registrations/#{@reg_b.id}", headers: auth_headers
    assert_response :forbidden

    patch "/api/v1/registrations/#{@reg_b.id}",
          params: { registration: { team_name: "Hacked" } },
          headers: auth_headers,
          as: :json
    assert_response :forbidden

    post "/api/v1/registrations/#{@reg_b.id}/verify_payment", headers: auth_headers
    assert_response :forbidden

    post "/api/v1/registrations/#{@reg_b.id}/assign_group",
         params: { group_id: nil },
         headers: auth_headers,
         as: :json
    assert_response :forbidden

    post "/api/v1/registrations/#{@reg_b.id}/sync_raffle_tickets", headers: auth_headers
    assert_response :forbidden

    post "/api/v1/team_members/#{member_b.id}/check_in", headers: auth_headers
    assert_response :forbidden

    post "/api/v1/team_members/#{member_b.id}/undo_check_in", headers: auth_headers
    assert_response :forbidden

    assert_equal "Beta Pair", @reg_b.reload.team_name
    assert_nil member_b.reload.checked_in_at
  end

  test "verify_payment rejects invalid amount, preserves existing amount on blank string, and swipe_simple refuses paid registration" do
    reg = @tournament_a.registrations.create!(
      organization: @org_a,
      team_name: "Amount Guard Team",
      payment_type: "swipe_simple",
      payment_status: "pending",
      payment_amount_cents: 35000,
      team_members_attributes: team_payload(2, prefix: "ag").map { |m| m.except(:waiver_accepted) }
    )
    reg.generate_payment_token!

    authenticate_as(@admin_a)

    # Invalid payment_amount_cents -> 422 and state untouched
    post "/api/v1/registrations/#{reg.id}/verify_payment",
         params: { payment_amount_cents: "not-a-number" },
         headers: auth_headers,
         as: :json
    assert_response :unprocessable_entity
    assert_equal "pending", reg.reload.payment_status
    assert_equal 35000, reg.payment_amount_cents

    # Blank payment_amount_cents ("") treated as omitted -> preserves 35000
    post "/api/v1/registrations/#{reg.id}/verify_payment",
         params: { payment_amount_cents: "" },
         headers: auth_headers,
         as: :json
    assert_response :success
    assert_equal "paid", reg.reload.payment_status
    assert_equal 35000, reg.payment_amount_cents

    # swipe_simple must not downgrade a paid registration back to pending
    post "/api/v1/checkout/swipe_simple",
         params: { payment_token: reg.payment_token },
         headers: { "X-Tenant-Host" => "alpha.golf.test" },
         as: :json
    assert_response :unprocessable_entity
    assert_equal "paid", reg.reload.payment_status
  end

  test "check_in rejects members on cancelled or pending registrations with 422" do
    pending_reg = @tournament_a.registrations.create!(
      organization: @org_a,
      team_name: "Pending Team",
      registration_status: "pending",
      payment_type: "swipe_simple",
      team_members_attributes: team_payload(2, prefix: "pnd").map { |m| m.except(:waiver_accepted) }
    )
    cancelled_reg = @tournament_a.registrations.create!(
      organization: @org_a,
      team_name: "Cancelled Team",
      registration_status: "cancelled",
      payment_type: "swipe_simple",
      team_members_attributes: team_payload(2, prefix: "cnc").map { |m| m.except(:waiver_accepted) }
    )

    authenticate_as(@volunteer_a)

    post "/api/v1/team_members/#{pending_reg.team_members.first.id}/check_in", headers: auth_headers
    assert_response :unprocessable_entity
    assert_nil pending_reg.team_members.first.reload.checked_in_at

    post "/api/v1/team_members/#{cancelled_reg.team_members.first.id}/check_in", headers: auth_headers
    assert_response :unprocessable_entity
    assert_nil cancelled_reg.team_members.first.reload.checked_in_at
  end

  test "GroupsController#merge_into moves registrations from source group to target group before destroying source" do
    source_group = @tournament_a.groups.create!(group_number: 1, hole_number: 1)
    target_group = @tournament_a.groups.create!(group_number: 2, hole_number: 2)

    reg_source = @tournament_a.registrations.create!(
      organization: @org_a,
      group: source_group,
      team_name: "Source Pair",
      payment_type: "stripe",
      team_members_attributes: team_payload(2, prefix: "ms").map { |m| m.except(:waiver_accepted) }
    )
    reg_target = @tournament_a.registrations.create!(
      organization: @org_a,
      group: target_group,
      team_name: "Target Pair",
      payment_type: "stripe",
      team_members_attributes: team_payload(2, prefix: "mt").map { |m| m.except(:waiver_accepted) }
    )

    authenticate_as(@admin_a)
    post "/api/v1/groups/#{source_group.id}/merge_into",
         params: { target_group_id: target_group.id },
         headers: auth_headers,
         as: :json

    assert_response :success
    assert_not Group.exists?(source_group.id)
    assert_equal target_group.id, reg_source.reload.group_id
    assert_equal target_group.id, reg_target.reload.group_id
    assert_equal 4, target_group.reload.player_count
  end

  test "P1-2 & P1-3: unified capacity waitlists/blocks legacy POST /api/v1/golfers when Registrations fill tournament and syncs TournamentSerializer" do
    # 2-team tournament using capacity_unit: 'teams'
    t = @org_a.tournaments.create!(
      name: "Mixed Admission Cup",
      year: 2027,
      status: "open",
      registration_open: true,
      team_size: 2,
      capacity_unit: "teams",
      max_capacity: 2,
      waitlist_enabled: true,
      entry_fee: 30000
    )

    # Fill both spots via new Registration API
    2.times do |i|
      t.registrations.create!(
        organization: @org_a,
        team_name: "New Team #{i + 1}",
        payment_type: "stripe",
        team_members_attributes: team_payload(2, prefix: "mx#{i}").map { |m| m.except(:waiver_accepted) }
      )
    end

    # TournamentSerializer reports unified at_capacity / confirmed_count for teams mode
    authenticate_as(@admin_a)
    get "/api/v1/tournaments/#{t.id}", headers: auth_headers
    assert_response :success
    serialized = JSON.parse(response.body)
    assert_equal 2, serialized["confirmed_count"]
    assert_equal 0, serialized["public_capacity_remaining"]
    assert_equal true, serialized["at_capacity"]
    assert_equal true, serialized["public_at_capacity"]

    # Incoming legacy POST /api/v1/golfers MUST be waitlisted (not confirmed!)
    post "/api/v1/golfers",
         params: {
           tournament_id: t.id,
           waiver_accepted: true,
           golfer: {
             name: "Legacy Overflow",
             email: "legacy-ov-#{SecureRandom.hex(3)}@example.com",
             phone: "+16715559876",
             payment_type: "pay_on_day",
             team_category: "Co-Ed"
           }
         },
         headers: { "X-Tenant-Host" => "alpha.golf.test" },
         as: :json
    assert_response :created
    assert_equal "waitlist", JSON.parse(response.body).dig("golfer", "registration_status")

    # When waitlist is disabled, legacy POST /api/v1/golfers is rejected with 422!
    t.update!(waitlist_enabled: false)
    post "/api/v1/golfers",
         params: {
           tournament_id: t.id,
           waiver_accepted: true,
           golfer: {
             name: "Legacy Blocked",
             email: "legacy-blk-#{SecureRandom.hex(3)}@example.com",
             phone: "+16715559877",
             payment_type: "pay_on_day",
             team_category: "Co-Ed"
           }
         },
         headers: { "X-Tenant-Host" => "alpha.golf.test" },
         as: :json
    assert_response :unprocessable_entity
  end

  test "P2: undo_check_in rejects members on cancelled registrations with 422" do
    reg = @tournament_a.registrations.create!(
      organization: @org_a,
      team_name: "Cancel Undo Team",
      payment_type: "stripe",
      team_members_attributes: team_payload(2, prefix: "cu").map { |m| m.except(:waiver_accepted) }
    )
    member = reg.team_members.first
    member.check_in!(admin: @admin_a)
    reg.cancel!(admin: @admin_a, reason: "Withdrew")

    authenticate_as(@volunteer_a)
    post "/api/v1/team_members/#{member.id}/undo_check_in", headers: auth_headers
    assert_response :unprocessable_entity
  end
end
