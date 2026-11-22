# frozen_string_literal: true

require "test_helper"

class RaffleTicketTest < ActiveSupport::TestCase
  setup do
    @org = Organization.create!(
      name: "Pacific Charity Golf Foundation",
      slug: "pacific-charity-golf-#{SecureRandom.hex(4)}"
    )
    @tournament_2026 = @org.tournaments.create!(
      name: "Annual Charity Open 2026",
      slug: "annual-charity-open-2026-#{SecureRandom.hex(4)}",
      year: 2026,
      status: "open"
    )
    @tournament_2027 = @org.tournaments.create!(
      name: "Annual Charity Open 2027",
      slug: "annual-charity-open-2027-#{SecureRandom.hex(4)}",
      year: 2027,
      status: "draft"
    )
  end

  test "generates ticket numbers with 2-digit year prefix and succeeds across tournament years in same org" do
    legacy_ticket = @tournament_2026.raffle_tickets.create!(
      ticket_number: "PCGF-0001",
      sequence_number: 1,
      purchaser_name: "Legacy Buyer",
      payment_status: "paid"
    )

    ticket_2026 = @tournament_2026.raffle_tickets.create!(
      purchaser_name: "2026 Buyer",
      payment_status: "paid"
    )
    ticket_2027 = @tournament_2027.raffle_tickets.create!(
      purchaser_name: "2027 Buyer",
      payment_status: "paid"
    )

    assert_equal "PCGF-0001", legacy_ticket.reload.ticket_number
    assert_equal "PCGF26-0002", ticket_2026.ticket_number
    assert_equal 2, ticket_2026.sequence_number
    assert_equal "PCGF27-0001", ticket_2027.ticket_number
    assert_equal 1, ticket_2027.sequence_number
  end

  test "falls back cleanly without year suffix when tournament year is nil" do
    unsaved_tournament = @org.tournaments.build(name: "Undated Event", year: nil, status: "draft")
    ticket = RaffleTicket.new(tournament: unsaved_tournament, purchaser_name: "No Year Buyer", payment_status: "paid")

    assert_equal "PCGF", ticket.send(:ticket_prefix)
  end

  test "two distinct organizations with identical prefixes can both issue ticket 0001 without collision" do
    org_a = Organization.create!(
      name: "Island Golf Classic Association",
      slug: "island-golf-a-#{SecureRandom.hex(4)}"
    )
    org_b = Organization.create!(
      name: "Island Golf Classic Alliance",
      slug: "island-golf-b-#{SecureRandom.hex(4)}"
    )

    tournament_a = org_a.tournaments.create!(
      name: "Classic 2027 A",
      slug: "classic-2027-a-#{SecureRandom.hex(4)}",
      year: 2027,
      status: "open"
    )
    tournament_b = org_b.tournaments.create!(
      name: "Classic 2027 B",
      slug: "classic-2027-b-#{SecureRandom.hex(4)}",
      year: 2027,
      status: "open"
    )

    ticket_a = tournament_a.raffle_tickets.create!(purchaser_name: "Buyer A", payment_status: "paid")
    ticket_b = tournament_b.raffle_tickets.create!(purchaser_name: "Buyer B", payment_status: "paid")

    assert_equal "IGCA27-0001", ticket_a.ticket_number
    assert_equal "IGCA27-0001", ticket_b.ticket_number
    assert_not_equal ticket_a.tournament_id, ticket_b.tournament_id
  end

  test "rejects duplicate ticket_number within the same tournament at both model and database levels" do
    @tournament_2027.raffle_tickets.create!(
      ticket_number: "PCGF27-0001",
      sequence_number: 1,
      purchaser_name: "First Buyer",
      payment_status: "paid"
    )

    duplicate = @tournament_2027.raffle_tickets.build(
      ticket_number: "PCGF27-0001",
      sequence_number: 2,
      purchaser_name: "Duplicate Buyer",
      payment_status: "paid"
    )

    assert_not duplicate.valid?
    assert_includes duplicate.errors[:ticket_number], "has already been taken"

    assert_raises(ActiveRecord::RecordNotUnique) do
      duplicate.save!(validate: false)
    end
  end

  test "golfer with 7-digit phone still receives complimentary and purchased raffle tickets cleanly" do
    @tournament_2027.update!(
      raffle_enabled: true,
      raffle_ticket_price_cents: 500,
      config: (@tournament_2027.config || {}).merge("raffle_include_with_registration" => true)
    )

    golfer = @tournament_2027.golfers.create!(
      name: "Local Golfer",
      email: "local-golfer@example.com",
      phone: "555-1234",
      partner_name: "Local Partner",
      partner_phone: "555-5678",
      payment_type: "pay_on_day",
      payment_status: "paid",
      registration_status: "confirmed",
      waiver_accepted_at: Time.current,
      team_category: "Male",
      raffle_tickets_requested: 2
    )

    assert_nothing_raised do
      golfer.create_raffle_tickets!
      golfer.create_purchased_raffle_tickets!
    end

    complimentary = @tournament_2027.raffle_tickets.where(golfer_id: golfer.id, price_cents: [ 0, nil ]).order(:id)
    purchased = @tournament_2027.raffle_tickets.where(golfer_id: golfer.id).where("price_cents > 0")

    assert_equal 2, complimentary.count
    assert_equal "555-1234", complimentary.first.purchaser_phone
    assert_equal "555-5678", complimentary.second.purchaser_phone
    assert_equal 2, purchased.count
    assert_equal [ "555-1234" ], purchased.pluck(:purchaser_phone).uniq
  end

  test "golfer with valid 10-digit phone gets normalized E164 phone on raffle tickets" do
    @tournament_2027.update!(
      raffle_enabled: true,
      config: (@tournament_2027.config || {}).merge("raffle_include_with_registration" => true)
    )

    golfer = @tournament_2027.golfers.create!(
      name: "Normalized Golfer",
      email: "norm-golfer@example.com",
      phone: "671-555-1234",
      payment_type: "pay_on_day",
      payment_status: "paid",
      registration_status: "confirmed",
      waiver_accepted_at: Time.current,
      team_category: "Male"
    )

    golfer.create_raffle_tickets!
    ticket = @tournament_2027.raffle_tickets.find_by!(golfer_id: golfer.id)
    assert_equal "+16715551234", ticket.purchaser_phone
  end
end
