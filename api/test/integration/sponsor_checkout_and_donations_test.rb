# frozen_string_literal: true

require "test_helper"

class SponsorCheckoutAndDonationsTest < ActionDispatch::IntegrationTest
  setup do
    @prev_platform_secret = ENV["PLATFORM_STRIPE_SECRET_KEY"]
    @prev_platform_pub = ENV["PLATFORM_STRIPE_PUBLISHABLE_KEY"]
    @prev_platform_wh = ENV["PLATFORM_STRIPE_WEBHOOK_SECRET"]
    @prev_app_env = ENV["APP_ENV"]

    ENV["PLATFORM_STRIPE_SECRET_KEY"] = "sk_live_platform_pr4c_test"
    ENV["PLATFORM_STRIPE_PUBLISHABLE_KEY"] = "pk_live_platform_pr4c_test"
    ENV["PLATFORM_STRIPE_WEBHOOK_SECRET"] = "whsec_platform_pr4c_test"
    ENV["APP_ENV"] = nil

    @org_a = Organization.create!(
      name: "Ocean Breeze Foundation",
      slug: "ocean-breeze-#{SecureRandom.hex(3)}",
      primary_color: "#1B3A4B",
      settings: {
        "features" => {
          "sponsors" => true,
          "sponsor_checkout" => true,
          "donations" => true
        }
      }
    )
    @org_a.organization_domains.create!(hostname: "ocean-#{@org_a.slug}.example.com", is_primary: true)
    @org_a.create_organization_payment_config!(
      payment_mode: "platform_collect",
      processor_provider: "stripe",
      test_mode: false,
      platform_fee_flat_cents: 0,
      platform_fee_per_registrant_cents: 0
    )

    @org_b = Organization.create!(
      name: "Sunset Club Charity",
      slug: "sunset-club-#{SecureRandom.hex(3)}",
      primary_color: "#0F766E",
      settings: {
        "features" => {
          "sponsors" => true,
          "sponsor_checkout" => true,
          "donations" => true
        }
      }
    )
    @org_b.organization_domains.create!(hostname: "sunset-#{@org_b.slug}.example.com", is_primary: true)
    @org_b_wh_secret = "whsec_org_b_pr4c_test"
    @org_b_config = @org_b.create_organization_payment_config!(
      payment_mode: "client_processor",
      processor_provider: "stripe",
      test_mode: false,
      encrypted_public_key: "pk_live_org_b_pr4c",
      encrypted_secret_key: "sk_live_org_b_pr4c",
      encrypted_webhook_secret: @org_b_wh_secret
    )

    @tournament_a = @org_a.tournaments.create!(
      name: "Ocean Breeze Classic 2027",
      slug: "ocean-classic-#{SecureRandom.hex(2)}",
      year: 2027,
      status: "open",
      registration_open: true,
      public_listed: true,
      entry_fee: 15_000,
      max_capacity: 144
    )
    @tournament_b = @org_b.tournaments.create!(
      name: "Sunset Invitational 2027",
      slug: "sunset-inv-#{SecureRandom.hex(2)}",
      year: 2027,
      status: "open",
      registration_open: true,
      public_listed: true,
      entry_fee: 12_500,
      max_capacity: 144
    )

    @admin_a = User.create!(
      email: "admin-a-4c-#{SecureRandom.hex(3)}@example.com",
      name: "Org A Admin",
      role: "org_admin",
      clerk_id: "clerk_admin_a_4c_#{SecureRandom.hex(4)}"
    )
    @org_a.add_admin(@admin_a)

    @volunteer_a = User.create!(
      email: "vol-a-4c-#{SecureRandom.hex(3)}@example.com",
      name: "Org A Volunteer",
      role: "tournament_admin",
      clerk_id: "clerk_vol_a_4c_#{SecureRandom.hex(4)}"
    )
    @org_a.add_member(@volunteer_a, role: "volunteer")

    @admin_b = User.create!(
      email: "admin-b-4c-#{SecureRandom.hex(3)}@example.com",
      name: "Org B Admin",
      role: "org_admin",
      clerk_id: "clerk_admin_b_4c_#{SecureRandom.hex(4)}"
    )
    @org_b.add_admin(@admin_b)
  end

  teardown do
    ENV["PLATFORM_STRIPE_SECRET_KEY"] = @prev_platform_secret
    ENV["PLATFORM_STRIPE_PUBLISHABLE_KEY"] = @prev_platform_pub
    ENV["PLATFORM_STRIPE_WEBHOOK_SECRET"] = @prev_platform_wh
    ENV["APP_ENV"] = @prev_app_env
  end

  test "feature flags gate sponsor_checkout and donations endpoints with 403 when disabled" do
    @org_a.update!(settings: { "features" => { "sponsors" => true, "sponsor_checkout" => false, "donations" => false } })

    tier = @tournament_a.sponsor_tiers.create!(
      organization: @org_a,
      key: "gold",
      label: "Gold Sponsor",
      price_cents: 150_000,
      included_player_slots: 4
    )

    get "/api/v1/tournaments/#{@tournament_a.id}/sponsor_tiers"
    assert_response :forbidden
    assert_equal "sponsor_checkout", JSON.parse(response.body)["feature"]

    post "/api/v1/tournaments/#{@tournament_a.id}/sponsor_tiers/#{tier.id}/checkout",
         params: { name: "Blocked Co", email: "blocked@example.com" }
    assert_response :forbidden
    assert_equal "sponsor_checkout", JSON.parse(response.body)["feature"]

    get "/api/v1/tournaments/#{@tournament_a.id}/donations/summary"
    assert_response :forbidden
    assert_equal "donations", JSON.parse(response.body)["feature"]

    post "/api/v1/tournaments/#{@tournament_a.id}/donations/checkout",
         params: { donor_name: "Blocked Donor", amount_cents: 5000 }
    assert_response :forbidden
    assert_equal "donations", JSON.parse(response.body)["feature"]

    get "/api/v1/tournaments/#{@tournament_a.id}/donations", headers: auth_headers_for(@admin_a)
    assert_response :forbidden
    assert_equal "donations", JSON.parse(response.body)["feature"]
  end

  test "sponsor tier admin CRUD enforces require_org_admin and rejects volunteers and cross-org admins" do
    post "/api/v1/tournaments/#{@tournament_a.id}/sponsor_tiers",
         params: { sponsor_tier: { key: "platinum", label: "Platinum Sponsor", price_cents: 250_000, included_player_slots: 4 } },
         headers: auth_headers_for(@volunteer_a)
    assert_response :forbidden

    post "/api/v1/tournaments/#{@tournament_a.id}/sponsor_tiers",
         params: { sponsor_tier: { key: "platinum", label: "Platinum Sponsor", price_cents: 250_000, included_player_slots: 4 } },
         headers: auth_headers_for(@admin_b)
    assert_response :forbidden

    post "/api/v1/tournaments/#{@tournament_a.id}/sponsor_tiers",
         params: {
           sponsor_tier: {
             key: "platinum",
             label: "Platinum Sponsor",
             description: "Premier event banner & foursome",
             price_cents: 250_000,
             included_player_slots: 4,
             max_quantity: 2,
             benefits: ["Banner at clubhouse", "4 player entries"],
             online_checkout_enabled: true,
             sort_order: 1
           }
         },
         headers: auth_headers_for(@admin_a)
    assert_response :created
    tier_id = JSON.parse(response.body).dig("sponsor_tier", "id")

    patch "/api/v1/tournaments/#{@tournament_a.id}/sponsor_tiers/#{tier_id}",
          params: { sponsor_tier: { label: "Premier Platinum", max_quantity: 3 } },
          headers: auth_headers_for(@admin_a)
    assert_response :success
    assert_equal "Premier Platinum", JSON.parse(response.body).dig("sponsor_tier", "label")
    assert_equal 3, JSON.parse(response.body).dig("sponsor_tier", "remaining_quantity")

    delete "/api/v1/tournaments/#{@tournament_a.id}/sponsor_tiers/#{tier_id}",
           headers: auth_headers_for(@admin_a)
    assert_response :success
  end

  test "sponsor tier checkout enforces max_quantity, calls per-request Stripe api_key, webhook provisions slots idempotently and feeds Settlements::Calculator" do
    tier = @tournament_a.sponsor_tiers.create!(
      organization: @org_a,
      key: "title_cup",
      label: "Title Cup Sponsor",
      description: "Headline sponsor with 4 player slots",
      price_cents: 250_000,
      included_player_slots: 4,
      max_quantity: 1,
      benefits: ["Logo on all scorecards", "One foursome included"],
      online_checkout_enabled: true,
      sort_order: 0
    )

    captured_calls = []
    previous_global_key = Stripe.api_key
    Stripe.api_key = "sk_global_sentinel_pr4c"

    with_singleton_method(Stripe::Checkout::Session, :create, ->(params, opts = {}) {
      captured_calls << { params: params, opts: opts }
      Struct.new(:id, :url).new("cs_sponsor_test_1", "https://checkout.stripe.com/pay/cs_sponsor_test_1")
    }) do
      post "/api/v1/tournaments/#{@tournament_a.id}/sponsor_tiers/#{tier.id}/checkout",
           params: {
             name: "Island Marine Supply",
             email: "sponsor@islandmarine.example.com",
             website_url: "https://islandmarine.example.com"
           }
      assert_response :created
    end

    assert_equal "sk_global_sentinel_pr4c", Stripe.api_key
    assert_equal "sk_live_platform_pr4c_test", captured_calls.first[:opts][:api_key]
    assert_equal "sponsorship", captured_calls.first[:params][:metadata][:item_type]
    assert_equal @org_a.id.to_s, captured_calls.first[:params][:metadata][:organization_id]

    checkout_body = JSON.parse(response.body)
    sponsor_id = checkout_body.dig("sponsor", "id")
    sponsor = Sponsor.find(sponsor_id)
    assert_equal "pending", sponsor.payment_status
    assert_equal false, sponsor.active
    assert_equal 4, sponsor.slot_count
    assert_equal 0, sponsor.sponsor_slots.count, "Slots must not be provisioned until payment is confirmed"

    # Second checkout for the same tier must fail because max_quantity == 1 is claimed
    post "/api/v1/tournaments/#{@tournament_a.id}/sponsor_tiers/#{tier.id}/checkout",
         params: { name: "Second Buyer", email: "second@example.com" }
    assert_response :unprocessable_entity
    assert_includes response.body, "sold out"

    # Signed Stripe webhook marks sponsor paid, activates it, auto-provisions 4 slots, and creates portal token
    payload = {
      id: "evt_sponsor_paid_1",
      type: "checkout.session.completed",
      data: {
        object: {
          id: "cs_sponsor_test_1",
          payment_status: "paid",
          payment_intent: "pi_sponsor_test_1",
          amount_total: 250_000,
          metadata: {
            organization_id: @org_a.id.to_s,
            tournament_id: @tournament_a.id.to_s,
            sponsor_id: sponsor.id.to_s,
            item_type: "sponsorship"
          }
        }
      }
    }.to_json

    post "/api/v1/webhooks/stripe",
         params: payload,
         headers: signed_stripe_headers(payload, ENV["PLATFORM_STRIPE_WEBHOOK_SECRET"])
    assert_response :ok

    sponsor.reload
    assert_equal "paid", sponsor.payment_status
    assert_equal true, sponsor.active
    assert_equal "platform_live", sponsor.stripe_account_origin
    assert_equal "pi_sponsor_test_1", sponsor.stripe_payment_intent_id
    assert_not_nil sponsor.paid_at
    assert_equal [1, 2, 3, 4], sponsor.sponsor_slots.order(:slot_number).pluck(:slot_number)
    assert sponsor.access_token_valid?, "Portal access token must be generated on paid webhook"
    first_token = sponsor.access_token

    # Duplicate webhook delivery MUST be idempotent (no duplicate slots, token unchanged)
    post "/api/v1/webhooks/stripe",
         params: payload,
         headers: signed_stripe_headers(payload, ENV["PLATFORM_STRIPE_WEBHOOK_SECRET"])
    assert_response :ok
    sponsor.reload
    assert_equal 4, sponsor.sponsor_slots.count
    assert_equal first_token, sponsor.access_token

    # Settlements::Calculator automatically includes paid platform sponsorship
    settlement = Settlements::Calculator.call(@tournament_a)
    assert_equal 250_000, settlement.gross_cents
    assert_equal 1, settlement.breakdown_json.dig("sponsorships", "charge_count")
    assert_equal 250_000, settlement.breakdown_json.dig("sponsorships", "gross_cents")
    assert settlement.line_items.any? { |item| item[:source_type] == "sponsorship" && item[:source_id] == sponsor.id }
  ensure
    Stripe.api_key = previous_global_key
  end

  test "sponsor tier checkout supports external_link fallback cleanly when org uses external_link mode" do
    @org_a.organization_payment_config.update!(
      payment_mode: "external_link",
      processor_provider: "swipesimple",
      external_checkout_url: "https://payments.example.com/sponsor-checkout"
    )
    tier = @tournament_a.sponsor_tiers.create!(
      organization: @org_a,
      key: "hole",
      label: "Hole Sponsor",
      price_cents: 50_000,
      included_player_slots: 0,
      online_checkout_enabled: true
    )

    post "/api/v1/tournaments/#{@tournament_a.id}/sponsor_tiers/#{tier.id}/checkout",
         params: { name: "Bayview Hardware", email: "bayview@example.com" }
    assert_response :created
    body = JSON.parse(response.body)
    assert_equal true, body["external_link"]
    assert_equal "https://payments.example.com/sponsor-checkout", body["checkout_url"]
    assert_equal "external_link", body.dig("sponsor", "payment_type")
  end

  test "donation checkout, signed webhook, anonymous donor wall, offline admin donation, and Settlements::Calculator integration" do
    # Reject amount < 100 cents
    post "/api/v1/tournaments/#{@tournament_a.id}/donations/checkout",
         params: { donor_name: "Small Gift", amount_cents: 50 }
    assert_response :unprocessable_entity

    captured = nil
    with_singleton_method(Stripe::Checkout::Session, :create, ->(params, opts = {}) {
      captured = { params: params, opts: opts }
      Struct.new(:id, :url).new("cs_donation_test_1", "https://checkout.stripe.com/pay/cs_donation_test_1")
    }) do
      post "/api/v1/tournaments/#{@tournament_a.id}/donations/checkout",
           params: {
             donor_name: "Secret Benefactor",
             donor_email: "secret@example.com",
             amount_cents: 10_000,
             anonymous: true,
             message: "Go team!"
           }
      assert_response :created
    end

    assert_equal "donation", captured[:params][:metadata][:item_type]
    donation_id = captured[:params][:metadata][:donation_id].to_i
    donation = Donation.find(donation_id)
    assert_equal "pending", donation.payment_status

    # Public summary does not include unpaid donation
    get "/api/v1/tournaments/#{@tournament_a.id}/donations/summary"
    assert_response :success
    assert_equal 0, JSON.parse(response.body)["total_raised_cents"]

    # Signed platform webhook marks donation paid
    payload = {
      id: "evt_donation_paid_1",
      type: "checkout.session.completed",
      data: {
        object: {
          id: "cs_donation_test_1",
          payment_status: "paid",
          payment_intent: "pi_donation_test_1",
          amount_total: 10_000,
          metadata: {
            organization_id: @org_a.id.to_s,
            tournament_id: @tournament_a.id.to_s,
            donation_id: donation.id.to_s,
            item_type: "donation"
          }
        }
      }
    }.to_json

    post "/api/v1/webhooks/stripe",
         params: payload,
         headers: signed_stripe_headers(payload, ENV["PLATFORM_STRIPE_WEBHOOK_SECRET"])
    assert_response :ok

    donation.reload
    assert_equal "paid", donation.payment_status
    assert_equal "platform_live", donation.stripe_account_origin
    assert_not_nil donation.paid_at

    # Admin records an offline check donation ($250) — included in donor wall, NOT in Shimizu platform payout gross
    post "/api/v1/tournaments/#{@tournament_a.id}/donations",
         params: {
           donation: {
             donor_name: "Maria Cruz",
             donor_email: "maria@example.com",
             amount_cents: 25_000,
             payment_type: "check",
             payment_method: "check",
             anonymous: false,
             message: "Happy to support!"
           }
         },
         headers: auth_headers_for(@admin_a)
    assert_response :created

    # Public summary respects anonymous: true and never leaks donor_email
    get "/api/v1/tournaments/#{@tournament_a.id}/donations/summary"
    assert_response :success
    summary = JSON.parse(response.body)
    assert_equal 35_000, summary["total_raised_cents"]
    assert_equal 2, summary["donor_count"]

    anon_entry = summary["recent_donations"].find { |d| d["id"] == donation.id }
    assert_equal "Anonymous", anon_entry["display_name"]
    assert_equal "Go team!", anon_entry["message"]
    assert_not_includes response.body, "Secret Benefactor"
    assert_not_includes response.body, "secret@example.com"

    named_entry = summary["recent_donations"].find { |d| d["display_name"] == "Maria Cruz" }
    assert_not_nil named_entry

    # Admin list sees real donor names and totals
    get "/api/v1/tournaments/#{@tournament_a.id}/donations", headers: auth_headers_for(@admin_a)
    assert_response :success
    admin_body = JSON.parse(response.body)
    assert_equal 35_000, admin_body.dig("totals", "total_raised_cents")
    assert_equal 10_000, admin_body.dig("totals", "stripe_cents")
    assert_equal 25_000, admin_body.dig("totals", "offline_cents")
    assert admin_body["donations"].any? { |d| d["donor_name"] == "Secret Benefactor" }

    # Admin offline donation creation rejects payment_type: "stripe" with 422
    post "/api/v1/tournaments/#{@tournament_a.id}/donations",
         params: {
           donation: {
             donor_name: "Spoofed Stripe Donor",
             amount_cents: 50_000,
             payment_type: "stripe",
             payment_method: "stripe"
           }
         },
         headers: auth_headers_for(@admin_a)
    assert_response :unprocessable_entity

    # Manual sponsor or donation marked payment_method="stripe" WITHOUT stripe_payment_intent_id / platform_* origin
    # MUST NOT be counted as platform-collected in Settlements::Calculator
    @tournament_a.sponsors.create!(
      name: "Unverified Stripe Sponsor",
      tier: "gold",
      payment_type: "stripe",
      payment_method: "stripe",
      payment_status: "paid",
      payment_amount_cents: 50_000,
      active: true
    )
    @tournament_a.donations.create!(
      organization: @org_a,
      donor_name: "Unverified Stripe Donation",
      amount_cents: 15_000,
      payment_type: "stripe",
      payment_method: "stripe",
      payment_status: "paid"
    )

    # Settlements::Calculator includes platform Stripe donation ($100) and reports check ($250) + unverified ($150) under direct_collected
    settlement = Settlements::Calculator.call(@tournament_a)
    assert_equal 10_000, settlement.gross_cents
    assert_equal 1, settlement.breakdown_json.dig("donations", "charge_count")
    assert_equal 10_000, settlement.breakdown_json.dig("donations", "gross_cents")
    assert_equal 0, settlement.breakdown_json.dig("sponsorships", "gross_cents")
    assert_equal 50_000, settlement.breakdown_json.dig("direct_collected", "sponsorships", "gross_cents")
    assert_equal 40_000, settlement.breakdown_json.dig("direct_collected", "donations", "gross_cents")
    assert settlement.line_items.any? { |item| item[:source_type] == "donation" && item[:source_id] == donation.id }
  end

  test "cross-org client_processor webhook cannot mark another organization's sponsor or donation paid" do
    tier_a = @tournament_a.sponsor_tiers.create!(
      organization: @org_a,
      key: "silver",
      label: "Silver Sponsor",
      price_cents: 100_000,
      included_player_slots: 2
    )
    sponsor_a = @tournament_a.sponsors.create!(
      sponsor_tier: tier_a,
      tier: tier_a.key,
      name: "Org A Pending Sponsor",
      login_email: "orga@example.com",
      slot_count: 2,
      payment_type: "stripe",
      payment_status: "pending",
      payment_amount_cents: 100_000,
      stripe_checkout_session_id: "cs_orga_sponsor_1",
      active: false
    )
    donation_a = @tournament_a.donations.create!(
      organization: @org_a,
      donor_name: "Org A Pending Donor",
      amount_cents: 5000,
      payment_type: "stripe",
      payment_status: "pending",
      stripe_checkout_session_id: "cs_orga_donation_1"
    )

    cross_sponsor_payload = {
      id: "evt_cross_sponsor",
      type: "checkout.session.completed",
      data: {
        object: {
          id: "cs_orga_sponsor_1",
          payment_status: "paid",
          payment_intent: "pi_cross_1",
          metadata: { sponsor_id: sponsor_a.id.to_s, item_type: "sponsorship" }
        }
      }
    }.to_json

    post "/api/v1/webhooks/stripe/orgs/#{@org_b_config.webhook_endpoint_token}",
         params: cross_sponsor_payload,
         headers: signed_stripe_headers(cross_sponsor_payload, @org_b_wh_secret)
    assert_response :ok
    assert_equal "pending", sponsor_a.reload.payment_status
    assert_equal 0, sponsor_a.sponsor_slots.count

    cross_donation_payload = {
      id: "evt_cross_donation",
      type: "checkout.session.completed",
      data: {
        object: {
          id: "cs_orga_donation_1",
          payment_status: "paid",
          payment_intent: "pi_cross_2",
          metadata: { donation_id: donation_a.id.to_s, item_type: "donation" }
        }
      }
    }.to_json

    post "/api/v1/webhooks/stripe/orgs/#{@org_b_config.webhook_endpoint_token}",
         params: cross_donation_payload,
         headers: signed_stripe_headers(cross_donation_payload, @org_b_wh_secret)
    assert_response :ok
    assert_equal "pending", donation_a.reload.payment_status
  end

  test "TaxReceiptCalculator stays off by default and computes exact IRS >$75 FMV and deductible excess when enabled" do
    # Default must be false
    assert_equal false, @tournament_a.tax_receipt_enabled?

    off_result = TaxReceiptCalculator.for_sponsorship(
      tournament: @tournament_a,
      amount_cents: 250_000,
      included_player_slots: 4
    )
    assert_equal false, off_result.enabled?
    assert_equal false, off_result.applicable?
    assert_nil off_result.receipt_copy

    off_donation = TaxReceiptCalculator.for_donation(tournament: @tournament_a, amount_cents: 10_000)
    assert_equal false, off_donation.applicable?
    assert_nil off_donation.receipt_copy

    # Enable tax receipts with $100/player FMV
    @tournament_a.update!(
      tax_receipt_enabled: true,
      tax_org_name: "Ocean Breeze Charitable Association",
      tax_org_ein: "66-0123456",
      fmv_per_player_cents: 10_000,
      tax_receipt_disclaimer: "Consult your tax advisor for deductibility."
    )

    # Sponsorship $2,500 with 4 player slots -> FMV $400, deductible $2,100
    sponsor_receipt = TaxReceiptCalculator.for_sponsorship(
      tournament: @tournament_a,
      amount_cents: 250_000,
      included_player_slots: 4
    )
    assert_equal true, sponsor_receipt.applicable?
    assert_equal 40_000, sponsor_receipt.fmv_cents
    assert_equal 210_000, sponsor_receipt.deductible_cents
    assert_includes sponsor_receipt.receipt_copy, "Ocean Breeze Charitable Association"
    assert_includes sponsor_receipt.receipt_copy, "66-0123456"
    assert_includes sponsor_receipt.receipt_copy, "$400.00"
    assert_includes sponsor_receipt.receipt_copy, "$2100.00"
    assert_includes sponsor_receipt.receipt_copy, "Consult your tax advisor"

    # Payment at or under $75 threshold ($75.00 = 7500 cents) -> quid-pro-quo not applicable
    under_threshold = TaxReceiptCalculator.for_registration(
      tournament: @tournament_a,
      amount_cents: 7_500,
      player_count: 1
    )
    assert_equal false, under_threshold.applicable?
    assert_nil under_threshold.receipt_copy

    # FMV greater than payment clamps deductible_cents to 0
    clamped = TaxReceiptCalculator.for_registration(
      tournament: @tournament_a,
      amount_cents: 8_000,
      player_count: 1
    )
    assert_equal true, clamped.applicable?
    assert_equal 10_000, clamped.fmv_cents
    assert_equal 0, clamped.deductible_cents

    # Pure charitable donation: FMV is 0, full amount deductible
    donation_receipt = TaxReceiptCalculator.for_donation(tournament: @tournament_a, amount_cents: 5_000)
    assert_equal true, donation_receipt.applicable?
    assert_equal 0, donation_receipt.fmv_cents
    assert_equal 5_000, donation_receipt.deductible_cents
    assert_includes donation_receipt.receipt_copy, "No goods or services were provided"
    assert_includes donation_receipt.receipt_copy, "$50.00"
  end

  private

  def auth_headers_for(user)
    { "Authorization" => "Bearer test_token_#{user.id}" }
  end

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
