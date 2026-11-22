require "test_helper"

class MessageDeliveryTrackerTest < ActiveSupport::TestCase
  test "create returns nil instead of blocking sends when tracking validation fails" do
    assert_nothing_raised do
      delivery = MessageDeliveryTracker.create!(
        provider: "unsupported",
        channel: "email",
        purpose: "sponsor_portal_invite",
        recipient: "sponsor@example.com"
      )
      assert_nil delivery
    end
  end

  test "normalize status maps provider statuses without unreachable exact branches" do
    assert_equal "accepted", MessageDelivery.normalize_status("sent")
    assert_equal "accepted", MessageDelivery.normalize_status("200")
    assert_equal "delivered", MessageDelivery.normalize_status("Message delivered to the handset")
    assert_equal "failed", MessageDelivery.normalize_status("undelivered")
    assert_equal "failed", MessageDelivery.normalize_status("Message not delivered")
    assert_equal "failed", MessageDelivery.normalize_status("THROTTLED")
    assert_equal "bounced", MessageDelivery.normalize_status("hard_bounce")
    assert_equal "delayed", MessageDelivery.normalize_status("delivery_delayed")
    assert_equal "complained", MessageDelivery.normalize_status("complaint")
    assert_equal "skipped", MessageDelivery.normalize_status("skipped")
    assert_equal "failed", MessageDelivery.normalize_status("invalid recipient")
  end

  test "nil delivery result marks an existing delivery as skipped and terminal" do
    delivery = MessageDelivery.create!(
      provider: "resend",
      channel: "email",
      purpose: "sponsor_portal_invite",
      recipient: "sponsor@example.com",
      status: "pending"
    )

    result = MessageDeliveryTracker.track_result!(delivery, nil)

    assert_equal false, result.fetch(:success)
    assert_equal "skipped", delivery.reload.status
    assert_equal "Delivery service not configured", delivery.error_text
    assert delivery.failed_at.present?
  end

  test "mark skipped stamps failed_at consistently" do
    delivery = MessageDelivery.create!(
      provider: "resend",
      channel: "email",
      purpose: "sponsor_portal_invite",
      recipient: "sponsor@example.com",
      status: "pending"
    )

    delivery.mark_skipped!("No configured provider")

    assert_equal "skipped", delivery.reload.status
    assert_equal "No configured provider", delivery.error_text
    assert delivery.failed_at.present?
  end

  test "raw string responses are wrapped before storing in response payload" do
    delivery = MessageDelivery.create!(
      provider: "clicksend",
      channel: "sms",
      purpose: "raffle_winner_notification",
      recipient: "+16715550123",
      status: "pending"
    )

    MessageDeliveryTracker.track_result!(
      delivery,
      { success: false, status: "failed", error: "http_500", raw_response: "upstream unavailable" }
    )

    delivery.reload
    assert_equal "failed", delivery.status
    assert_equal "upstream unavailable", delivery.response_payload.fetch("raw_response")
    assert delivery.failed_at.present?
  end

  test "create populates organization_id from explicit organization, tournament, or messageable" do
    org_one = organizations(:org_one)
    org_two = Organization.create!(name: "Second Golf Org", slug: "second-golf-org-#{SecureRandom.hex(4)}")
    tournament = tournaments(:tournament_one)
    ticket = tournament.raffle_tickets.create!(
      purchaser_name: "Tracker Buyer",
      payment_status: "paid"
    )

    from_tournament = MessageDeliveryTracker.create!(
      provider: "resend",
      channel: "email",
      purpose: "raffle_ticket_confirmation",
      recipient: "buyer@example.com",
      tournament: tournament
    )
    assert_equal tournament.organization_id, from_tournament.organization_id

    from_messageable = MessageDeliveryTracker.create!(
      provider: "resend",
      channel: "email",
      purpose: "raffle_ticket_confirmation",
      recipient: "buyer@example.com",
      messageable: ticket
    )
    assert_equal tournament.organization_id, from_messageable.organization_id

    from_org_messageable = MessageDeliveryTracker.create!(
      provider: "resend",
      channel: "email",
      purpose: "admin_invite",
      recipient: "admin@example.com",
      messageable: org_one
    )
    assert_equal org_one.id, from_org_messageable.organization_id

    from_explicit = MessageDeliveryTracker.create!(
      provider: "resend",
      channel: "email",
      purpose: "admin_invite",
      recipient: "admin2@example.com",
      organization: org_two,
      tournament: tournament
    )
    assert_equal org_two.id, from_explicit.organization_id
  end

  test "track_result does not regress delivered status or drop webhook events when webhook arrives first" do
    delivery = MessageDelivery.create!(
      provider: "resend",
      channel: "email",
      purpose: "raffle_ticket_confirmation",
      recipient: "race@example.com",
      status: "pending"
    )

    # Simulate webhook arriving before track_result!
    stale_handle = MessageDelivery.find(delivery.id)
    delivery.update!(provider_message_id: "email_fast_123")
    delivery.apply_provider_event!(
      status: "delivered",
      provider_status_text: "email.delivered",
      payload: { "type" => "email.delivered", "data" => { "email_id" => "email_fast_123" } },
      event_at: Time.current
    )

    MessageDeliveryTracker.track_result!(
      stale_handle,
      { success: true, status: "accepted", message_id: "email_fast_123", data: { "id" => "email_fast_123" } }
    )

    delivery.reload
    assert_equal "delivered", delivery.status
    assert delivery.delivered_at.present?
    assert_equal "email_fast_123", delivery.provider_message_id
    assert_equal 1, delivery.response_payload.fetch("events").length
    assert_equal "email_fast_123", delivery.response_payload.fetch("id")
  end
end
