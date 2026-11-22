# frozen_string_literal: true

require "test_helper"

class RaffleChannelTest < ActionCable::Channel::TestCase
  test "public guests can subscribe to listed active tournament raffle stream on matching tenant" do
    tournament = tournaments(:tournament_one)
    tournament.update!(public_listed: true, status: "open")
    stub_connection current_admin: nil, current_organization: tournament.organization

    subscribe tournament_id: tournament.id

    assert subscription.confirmed?
    assert_has_stream "tournament_#{tournament.id}_raffle"
  end

  test "rejects public guest subscribing to another organization tournament raffle stream" do
    org_a = Organization.create!(name: "Org A Raffle", slug: "org-a-raffle-#{SecureRandom.hex(3)}")
    org_b = Organization.create!(name: "Org B Raffle", slug: "org-b-raffle-#{SecureRandom.hex(3)}")
    tournament_b = org_b.tournaments.create!(name: "Org B Raffle Open", year: 2027, status: "open", public_listed: true)

    stub_connection current_admin: nil, current_organization: org_a

    subscribe tournament_id: tournament_b.id

    assert subscription.rejected?
  end

  test "rejects archived tournament raffle stream" do
    tournament = tournaments(:tournament_one)
    tournament.update!(public_listed: true, status: "archived")
    stub_connection current_admin: nil, current_organization: tournament.organization

    subscribe tournament_id: tournament.id

    assert subscription.rejected?
  end
end
