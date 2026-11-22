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

  test "excludes admin-entered stripe records without payment_intent and groups raffle fees by intent" do
    @org_a.organization_payment_config.update!(
      platform_fee_flat_cents: 0,
      platform_fee_per_registrant_cents: 0,
      platform_fee_cap_cents: nil
    )

    # Admin manually typed payment_method='stripe' with NO stripe_account_origin and NO stripe_payment_intent_id
    Golfer.create!(
      tournament: @tournament_a,
      name: "  =CMD() Spoofed Stripe",
      email: "spoof@example.com",
      phone: "671-555-0301",
      team_category: "Co-Ed",
      payment_type: "pay_on_day",
      payment_status: "paid",
      payment_method: "stripe",
      payment_amount_cents: 15_000,
      registration_status: "confirmed",
      waiver_accepted_at: Time.current,
      paid_at: Time.current
    )

    # Admin manually created raffle ticket with payment_method='stripe' and NO payment_intent_id
    @tournament_a.raffle_tickets.create!(
      ticket_number: "TST-0001",
      sequence_number: 1,
      purchaser_name: "Manual Raffle",
      purchaser_phone: "+16715550301",
      price_cents: 1_000,
      payment_status: "paid",
      payment_method: "stripe",
      purchased_at: Time.current
    )

    # Real platform-collected raffle batch: 3 x $10 tickets sharing ONE stripe_payment_intent_id (one refunded)
    3.times do |i|
      @tournament_a.raffle_tickets.create!(
        ticket_number: "TST-001#{i}",
        sequence_number: 10 + i,
        purchaser_name: "Real Raffle Buyer",
        purchaser_phone: "+16715550302",
        price_cents: 1_000,
        payment_status: i == 2 ? "refunded" : "paid",
        payment_method: "stripe",
        stripe_payment_intent_id: "pi_raffle_batch_1",
        purchased_at: Time.current
      )
    end

    result = Settlements::Calculator.call(@tournament_a)

    # Only the 3 real raffle tickets ($30) count as platform-collected; manual stripe golfer & ticket excluded!
    assert_equal 3_000, result.gross_cents
    assert_equal 1_000, result.refund_cents
    assert_equal 2_000, result.net_cents
    # Grouped Stripe fee on ONE $30 charge: round(3000 * 0.029) + 30 = 87 + 30 = 117c (NOT 3 * 59 = 177c)
    assert_equal 117, result.processing_fee_cents
    assert_equal 15_000, result.breakdown_json.dig("direct_collected", "registrations", "gross_cents")
    assert_equal 1_000, result.breakdown_json.dig("direct_collected", "raffle", "gross_cents")

    # CSV neutralizes leading whitespace before formula trigger
    Golfer.create!(
      tournament: @tournament_a,
      name: "  =CMD() Whitespace",
      email: "ws@example.com",
      phone: "671-555-0309",
      team_category: "Co-Ed",
      payment_type: "stripe",
      payment_status: "paid",
      payment_method: "stripe",
      payment_amount_cents: 1_000,
      stripe_account_origin: "platform_live",
      registration_status: "confirmed",
      waiver_accepted_at: Time.current,
      paid_at: Time.current
    )
    get "/api/v1/tournaments/#{@tournament_a.id}/settlement/export", headers: auth_headers_for(@org_a_admin)
    assert_response :success
    assert_includes response.body, "'  =CMD() Whitespace"
  end

  test "blocks payouts on drafts or stale finalized statements, rejects mismatched replay, and enforces strict base-10 integers" do
    @org_a.organization_payment_config.update!(
      platform_fee_flat_cents: 0,
      platform_fee_per_registrant_cents: 0,
      platform_fee_cap_cents: nil
    )

    g1 = Golfer.create!(
      tournament: @tournament_a,
      name: "Guard Golfer",
      email: "guard@example.com",
      phone: "671-555-0401",
      team_category: "Co-Ed",
      payment_type: "stripe",
      payment_status: "paid",
      payment_method: "stripe",
      payment_amount_cents: 20_000,
      stripe_fee_cents: 600,
      stripe_account_origin: "platform_live",
      registration_status: "confirmed",
      waiver_accepted_at: Time.current,
      paid_at: Time.current
    )

    # Reject non-base-10 / float / overflow adjustment_cents
    %w[100.5 0x10 12abc 999999999999].each do |bad|
      post "/api/v1/tournaments/#{@tournament_a.id}/settlement/calculate",
           params: { adjustment_cents: bad },
           headers: auth_headers_for(@super_admin)
      assert_response :unprocessable_entity, "Expected 422 for adjustment_cents=#{bad.inspect}"
    end

    # Leading-zero string parses strictly as base-10 (10), NOT octal (8)
    post "/api/v1/tournaments/#{@tournament_a.id}/settlement/calculate",
         params: { adjustment_cents: "010" },
         headers: auth_headers_for(@super_admin)
    assert_response :success
    assert_equal 10, JSON.parse(response.body).dig("settlement", "adjustment_cents")

    # Calculate v1 draft
    post "/api/v1/tournaments/#{@tournament_a.id}/settlement/calculate",
         params: { adjustment_cents: 0 },
         headers: auth_headers_for(@super_admin)
    assert_response :success

    # Cannot record payout while statement is still draft
    post "/api/v1/tournaments/#{@tournament_a.id}/settlement/payouts",
         params: { amount_cents: 5_000, provider: "check" },
         headers: auth_headers_for(@super_admin)
    assert_response :unprocessable_entity
    assert_includes response.body, "Finalize settlement"

    # Mutate ledger before finalizing -> finalize MUST reject stale draft with 409 Conflict
    g1.update!(refund_amount_cents: 2_000, refunded_at: Time.current)
    post "/api/v1/tournaments/#{@tournament_a.id}/settlement/finalize",
         headers: auth_headers_for(@super_admin)
    assert_response :conflict

    # Recalculate and finalize cleanly
    post "/api/v1/tournaments/#{@tournament_a.id}/settlement/calculate",
         params: { adjustment_cents: 0 },
         headers: auth_headers_for(@super_admin)
    assert_response :success
    post "/api/v1/tournaments/#{@tournament_a.id}/settlement/finalize",
         headers: auth_headers_for(@super_admin)
    assert_response :success

    # Record payout with idempotency key
    post "/api/v1/tournaments/#{@tournament_a.id}/settlement/payouts",
         params: { amount_cents: 5_000, provider: "check", idempotency_key: "key-strict-1" },
         headers: auth_headers_for(@super_admin)
    assert_response :created

    # Replaying SAME idempotency_key with DIFFERENT amount or provider returns 422
    post "/api/v1/tournaments/#{@tournament_a.id}/settlement/payouts",
         params: { amount_cents: 6_000, provider: "check", idempotency_key: "key-strict-1" },
         headers: auth_headers_for(@super_admin)
    assert_response :unprocessable_entity

    post "/api/v1/tournaments/#{@tournament_a.id}/settlement/payouts",
         params: { amount_cents: 5_000, provider: "ach", idempotency_key: "key-strict-1" },
         headers: auth_headers_for(@super_admin)
    assert_response :unprocessable_entity

    # Late refund invalidates finalized statement -> new payout MUST fail with 409 Conflict
    g1.update!(refund_amount_cents: 10_000, refunded_at: Time.current)
    post "/api/v1/tournaments/#{@tournament_a.id}/settlement/payouts",
         params: { amount_cents: 5_000, provider: "check", idempotency_key: "key-strict-2" },
         headers: auth_headers_for(@super_admin)
    assert_response :conflict
    assert_includes response.body, "recalculate and finalize"
  end

  test "calculator includes paid multi-player registrations and deduplicates bridged legacy golfers" do
    @tournament_a.update!(team_size: 4, allow_partial_teams: true, capacity_unit: "players", entry_fee: 15_000)

    # 1. Paid 4-player PR-3b Registration on platform_collect ($600.00)
    reg = @tournament_a.registrations.create!(
      organization: @org_a,
      team_name: "Pacific Foursome",
      contact_name: "Captain One",
      contact_email: "cap1@example.com",
      contact_phone: "+16715550111",
      payment_type: "stripe",
      payment_status: "paid",
      payment_method: "stripe",
      payment_amount_cents: 60_000,
      stripe_payment_intent_id: "pi_reg_foursome_1",
      stripe_account_origin: "platform_test",
      registration_status: "confirmed",
      paid_at: Time.current,
      team_members_attributes: [
        { organization: @org_a, tournament: @tournament_a, position: 1, is_captain: true, name: "Captain One", email: "cap1@example.com" },
        { organization: @org_a, tournament: @tournament_a, position: 2, is_captain: false, name: "Player Two" },
        { organization: @org_a, tournament: @tournament_a, position: 3, is_captain: false, name: "Player Three" },
        { organization: @org_a, tournament: @tournament_a, position: 4, is_captain: false, name: "Player Four" }
      ]
    )

    # 2. Bridged legacy golfer linked via registration.golfer_id MUST NOT be double-counted
    legacy_golfer = Golfer.create!(
      tournament: @tournament_a,
      name: "Bridged Golfer",
      email: "bridged@example.com",
      phone: "671-555-0199",
      team_category: "Co-Ed",
      payment_type: "stripe",
      payment_status: "paid",
      payment_method: "stripe",
      payment_amount_cents: 15_000,
      stripe_payment_intent_id: "pi_bridged_1",
      stripe_account_origin: "platform_live",
      registration_status: "confirmed",
      waiver_accepted_at: Time.current,
      paid_at: Time.current
    )
    @tournament_a.registrations.create!(
      organization: @org_a,
      golfer: legacy_golfer,
      team_name: "Bridged Golfer",
      contact_name: "Bridged Golfer",
      contact_email: "bridged@example.com",
      payment_type: "stripe",
      payment_status: "paid",
      payment_method: "stripe",
      payment_amount_cents: 15_000,
      stripe_payment_intent_id: "pi_bridged_1",
      stripe_account_origin: "platform_live",
      registration_status: "confirmed",
      paid_at: Time.current,
      team_members_attributes: [
        { organization: @org_a, tournament: @tournament_a, position: 1, is_captain: true, name: "Bridged Golfer", email: "bridged@example.com" }
      ]
    )

    # 3. Direct-collected offline registration goes to direct_collected, NOT platform gross
    @tournament_a.registrations.create!(
      organization: @org_a,
      team_name: "Cash Team",
      contact_name: "Cash Captain",
      contact_email: "cash@example.com",
      payment_type: "pay_on_day",
      payment_status: "paid",
      payment_method: "cash",
      payment_amount_cents: 30_000,
      registration_status: "confirmed",
      paid_at: Time.current,
      team_members_attributes: [
        { organization: @org_a, tournament: @tournament_a, position: 1, is_captain: true, name: "Cash Captain", email: "cash@example.com" },
        { organization: @org_a, tournament: @tournament_a, position: 2, is_captain: false, name: "Cash Partner" }
      ]
    )

    result = Settlements::Calculator.call(@tournament_a)

    # Gross = $600 (foursome) + $150 (bridged once) = $750.00 (75_000c)
    assert_equal 75_000, result.gross_cents
    # Billable registrants = 4 + 1 = 5 players
    assert_equal 5, result.breakdown_json.dig("registrations", "billable_registrant_count")
    assert_equal 2, result.breakdown_json.dig("registrations", "charge_count")
    # Platform fee = $300 flat + 5 * $3 = $315 (31_500c)
    assert_equal 31_500, result.platform_fee_cents
    # Direct collected = 1 cash registration ($300)
    assert_equal 1, result.breakdown_json.dig("direct_collected", "registrations", "count")
    assert_equal 30_000, result.breakdown_json.dig("direct_collected", "registrations", "gross_cents")

    reg_item = result.line_items.find { |li| li[:source_type] == "team_registration" && li[:source_id] == reg.id }
    assert_not_nil reg_item
    assert_equal "Pacific Foursome", reg_item[:label]
    assert_equal 60_000, reg_item[:gross_cents]

    # 4. Also verify payout statement endpoint + CSV export include registration, sponsor, and donation together
    @tournament_a.sponsors.create!(
      name: "Island Marine Co",
      login_email: "sponsor@example.com",
      tier: "gold",
      payment_type: "stripe",
      payment_amount_cents: 250_000,
      payment_status: "paid",
      payment_method: "stripe",
      stripe_payment_intent_id: "pi_sponsor_gold_1",
      stripe_account_origin: "platform_test",
      active: true,
      paid_at: Time.current
    )
    @tournament_a.donations.create!(
      organization: @org_a,
      donor_name: "Generous Donor",
      donor_email: "donor@example.com",
      amount_cents: 5_000,
      payment_type: "stripe",
      payment_status: "paid",
      payment_method: "stripe",
      stripe_payment_intent_id: "pi_donation_1",
      stripe_account_origin: "platform_test",
      paid_at: Time.current
    )

    get "/api/v1/tournaments/#{@tournament_a.id}/settlement", headers: auth_headers_for(@org_a_admin)
    assert_response :success
    payload = JSON.parse(response.body)
    # Gross = $600 (foursome) + $150 (bridged once) + $2,500 (sponsor) + $50 (donation) = $3,300.00 (330_000c)
    # Processing fees = 1770 + 465 + 7280 + 175 = 9_690c ($96.90)
    # Platform fee = $300 flat + 5 * $3 = $315 (31_500c)
    # Organizer proceeds / payable = 330_000 - 9_690 - 31_500 = 288_810c ($2,888.10)
    assert_equal 330_000, payload.dig("live_preview", "gross_cents")
    assert_equal 9_690, payload.dig("live_preview", "processing_fee_cents")
    assert_equal 288_810, payload.dig("live_preview", "payable_cents")

    get "/api/v1/tournaments/#{@tournament_a.id}/settlement/export", headers: auth_headers_for(@org_a_admin)
    assert_response :success
    csv_body = response.body
    assert_includes csv_body, "team_registration"
    assert_includes csv_body, "Pacific Foursome"
    assert_includes csv_body, "Island Marine Co"
    assert_includes csv_body, "Generous Donor"
    assert_includes csv_body, "3300.00"
    assert_includes csv_body, "96.90"
    assert_includes csv_body, "2888.10"

    # 5. Roster change after draft calculation changes source_digest so finalize returns 409 Conflict
    post "/api/v1/tournaments/#{@tournament_a.id}/settlement/calculate", headers: auth_headers_for(@super_admin)
    assert_response :success
    reg.team_members.order(:position).last.destroy!

    post "/api/v1/tournaments/#{@tournament_a.id}/settlement/finalize", headers: auth_headers_for(@super_admin)
    assert_response :conflict
    assert_includes response.body, "recalculate"
  end

  test "calculator handles registration edge cases (cancelled, full/partial refunds, sponsor, unpaid, zero members)" do
    @tournament_a.update!(team_size: 4, allow_partial_teams: true, capacity_unit: "players", entry_fee: 15_000)

    # Cancelled paid registration: gross counted, NOT a billable registrant
    @tournament_a.registrations.create!(
      organization: @org_a,
      team_name: "Cancelled Team",
      contact_name: "Cancelled Cap",
      contact_email: "cancelled@example.com",
      payment_type: "stripe",
      payment_status: "paid",
      payment_method: "stripe",
      payment_amount_cents: 15_000,
      stripe_payment_intent_id: "pi_reg_cancelled",
      stripe_account_origin: "platform_live",
      registration_status: "cancelled",
      paid_at: Time.current,
      team_members_attributes: [
        { organization: @org_a, tournament: @tournament_a, position: 1, is_captain: true, name: "Cancelled Cap" }
      ]
    )

    # Fully refunded registration: gross + refund counted, NOT a billable registrant
    @tournament_a.registrations.create!(
      organization: @org_a,
      team_name: "Refunded Team",
      contact_name: "Refunded Cap",
      contact_email: "refunded@example.com",
      payment_type: "stripe",
      payment_status: "refunded",
      payment_method: "stripe",
      payment_amount_cents: 15_000,
      refund_amount_cents: 15_000,
      stripe_payment_intent_id: "pi_reg_refunded",
      stripe_account_origin: "platform_live",
      registration_status: "cancelled",
      paid_at: 2.days.ago,
      refunded_at: 1.day.ago,
      team_members_attributes: [
        { organization: @org_a, tournament: @tournament_a, position: 1, is_captain: true, name: "Refunded Cap" }
      ]
    )

    # Partially refunded registration (2 players): still active_paid -> 2 billable registrants, $50 refund
    @tournament_a.registrations.create!(
      organization: @org_a,
      team_name: "Partial Refund Team",
      contact_name: "Partial Cap",
      contact_email: "partial@example.com",
      payment_type: "stripe",
      payment_status: "paid",
      payment_method: "stripe",
      payment_amount_cents: 30_000,
      refund_amount_cents: 5_000,
      stripe_payment_intent_id: "pi_reg_partial",
      stripe_account_origin: "platform_live",
      registration_status: "confirmed",
      paid_at: 2.days.ago,
      refunded_at: 1.day.ago,
      team_members_attributes: [
        { organization: @org_a, tournament: @tournament_a, position: 1, is_captain: true, name: "Partial Cap" },
        { organization: @org_a, tournament: @tournament_a, position: 2, is_captain: false, name: "Partial Mate" }
      ]
    )

    # Registration with 0 team_members (e.g. legacy/orphaned row): clamped to 1 billable registrant
    no_members_reg = @tournament_a.registrations.create!(
      organization: @org_a,
      team_name: "No Members Yet",
      contact_name: "Solo Contact",
      contact_email: "solo@example.com",
      payment_type: "stripe",
      payment_status: "paid",
      payment_method: "stripe",
      payment_amount_cents: 15_000,
      stripe_payment_intent_id: "pi_reg_nomembers",
      stripe_account_origin: "platform_live",
      registration_status: "confirmed",
      paid_at: Time.current,
      team_members_attributes: [
        { organization: @org_a, tournament: @tournament_a, position: 1, is_captain: true, name: "Solo Contact" }
      ]
    )
    no_members_reg.team_members.delete_all

    # Sponsor registration: skipped completely (counted via Sponsor model)
    @tournament_a.registrations.create!(
      organization: @org_a,
      team_name: "Sponsor Foursome",
      contact_name: "Sponsor Cap",
      contact_email: "sponsorcap@example.com",
      payment_type: "sponsor",
      payment_status: "paid",
      payment_method: "stripe",
      payment_amount_cents: 60_000,
      stripe_payment_intent_id: "pi_reg_sponsor",
      stripe_account_origin: "platform_live",
      registration_status: "confirmed",
      paid_at: Time.current,
      team_members_attributes: [
        { organization: @org_a, tournament: @tournament_a, position: 1, is_captain: true, name: "Sponsor Cap" }
      ]
    )

    # Unpaid / zero-amount registration: skipped completely
    @tournament_a.registrations.create!(
      organization: @org_a,
      team_name: "Unpaid Zero",
      contact_name: "Unpaid Cap",
      contact_email: "unpaid@example.com",
      payment_type: "stripe",
      payment_status: "unpaid",
      payment_amount_cents: 0,
      registration_status: "confirmed",
      team_members_attributes: [
        { organization: @org_a, tournament: @tournament_a, position: 1, is_captain: true, name: "Unpaid Cap" }
      ]
    )

    result = Settlements::Calculator.call(@tournament_a)

    # Gross = 15_000 (cancelled) + 15_000 (refunded) + 30_000 (partial) + 15_000 (no members) = 75_000
    assert_equal 75_000, result.gross_cents
    # Refunds = 15_000 (full) + 5_000 (partial) = 20_000
    assert_equal 20_000, result.refund_cents
    assert_equal 55_000, result.net_cents
    # Billable registrants = 2 (partial refund team) + 1 (no-members clamped min 1) = 3
    assert_equal 3, result.breakdown_json.dig("registrations", "billable_registrant_count")
    assert_equal 4, result.breakdown_json.dig("registrations", "charge_count")
  end

  test "calculator uses authoritative Golfer state for bridged rows (pending registration + paid golfer, and golfer refund)" do
    @tournament_a.update!(team_size: 1, allow_partial_teams: false, capacity_unit: "players", entry_fee: 15_000)

    # 1. Golfer paid later via legacy golfer checkout while bridged registration stayed unpaid
    paid_golfer = Golfer.create!(
      tournament: @tournament_a,
      name: "Imported Then Paid",
      email: "paid-bridged@example.com",
      phone: "671-555-0301",
      team_category: "Co-Ed",
      payment_type: "stripe",
      payment_status: "paid",
      payment_method: "stripe",
      payment_amount_cents: 15_000,
      stripe_fee_cents: 465,
      stripe_payment_intent_id: "pi_bridged_paid_later",
      stripe_account_origin: "platform_live",
      registration_status: "confirmed",
      waiver_accepted_at: Time.current,
      paid_at: Time.current
    )
    @tournament_a.registrations.create!(
      organization: @org_a,
      golfer: paid_golfer,
      team_name: "Imported Then Paid",
      contact_name: "Imported Then Paid",
      contact_email: "paid-bridged@example.com",
      payment_type: "stripe",
      payment_status: "unpaid",
      payment_amount_cents: 0,
      registration_status: "confirmed",
      team_members_attributes: [
        { organization: @org_a, tournament: @tournament_a, position: 1, is_captain: true, name: "Imported Then Paid" }
      ]
    )

    # 2. Golfer refunded via legacy Golfer#process_refund! while bridged registration still reads paid
    refunded_golfer = Golfer.create!(
      tournament: @tournament_a,
      name: "Imported Then Refunded",
      email: "refunded-bridged@example.com",
      phone: "671-555-0302",
      team_category: "Co-Ed",
      payment_type: "stripe",
      payment_status: "refunded",
      payment_method: "stripe",
      payment_amount_cents: 15_000,
      refund_amount_cents: 15_000,
      stripe_fee_cents: 465,
      stripe_payment_intent_id: "pi_bridged_refunded",
      stripe_account_origin: "platform_live",
      registration_status: "cancelled",
      waiver_accepted_at: Time.current,
      paid_at: 2.days.ago,
      refunded_at: 1.day.ago
    )
    @tournament_a.registrations.create!(
      organization: @org_a,
      golfer: refunded_golfer,
      team_name: "Imported Then Refunded",
      contact_name: "Imported Then Refunded",
      contact_email: "refunded-bridged@example.com",
      payment_type: "stripe",
      payment_status: "paid",
      payment_method: "stripe",
      payment_amount_cents: 15_000,
      stripe_payment_intent_id: "pi_bridged_refunded",
      stripe_account_origin: "platform_live",
      registration_status: "confirmed",
      paid_at: 2.days.ago,
      team_members_attributes: [
        { organization: @org_a, tournament: @tournament_a, position: 1, is_captain: true, name: "Imported Then Refunded" }
      ]
    )

    result = Settlements::Calculator.call(@tournament_a)

    # Both golfers accounted for once from authoritative Golfer rows:
    # Gross = 15_000 + 15_000 = 30_000; Refunds = 15_000; Net = 15_000
    assert_equal 30_000, result.gross_cents
    assert_equal 15_000, result.refund_cents
    assert_equal 15_000, result.net_cents
    # Actual Stripe fees preserved from Golfer rows (465 + 465 = 930)
    assert_equal 930, result.processing_fee_cents
    assert_equal 2, result.breakdown_json.dig("processing_fees", "actual_fee_count")
    assert_equal 0, result.breakdown_json.dig("processing_fees", "estimated_fee_count")
    # Only the non-refunded golfer counts as a billable registrant
    assert_equal 1, result.breakdown_json.dig("registrations", "billable_registrant_count")
    assert_equal 2, result.breakdown_json.dig("registrations", "charge_count")
  end

  private

  def auth_headers_for(user)
    { "Authorization" => "Bearer test_token_#{user.id}" }
  end
end
