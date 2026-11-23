# frozen_string_literal: true

require "test_helper"

class BroadcastAnnouncementsTest < ActionDispatch::IntegrationTest
  setup do
    @prev_resend = ENV["RESEND_API_KEY"]
    @prev_clicksend_user = ENV["CLICKSEND_USERNAME"]
    @prev_clicksend_key = ENV["CLICKSEND_API_KEY"]
    ENV["RESEND_API_KEY"] = ""
    ENV["CLICKSEND_USERNAME"] = ""
    ENV["CLICKSEND_API_KEY"] = ""

    @org = Organization.create!(
      name: "Broadcast Golf Club",
      slug: "broadcast-club-#{SecureRandom.hex(3)}",
      primary_color: "#1E3A5F",
      subscription_status: "active"
    )
    @t1 = @org.tournaments.create!(
      name: "Island Open 2027",
      slug: "island-open-#{SecureRandom.hex(2)}",
      year: 2027,
      status: "open",
      registration_open: true,
      entry_fee: 15_000,
      waiver_enabled: true
    )
    @t2 = @org.tournaments.create!(
      name: "Fall Cup 2027",
      slug: "fall-cup-#{SecureRandom.hex(2)}",
      year: 2027,
      status: "open",
      registration_open: true,
      entry_fee: 15_000,
      waiver_enabled: true
    )

    @group1 = @t1.groups.create!(group_number: 1, hole_number: 1)
    @group2 = @t1.groups.create!(group_number: 2, hole_number: 2)
    @foreign_group = @t2.groups.create!(group_number: 1, hole_number: 1)

    @g_checked = @t1.golfers.create!(
      name: "Checked In Player",
      email: "checked@example.com",
      phone: "+16715550101",
      group: @group1,
      registration_status: "confirmed",
      payment_status: "paid",
      payment_type: "stripe",
      checked_in_at: Time.current,
      waiver_accepted_at: Time.current,
      team_category: "Male"
    )
    @g_unchecked = @t1.golfers.create!(
      name: "Not Checked Player",
      email: "unchecked@example.com",
      phone: "+16715550102",
      group: @group2,
      registration_status: "confirmed",
      payment_status: "paid",
      payment_type: "stripe",
      waiver_accepted_at: Time.current,
      team_category: "Female"
    )
    @g_cancelled = @t1.golfers.create!(
      name: "Cancelled Player",
      email: "cancelled@example.com",
      phone: "+16715550199",
      group: @group1,
      registration_status: "cancelled",
      payment_status: "unpaid",
      payment_type: "pay_on_day",
      waiver_accepted_at: Time.current,
      team_category: "Male"
    )

    @t1.sponsors.create!(
      name: "Ocean Bank",
      tier: "gold",
      login_email: "sponsor@oceanbank.example.com",
      active: true
    )
    @t1.sponsors.create!(
      name: "Inactive Sponsor",
      tier: "silver",
      login_email: "hidden@sponsor.example.com",
      active: false
    )

    @org_admin = User.create!(
      clerk_id: "clerk_bcast_admin_#{SecureRandom.hex(3)}",
      email: "admin-#{SecureRandom.hex(3)}@bcast.example.com",
      name: "Org Admin",
      role: "org_admin"
    )
    @org.organization_memberships.create!(user: @org_admin, role: "org_admin")

    @coordinator = User.create!(
      clerk_id: "clerk_bcast_coord_#{SecureRandom.hex(3)}",
      email: "coord-#{SecureRandom.hex(3)}@bcast.example.com",
      name: "Scoped Coordinator",
      role: "tournament_admin"
    )
    @org.organization_memberships.create!(
      user: @coordinator,
      role: "coordinator",
      scoped_tournament_ids: [@t1.id]
    )

    @checkin_vol = User.create!(
      clerk_id: "clerk_bcast_checkin_#{SecureRandom.hex(3)}",
      email: "checkin-#{SecureRandom.hex(3)}@bcast.example.com",
      name: "Check-In Volunteer",
      role: "tournament_admin"
    )
    @org.organization_memberships.create!(user: @checkin_vol, role: "checkin_volunteer")

    @raffle_vol = User.create!(
      clerk_id: "clerk_bcast_raffle_#{SecureRandom.hex(3)}",
      email: "raffle-#{SecureRandom.hex(3)}@bcast.example.com",
      name: "Raffle Volunteer",
      role: "tournament_admin"
    )
    @org.organization_memberships.create!(user: @raffle_vol, role: "raffle_volunteer")
  end

  teardown do
    ENV["RESEND_API_KEY"] = @prev_resend
    ENV["CLICKSEND_USERNAME"] = @prev_clicksend_user
    ENV["CLICKSEND_API_KEY"] = @prev_clicksend_key
  end

  def headers_for(user)
    { "Authorization" => "Bearer test_token_#{user.id}" }
  end

  def with_stubbed_singleton_method(klass, method_name, replacement)
    orig = klass.method(method_name)
    klass.define_singleton_method(method_name, &replacement)
    yield
  ensure
    klass.define_singleton_method(method_name, orig)
  end

  test "RBAC denies check-in and raffle volunteers (403) and scopes coordinators strictly" do
    [@checkin_vol, @raffle_vol].each do |vol|
      get "/api/v1/tournaments/#{@t1.id}/broadcasts", headers: headers_for(vol)
      assert_response :forbidden

      post "/api/v1/tournaments/#{@t1.id}/broadcasts/preview",
           params: { audience: "all_confirmed", channel: "email" },
           headers: headers_for(vol),
           as: :json
      assert_response :forbidden

      post "/api/v1/tournaments/#{@t1.id}/broadcasts",
           params: { audience: "all_confirmed", channel: "email", subject: "Test", message: "Hello" },
           headers: headers_for(vol),
           as: :json
      assert_response :forbidden
    end

    # Scoped coordinator can access @t1, blocked on @t2
    get "/api/v1/tournaments/#{@t1.id}/broadcasts", headers: headers_for(@coordinator)
    assert_response :success

    get "/api/v1/tournaments/#{@t2.id}/broadcasts", headers: headers_for(@coordinator)
    assert_response :forbidden
  end

  test "preview accurately counts all 5 audiences and rejects foreign group IDs" do
    # 1. all_confirmed (excludes cancelled) -> 2
    post "/api/v1/tournaments/#{@t1.id}/broadcasts/preview",
         params: { audience: "all_confirmed", channel: "both" },
         headers: headers_for(@org_admin),
         as: :json
    assert_response :success
    body = JSON.parse(response.body)
    assert_equal 2, body["recipient_count"]
    assert_equal 2, body["email_recipients"]
    assert_equal 2, body["sms_recipients"]
    assert_equal true, body["dry_run"]

    # 2. checked_in -> 1
    post "/api/v1/tournaments/#{@t1.id}/broadcasts/preview",
         params: { audience: "checked_in", channel: "sms" },
         headers: headers_for(@org_admin),
         as: :json
    assert_response :success
    assert_equal 1, JSON.parse(response.body)["recipient_count"]

    # 3. unchecked_in -> 1
    post "/api/v1/tournaments/#{@t1.id}/broadcasts/preview",
         params: { audience: "unchecked_in", channel: "email" },
         headers: headers_for(@org_admin),
         as: :json
    assert_response :success
    assert_equal 1, JSON.parse(response.body)["recipient_count"]

    # 4. sponsors (active only) -> 1
    post "/api/v1/tournaments/#{@t1.id}/broadcasts/preview",
         params: { audience: "sponsors", channel: "email" },
         headers: headers_for(@org_admin),
         as: :json
    assert_response :success
    assert_equal 1, JSON.parse(response.body)["recipient_count"]

    # 5. specific_groups (@group1 only -> 1 confirmed, excludes cancelled)
    post "/api/v1/tournaments/#{@t1.id}/broadcasts/preview",
         params: { audience: "specific_groups", channel: "both", target_group_ids: [@group1.id] },
         headers: headers_for(@org_admin),
         as: :json
    assert_response :success
    assert_equal 1, JSON.parse(response.body)["recipient_count"]

    # Foreign group ID rejected with 422
    post "/api/v1/tournaments/#{@t1.id}/broadcasts/preview",
         params: { audience: "specific_groups", channel: "both", target_group_ids: [@foreign_group.id] },
         headers: headers_for(@org_admin),
         as: :json
    assert_response :unprocessable_entity
  end

  test "sending broadcast in dry-run mode makes zero outbound calls, logs ActivityLog, and appears in history" do
    sms_called = false
    email_called = false

    with_stubbed_singleton_method(SmsService, :send_sms, ->(**) { sms_called = true; { success: true } }) do
      with_stubbed_singleton_method(Resend::Emails, :send, ->(*) { email_called = true; { "id" => "re_1" } }) do
        post "/api/v1/tournaments/#{@t1.id}/broadcasts",
             params: {
               broadcast: {
                 audience: "all_confirmed",
                 channel: "both",
                 subject: "15-Minute Shotgun Call",
                 message: "Please report to your carts now for the 7:30 AM shotgun start!"
               }
             },
             headers: headers_for(@coordinator),
             as: :json
      end
    end

    assert_response :created
    assert_equal false, sms_called
    assert_equal false, email_called

    created = JSON.parse(response.body)["announcement"]
    assert_equal true, created["dry_run"]
    assert_equal "dry_run", created["status"]
    assert_equal 2, created["recipient_count"]
    assert_equal 0, created["sent_count"]
    assert_equal "Scoped Coordinator", created["sender_name"]

    # ActivityLog recorded
    log = ActivityLog.where(tournament: @t1, action: "broadcast_sent").last
    assert_not_nil log
    assert_equal @coordinator.id, log.admin_id

    # Appears in history
    get "/api/v1/tournaments/#{@t1.id}/broadcasts", headers: headers_for(@org_admin)
    assert_response :success
    index_body = JSON.parse(response.body)
    assert_equal 1, index_body["announcements"].length
    assert_equal true, index_body["config"]["local_dry_run_mode"]
    assert_equal 2, index_body["groups"].length
  end

  test "configured email channel escapes HTML and tracks MessageDelivery records" do
    ENV["RESEND_API_KEY"] = "re_test_key"
    sent_payloads = []

    with_stubbed_singleton_method(Resend::Emails, :send, ->(payload) { sent_payloads << payload; { "id" => "re_msg_1" } }) do
      post "/api/v1/tournaments/#{@t1.id}/broadcasts",
           params: {
             broadcast: {
               audience: "sponsors",
               channel: "email",
               subject: "Sponsor Update <script>alert(1)</script>",
               message: "Thanks for supporting us!\nMeet at <b>Hole 1</b>."
             }
           },
           headers: headers_for(@org_admin),
           as: :json
    end

    assert_response :created
    created = JSON.parse(response.body)["announcement"]
    assert_equal false, created["dry_run"]
    assert_equal "completed", created["status"]
    assert_equal 1, created["sent_count"]
    assert_equal 0, created["failed_count"]
    assert_equal 1, sent_payloads.length
    assert_equal "sponsor@oceanbank.example.com", sent_payloads.first[:to]
    assert_not_includes sent_payloads.first[:html], "<script>"
    assert_not_includes sent_payloads.first[:html], "<b>Hole 1</b>"
    assert_includes sent_payloads.first[:html], "&lt;b&gt;Hole 1&lt;/b&gt;"
    assert_equal 1, MessageDelivery.where(tournament: @t1, purpose: "tournament_broadcast").count
  end

  test "both channel with only email configured records effective email channel, skips sms cleanly, and send_broadcasts-only user loads broadcasts by slug without roster PII" do
    ENV["RESEND_API_KEY"] = "re_test_key"

    # Custom user with ONLY send_broadcasts capability CANNOT read full golfer roster (403)
    broadcaster = User.create!(
      clerk_id: "clerk_bcast_only_#{SecureRandom.hex(3)}",
      email: "broadcaster-#{SecureRandom.hex(3)}@bcast.example.com",
      name: "Comms Lead",
      role: "tournament_admin"
    )
    @org.organization_memberships.create!(
      user: broadcaster,
      role: "checkin_volunteer",
      permissions: { "check_in" => false, "verify_door_payment" => false, "send_broadcasts" => true }
    )
    get "/api/v1/admin/organizations/#{@org.slug}/tournaments/#{@t1.slug}", headers: headers_for(broadcaster)
    assert_response :forbidden

    # Instead, broadcaster loads the slug-scoped broadcasts endpoint returning minimal tournament metadata (no golfer PII)
    get "/api/v1/admin/organizations/#{@org.slug}/tournaments/#{@t1.slug}/broadcasts", headers: headers_for(broadcaster)
    assert_response :success
    slug_body = JSON.parse(response.body)
    assert_equal @t1.id, slug_body.dig("tournament", "id")
    assert_equal @t1.name, slug_body.dig("tournament", "name")
    assert_nil slug_body["golfers"]

    # Preview for channel=both when only email is configured reports skipped_channel=sms & sms_recipients=0
    post "/api/v1/tournaments/#{@t1.id}/broadcasts/preview",
         params: { audience: "all_confirmed", channel: "both" },
         headers: headers_for(broadcaster),
         as: :json
    assert_response :success
    preview = JSON.parse(response.body)
    assert_equal "email", preview["effective_channel"]
    assert_equal "sms", preview["skipped_channel"]
    assert_equal 2, preview["email_recipients"]
    assert_equal 0, preview["sms_recipients"]
    assert_equal false, preview["dry_run"]

    # Send records effective_channel="email" and sms_recipient_count=0
    with_stubbed_singleton_method(Resend::Emails, :send, ->(*) { { "id" => "re_partial" } }) do
      post "/api/v1/tournaments/#{@t1.id}/broadcasts",
           params: {
             broadcast: {
               audience: "all_confirmed",
               channel: "both",
               subject: "Schedule Update",
               message: "Check-in opens at 6:30 AM."
             }
           },
           headers: headers_for(broadcaster),
           as: :json
    end
    assert_response :created
    body = JSON.parse(response.body)
    assert_equal "sms", body["skipped_channel"]
    assert_equal "email", body["announcement"]["channel"]
    assert_equal 2, body["announcement"]["email_recipient_count"]
    assert_equal 0, body["announcement"]["sms_recipient_count"]
    assert_equal 2, body["announcement"]["sent_count"]
  end
end
