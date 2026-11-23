# frozen_string_literal: true

require "test_helper"

class RbacAndSecurityHardeningTest < ActionDispatch::IntegrationTest
  setup do
    @org = Organization.create!(
      name: "RBAC Golf Club",
      slug: "rbac-golf-club",
      primary_color: "#1E3A5F",
      subscription_status: "active"
    )
    @other_org = Organization.create!(
      name: "Other Golf Club",
      slug: "other-golf-club",
      primary_color: "#14532D",
      subscription_status: "active"
    )
    @t1 = @org.tournaments.create!(
      name: "Spring Classic",
      slug: "spring-classic",
      year: 2026,
      status: "open",
      entry_fee: 15_000,
      registration_open: true,
      raffle_enabled: true,
      raffle_ticket_price_cents: 1_000,
      waiver_enabled: true
    )
    @t2 = @org.tournaments.create!(
      name: "Fall Invitational",
      slug: "fall-invitational",
      year: 2026,
      status: "open",
      entry_fee: 20_000,
      registration_open: true,
      raffle_enabled: true,
      waiver_enabled: true,
      allow_partial_teams: true
    )

    @group = @t1.groups.create!(group_number: 1, hole_number: 1)
    @golfer = @t1.golfers.create!(
      name: "Jordan Cruz",
      email: "jordan@example.com",
      phone: "671-555-0199",
      group: @group,
      registration_status: "confirmed",
      payment_status: "paid",
      payment_method: "stripe",
      payment_type: "stripe",
      payment_amount_cents: 15_000,
      waiver_accepted_at: Time.current,
      team_category: "Male"
    )
    @t2_golfer = @t2.golfers.create!(
      name: "Fall Player",
      email: "fall@example.com",
      phone: "671-555-0177",
      registration_status: "confirmed",
      payment_status: "paid",
      payment_method: "stripe",
      payment_type: "stripe",
      payment_amount_cents: 20_000,
      waiver_accepted_at: Time.current,
      team_category: "Male"
    )
    @t2_reg = @t2.registrations.new(
      organization: @org,
      contact_name: "Fall Captain",
      contact_email: "fallcap@example.com",
      contact_phone: "671-555-0178",
      team_name: "Fall Squad",
      registration_status: "confirmed",
      payment_status: "paid"
    )
    @t2_team_member = @t2_reg.team_members.build(
      organization: @org,
      name: "Fall Teammate",
      email: "falltm@example.com",
      phone: "671-555-0179"
    )
    @t2_reg.save!
    @unpaid_golfer = @t1.golfers.create!(
      name: "Door Pay Player",
      email: "doorpay@example.com",
      phone: "671-555-0188",
      registration_status: "confirmed",
      payment_status: "unpaid",
      payment_type: "pay_on_day",
      waiver_accepted_at: Time.current,
      team_category: "Female"
    )
    @prize = @t1.raffle_prizes.create!(
      name: "Pro Driver",
      tier: "grand",
      value_cents: 50_000,
      position: 1
    )

    @org_admin = User.create!(clerk_id: "clerk_rbac_admin", email: "admin@rbac.example.com", name: "Org Admin", role: "org_admin")
    @org_admin_membership = @org.organization_memberships.create!(user: @org_admin, role: "org_admin")

    @coordinator = User.create!(clerk_id: "clerk_rbac_coord", email: "coord@rbac.example.com", name: "Coordinator", role: "tournament_admin")
    @org.organization_memberships.create!(user: @coordinator, role: "coordinator")

    @checkin_vol = User.create!(clerk_id: "clerk_rbac_checkin", email: "checkin@rbac.example.com", name: "Checkin Vol", role: "tournament_admin")
    @org.organization_memberships.create!(user: @checkin_vol, role: "checkin_volunteer", scoped_tournament_ids: [@t1.id])

    @raffle_vol = User.create!(clerk_id: "clerk_rbac_raffle", email: "raffle@rbac.example.com", name: "Raffle Vol", role: "tournament_admin")
    @org.organization_memberships.create!(user: @raffle_vol, role: "raffle_volunteer")

    @marshal = User.create!(clerk_id: "clerk_rbac_marshal", email: "marshal@rbac.example.com", name: "Scoring Marshal", role: "tournament_admin")
    @org.organization_memberships.create!(user: @marshal, role: "scoring_marshal", scoped_tournament_ids: [@t1.id])

    @golfer_mgr = User.create!(clerk_id: "clerk_rbac_gmgr", email: "gmgr@rbac.example.com", name: "Roster Mgr", role: "tournament_admin")
    @org.organization_memberships.create!(
      user: @golfer_mgr,
      role: "checkin_volunteer",
      permissions: { "manage_golfers" => true, "check_in" => false, "verify_door_payment" => false }
    )
  end

  def headers_for(user)
    authenticate_as(user)
    auth_headers
  end

  test "checkin_volunteer is scoped to @t1 across check-in, waivers, team_members, and roster without leaking revenue or payment_amount_cents" do
    # /admins/me returns station_mode = checkin & fails closed on inaccessible ?org=
    get "/api/v1/admins/me", params: { org: @org.slug }, headers: headers_for(@checkin_vol)
    assert_response :success
    me = JSON.parse(response.body)
    assert_equal "checkin_volunteer", me["org_role"]
    assert_equal "checkin", me["station_mode"]
    assert_equal true, me.dig("capabilities", "check_in")
    assert_equal false, me.dig("capabilities", "view_reports")
    assert_equal [@t1.id], me["scoped_tournament_ids"]

    get "/api/v1/admins/me", params: { org: @other_org.slug }, headers: headers_for(@checkin_vol)
    assert_response :forbidden

    # Can check in & verify door payment on @t1
    post "/api/v1/golfers/#{@golfer.id}/check_in", headers: headers_for(@checkin_vol)
    assert_response :success
    post "/api/v1/golfers/#{@unpaid_golfer.id}/verify_payment",
         params: { payment_method: "cash" },
         headers: headers_for(@checkin_vol),
         as: :json
    assert_response :success

    # Out-of-scope @t2 waiver signing and team_member check-in are strictly 403!
    post "/api/v1/golfers/#{@t2_golfer.id}/mark_waiver_signed", headers: headers_for(@checkin_vol)
    assert_response :forbidden
    post "/api/v1/team_members/#{@t2_team_member.id}/check_in", headers: headers_for(@checkin_vol)
    assert_response :forbidden

    # 403 on PaymentReports, Raffle POS, Raffle Draw, Team management
    get "/api/v1/tournaments/#{@t1.id}/payment_report", headers: headers_for(@checkin_vol)
    assert_response :forbidden
    get "/api/v1/tournaments/#{@t1.id}/raffle/admin/tickets", headers: headers_for(@checkin_vol)
    assert_response :forbidden
    post "/api/v1/tournaments/#{@t1.id}/raffle/prizes/#{@prize.id}/draw", headers: headers_for(@checkin_vol)
    assert_response :forbidden
    get "/api/v1/admin/organizations/#{@org.slug}/members", headers: headers_for(@checkin_vol)
    assert_response :forbidden

    # Tournament list only includes scoped @t1 and strips revenue & total_revenue
    get "/api/v1/admin/organizations/#{@org.slug}/tournaments", headers: headers_for(@checkin_vol)
    assert_response :success
    t_body = JSON.parse(response.body)
    assert_equal [@t1.slug], t_body["tournaments"].map { |t| t["slug"] }
    assert_nil t_body["tournaments"].first["revenue"]
    assert_nil t_body.dig("stats", "total_revenue")

    # Tournament detail strips revenue AND per-golfer payment_amount_cents on @t1; 403 on @t2
    get "/api/v1/admin/organizations/#{@org.slug}/tournaments/#{@t1.slug}", headers: headers_for(@checkin_vol)
    assert_response :success
    detail = JSON.parse(response.body)
    assert_nil detail.dig("stats", "revenue")
    assert_nil detail["golfers"].first["payment_amount_cents"]

    get "/api/v1/admin/organizations/#{@org.slug}/tournaments/#{@t2.slug}", headers: headers_for(@checkin_vol)
    assert_response :forbidden
  end

  test "raffle_volunteer can sell raffle tickets without seeing additional_revenue_cents and gets 403 on draw, waivers, team check-in, and reports" do
    get "/api/v1/admins/me", params: { org: @org.slug }, headers: headers_for(@raffle_vol)
    assert_response :success
    me = JSON.parse(response.body)
    assert_equal "raffle", me["station_mode"]

    post "/api/v1/tournaments/#{@t1.id}/raffle/sell",
         params: { buyer_name: "Walkup Buyer", buyer_email: "walkup@example.com", quantity: 2, price_cents: 2_000, payment_method: "cash" },
         headers: headers_for(@raffle_vol),
         as: :json
    assert_response :created

    # Raffle POS tickets response omits additional_revenue_cents for volunteers
    get "/api/v1/tournaments/#{@t1.id}/raffle/admin/tickets", headers: headers_for(@raffle_vol)
    assert_response :success
    assert_nil JSON.parse(response.body).dig("stats", "additional_revenue_cents")

    # 403 on draw, reset, prize creation, check-in, waiver, team_member, and payment report
    post "/api/v1/tournaments/#{@t1.id}/raffle/prizes/#{@prize.id}/draw", headers: headers_for(@raffle_vol)
    assert_response :forbidden
    post "/api/v1/tournaments/#{@t1.id}/raffle/prizes/#{@prize.id}/reset", headers: headers_for(@raffle_vol)
    assert_response :forbidden
    post "/api/v1/tournaments/#{@t1.id}/raffle/prizes",
         params: { prize: { name: "Blocked Prize", tier: "standard" } },
         headers: headers_for(@raffle_vol),
         as: :json
    assert_response :forbidden
    post "/api/v1/golfers/#{@golfer.id}/check_in", headers: headers_for(@raffle_vol)
    assert_response :forbidden
    post "/api/v1/golfers/#{@golfer.id}/mark_waiver_signed", headers: headers_for(@raffle_vol)
    assert_response :forbidden
    post "/api/v1/team_members/#{@t2_team_member.id}/check_in", headers: headers_for(@raffle_vol)
    assert_response :forbidden
    get "/api/v1/tournaments/#{@t1.id}/payment_report", headers: headers_for(@raffle_vol)
    assert_response :forbidden
  end

  test "scoring_marshal can enter scores on scoped @t1 but gets 403 on @t2 scores, check-in, and reports; manage_golfers alone cannot mutate payments" do
    get "/api/v1/admins/me", params: { org: @org.slug }, headers: headers_for(@marshal)
    assert_response :success
    assert_equal "scoring", JSON.parse(response.body)["station_mode"]

    post "/api/v1/tournaments/#{@t1.id}/scores",
         params: { score: { golfer_id: @golfer.id, group_id: @group.id, hole: 1, strokes: 4, score_type: "individual" } },
         headers: headers_for(@marshal),
         as: :json
    assert_includes [200, 201], response.status

    post "/api/v1/tournaments/#{@t2.id}/scores",
         params: { score: { golfer_id: @t2_golfer.id, hole: 1, strokes: 4 } },
         headers: headers_for(@marshal),
         as: :json
    assert_response :forbidden

    post "/api/v1/golfers/#{@golfer.id}/check_in", headers: headers_for(@marshal)
    assert_response :forbidden

    # manage_golfers-only member cannot mutate payments or edit payment details or enter scores
    post "/api/v1/golfers/#{@golfer.id}/payment_details",
         params: { payment_notes: "Blocked" },
         headers: headers_for(@golfer_mgr),
         as: :json
    assert_response :forbidden
    patch "/api/v1/golfers/#{@golfer.id}/mark_paid",
          params: { payment_method: "cash" },
          headers: headers_for(@golfer_mgr),
          as: :json
    assert_response :forbidden
    post "/api/v1/tournaments/#{@t1.id}/scores",
         params: { score: { golfer_id: @golfer.id, hole: 2, strokes: 3 } },
         headers: headers_for(@golfer_mgr),
         as: :json
    assert_response :forbidden
  end

  test "team management blocks self-mutation, manage_team escalation, and malformed scoped_tournament_ids; org_admin sees team logs in activity feed" do
    # Cannot grant manage_team to non-admin role
    post "/api/v1/admin/organizations/#{@org.slug}/members",
         params: {
           email: "escalate@rbac.example.com",
           role: "checkin_volunteer",
           permissions: { manage_team: true }
         },
         headers: headers_for(@org_admin),
         as: :json
    assert_response :unprocessable_entity

    # Malformed scoped_tournament_ids rejected (never silently widened to [])
    post "/api/v1/admin/organizations/#{@org.slug}/members",
         params: {
           email: "badscope@rbac.example.com",
           role: "checkin_volunteer",
           scoped_tournament_ids: ["not-an-id", -5]
         },
         headers: headers_for(@org_admin),
         as: :json
    assert_response :unprocessable_entity

    # Self-mutation forbidden for non-super-admin
    patch "/api/v1/admin/organizations/#{@org.slug}/members/#{@org_admin_membership.id}",
          params: { role: "coordinator" },
          headers: headers_for(@org_admin),
          as: :json
    assert_response :forbidden

    # Valid invite & update logged and visible to org_admin in activity_logs?all_tournaments=true
    post "/api/v1/admin/organizations/#{@org.slug}/members",
         params: {
           email: "dual-vol@rbac.example.com",
           role: "checkin_volunteer",
           permissions: { raffle_sell: true },
           scoped_tournament_ids: [@t1.id]
         },
         headers: headers_for(@org_admin),
         as: :json
    assert_response :created
    member = JSON.parse(response.body)["member"]

    patch "/api/v1/admin/organizations/#{@org.slug}/members/#{member['id']}",
          params: { role: "raffle_volunteer", permissions: { check_in: true }, scoped_tournament_ids: [] },
          headers: headers_for(@org_admin),
          as: :json
    assert_response :success

    get "/api/v1/activity_logs", params: { all_tournaments: "true" }, headers: headers_for(@org_admin)
    assert_response :success
    actions = JSON.parse(response.body)["activity_logs"].map { |l| l["action"] }
    assert_includes actions, "member_permissions_updated"
  end
end
