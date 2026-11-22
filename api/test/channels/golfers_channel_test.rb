# frozen_string_literal: true

require "test_helper"

class GolfersChannelTest < ActionCable::Channel::TestCase
  test "subscribes and streams from accessible tournament channels" do
    admin = users(:super_admin)
    tournament = tournaments(:tournament_one)
    stub_connection current_admin: admin, current_organization: nil

    subscribe
    assert subscription.confirmed?
    assert_has_stream "golfers_channel_#{tournament.id}"
  end

  test "rejects org admin subscribing to another organization tournament golfers stream" do
    org_a = Organization.create!(name: "Org A Golfers", slug: "org-a-golfers-#{SecureRandom.hex(3)}")
    org_b = Organization.create!(name: "Org B Golfers", slug: "org-b-golfers-#{SecureRandom.hex(3)}")
    tournament_b = org_b.tournaments.create!(name: "Org B Cup", year: 2027, status: "open", registration_open: true)
    admin_a = User.create!(email: "admin-a-golfers-#{SecureRandom.hex(3)}@example.com", role: "org_admin", clerk_id: "clerk_#{SecureRandom.hex(4)}")
    org_a.add_admin(admin_a)

    stub_connection current_admin: admin_a, current_organization: nil

    subscribe tournament_id: tournament_b.id

    assert subscription.rejected?
  end

  test "rejects subscription when no authenticated admin is present" do
    stub_connection current_admin: nil, current_organization: nil

    subscribe
    assert subscription.rejected?
  end
end
