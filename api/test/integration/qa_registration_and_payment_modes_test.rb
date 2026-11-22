# frozen_string_literal: true

require "test_helper"

class QaRegistrationAndPaymentModesTest < ActionDispatch::IntegrationTest
  setup do
    @org = Organization.create!(
      name: "Island Golf Club",
      slug: "island-golf-qa-#{SecureRandom.hex(4)}",
      primary_color: "#6B1D2F"
    )
    @org.organization_domains.create!(hostname: "club-qa.localhost", is_primary: true)
    @payment_config = OrganizationPaymentConfig.create!(
      organization: @org,
      payment_mode: "offline",
      processor_provider: "none"
    )

    @tournament = Tournament.create!(
      organization: @org,
      name: "Island Classic 2027",
      slug: "island-classic-2027",
      year: 2027,
      status: "open",
      registration_open: true,
      public_listed: true,
      team_size: 4,
      allow_partial_teams: true,
      capacity_unit: "players",
      max_capacity: 144,
      entry_fee: 15_000,
      employee_entry_fee: 9_000,
      config: { "features" => { "employee_pricing" => true } }
    )

    @emp_available = EmployeeNumber.create!(
      organization: @org,
      tournament: @tournament,
      employee_number: "EMP-QA-101",
      employee_name: "Confidential Staff Member",
      used: false
    )
  end

  test "new tournaments default entry_fee_display to nil and serialize dynamic player/team display" do
    assert_nil @tournament.read_attribute(:entry_fee_display)
    assert_equal "$150/player", @tournament.formatted_entry_fee_display

    team_tournament = Tournament.create!(
      organization: @org,
      name: "Pair Scramble 2027",
      slug: "pair-scramble-2027",
      year: 2027,
      status: "open",
      registration_open: true,
      public_listed: true,
      team_size: 2,
      capacity_unit: "teams",
      max_capacity: 72,
      entry_fee: 30_000
    )
    assert_nil team_tournament.read_attribute(:entry_fee_display)
    assert_equal "$300/team", team_tournament.formatted_entry_fee_display

    get "/api/v1/organizations/#{@org.slug}/tournaments/#{@tournament.slug}",
        headers: { "Host" => "club-qa.localhost" }
    assert_response :success
    body = JSON.parse(response.body)
    assert_equal "$150/player", body["entry_fee_display"]
    assert_equal "offline", body["payment_mode"]
    assert_equal "none", body["processor_provider"]
    assert_equal false, body["external_checkout_configured"]
  end

  test "tenant resolution exposes non-secret payment_mode and processor_provider" do
    get "/api/v1/tenant", headers: { "Host" => "club-qa.localhost" }
    assert_response :success
    body = JSON.parse(response.body)
    assert_equal @org.slug, body.dig("organization", "slug")
    assert_equal "offline", body.dig("organization", "payment_mode")
    assert_equal "none", body.dig("organization", "processor_provider")
  end

  test "OrgUrlBuilder uses http and local dev port for *.localhost subdomains" do
    prev = ENV["FRONTEND_URL"]
    ENV["FRONTEND_URL"] = "http://localhost:5174"
    assert_equal "http://club-qa.localhost:5174/payment/success?session_id=abc",
                 OrgUrlBuilder.public_url(@org, "/payment/success?session_id=abc")
  ensure
    ENV["FRONTEND_URL"] = prev
  end

  test "public Registration#create computes per-player totals for partial and full teams and defaults offline payment_type" do
    # 2-player partial team ($150 x 2 = $300)
    post "/api/v1/tournaments/#{@tournament.id}/registrations",
         params: {
           organization_slug: @org.slug,
           waiver_accepted: true,
           registration: {
             team_name: "Two Ball",
             team_members: [
               { name: "Alice One", email: "alice1@example.test", phone: "+16715550101", waiver_accepted: true },
               { name: "Bob Two", waiver_accepted: true }
             ]
           }
         },
         as: :json
    assert_response :created
    reg = JSON.parse(response.body)["registration"]
    assert_equal "pay_on_day", reg["payment_type"]
    assert_equal 30_000, reg["payment_amount_cents"]
    assert_equal 30_000, reg["expected_entry_fee_cents"]
    assert_equal 2, reg["player_count"]

    # 4-player full foursome ($150 x 4 = $600)
    post "/api/v1/tournaments/#{@tournament.id}/registrations",
         params: {
           organization_slug: @org.slug,
           waiver_accepted: true,
           registration: {
             team_name: "Full Four",
             team_members: [
               { name: "Cap Four", email: "cap4@example.test", phone: "+16715550102", waiver_accepted: true },
               { name: "P2", waiver_accepted: true },
               { name: "P3", waiver_accepted: true },
               { name: "P4", waiver_accepted: true }
             ]
           }
         },
         as: :json
    assert_response :created
    reg4 = JSON.parse(response.body)["registration"]
    assert_equal 60_000, reg4["payment_amount_cents"]
    assert_equal 4, reg4["player_count"]
  end

  test "public Registration#create claims EmployeeNumber atomically, discounts captain fee, blocks reuse, and releases on cancel" do
    post "/api/v1/tournaments/#{@tournament.id}/registrations",
         params: {
           organization_slug: @org.slug,
           waiver_accepted: true,
           is_employee: true,
           employee_number: "emp-qa-101",
           registration: {
             payment_type: "pay_on_day",
             team_members: [
               { name: "Staff Golfer", email: "staff@example.test", phone: "+16715550109", waiver_accepted: true }
             ]
           }
         },
         as: :json

    assert_response :created
    reg_json = JSON.parse(response.body)["registration"]
    assert_equal 9_000, reg_json["payment_amount_cents"]
    assert_equal true, reg_json["is_employee"]
    assert_equal "EMP-QA-101", reg_json["employee_number"]

    @emp_available.reload
    assert @emp_available.used?
    assert_equal reg_json["id"], @emp_available.used_by_registration_id
    registration = Registration.find(reg_json["id"])
    assert registration.captain.is_employee?
    assert_equal @emp_available.id, registration.captain.employee_number_record_id

    # Attempting to reuse EMP-QA-101 must fail cleanly with 422
    post "/api/v1/tournaments/#{@tournament.id}/registrations",
         params: {
           organization_slug: @org.slug,
           waiver_accepted: true,
           is_employee: true,
           employee_number: "EMP-QA-101",
           registration: {
             team_members: [
               { name: "Second Staff", email: "staff2@example.test", phone: "+16715550110", waiver_accepted: true }
             ]
           }
         },
         as: :json
    assert_response :unprocessable_entity
    assert_match(/already been used/i, response.body)

    # Cancelling registration releases the employee number for reuse
    registration.cancel!(reason: "Test cancel")
    @emp_available.reload
    assert_not @emp_available.used?
    assert_nil @emp_available.used_by_registration_id
    assert_not registration.captain.reload.is_employee?
  end

  test "platform_collect test-mode checkout create and confirm work end-to-end for Registration" do
    @payment_config.update!(payment_mode: "platform_collect", processor_provider: "stripe", test_mode: true)

    post "/api/v1/tournaments/#{@tournament.id}/registrations",
         params: {
           organization_slug: @org.slug,
           waiver_accepted: true,
           registration: {
             payment_type: "stripe",
             team_name: "Stripe Foursome",
             team_members: [
               { name: "Stripe Cap", email: "stripe-cap@example.test", phone: "+16715550201", waiver_accepted: true },
               { name: "Stripe Two", waiver_accepted: true }
             ]
           }
         },
         as: :json
    assert_response :created
    reg_json = JSON.parse(response.body)["registration"]
    token = reg_json["payment_token"]
    assert token.present?

    post "/api/v1/checkout",
         params: { payment_token: token },
         headers: { "Host" => "club-qa.localhost" },
         as: :json
    assert_response :success
    checkout_body = JSON.parse(response.body)
    assert checkout_body["test_mode"]
    assert_equal reg_json["id"], checkout_body["registration_id"]
    assert_includes checkout_body["checkout_url"], "/payment/success?session_id="
    session_id = checkout_body["session_id"]

    post "/api/v1/checkout/confirm",
         params: { session_id: session_id },
         headers: { "Host" => "club-qa.localhost" },
         as: :json
    assert_response :success
    confirm_body = JSON.parse(response.body)
    assert confirm_body["success"]
    assert_equal @tournament.slug, confirm_body["tournament_slug"]
    assert_equal "paid", confirm_body.dig("registration", "payment_status")
    assert_equal 30_000, confirm_body.dig("registration", "payment_amount_cents")

    reg_record = Registration.find(reg_json["id"])
    assert_equal "paid", reg_record.payment_status
    assert_equal "platform_test", reg_record.stripe_account_origin
  end

  test "Stripe webhook marks Registration paid on checkout.session.completed" do
    @payment_config.update!(payment_mode: "platform_collect", processor_provider: "stripe", test_mode: false)
    reg = Registration.create!(
      organization: @org,
      tournament: @tournament,
      team_name: "Webhook Team",
      payment_type: "stripe",
      payment_status: "unpaid",
      stripe_checkout_session_id: "cs_test_reg_webhook_123",
      team_members_attributes: [
        { name: "Hook Cap", email: "hook@example.test", phone: "+16715550222", position: 1, is_captain: true, waiver_accepted_at: Time.current }
      ]
    )

    event_payload = {
      id: "evt_reg_123",
      type: "checkout.session.completed",
      livemode: false,
      data: {
        object: {
          id: "cs_test_reg_webhook_123",
          payment_status: "paid",
          payment_intent: "pi_test_reg_123",
          amount_total: 15_000,
          metadata: {
            organization_id: @org.id.to_s,
            tournament_id: @tournament.id.to_s,
            registration_id: reg.id.to_s,
            item_type: "registration"
          }
        }
      }
    }.to_json

    prev_key = ENV["STRIPE_SECRET_KEY"]
    prev_wh = ENV["STRIPE_WEBHOOK_SECRET"]
    ENV["STRIPE_SECRET_KEY"] = "sk_test_dummy_for_webhook_routing"
    ENV["STRIPE_WEBHOOK_SECRET"] = ""

    post "/api/v1/webhooks/stripe",
         params: event_payload,
         headers: { "CONTENT_TYPE" => "application/json" }
    assert_response :ok

    reg.reload
    assert_equal "paid", reg.payment_status
    assert_equal "pi_test_reg_123", reg.stripe_payment_intent_id
    assert_equal 15_000, reg.payment_amount_cents
  ensure
    ENV["STRIPE_SECRET_KEY"] = prev_key
    ENV["STRIPE_WEBHOOK_SECRET"] = prev_wh
  end
end
