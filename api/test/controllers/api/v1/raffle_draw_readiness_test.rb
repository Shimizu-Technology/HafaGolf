# frozen_string_literal: true

require "test_helper"

class Api::V1::RaffleDrawReadinessTest < ActionDispatch::IntegrationTest
  include ActionCable::TestHelper

  setup do
    @tournament = tournaments(:tournament_one)
    @tournament.update!(raffle_enabled: true)
    @tournament.raffle_prizes.update_all(winning_ticket_id: nil)
    @tournament.message_deliveries.delete_all
    @tournament.raffle_tickets.delete_all
    @tournament.raffle_sale_batches.delete_all
    @tournament.raffle_prizes.delete_all

    @admin = users(:user_one)
    @admin.update!(clerk_id: "test_clerk_readiness_#{@admin.id}") if @admin.clerk_id.blank?
    OrganizationMembership.find_or_create_by!(user: @admin, organization: @tournament.organization) do |membership|
      membership.role = "admin"
    end
    @headers = { "Authorization" => "Bearer test_token_#{@admin.id}" }

    @prize = @tournament.raffle_prizes.create!(
      name: "Grand Golf Package",
      tier: "grand",
      value_cents: 150000,
      position: 1
    )
  end

  test "draw_readiness returns ready false when there are no eligible tickets" do
    get "/api/v1/tournaments/#{@tournament.id}/raffle/draw_readiness", headers: @headers

    assert_response :success
    json = JSON.parse(response.body)
    assert_equal false, json["ready"]
    assert_equal 0, json["eligible_ticket_count"]
    assert_equal 0, json["paid_buyer_batch_count"]
    assert_equal 0, json["missing_name_count"]
    assert_equal 0, json["failed_delivery_count"]
    assert_equal 0, json["unconfirmed_delivery_count"]
    assert_equal 0, json["confirmed_delivered_count"]
    assert_equal [], json["issues"]
  end

  test "draw_readiness catches failed, accepted-only, and missing-name buyers" do
    # 1. Delivered POS buyer (SMS delivered)
    delivered_batch, delivered_tickets = create_pos_batch(
      name: "Maria Cruz",
      phone: "+16715550101",
      email: "maria@example.com",
      quantity: 2
    )
    create_delivery(ticket: delivered_tickets.first, channel: "sms", status: "delivered", recipient: "+16715550101")

    # 2. Failed SMS without delivered fallback
    failed_batch, failed_tickets = create_pos_batch(
      name: "Carlos Santos",
      phone: "+16715550102",
      email: nil,
      quantity: 2
    )
    create_delivery(
      ticket: failed_tickets.first,
      channel: "sms",
      status: "failed",
      recipient: "+16715550102",
      error_text: "Carrier rejected number"
    )

    # 3. Accepted-only SMS (NOT yet delivered!)
    accepted_batch, accepted_tickets = create_pos_batch(
      name: "Ana Reyes",
      phone: "+16715550103",
      email: nil,
      quantity: 1
    )
    create_delivery(ticket: accepted_tickets.first, channel: "sms", status: "accepted", recipient: "+16715550103")

    # 4. Missing buyer name (blank purchaser_name, no golfer) with delivered email
    missing_name_ticket = @tournament.raffle_tickets.create!(
      purchaser_name: "Temp Name",
      purchaser_email: "nameless@example.com",
      price_cents: 500,
      payment_status: "paid",
      purchased_at: Time.current
    )
    missing_name_ticket.update_columns(purchaser_name: "   ")
    create_delivery(ticket: missing_name_ticket, channel: "email", status: "delivered", recipient: "nameless@example.com")

    get "/api/v1/tournaments/#{@tournament.id}/raffle/draw_readiness", headers: @headers

    assert_response :success
    json = JSON.parse(response.body)
    assert_equal false, json["ready"]
    assert_equal 6, json["eligible_ticket_count"]
    assert_equal 4, json["paid_buyer_batch_count"]
    assert_equal 2, json["confirmed_delivered_count"]
    assert_equal 1, json["failed_delivery_count"]
    assert_equal 1, json["unconfirmed_delivery_count"]
    assert_equal 1, json["missing_name_count"]
    assert_equal 3, json["issues_total_count"]
    assert_equal false, json["issues_truncated"]

    reasons_by_ticket = json["issues"].each_with_object({}) { |row, h| h[row["ticket_id"]] = row }
    assert_equal "missing_name", reasons_by_ticket[missing_name_ticket.id]["issue_reason"]
    assert_equal "failed_delivery", reasons_by_ticket[failed_tickets.first.id]["issue_reason"]
    assert_equal failed_batch.id, reasons_by_ticket[failed_tickets.first.id]["raffle_sale_batch_id"]
    assert_equal "Carrier rejected number", reasons_by_ticket[failed_tickets.first.id]["sms_error"]
    assert_equal "unconfirmed_delivery", reasons_by_ticket[accepted_tickets.first.id]["issue_reason"]
    assert_equal accepted_batch.id, reasons_by_ticket[accepted_tickets.first.id]["raffle_sale_batch_id"]
    assert_nil reasons_by_ticket[delivered_tickets.first.id]
    assert_not_nil delivered_batch.id

    # Missing-name ticket also surfaces in Needs Attention so one-click jump lets admin fix it
    get "/api/v1/tournaments/#{@tournament.id}/raffle/admin/tickets",
        params: { type: "needs_attention" },
        headers: @headers
    assert_response :success
    attention_ids = JSON.parse(response.body).fetch("tickets").map { |t| t["id"] }
    assert_includes attention_ids, missing_name_ticket.id
  end

  test "draw_readiness reports ready true when all buyers are delivered with names including delivered fallback" do
    # Buyer 1: SMS delivered
    _, tickets_one = create_pos_batch(
      name: "David Taitano",
      phone: "+16715550201",
      email: nil,
      quantity: 3
    )
    create_delivery(ticket: tickets_one.first, channel: "sms", status: "delivered", recipient: "+16715550201")

    # Buyer 2: SMS failed, BUT email delivered (delivered fallback channel!)
    _, tickets_two = create_pos_batch(
      name: "Elena Sablan",
      phone: "+16715550202",
      email: "elena@example.com",
      quantity: 2
    )
    create_delivery(ticket: tickets_two.first, channel: "sms", status: "failed", recipient: "+16715550202")
    create_delivery(ticket: tickets_two.first, channel: "email", status: "delivered", recipient: "elena@example.com")

    # Buyer 3: Complimentary registration ticket tied to golfer (no POS delivery needed)
    golfer = golfers(:confirmed_paid)
    @tournament.raffle_tickets.create!(
      golfer: golfer,
      purchaser_name: golfer.name,
      purchaser_email: golfer.email,
      price_cents: 0,
      payment_status: "paid",
      purchased_at: Time.current
    )

    get "/api/v1/tournaments/#{@tournament.id}/raffle/draw_readiness", headers: @headers

    assert_response :success
    json = JSON.parse(response.body)
    assert_equal true, json["ready"]
    assert_equal 6, json["eligible_ticket_count"]
    assert_equal 2, json["paid_buyer_batch_count"]
    assert_equal 2, json["confirmed_delivered_count"]
    assert_equal 0, json["failed_delivery_count"]
    assert_equal 0, json["unconfirmed_delivery_count"]
    assert_equal 0, json["missing_name_count"]
    assert_equal [], json["issues"]
  end

  test "draw_readiness uses bounded queries without N+1 across many batches and caps issues at 25" do
    30.times do |idx|
      _, tickets = create_pos_batch(
        name: "Buyer #{idx + 1}",
        phone: format("+1671555%04d", 1000 + idx),
        email: nil,
        quantity: 2
      )
      create_delivery(ticket: tickets.first, channel: "sms", status: "accepted", recipient: tickets.first.purchaser_phone)
    end

    select_count = 0
    callback = lambda do |_name, _started, _finished, _unique_id, payload|
      next if payload[:name] == "SCHEMA"
      next unless payload[:sql]&.match?(/\ASELECT/i)

      select_count += 1
    end

    ActiveSupport::Notifications.subscribed(callback, "sql.active_record") do
      get "/api/v1/tournaments/#{@tournament.id}/raffle/draw_readiness", headers: @headers
    end

    assert_response :success
    json = JSON.parse(response.body)
    assert_equal false, json["ready"]
    assert_equal 30, json["unconfirmed_delivery_count"]
    assert_equal 30, json["issues_total_count"]
    assert_equal true, json["issues_truncated"]
    assert_equal 25, json["issues"].length
    assert_operator select_count, :<=, 12
  end

  test "draw with enforce_readiness blocks unready draw with 422 and succeeds with audited override" do
    _, tickets = create_pos_batch(
      name: "Pending Buyer",
      phone: "+16715550301",
      email: nil,
      quantity: 2
    )
    create_delivery(ticket: tickets.first, channel: "sms", status: "accepted", recipient: "+16715550301")

    # 1. Blocked when enforce_readiness: true and no override
    assert_no_difference -> { ActivityLog.where(action: "raffle_draw_readiness_overridden").count } do
      post "/api/v1/tournaments/#{@tournament.id}/raffle/prizes/#{@prize.id}/draw",
           params: { enforce_readiness: true },
           as: :json,
           headers: @headers
    end

    assert_response :unprocessable_entity
    blocked_json = JSON.parse(response.body)
    assert_equal "Pre-draw readiness checks have unresolved warnings", blocked_json["error"]
    assert_equal false, blocked_json.dig("readiness", "ready")
    assert_equal 1, blocked_json.dig("readiness", "unconfirmed_delivery_count")
    assert_not @prize.reload.won?

    # 2. Succeeds when override_readiness: true + override_reason and logs audited ActivityLog entry
    assert_difference -> { ActivityLog.where(action: "raffle_draw_readiness_overridden").count }, 1 do
      assert_difference -> { ActivityLog.where(action: "raffle_prize_drawn").count }, 1 do
        post "/api/v1/tournaments/#{@tournament.id}/raffle/prizes/#{@prize.id}/draw",
             params: {
               enforce_readiness: true,
               override_readiness: true,
               override_reason: "Confirmed buyer ticket numbers in person at banquet table"
             },
             as: :json,
             headers: @headers
      end
    end

    assert_response :success
    assert @prize.reload.won?

    override_log = ActivityLog.where(action: "raffle_draw_readiness_overridden").last
    assert_equal @admin.id, override_log.admin_id
    assert_equal @tournament.id, override_log.tournament_id
    assert_equal @prize.id, override_log.target_id
    assert_equal "Confirmed buyer ticket numbers in person at banquet table", override_log.metadata["override_reason"]
    assert_equal 1, override_log.metadata["unconfirmed_delivery_count"]
    assert_equal 0, override_log.metadata["failed_delivery_count"]
    assert_equal 0, override_log.metadata["missing_name_count"]
    assert_equal "single_prize", override_log.metadata["draw_scope"]
  end

  test "draw_all enforces readiness when requested and logs audited override" do
    @tournament.raffle_prizes.create!(
      name: "Second Prize",
      tier: "gold",
      value_cents: 50000,
      position: 2
    )
    _, tickets = create_pos_batch(
      name: "Failed Delivery Buyer",
      phone: "+16715550401",
      email: nil,
      quantity: 3
    )
    create_delivery(ticket: tickets.first, channel: "sms", status: "failed", recipient: "+16715550401")

    post "/api/v1/tournaments/#{@tournament.id}/raffle/draw_all",
         params: { enforce_readiness: true },
         as: :json,
         headers: @headers

    assert_response :unprocessable_entity
    assert_equal 1, JSON.parse(response.body).dig("readiness", "failed_delivery_count")
    assert_equal 2, @tournament.raffle_prizes.available.count

    assert_difference -> { ActivityLog.where(action: "raffle_draw_readiness_overridden").count }, 1 do
      post "/api/v1/tournaments/#{@tournament.id}/raffle/draw_all",
           params: {
             enforce_readiness: true,
             override_readiness: true,
             override_reason: "Printed ticket slip handed to buyer"
           },
           as: :json,
           headers: @headers
    end

    assert_response :success
    assert_equal 0, @tournament.raffle_prizes.available.count
    log = ActivityLog.where(action: "raffle_draw_readiness_overridden").last
    assert_equal "draw_all", log.metadata["draw_scope"]
    assert_equal "Printed ticket slip handed to buyer", log.metadata["override_reason"]
    assert_equal 1, log.metadata["failed_delivery_count"]
  end

  test "draw remains backwards compatible when enforce_readiness is omitted" do
    create_pos_batch(
      name: "Legacy Caller Buyer",
      phone: "+16715550501",
      email: nil,
      quantity: 1
    )

    post "/api/v1/tournaments/#{@tournament.id}/raffle/prizes/#{@prize.id}/draw",
         headers: @headers

    assert_response :success
    assert @prize.reload.won?
  end

  test "clear_spotlight broadcasts spotlight_cleared on the tournament raffle channel" do
    stream = "tournament_#{@tournament.id}_raffle"

    assert_broadcasts(stream, 1) do
      post "/api/v1/tournaments/#{@tournament.id}/raffle/board/clear_spotlight",
           headers: @headers
    end

    assert_response :success
    payload = broadcasts(stream).last
    parsed = JSON.parse(payload)
    assert_equal "spotlight_cleared", parsed["action"]
    assert_equal @tournament.id, parsed["tournament_id"]
    assert parsed["cleared_at"].present?
  end

  test "prize_won broadcast includes hold_on_screen flag defaulting to true and configurable on tournament" do
    _, tickets = create_pos_batch(
      name: "Banquet Winner",
      phone: "+16715550601",
      email: nil,
      quantity: 1
    )
    create_delivery(ticket: tickets.first, channel: "sms", status: "delivered", recipient: "+16715550601")

    get "/api/v1/tournaments/#{@tournament.id}/raffle/board"
    assert_response :success
    assert_equal true, JSON.parse(response.body).dig("tournament", "raffle_hold_winner_on_screen")

    stream = "tournament_#{@tournament.id}_raffle"
    assert_broadcasts(stream, 2) do
      post "/api/v1/tournaments/#{@tournament.id}/raffle/prizes/#{@prize.id}/draw",
           params: { enforce_readiness: true },
           as: :json,
           headers: @headers
    end

    assert_response :success
    won_payload = broadcasts(stream).map { |raw| JSON.parse(raw) }.find { |msg| msg["action"] == "prize_won" }
    assert_equal true, won_payload["hold_on_screen"]
    assert_equal "Banquet Winner", won_payload.dig("prize", "winner_name")

    # Toggle hold_winner_on_screen off via tournament update
    patch "/api/v1/tournaments/#{@tournament.id}",
          params: { tournament: { raffle_hold_winner_on_screen: false } },
          as: :json,
          headers: @headers
    assert_response :success
    assert_equal false, @tournament.reload.raffle_hold_winner_on_screen?

    get "/api/v1/tournaments/#{@tournament.id}/raffle/board"
    assert_equal false, JSON.parse(response.body).dig("tournament", "raffle_hold_winner_on_screen")
  end

  test "volunteers and admins from another organization cannot access draw_readiness or clear_spotlight" do
    volunteer = User.create!(
      clerk_id: "test_clerk_vol_#{SecureRandom.hex(4)}",
      email: "vol-#{SecureRandom.hex(4)}@example.com",
      name: "Volunteer User"
    )
    OrganizationMembership.create!(user: volunteer, organization: @tournament.organization, role: "volunteer")
    volunteer_headers = { "Authorization" => "Bearer test_token_#{volunteer.id}" }

    get "/api/v1/tournaments/#{@tournament.id}/raffle/draw_readiness", headers: volunteer_headers
    assert_response :forbidden

    post "/api/v1/tournaments/#{@tournament.id}/raffle/board/clear_spotlight", headers: volunteer_headers
    assert_response :forbidden

    other_org = Organization.create!(name: "Other Golf Org", slug: "other-org-#{SecureRandom.hex(4)}")
    other_admin = User.create!(
      clerk_id: "test_clerk_other_#{SecureRandom.hex(4)}",
      email: "other-#{SecureRandom.hex(4)}@example.com",
      name: "Other Admin"
    )
    OrganizationMembership.create!(user: other_admin, organization: other_org, role: "admin")
    other_headers = { "Authorization" => "Bearer test_token_#{other_admin.id}" }

    get "/api/v1/tournaments/#{@tournament.id}/raffle/draw_readiness", headers: other_headers
    assert_response :forbidden

    post "/api/v1/tournaments/#{@tournament.id}/raffle/board/clear_spotlight", headers: other_headers
    assert_response :forbidden
  end

  private

  def create_pos_batch(name:, phone:, email:, quantity:)
    batch = @tournament.raffle_sale_batches.create!(
      buyer_name: name,
      buyer_phone: phone,
      buyer_email: email,
      quantity: quantity,
      total_cents: quantity * 500,
      payment_method: "swipe_simple",
      purchased_at: Time.current,
      sold_by_user: @admin
    )

    tickets = quantity.times.map do
      @tournament.raffle_tickets.create!(
        raffle_sale_batch: batch,
        purchaser_name: name,
        purchaser_phone: phone,
        purchaser_email: email,
        price_cents: 500,
        payment_status: "paid",
        purchased_at: Time.current,
        sold_by_user: @admin
      )
    end

    [ batch, tickets ]
  end

  def create_delivery(ticket:, channel:, status:, recipient:, error_text: nil)
    MessageDelivery.create!(
      organization: @tournament.organization,
      tournament: @tournament,
      messageable: ticket,
      channel: channel,
      provider: channel == "sms" ? "clicksend" : "resend",
      purpose: "raffle_purchase_confirmation",
      recipient: recipient,
      status: status,
      error_text: error_text,
      delivered_at: status == "delivered" ? Time.current : nil,
      failed_at: %w[failed bounced complained].include?(status) ? Time.current : nil,
      last_event_at: Time.current,
      metadata: { "raffle_sale_batch_id" => ticket.raffle_sale_batch_id }.compact
    )
  end
end
