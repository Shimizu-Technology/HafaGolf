# frozen_string_literal: true

require "test_helper"

class SettlementsAndPayoutsTest < ActionDispatch::IntegrationTest
  setup do
    @org_a = Organization.create!(
      name: "Pacific Island Club",
      slug: "pacific-club-#{SecureRandom.hex(3)}",
      primary_color: "#1B3A4B",
      subscription_status: "active"
    )
    @org_b = Organization.create!(
      name: "Coral Reef Charity",
      slug: "coral-reef-#{SecureRandom.hex(3)}",
      primary_color: "#0F766E",
      subscription_status: "active"
    )

    @org_a.create_organization_payment_config!(
      payment_mode: "platform_collect",
      processor_provider: "stripe",
      platform_fee_flat_cents: 30_000,          # $300.00
      platform_fee_per_registrant_cents: 300,   # $3.00 per registrant
      platform_fee_cap_cents: 50_000,           # $500.00 cap
      payout_payee_name: "Pacific Island Club Class Fund",
      payout_bank_name: "Bank of Guam",
      payout_notes: "Memo: Annual Golf Fundraiser"
    )
    @org_b.create_organization_payment_config!(
      payment_mode: "client_processor",
      processor_provider: "stripe",
      encrypted_public_key: "pk_live_coral",
      encrypted_secret_key: "sk_live_coral",
      encrypted_webhook_secret: "whsec_coral"
    )

    @tournament_a = Tournament.create!(
      organization: @org_a,
      name: "Pacific Invitational 2027",
      slug: "pacific-invitational-#{SecureRandom.hex(3)}",
      year: 2027,
      status: "open",
      registration_open: true,
      entry_fee: 15_000,
      max_capacity: 144
    )
    @tournament_b = Tournament.create!(
      organization: @org_b,
      name: "Coral Charity Open 2027",
      slug: "coral-open-#{SecureRandom.hex(3)}",
      year: 2027,
      status: "open",
      registration_open: true,
      entry_fee: 12_500,
      max_capacity: 144
    )

    @super_admin = User.create!(
      email: "super-settle-#{SecureRandom.hex(3)}@example.com",
      name: "Platform Super Admin",
      role: "super_admin",
      clerk_id: "clerk_super_#{SecureRandom.hex(4)}"
    )
    @org_a_admin = User.create!(
      email: "admin-a-settle-#{SecureRandom.hex(3)}@example.com",
      name: "Org A Admin",
      role: "org_admin",
      clerk_id: "clerk_admin_a_#{SecureRandom.hex(4)}"
    )
    OrganizationMembership.create!(user: @org_a_admin, organization: @org_a, role: "admin")

    @org_a_volunteer = User.create!(
      email: "vol-a-settle-#{SecureRandom.hex(3)}@example.com",
      name: "Org A Volunteer",
      role: "tournament_admin",
      clerk_id: "clerk_vol_a_#{SecureRandom.hex(4)}"
    )
    OrganizationMembership.create!(user: @org_a_volunteer, organization: @org_a, role: "volunteer")

    @org_b_admin = User.create!(
      email: "admin-b-settle-#{SecureRandom.hex(3)}@example.com",
      name: "Org B Admin",
      role: "org_admin",
      clerk_id: "clerk_admin_b_#{SecureRandom.hex(4)}"
    )
    OrganizationMembership.create!(user: @org_b_admin, organization: @org_b, role: "admin")
  end

  test "calculator reconciles platform charges, refunds, actual/estimated fees, and platform fee to the cent" do
    # 1. Paid via platform_collect with ACTUAL Stripe fee recorded ($4.65 = 465c)
    Golfer.create!(
      tournament: @tournament_a,
      name: "Alice Golfer",
      email: "alice@example.com",
      phone: "671-555-0101",
      team_category: "Co-Ed",
      payment_type: "stripe",
      payment_status: "paid",
      payment_method: "stripe",
      payment_amount_cents: 15_000,
      stripe_fee_cents: 465,
      stripe_account_origin: "platform_live",
      registration_status: "confirmed",
      waiver_accepted_at: Time.current,
      paid_at: Time.current
    )

    # 2. Paid via platform_collect with ESTIMATED Stripe fee (2.9% of 20000 = 580 + 30 = 610c)
    Golfer.create!(
      tournament: @tournament_a,
      name: "Bob Golfer",
      email: "bob@example.com",
      phone: "671-555-0102",
      team_category: "Co-Ed",
      payment_type: "stripe",
      payment_status: "paid",
      payment_method: "stripe",
      payment_amount_cents: 20_000,
      stripe_account_origin: "platform_live",
      registration_status: "confirmed",
      waiver_accepted_at: Time.current,
      paid_at: Time.current
    )

    # 3. Paid via platform_collect ($150) then refunded $150 (fee estimated: 2.9% of 15000 = 435 + 30 = 465c)
    # Not counted as billable registrant because fully refunded
    Golfer.create!(
      tournament: @tournament_a,
      name: "Charlie Refunded",
      email: "charlie@example.com",
      phone: "671-555-0103",
      team_category: "Co-Ed",
      payment_type: "stripe",
      payment_status: "refunded",
      payment_method: "stripe",
      payment_amount_cents: 15_000,
      refund_amount_cents: 15_000,
      stripe_account_origin: "platform_live",
      registration_status: "cancelled",
      waiver_accepted_at: Time.current,
      paid_at: 2.days.ago,
      refunded_at: 1.day.ago
    )

    # 4. Cash payment collected directly by org — MUST NOT be included in Shimizu payout gross!
    Golfer.create!(
      tournament: @tournament_a,
      name: "Dana Cash",
      email: "dana@example.com",
      phone: "671-555-0104",
      team_category: "Co-Ed",
      payment_type: "pay_on_day",
      payment_status: "paid",
      payment_method: "cash",
      payment_amount_cents: 15_000,
      registration_status: "confirmed",
      waiver_accepted_at: Time.current,
      paid_at: Time.current
    )

    result = Settlements::Calculator.call(@tournament_a)

    # Gross = 15000 + 20000 + 15000 = 50000
    assert_equal 50_000, result.gross_cents
    # Refunds = 15000
    assert_equal 15_000, result.refund_cents
    # Net = 50000 - 15000 = 35000
    assert_equal 35_000, result.net_cents
    # Processing fees = 465 (actual) + 610 (est) + 465 (est) = 1540
    assert_equal 1_540, result.processing_fee_cents
    # Platform fee = flat 30000 + (300 * 2 billable registrants) = 30600 (under 50000 cap)
    assert_equal 30_600, result.platform_fee_cents
    # Organizer proceeds = 35000 - 1540 - 30600 = 2860
    assert_equal 2_860, result.organizer_proceeds_cents

    assert_equal 1, result.breakdown_json.dig("processing_fees", "actual_fee_count")
    assert_equal 2, result.breakdown_json.dig("processing_fees", "estimated_fee_count")
    assert_equal 15_000, result.breakdown_json.dig("direct_collected", "registrations", "gross_cents")
    assert_equal 1, result.breakdown_json.dig("direct_collected", "registrations", "count")
  end

  test "RBAC enforces super_admin writes, org_admin read-only, volunteer 403, and cross-org 403" do
    # Volunteer cannot view settlement
    get "/api/v1/tournaments/#{@tournament_a.id}/settlement", headers: auth_headers_for(@org_a_volunteer)
    assert_response :forbidden

    # Cross-org admin (Org B) cannot view Org A settlement
    get "/api/v1/tournaments/#{@tournament_a.id}/settlement", headers: auth_headers_for(@org_b_admin)
    assert_response :forbidden

    # Org A admin CAN view settlement and export CSV
    get "/api/v1/tournaments/#{@tournament_a.id}/settlement", headers: auth_headers_for(@org_a_admin)
    assert_response :success
    body = JSON.parse(response.body)
    assert_equal false, body["can_manage_payouts"]
    assert_equal "Pacific Island Club Class Fund", body.dig("payee_defaults", "payee_name")

    get "/api/v1/tournaments/#{@tournament_a.id}/settlement/export", headers: auth_headers_for(@org_a_admin)
    assert_response :success
    assert_includes response.content_type, "text/csv"

    # Org A admin CANNOT calculate, finalize, or record payouts
    post "/api/v1/tournaments/#{@tournament_a.id}/settlement/calculate", headers: auth_headers_for(@org_a_admin)
    assert_response :forbidden

    post "/api/v1/tournaments/#{@tournament_a.id}/settlement/finalize", headers: auth_headers_for(@org_a_admin)
    assert_response :forbidden

    post "/api/v1/tournaments/#{@tournament_a.id}/settlement/payouts",
         params: { amount_cents: 1000, provider: "check" },
         headers: auth_headers_for(@org_a_admin)
    assert_response :forbidden
  end

  test "end-to-end settlement lifecycle: calculate, finalize immutability, check payout, idempotency, over-payout guard, void, and v2 recalculation" do
    # Seed $0 platform fee (in-kind style) + two $500 charges = $1,000 gross
    @org_a.organization_payment_config.update!(
      platform_fee_flat_cents: 0,
      platform_fee_per_registrant_cents: 0,
      platform_fee_cap_cents: nil
    )

    g1 = Golfer.create!(
      tournament: @tournament_a,
      name: "=EVIL() Foursome",
      email: "foursome1@example.com",
      phone: "671-555-0201",
      team_category: "Co-Ed",
      payment_type: "stripe",
      payment_status: "paid",
      payment_method: "stripe",
      payment_amount_cents: 50_000,
      stripe_fee_cents: 1_500,
      stripe_account_origin: "platform_live",
      registration_status: "confirmed",
      waiver_accepted_at: Time.current,
      paid_at: Time.current
    )
    Golfer.create!(
      tournament: @tournament_a,
      name: "Second Foursome",
      email: "foursome2@example.com",
      phone: "671-555-0202",
      team_category: "Co-Ed",
      payment_type: "stripe",
      payment_status: "paid",
      payment_method: "stripe",
      payment_amount_cents: 50_000,
      stripe_fee_cents: 1_500,
      stripe_account_origin: "platform_live",
      registration_status: "confirmed",
      waiver_accepted_at: Time.current,
      paid_at: Time.current
    )
    # Gross = 100_000, Fees = 3_000, Proceeds = 97_000

    # 1. Super admin calculates v1 draft with -$200 adjustment
    post "/api/v1/tournaments/#{@tournament_a.id}/settlement/calculate",
         params: { adjustment_cents: -200, adjustment_notes: "Bank check fee" },
         headers: auth_headers_for(@super_admin)
    assert_response :success
    body = JSON.parse(response.body)
    assert_equal 1, body.dig("settlement", "version")
    assert_equal "draft", body.dig("settlement", "status")
    assert_equal 96_800, body.dig("settlement", "organizer_proceeds_cents")
    assert_equal 96_800, body.dig("settlement", "payable_cents")

    # 2. Finalize v1
    post "/api/v1/tournaments/#{@tournament_a.id}/settlement/finalize",
         headers: auth_headers_for(@super_admin)
    assert_response :success
    body = JSON.parse(response.body)
    assert_equal "finalized", body.dig("settlement", "status")
    assert_not_nil body.dig("settlement", "finalized_at")

    # Finalized settlement financials cannot be mutated directly
    v1 = TournamentSettlement.find(body.dig("settlement", "id"))
    assert_raises(ActiveRecord::RecordInvalid) do
      v1.update!(gross_cents: 999_999)
    end

    # 3. Record partial check payout ($600.00 = 60_000c) as pending with idempotency_key
    post "/api/v1/tournaments/#{@tournament_a.id}/settlement/payouts",
         params: {
           amount_cents: 60_000,
           provider: "check",
           provider_payout_id: "CHK-1042",
           idempotency_key: "payout-chk-1042",
           notes: "First check to class treasurer"
         },
         headers: auth_headers_for(@super_admin)
    assert_response :created
    payout_body = JSON.parse(response.body)
    payout_id = payout_body.dig("payout", "id")
    assert_equal "pending", payout_body.dig("payout", "status")
    assert_equal "CHK-1042", payout_body.dig("payout", "provider_payout_id")
    assert_equal "Bank of Guam", payout_body.dig("payout", "payee_snapshot", "bank_name")
    assert_equal 0, payout_body.dig("settlement", "paid_cents")
    assert_equal 36_800, payout_body.dig("settlement", "remaining_payout_capacity_cents")

    # 4. Replaying the same idempotency_key returns existing payout without double-creating
    post "/api/v1/tournaments/#{@tournament_a.id}/settlement/payouts",
         params: {
           amount_cents: 60_000,
           provider: "check",
           provider_payout_id: "CHK-1042",
           idempotency_key: "payout-chk-1042"
         },
         headers: auth_headers_for(@super_admin)
    assert_response :ok
    replay_body = JSON.parse(response.body)
    assert_equal true, replay_body["idempotent_replay"]
    assert_equal payout_id, replay_body.dig("payout", "id")
    assert_equal 1, @tournament_a.tournament_payouts.count

    # 5. Over-payout guard rejects payout exceeding remaining capacity ($400 > $368)
    post "/api/v1/tournaments/#{@tournament_a.id}/settlement/payouts",
         params: { amount_cents: 40_000, provider: "check", provider_payout_id: "CHK-1043" },
         headers: auth_headers_for(@super_admin)
    assert_response :unprocessable_entity
    assert_includes response.body, "exceeds remaining payable capacity"

    # 6. Mark payout paid
    post "/api/v1/tournaments/#{@tournament_a.id}/settlement/payouts/#{payout_id}/mark_paid",
         headers: auth_headers_for(@super_admin)
    assert_response :ok
    paid_body = JSON.parse(response.body)
    assert_equal "paid", paid_body.dig("payout", "status")
    assert_equal 60_000, paid_body.dig("settlement", "paid_cents")
    assert_equal 36_800, paid_body.dig("settlement", "payable_cents")

    # 7. Late partial refund ($100) triggers ledger_changed_since_calculation and v2 draft preserves tournament paid_cents!
    g1.update!(refund_amount_cents: 10_000, refunded_at: Time.current)
    get "/api/v1/tournaments/#{@tournament_a.id}/settlement", headers: auth_headers_for(@super_admin)
    assert_response :success
    stale_body = JSON.parse(response.body)
    assert_equal true, stale_body.dig("settlement", "ledger_changed_since_calculation")

    post "/api/v1/tournaments/#{@tournament_a.id}/settlement/calculate",
         params: { adjustment_cents: 0 },
         headers: auth_headers_for(@super_admin)
    assert_response :ok
    v2_body = JSON.parse(response.body)
    assert_equal 2, v2_body.dig("settlement", "version")
    assert_equal "draft", v2_body.dig("settlement", "status")
    # Gross 100_000 - Refund 10_000 - Fees 3_000 = 87_000 proceeds; 60_000 already paid across tournament -> 27_000 payable!
    assert_equal 87_000, v2_body.dig("settlement", "organizer_proceeds_cents")
    assert_equal 60_000, v2_body.dig("settlement", "paid_cents")
    assert_equal 27_000, v2_body.dig("settlement", "payable_cents")
    assert_equal 27_000, v2_body.dig("settlement", "remaining_payout_capacity_cents")

    # 8. Voiding the check restores payable balance and prevents transitioning voided -> paid
    post "/api/v1/tournaments/#{@tournament_a.id}/settlement/payouts/#{payout_id}/void",
         params: { void_reason: "Check lost in mail" },
         headers: auth_headers_for(@super_admin)
    assert_response :ok
    void_body = JSON.parse(response.body)
    assert_equal "voided", void_body.dig("payout", "status")
    assert_equal 0, void_body.dig("settlement", "paid_cents")
    assert_equal 87_000, void_body.dig("settlement", "payable_cents")

    post "/api/v1/tournaments/#{@tournament_a.id}/settlement/payouts/#{payout_id}/mark_paid",
         headers: auth_headers_for(@super_admin)
    assert_response :unprocessable_entity

    # 9. CSV export neutralizes formula injection (=EVIL())
    get "/api/v1/tournaments/#{@tournament_a.id}/settlement/export", headers: auth_headers_for(@org_a_admin)
    assert_response :success
    assert_includes response.body, "'=EVIL() Foursome"
    assert_includes response.body, "CHK-1042"
  end

  private

  def auth_headers_for(user)
    { "Authorization" => "Bearer test_token_#{user.id}" }
  end
end
