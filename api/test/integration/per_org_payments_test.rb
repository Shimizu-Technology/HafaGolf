# frozen_string_literal: true

require "test_helper"

class PerOrgPaymentsTest < ActionDispatch::IntegrationTest
  setup do
    @prev_platform_secret = ENV["PLATFORM_STRIPE_SECRET_KEY"]
    @prev_platform_pub = ENV["PLATFORM_STRIPE_PUBLISHABLE_KEY"]
    @prev_platform_wh = ENV["PLATFORM_STRIPE_WEBHOOK_SECRET"]
    @prev_app_env = ENV["APP_ENV"]

    ENV["PLATFORM_STRIPE_SECRET_KEY"] = "sk_live_platform_master_test"
    ENV["PLATFORM_STRIPE_PUBLISHABLE_KEY"] = "pk_live_platform_master_test"
    ENV["PLATFORM_STRIPE_WEBHOOK_SECRET"] = "whsec_platform_master_test"
    ENV["APP_ENV"] = nil

    @org_a = Organization.create!(name: "Island Charity Golf", slug: "island-pay-#{SecureRandom.hex(3)}")
    @org_b = Organization.create!(name: "Harbor Club Golf", slug: "harbor-pay-#{SecureRandom.hex(3)}")

    @tournament_a = @org_a.tournaments.create!(
      name: "Island Open 2027",
      slug: "island-open-2027-#{SecureRandom.hex(2)}",
      year: 2027,
      status: "open",
      registration_open: true,
      entry_fee: 15000
    )
    @tournament_b = @org_b.tournaments.create!(
      name: "Harbor Classic 2027",
      slug: "harbor-classic-2027-#{SecureRandom.hex(2)}",
      year: 2027,
      status: "open",
      registration_open: true,
      entry_fee: 20000
    )

    @super_admin = users(:super_admin)
    @admin_a = User.create!(
      email: "admin-pay-a-#{SecureRandom.hex(3)}@example.com",
      name: "Admin A",
      role: "org_admin",
      clerk_id: "clerk_pay_a_#{SecureRandom.hex(4)}"
    )
    @org_a.add_admin(@admin_a)

    @volunteer_a = User.create!(
      email: "vol-pay-a-#{SecureRandom.hex(3)}@example.com",
      name: "Volunteer A",
      role: "tournament_admin",
      clerk_id: "clerk_vol_pay_a_#{SecureRandom.hex(4)}"
    )
    @org_a.add_member(@volunteer_a, role: "volunteer")

    @golfer_a = @tournament_a.golfers.create!(
      name: "Golfer Alpha",
      email: "golfer-a-#{SecureRandom.hex(3)}@example.com",
      phone: "671-555-4001",
      team_category: "Co-Ed",
      payment_type: "stripe",
      payment_status: "unpaid",
      registration_status: "confirmed",
      waiver_accepted_at: Time.current
    )
    @golfer_a.generate_payment_token!

    @golfer_b = @tournament_b.golfers.create!(
      name: "Golfer Beta",
      email: "golfer-b-#{SecureRandom.hex(3)}@example.com",
      phone: "671-555-4002",
      team_category: "Co-Ed",
      payment_type: "stripe",
      payment_status: "unpaid",
      registration_status: "confirmed",
      waiver_accepted_at: Time.current
    )
    @golfer_b.generate_payment_token!
  end

  teardown do
    ENV["PLATFORM_STRIPE_SECRET_KEY"] = @prev_platform_secret
    ENV["PLATFORM_STRIPE_PUBLISHABLE_KEY"] = @prev_platform_pub
    ENV["PLATFORM_STRIPE_WEBHOOK_SECRET"] = @prev_platform_wh
    ENV["APP_ENV"] = @prev_app_env
  end

  test "legacy settings table is dropped and replaced by organization_payment_configs" do
    assert_not ActiveRecord::Base.connection.data_source_exists?("settings")
    assert ActiveRecord::Base.connection.data_source_exists?("organization_payment_configs")
  end

  test "client_processor encrypts secrets at rest, redacts API responses, and rejects platform key duplication" do
    authenticate_as(@admin_a)

    # Cannot copy platform secret key into a tenant row
    patch "/api/v1/admin/organizations/#{@org_a.slug}/payment_config",
          params: {
            payment_config: {
              payment_mode: "client_processor",
              processor_provider: "stripe",
              public_key: "pk_live_client_a_1234567890",
              secret_key: "sk_live_platform_master_test",
              webhook_secret: "whsec_client_a_secret"
            }
          },
          headers: auth_headers
    assert_response :unprocessable_entity

    # Valid client_processor config stores ciphertext and redacts secrets in JSON
    patch "/api/v1/admin/organizations/#{@org_a.slug}/payment_config",
          params: {
            payment_config: {
              payment_mode: "client_processor",
              processor_provider: "stripe",
              public_key: "pk_live_client_a_1234567890",
              secret_key: "sk_live_client_a_unique_secret",
              webhook_secret: "whsec_client_a_unique_secret"
            }
          },
          headers: auth_headers
    assert_response :success

    json = JSON.parse(response.body)
    cfg = json.fetch("payment_config")
    assert_equal "client_processor", cfg["payment_mode"]
    assert_equal true, cfg["has_secret_key"]
    assert_equal true, cfg["has_webhook_secret"]
    assert_equal "pk_live...7890", cfg["masked_public_key"]
    assert_includes cfg["webhook_url"], "/api/v1/webhooks/stripe/orgs/"
    assert_not_includes response.body, "sk_live_client_a_unique_secret"
    assert_not_includes response.body, "whsec_client_a_unique_secret"

    # Verify raw database ciphertext does not contain plaintext secret
    raw_row = ActiveRecord::Base.connection.select_one(
      "SELECT encrypted_secret_key, encrypted_webhook_secret FROM organization_payment_configs " \
      "WHERE organization_id = #{ActiveRecord::Base.connection.quote(@org_a.id)}"
    )
    assert_not_includes raw_row["encrypted_secret_key"].to_s, "sk_live_client_a_unique_secret"
    assert_not_includes raw_row["encrypted_webhook_secret"].to_s, "whsec_client_a_unique_secret"
  end

  test "org admin cannot modify platform fee terms or access another org config; volunteer is blocked" do
    authenticate_as(@admin_a)

    patch "/api/v1/admin/organizations/#{@org_a.slug}/payment_config",
          params: { payment_config: { platform_fee_per_registrant_cents: 0 } },
          headers: auth_headers
    assert_response :forbidden

    get "/api/v1/admin/organizations/#{@org_b.slug}/payment_config", headers: auth_headers
    assert_response :forbidden

    authenticate_as(@volunteer_a)
    get "/api/v1/admin/organizations/#{@org_a.slug}/payment_config", headers: auth_headers
    assert_response :forbidden

    authenticate_as(@super_admin)
    patch "/api/v1/admin/organizations/#{@org_a.slug}/payment_config",
          params: {
            payment_config: {
              payment_mode: "platform_collect",
              processor_provider: "stripe",
              platform_fee_flat_cents: 30000,
              platform_fee_per_registrant_cents: 300
            }
          },
          headers: auth_headers
    assert_response :success
    body = JSON.parse(response.body)
    assert_equal 30000, body.dig("payment_config", "platform_fee_flat_cents")
    assert_equal 300, body.dig("payment_config", "platform_fee_per_registrant_cents")
  end

  test "external_link and offline modes route checkout properly and reject Stripe checkout" do
    @org_a.create_organization_payment_config!(
      payment_mode: "external_link",
      processor_provider: "swipesimple",
      external_checkout_url: "https://swipesimple.com/links/org-a-regular",
      external_walkin_url: "https://swipesimple.com/links/org-a-walkin"
    )

    post "/api/v1/checkout", params: { payment_token: @golfer_a.payment_token }
    assert_response :unprocessable_entity

    post "/api/v1/checkout/swipe_simple", params: { payment_token: @golfer_a.payment_token }
    assert_response :success
    assert_equal "https://swipesimple.com/links/org-a-regular", JSON.parse(response.body)["redirect_url"]

    @org_b.create_organization_payment_config!(payment_mode: "offline", processor_provider: "none")
    post "/api/v1/checkout", params: { payment_token: @golfer_b.payment_token }
    assert_response :unprocessable_entity
  end

  test "platform_collect and client_processor pass per-request api_key without mutating global Stripe.api_key" do
    @org_a.create_organization_payment_config!(
      payment_mode: "platform_collect",
      processor_provider: "stripe",
      test_mode: false
    )
    @org_b.create_organization_payment_config!(
      payment_mode: "client_processor",
      processor_provider: "stripe",
      test_mode: false,
      encrypted_public_key: "pk_live_org_b_public",
      encrypted_secret_key: "sk_live_org_b_only",
      encrypted_webhook_secret: "whsec_org_b_only"
    )

    captured_calls = []
    previous_global_key = Stripe.api_key
    Stripe.api_key = "sk_global_sentinel"

    with_singleton_method(Stripe::Checkout::Session, :create, ->(params, opts = {}) {
      captured_calls << { params: params, opts: opts }
      sid = "cs_live_#{captured_calls.length}"
      Struct.new(:id, :url).new(sid, "https://checkout.stripe.com/pay/#{sid}")
    }) do
      post "/api/v1/checkout", params: { payment_token: @golfer_a.payment_token }
      assert_response :success

      post "/api/v1/checkout", params: { payment_token: @golfer_b.payment_token }
      assert_response :success
    end

    assert_equal "sk_global_sentinel", Stripe.api_key, "Global Stripe.api_key must never be mutated"
    assert_equal "sk_live_platform_master_test", captured_calls[0][:opts][:api_key]
    assert_equal @org_a.id.to_s, captured_calls[0][:params][:metadata][:organization_id]
    assert_equal "sk_live_org_b_only", captured_calls[1][:opts][:api_key]
    assert_equal @org_b.id.to_s, captured_calls[1][:params][:metadata][:organization_id]
  ensure
    Stripe.api_key = previous_global_key
  end

  test "client_processor signed webhook pays own org golfer, blocks cross-org golfer, and respects token rotation" do
    wh_secret = "whsec_client_b_signed_test"
    config_b = @org_b.create_organization_payment_config!(
      payment_mode: "client_processor",
      processor_provider: "stripe",
      test_mode: false,
      encrypted_public_key: "pk_live_org_b_pub",
      encrypted_secret_key: "sk_live_org_b_sec",
      encrypted_webhook_secret: wh_secret
    )
    old_token = config_b.webhook_endpoint_token
    assert old_token.present?

    # 1. Invalid signature rejected with 400
    bad_payload = { id: "evt_bad", type: "checkout.session.completed", data: { object: { id: "cs_x" } } }.to_json
    post "/api/v1/webhooks/stripe/orgs/#{old_token}",
         params: bad_payload,
         headers: { "CONTENT_TYPE" => "application/json", "HTTP_STRIPE_SIGNATURE" => "t=123,v1=bad" }
    assert_response :bad_request

    # 2. Validly signed Org B webhook trying to mark Org A golfer paid MUST NOT touch Org A golfer
    cross_org_payload = {
      id: "evt_cross_org",
      type: "checkout.session.completed",
      data: {
        object: {
          id: "cs_cross_org",
          payment_status: "paid",
          payment_intent: "pi_cross_org",
          metadata: { golfer_id: @golfer_a.id.to_s }
        }
      }
    }.to_json
    post "/api/v1/webhooks/stripe/orgs/#{old_token}",
         params: cross_org_payload,
         headers: signed_stripe_headers(cross_org_payload, wh_secret)
    assert_response :ok
    assert_equal "unpaid", @golfer_a.reload.payment_status

    # 3. Validly signed Org B webhook marks Org B golfer paid with client_processor origin tag
    own_payload = {
      id: "evt_own_org_b",
      type: "checkout.session.completed",
      data: {
        object: {
          id: "cs_own_org_b",
          payment_status: "paid",
          payment_intent: "pi_own_org_b",
          amount_total: 20000,
          metadata: { golfer_id: @golfer_b.id.to_s, organization_id: @org_b.id.to_s }
        }
      }
    }.to_json
    post "/api/v1/webhooks/stripe/orgs/#{old_token}",
         params: own_payload,
         headers: signed_stripe_headers(own_payload, wh_secret)
    assert_response :ok
    @golfer_b.reload
    assert_equal "paid", @golfer_b.payment_status
    assert_equal "client_processor:#{@org_b.id}", @golfer_b.stripe_account_origin

    # 4. Rotating webhook token invalidates old URL
    authenticate_as(@super_admin)
    post "/api/v1/admin/organizations/#{@org_b.slug}/payment_config/rotate_webhook_token", headers: auth_headers
    assert_response :success
    assert_not_equal old_token, config_b.reload.webhook_endpoint_token

    post "/api/v1/webhooks/stripe/orgs/#{old_token}",
         params: own_payload,
         headers: signed_stripe_headers(own_payload, wh_secret)
    assert_response :not_found
  end

  test "historical stripe_account_origin guard blocks cross-account automated refunds" do
    @org_a.create_organization_payment_config!(
      payment_mode: "platform_collect",
      processor_provider: "stripe",
      test_mode: false
    )

    @golfer_a.update!(
      payment_type: "stripe",
      payment_status: "paid",
      stripe_payment_intent_id: "pi_legacy_historical_1",
      stripe_account_origin: "legacy_imported_account"
    )

    stripe_called = false
    with_singleton_method(Stripe::Refund, :create, ->(*) { stripe_called = true; raise "Should not call Stripe" }) do
      err = assert_raises(RuntimeError) do
        @golfer_a.process_refund!(admin: @admin_a, reason: "Test cross-account block")
      end
      assert_match(/does not match this organization's active Stripe account/, err.message)
    end

    assert_not stripe_called
    assert_equal "paid", @golfer_a.reload.payment_status
  end

  test "checkout confirm blocks cross-tenant session forged from Org A client_processor targeting Org B tournament" do
    @org_a.create_organization_payment_config!(
      payment_mode: "client_processor",
      processor_provider: "stripe",
      test_mode: false,
      encrypted_public_key: "pk_test_attacker_a",
      encrypted_secret_key: "sk_test_attacker_a",
      encrypted_webhook_secret: "whsec_attacker_a"
    )

    forged_session = Struct.new(:id, :payment_status, :payment_intent, :amount_total, :metadata).new(
      "cs_forged_cross_org_1",
      "paid",
      "pi_forged_1",
      12_500,
      {
        organization_id: @org_b.id.to_s,
        tournament_id: @tournament_b.id.to_s,
        golfer_name: "Forged Intruder",
        golfer_email: "intruder@example.com",
        golfer_phone: "671-555-9999"
      }
    )

    before_count_b = @tournament_b.golfers.count

    captured_api_key = nil
    with_singleton_method(Stripe::Checkout::Session, :retrieve, ->(_sid, opts = {}) {
      captured_api_key = opts[:api_key]
      forged_session
    }) do
      post "/api/v1/checkout/confirm",
           params: { session_id: "cs_forged_cross_org_1", organization_slug: @org_a.slug },
           headers: { "X-Tenant-Host" => "unmapped-host.example.com" }
    end

    assert_equal "sk_test_attacker_a", captured_api_key
    assert_response :not_found
    assert_equal before_count_b, @tournament_b.golfers.reload.count, "Must NEVER create golfer in Org B from Org A session"
  end

  test "org without payment config defaults fail-closed to offline and org_admin cannot enable platform_collect or test_mode" do
    fresh_org = Organization.create!(
      name: "Default Offline Club",
      slug: "default-offline-#{SecureRandom.hex(3)}"
    )
    assert_equal "offline", fresh_org.effective_payment_config.payment_mode
    assert_equal "none", fresh_org.effective_payment_config.processor_provider

    authenticate_as(@admin_a)
    patch "/api/v1/admin/organizations/#{@org_a.slug}/payment_config",
          params: { payment_config: { payment_mode: "platform_collect" } },
          headers: auth_headers
    assert_response :forbidden

    patch "/api/v1/admin/organizations/#{@org_a.slug}/payment_config",
          params: { payment_config: { payment_mode: "offline", test_mode: true } },
          headers: auth_headers
    assert_response :forbidden
  end

  test "unpaid checkout.session.completed webhook does not mark golfer paid" do
    @org_a.create_organization_payment_config!(
      payment_mode: "platform_collect",
      processor_provider: "stripe",
      test_mode: false
    )
    @golfer_a.update!(stripe_checkout_session_id: "cs_unpaid_async_1")

    payload = {
      id: "evt_unpaid_async_1",
      type: "checkout.session.completed",
      livemode: true,
      data: {
        object: {
          id: "cs_unpaid_async_1",
          payment_status: "unpaid",
          payment_intent: "pi_async_pending",
          amount_total: 12_500,
          metadata: { organization_id: @org_a.id.to_s, golfer_id: @golfer_a.id.to_s }
        }
      }
    }.to_json

    post "/api/v1/webhooks/stripe",
         params: payload,
         headers: signed_stripe_headers(payload, ENV["PLATFORM_STRIPE_WEBHOOK_SECRET"])

    assert_response :ok
    assert_equal "unpaid", @golfer_a.reload.payment_status
  end

  test "client_processor per-org webhook marks registration, sponsor, and donation paid while rejecting wrong token/secret and platform endpoint" do
    client_whsec = "whsec_client_a_dedicated_secret"
    config_a = @org_a.create_organization_payment_config!(
      payment_mode: "client_processor",
      processor_provider: "stripe",
      encrypted_public_key: "pk_test_client_a_9999",
      encrypted_secret_key: "rk_test_client_a_restricted_9999",
      encrypted_webhook_secret: client_whsec
    )
    @org_b.create_organization_payment_config!(
      payment_mode: "platform_collect",
      processor_provider: "stripe"
    )

    @tournament_a.update!(team_size: 4, allow_partial_teams: true, capacity_unit: "players", entry_fee: 15_000)
    reg = @tournament_a.registrations.create!(
      organization: @org_a,
      team_name: "Client Webhook Team",
      contact_name: "Webhook Cap",
      contact_email: "whcap@example.com",
      payment_type: "stripe",
      payment_status: "unpaid",
      registration_status: "pending",
      stripe_checkout_session_id: "cs_client_reg_1",
      team_members_attributes: [
        { organization: @org_a, tournament: @tournament_a, position: 1, is_captain: true, name: "Webhook Cap" }
      ]
    )
    tier = @tournament_a.sponsor_tiers.create!(
      organization: @org_a,
      key: "gold",
      label: "Gold Sponsor",
      price_cents: 100_000,
      max_quantity: 2,
      included_player_slots: 2,
      online_checkout_enabled: true,
      sort_order: 1
    )
    sponsor = @tournament_a.sponsors.create!(
      sponsor_tier: tier,
      name: "Client Webhook Sponsor",
      login_email: "whsponsor@example.com",
      tier: "gold",
      payment_type: "stripe",
      payment_status: "pending",
      payment_amount_cents: 100_000,
      stripe_checkout_session_id: "cs_client_sponsor_1",
      active: false
    )
    donation = @tournament_a.donations.create!(
      organization: @org_a,
      donor_name: "Client Webhook Donor",
      donor_email: "whdonor@example.com",
      amount_cents: 5_000,
      payment_type: "stripe",
      payment_status: "pending",
      stripe_checkout_session_id: "cs_client_donation_1"
    )

    reg_payload = {
      id: "evt_client_reg_1",
      type: "checkout.session.completed",
      data: {
        object: {
          id: "cs_client_reg_1",
          payment_status: "paid",
          payment_intent: "pi_client_reg_1",
          amount_total: 15_000,
          metadata: { organization_id: @org_a.id.to_s, tournament_id: @tournament_a.id.to_s, registration_id: reg.id.to_s, item_type: "registration" }
        }
      }
    }.to_json

    # 1. Wrong org endpoint token returns 404
    post "/api/v1/webhooks/stripe/orgs/wrong_token_999",
         params: reg_payload,
         headers: signed_stripe_headers(reg_payload, client_whsec)
    assert_response :not_found
    assert_equal "unpaid", reg.reload.payment_status

    # 2. Wrong signing secret returns 400
    post "/api/v1/webhooks/stripe/orgs/#{config_a.webhook_endpoint_token}",
         params: reg_payload,
         headers: signed_stripe_headers(reg_payload, "whsec_wrong_secret")
    assert_response :bad_request
    assert_equal "unpaid", reg.reload.payment_status

    # 3. Platform webhook endpoint ignores client_processor org events
    post "/api/v1/webhooks/stripe",
         params: reg_payload,
         headers: signed_stripe_headers(reg_payload, ENV["PLATFORM_STRIPE_WEBHOOK_SECRET"])
    assert_response :ok
    assert_equal "unpaid", reg.reload.payment_status

    # 4. Signed per-org webhook marks registration, sponsor, and donation paid with client_processor origin
    post "/api/v1/webhooks/stripe/orgs/#{config_a.webhook_endpoint_token}",
         params: reg_payload,
         headers: signed_stripe_headers(reg_payload, client_whsec)
    assert_response :ok
    reg.reload
    assert_equal "paid", reg.payment_status
    assert_equal "confirmed", reg.registration_status
    assert_equal "client_processor:#{@org_a.id}", reg.stripe_account_origin

    sponsor_payload = {
      id: "evt_client_sponsor_1",
      type: "checkout.session.completed",
      data: {
        object: {
          id: "cs_client_sponsor_1",
          payment_status: "paid",
          payment_intent: "pi_client_sponsor_1",
          amount_total: 100_000,
          metadata: { organization_id: @org_a.id.to_s, tournament_id: @tournament_a.id.to_s, sponsor_id: sponsor.id.to_s, item_type: "sponsorship" }
        }
      }
    }.to_json
    post "/api/v1/webhooks/stripe/orgs/#{config_a.webhook_endpoint_token}",
         params: sponsor_payload,
         headers: signed_stripe_headers(sponsor_payload, client_whsec)
    assert_response :ok
    sponsor.reload
    assert_equal "paid", sponsor.payment_status
    assert sponsor.active?
    assert_equal "client_processor:#{@org_a.id}", sponsor.stripe_account_origin

    donation_payload = {
      id: "evt_client_donation_1",
      type: "checkout.session.completed",
      data: {
        object: {
          id: "cs_client_donation_1",
          payment_status: "paid",
          payment_intent: "pi_client_donation_1",
          amount_total: 5_000,
          metadata: { organization_id: @org_a.id.to_s, tournament_id: @tournament_a.id.to_s, donation_id: donation.id.to_s, item_type: "donation" }
        }
      }
    }.to_json
    post "/api/v1/webhooks/stripe/orgs/#{config_a.webhook_endpoint_token}",
         params: donation_payload,
         headers: signed_stripe_headers(donation_payload, client_whsec)
    assert_response :ok
    donation.reload
    assert_equal "paid", donation.payment_status
    assert_equal "client_processor:#{@org_a.id}", donation.stripe_account_origin

    # Org B (platform_collect) has zero leaked charges or settlement impact
    org_b_calc = Settlements::Calculator.call(@tournament_b)
    assert_equal 0, org_b_calc.gross_cents
  end

  private

  def signed_stripe_headers(payload, secret)
    timestamp = Time.current.to_i
    signature = Stripe::Webhook::Signature.compute_signature(Time.at(timestamp), payload, secret)
    {
      "CONTENT_TYPE" => "application/json",
      "HTTP_STRIPE_SIGNATURE" => "t=#{timestamp},v1=#{signature}"
    }
  end

  def with_singleton_method(klass, method_name, replacement)
    original = klass.method(method_name)
    klass.define_singleton_method(method_name, &replacement)
    yield
  ensure
    klass.define_singleton_method(method_name) do |*args, **kwargs, &block|
      original.call(*args, **kwargs, &block)
    end
  end
end
