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
    @t1 = @org.tournaments.create!(
      name: "Spring Classic",
      slug: "spring-classic",
      year: 2026,
      status: "open",
      entry_fee: 15_000,
      registration_open: true,
      raffle_enabled: true,
      raffle_ticket_price_cents: 1_000
    )
    @t2 = @org.tournaments.create!(
      name: "Fall Invitational",
      slug: "fall-invitational",
      year: 2026,
      status: "open",
      entry_fee: 20_000,
      registration_open: true,
      raffle_enabled: true
    )

    @golfer = @t1.golfers.create!(
      name: "Jordan Cruz",
      email: "jordan@example.com",
      phone: "671-555-0199",
      registration_status: "confirmed",
      payment_status: "paid",
      payment_method: "stripe",
      payment_type: "stripe",
      payment_amount_cents: 15_000,
      waiver_accepted_at: Time.current,
      team_category: "Male"
    )
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
    @org.organization_memberships.create!(user: @org_admin, role: "org_admin")

    @coordinator = User.create!(clerk_id: "clerk_rbac_coord", email: "coord@rbac.example.com", name: "Coordinator", role: "tournament_admin")
    @org.organization_memberships.create!(user: @coordinator, role: "coordinator")

    @checkin_vol = User.create!(clerk_id: "clerk_rbac_checkin", email: "checkin@rbac.example.com", name: "Checkin Vol", role: "tournament_admin")
    @org.organization_memberships.create!(user: @checkin_vol, role: "checkin_volunteer", scoped_tournament_ids: [@t1.id])

    @raffle_vol = User.create!(clerk_id: "clerk_rbac_raffle", email: "raffle@rbac.example.com", name: "Raffle Vol", role: "tournament_admin")
    @org.organization_memberships.create!(user: @raffle_vol, role: "raffle_volunteer")
  end

  def headers_for(user)
    authenticate_as(user)
    auth_headers
  end

  test "checkin_volunteer can check in and verify door payment on scoped tournament, but gets 403 on payment reports, raffle, settings, and unscoped tournaments" do
    # /admins/me returns station_mode = checkin & exact capabilities
    get "/api/v1/admins/me", params: { org: @org.slug }, headers: headers_for(@checkin_vol)
    assert_response :success
    me = JSON.parse(response.body)
    assert_equal "checkin_volunteer", me["org_role"]
    assert_equal "checkin", me["station_mode"]
    assert_equal true, me.dig("capabilities", "check_in")
    assert_equal false, me.dig("capabilities", "view_reports")
    assert_equal [@t1.id], me["scoped_tournament_ids"]

    # Can check in golfer on @t1
    post "/api/v1/golfers/#{@golfer.id}/check_in", headers: headers_for(@checkin_vol)
    assert_response :success

    # Can verify door payment on @t1
    post "/api/v1/golfers/#{@unpaid_golfer.id}/verify_payment",
         params: { payment_method: "cash" },
         headers: headers_for(@checkin_vol),
         as: :json
    assert_response :success

    # 403 on PaymentReportsController
    get "/api/v1/tournaments/#{@t1.id}/payment_report", headers: headers_for(@checkin_vol)
    assert_response :forbidden

    # 403 on Raffle POS and Raffle Draw
    get "/api/v1/tournaments/#{@t1.id}/raffle/admin/tickets", headers: headers_for(@checkin_vol)
    assert_response :forbidden
    post "/api/v1/tournaments/#{@t1.id}/raffle/prizes/#{@prize.id}/draw", headers: headers_for(@checkin_vol)
    assert_response :forbidden

    # 403 on Team management
    get "/api/v1/admin/organizations/#{@org.slug}/members", headers: headers_for(@checkin_vol)
    assert_response :forbidden

    # Tournament list only includes scoped @t1 and strips revenue & total_revenue!
    get "/api/v1/admin/organizations/#{@org.slug}/tournaments", headers: headers_for(@checkin_vol)
    assert_response :success
    t_body = JSON.parse(response.body)
    assert_equal [@t1.slug], t_body["tournaments"].map { |t| t["slug"] }
    assert_nil t_body["tournaments"].first["revenue"]
    assert_nil t_body.dig("stats", "total_revenue")

    # Tournament detail strips revenue on @t1 and returns 403 on out-of-scope @t2!
    get "/api/v1/admin/organizations/#{@org.slug}/tournaments/#{@t1.slug}", headers: headers_for(@checkin_vol)
    assert_response :success
    assert_nil JSON.parse(response.body).dig("stats", "revenue")

    get "/api/v1/admin/organizations/#{@org.slug}/tournaments/#{@t2.slug}", headers: headers_for(@checkin_vol)
    assert_response :forbidden
  end

  test "raffle_volunteer can sell raffle tickets but gets 403 on draw, reset, prize CRUD, check-in, and payment reports" do
    get "/api/v1/admins/me", params: { org: @org.slug }, headers: headers_for(@raffle_vol)
    assert_response :success
    me = JSON.parse(response.body)
    assert_equal "raffle", me["station_mode"]
    assert_equal true, me.dig("capabilities", "raffle_sell")
    assert_equal false, me.dig("capabilities", "raffle_draw")

    # Can view raffle tickets & sell tickets
    get "/api/v1/tournaments/#{@t1.id}/raffle/admin/tickets", headers: headers_for(@raffle_vol)
    assert_response :success

    post "/api/v1/tournaments/#{@t1.id}/raffle/sell",
         params: { buyer_name: "Walkup Buyer", buyer_email: "walkup@example.com", quantity: 2, price_cents: 2_000, payment_method: "cash" },
         headers: headers_for(@raffle_vol),
         as: :json
    assert_response :created

    # 403 on draw, reset, prize creation, check-in, and payment report
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

    get "/api/v1/tournaments/#{@t1.id}/payment_report", headers: headers_for(@raffle_vol)
    assert_response :forbidden
  end

  test "coordinator can view payment reports and draw raffle prizes but gets 403 on manage_team and manage_finances refunds" do
    get "/api/v1/tournaments/#{@t1.id}/payment_report", headers: headers_for(@coordinator)
    assert_response :success

    get "/api/v1/admin/organizations/#{@org.slug}/tournaments", headers: headers_for(@coordinator)
    assert_response :success
    assert_not_nil JSON.parse(response.body).dig("stats", "total_revenue")

    get "/api/v1/admin/organizations/#{@org.slug}/members", headers: headers_for(@coordinator)
    assert_response :forbidden

    post "/api/v1/golfers/#{@golfer.id}/mark_refunded",
         params: { reason: "Test" },
         headers: headers_for(@coordinator),
         as: :json
    assert_response :forbidden
  end

  test "org_admin can invite with granular role + overrides + tournament scope, update them, and audit log records changes" do
    get "/api/v1/admin/organizations/#{@org.slug}/members", headers: headers_for(@org_admin)
    assert_response :success
    list = JSON.parse(response.body)
    assert_equal 5, list["role_catalog"].size
    assert_operator list["capability_catalog"].size, :>=, 14

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
    assert_equal "checkin_volunteer", member["role"]
    assert_equal true, member.dig("effective_capabilities", "raffle_sell")
    assert_equal [@t1.id], member["scoped_tournament_ids"]

    # Update overrides & role -> logs member_permissions_updated
    patch "/api/v1/admin/organizations/#{@org.slug}/members/#{member['id']}",
          params: {
            role: "raffle_volunteer",
            permissions: { check_in: true },
            scoped_tournament_ids: []
          },
          headers: headers_for(@org_admin),
          as: :json
    assert_response :success
    updated = JSON.parse(response.body)["member"]
    assert_equal "raffle_volunteer", updated["role"]
    assert_equal true, updated.dig("effective_capabilities", "check_in")
    assert_equal [], updated["scoped_tournament_ids"]
    assert ActivityLog.exists?(organization: @org, action: "member_permissions_updated")
  end
end
