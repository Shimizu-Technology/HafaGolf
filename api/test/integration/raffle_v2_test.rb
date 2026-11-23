require "test_helper"

class RaffleV2Test < ActionDispatch::IntegrationTest
  setup do
    @tournament = tournaments(:tournament_one)
    @organization = @tournament.organization
    @organization.organization_domains.create!(hostname: "raffle.example.com", is_primary: true, verified_at: Time.current)
    @other_organization = Organization.create!(name: "Other Host", slug: "other-raffle-host", subscription_status: "active")
    @other_organization.organization_domains.create!(hostname: "other-raffle.example.com", is_primary: true, verified_at: Time.current)
    @admin = users(:user_one)
    OrganizationMembership.find_or_create_by!(user: @admin, organization: @organization) do |membership|
      membership.role = "admin"
    end
    @host = { "X-Tenant-Host" => "raffle.example.com" }
    @admin_headers = @host.merge("Authorization" => "Bearer test_token_#{@admin.id}")
  end

  test "checks a trimmed ticket number case-insensitively without exposing buyer fields or values" do
    ticket = create_ticket("TIX-0007", golfer: golfers(:confirmed_paid))

    check("  tIx-0007  ")

    assert_response :ok
    assert_equal "no-store", response.headers["Cache-Control"]
    assert_equal ticket_result("TIX-0007", found: true, eligible: true, status: "entered"), response.parsed_body
    assert_private(ticket)
  end

  test "winner lookup returns only prize details and current claim state" do
    ticket = create_ticket("TIX-0008")
    prize = create_won_prize(ticket)

    check(ticket.ticket_number)

    assert_response :ok
    assert_equal ticket_result(ticket.ticket_number, found: true, eligible: true, status: "winner", prize: {
      "id" => prize.id,
      "name" => "Golf Bag",
      "tier" => "gold",
      "tier_display" => "Gold",
      "value_dollars" => 124.50,
      "sponsor_name" => "Example Sponsor",
      "claimed" => false,
      "claimed_at" => nil
    }), response.parsed_body
    assert_private(ticket)

    claim(prize, params: { claimed: true })
    assert_response :ok
    check(ticket.ticket_number)
    assert_response :ok
    assert_equal true, response.parsed_body.dig("prize", "claimed")
    assert_equal prize.reload.claimed_at.iso8601, response.parsed_body.dig("prize", "claimed_at")
    assert_private(ticket)
  end

  test "existing voided, unpaid, refunded, and waitlisted tickets are ineligible" do
    tickets = [
      create_ticket("TIX-0009", payment_status: "voided"),
      create_ticket("TIX-0010", payment_status: "pending"),
      create_ticket("TIX-0011", payment_status: "refunded"),
      create_ticket("TIX-0012", golfer: golfers(:waitlist_golfer))
    ]

    tickets.each do |ticket|
      check(ticket.ticket_number)

      assert_response :ok
      assert_equal ticket_result(ticket.ticket_number, found: true, status: "ineligible"), response.parsed_body
      assert_private(ticket)
    end
  end

  test "unknown tickets and inputs matching only contact details or a prefix are not found" do
    ticket = create_ticket("TIX-0013")

    [" TIX-9999 ", "TIX-001", ticket.purchaser_email, ticket.purchaser_phone, ticket.purchaser_name].each do |input|
      check(input)

      assert_response :ok
      assert_equal ticket_result(input.strip.downcase), response.parsed_body
    end
  end

  test "ticket numbers in a different tournament are not found" do
    other_tournament = @tournament.dup
    other_tournament.update!(organization: @other_organization, slug: "other-raffle", name: "Other Raffle")
    other_tournament.raffle_tickets.create!(ticket_number: "TIX-0014", purchaser_name: "Other Buyer", payment_status: "paid")

    check("TIX-0014")

    assert_response :ok
    assert_equal ticket_result("tix-0014"), response.parsed_body
  end

  test "rejects missing, blank, overly long, and non-string ticket numbers" do
    [nil, "   ", "A" * 65, ["TIX-0015"]].each do |input|
      check(input)
      assert_response :bad_request
    end
  end

  test "rejects a mismatched tenant host and an unpublished tournament" do
    ticket = create_ticket("TIX-0016")
    check(ticket.ticket_number, headers: { "X-Tenant-Host" => "other-raffle.example.com" })
    assert_response :not_found
    assert_private(ticket)

    @tournament.update!(public_listed: false)
    check(ticket.ticket_number)
    assert_response :not_found
    assert_private(ticket)
  end

  test "rejects lookup when the raffle feature is disabled" do
    ticket = create_ticket("TIX-0017")
    @tournament.update!(config: { "features" => { "raffle" => false } })

    check(ticket.ticket_number)

    assert_response :forbidden
    assert_equal "raffle", response.parsed_body["feature"]
    assert_private(ticket)
  end

  test "admin can claim and unclaim a won prize and repeating a claim preserves its timestamp" do
    prize = create_won_prize(create_ticket("TIX-0018"))

    assert_difference -> { ActivityLog.where(action: "raffle_prize_claimed", target_id: prize.id).count }, 1 do
      claim(prize)
      assert_response :ok
      assert_equal true, response.parsed_body.dig("prize", "claimed")
    end
    claimed_at = prize.reload.claimed_at
    assert_not_nil claimed_at

    travel 1.minute do
      assert_no_difference -> { ActivityLog.where(action: "raffle_prize_claimed", target_id: prize.id).count } do
        claim(prize, params: { claimed: true })
        assert_response :ok
      end
      assert_equal claimed_at, prize.reload.claimed_at
    end

    assert_difference -> { ActivityLog.where(action: "raffle_prize_unclaimed", target_id: prize.id).count }, 1 do
      claim(prize, params: { claimed: false })
      assert_response :ok
      assert_equal false, response.parsed_body.dig("prize", "claimed")
      assert_nil response.parsed_body.dig("prize", "claimed_at")
    end
    assert_not prize.reload.claimed?
    assert_nil prize.claimed_at
  end

  test "cannot claim a prize before it is won" do
    prize = @tournament.raffle_prizes.create!(name: "Early Prize", tier: "silver")

    assert_no_difference "ActivityLog.count" do
      claim(prize, params: { claimed: true })
      assert_response :unprocessable_entity
    end
    assert_not prize.reload.claimed?
  end

  test "claim requires tournament admin access and matching tenant host" do
    prize = create_won_prize(create_ticket("TIX-0019"))
    volunteer = User.create!(name: "Test Volunteer", email: "raffle-volunteer@example.com", clerk_id: "clerk_volunteer", role: "tournament_admin")
    OrganizationMembership.create!(user: volunteer, organization: @organization, role: "volunteer")

    claim(prize, headers: @host)
    assert_response :unauthorized

    claim(prize, headers: @host.merge("Authorization" => "Bearer test_token_#{volunteer.id}"))
    assert_response :forbidden

    claim(prize, headers: @admin_headers.merge("X-Tenant-Host" => "other-raffle.example.com"))
    assert_response :not_found

    outside_admin = User.create!(name: "Outside Admin", email: "raffle-admin@example.com", clerk_id: "clerk_outside_admin", role: "org_admin")
    OrganizationMembership.create!(user: outside_admin, organization: @other_organization, role: "admin")
    claim(prize, headers: @host.merge("Authorization" => "Bearer test_token_#{outside_admin.id}"))
    assert_response :forbidden
    assert_not prize.reload.claimed?
  end

  private

  def check(number, headers: @host)
    params = number.nil? ? {} : { ticket_number: number }
    get "/api/v1/tournaments/#{@tournament.id}/raffle/check_ticket", params: params, headers: headers
  end

  def claim(prize, params: {}, headers: @admin_headers)
    post "/api/v1/tournaments/#{@tournament.id}/raffle/prizes/#{prize.id}/claim",
         params: params, headers: headers, as: :json
  end

  def create_ticket(number, **attributes)
    @tournament.raffle_tickets.create!(
      ticket_number: number,
      purchaser_name: "Private Buyer",
      purchaser_email: "private-buyer@example.com",
      purchaser_phone: "+12025550131",
      payment_status: "paid",
      **attributes
    )
  end

  def create_won_prize(ticket)
    prize = @tournament.raffle_prizes.create!(
      name: "Golf Bag", tier: "gold", sponsor_name: "Example Sponsor", value_cents: 12450,
      won: true, won_at: Time.current, winning_ticket: ticket, winner_name: ticket.purchaser_name,
      winner_email: ticket.purchaser_email, winner_phone: ticket.purchaser_phone
    )
    ticket.update!(is_winner: true, raffle_prize: prize)
    prize
  end

  def ticket_result(number, found: false, eligible: false, status: "not_found", prize: nil)
    { "found" => found, "ticket_number" => number, "eligible" => eligible, "status" => status, "prize" => prize }
  end

  def assert_private(ticket)
    %w[purchaser_name purchaser_email purchaser_phone golfer_id registration_id team_member_id winner_name winner_email winner_phone].each do |key|
      refute_includes response.body, %("#{key}")
    end
    [ticket.purchaser_name, ticket.purchaser_email, ticket.purchaser_phone].each do |value|
      refute_includes response.body, value
    end
  end
end
