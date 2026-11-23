# frozen_string_literal: true

require "test_helper"

class GolfersChannelTest < ActionCable::Channel::TestCase
  setup do
    @org = Organization.create!(name: "Channel Golf Org", slug: "channel-golf-org", subscription_status: "active")
    @t1 = @org.tournaments.create!(name: "Event One", slug: "event-one", year: 2026, status: "open")
    @t2 = @org.tournaments.create!(name: "Event Two", slug: "event-two", year: 2026, status: "open")

    @checkin_vol = User.create!(clerk_id: "clerk_gc_ci", email: "ci@channel.example.com", role: "tournament_admin")
    @org.organization_memberships.create!(user: @checkin_vol, role: "checkin_volunteer", scoped_tournament_ids: [@t1.id])

    @raffle_vol = User.create!(clerk_id: "clerk_gc_raf", email: "raf@channel.example.com", role: "tournament_admin")
    @org.organization_memberships.create!(user: @raffle_vol, role: "raffle_volunteer")
  end

  test "scoped checkin_volunteer can subscribe to scoped @t1 but is rejected for out-of-scope @t2" do
    stub_connection current_admin: @checkin_vol, current_organization: @org
    subscribe(tournament_id: @t1.id)
    assert subscription.confirmed?
    assert_has_stream "golfers_channel_#{@t1.id}"

    unsubscribe
    subscribe(tournament_id: @t2.id)
    assert subscription.rejected?
  end

  test "default subscription without tournament_id streams only authorized scoped tournaments" do
    stub_connection current_admin: @checkin_vol, current_organization: @org
    subscribe
    assert subscription.confirmed?
    assert_has_stream "golfers_channel_#{@t1.id}"
    assert_not_includes subscription.streams, "golfers_channel_#{@t2.id}"
  end

  test "raffle_volunteer is rejected from GolfersChannel both explicitly and on default stream" do
    stub_connection current_admin: @raffle_vol, current_organization: @org
    subscribe(tournament_id: @t1.id)
    assert subscription.rejected?

    subscribe
    assert subscription.rejected?
  end
end
