# frozen_string_literal: true

require "test_helper"

class GroupsChannelTest < ActionCable::Channel::TestCase
  test "subscribes authenticated admin to tournament-scoped groups streams" do
    admin = users(:super_admin)
    tournament = tournaments(:tournament_one)
    stub_connection current_admin: admin, current_organization: nil

    subscribe tournament_id: tournament.id

    assert subscription.confirmed?
    assert_has_stream "tournament_#{tournament.id}_groups"
  end

  test "rejects org admin subscribing to another organization tournament groups stream" do
    org_a = Organization.create!(name: "Org A Cable", slug: "org-a-cable-#{SecureRandom.hex(3)}")
    org_b = Organization.create!(name: "Org B Cable", slug: "org-b-cable-#{SecureRandom.hex(3)}")
    tournament_b = org_b.tournaments.create!(name: "Org B Open", year: 2027, status: "open", registration_open: true)
    admin_a = User.create!(email: "admin-a-cable-#{SecureRandom.hex(3)}@example.com", role: "org_admin", clerk_id: "clerk_#{SecureRandom.hex(4)}")
    org_a.add_admin(admin_a)

    stub_connection current_admin: admin_a, current_organization: nil

    subscribe tournament_id: tournament_b.id

    assert subscription.rejected?
  end

  test "rejects volunteer subscribing to groups stream" do
    org = Organization.create!(name: "Vol Org Cable", slug: "vol-org-cable-#{SecureRandom.hex(3)}")
    tournament = org.tournaments.create!(name: "Vol Open", year: 2027, status: "open", registration_open: true)
    volunteer = User.create!(email: "vol-cable-#{SecureRandom.hex(3)}@example.com", role: "tournament_admin", clerk_id: "clerk_#{SecureRandom.hex(4)}")
    org.add_member(volunteer, role: "volunteer")

    stub_connection current_admin: volunteer, current_organization: nil

    subscribe tournament_id: tournament.id

    assert subscription.rejected?
  end

  test "rejects subscription when no authenticated admin is present" do
    stub_connection current_admin: nil, current_organization: nil

    subscribe

    assert subscription.rejected?
  end
end
