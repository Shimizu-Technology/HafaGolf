# frozen_string_literal: true

require "test_helper"

class AdminMailerTest < ActionMailer::TestCase
  def setup
    @golfer = golfers(:confirmed_paid)
    @org = @golfer.tournament.organization
    @org.organization_memberships.where(role: "admin").delete_all
    @org.update!(contact_email: "admin-test@example.com")
    @previous_platform_admin = ENV["PLATFORM_ADMIN_EMAIL"]
    ENV["PLATFORM_ADMIN_EMAIL"] = nil
  end

  def teardown
    ENV["PLATFORM_ADMIN_EMAIL"] = @previous_platform_admin
  end

  test "notify_new_golfer" do
    mail = AdminMailer.notify_new_golfer(@golfer)

    assert_equal "New Golf Tournament Registration: #{@golfer.name}", mail.subject
    assert_equal ["admin-test@example.com"], mail.to
    assert_match @golfer.name, mail.body.encoded
    assert_match @golfer.email, mail.body.encoded
  end

  test "notify_new_golfer returns nil without admin emails" do
    @org.update!(contact_email: nil)
    mail = AdminMailer.notify_new_golfer(@golfer)

    assert_nil mail.to
  end

  test "notify_payment_received" do
    mail = AdminMailer.notify_payment_received(@golfer)

    assert_equal "Payment Received: #{@golfer.name}", mail.subject
    assert_equal ["admin-test@example.com"], mail.to
  end

  test "notify_new_registration_with_payment" do
    @golfer.update!(
      payment_type: "stripe",
      payment_status: "paid",
      payment_amount_cents: 12500,
      stripe_card_brand: "visa",
      stripe_card_last4: "4242"
    )

    mail = AdminMailer.notify_new_registration_with_payment(@golfer)

    assert_equal "New Registration & Payment: #{@golfer.name}", mail.subject
    assert_equal ["admin-test@example.com"], mail.to
    assert_match @golfer.name, mail.body.encoded
    assert_match @golfer.email, mail.body.encoded
    assert_match "Paid Online", mail.body.encoded
    assert_match "$125.00", mail.body.encoded
    assert_match "Visa", mail.body.encoded
    assert_match "4242", mail.body.encoded
  end

  test "notify_new_registration_with_payment returns nil without admin emails" do
    @org.update!(contact_email: nil)
    mail = AdminMailer.notify_new_registration_with_payment(@golfer)

    assert_nil mail.to
  end

  test "notify_new_registration_pending_payment" do
    unpaid_golfer = golfers(:confirmed_unpaid)

    mail = AdminMailer.notify_new_registration_pending_payment(unpaid_golfer)

    assert_equal "New Registration - Awaiting Payment: #{unpaid_golfer.name}", mail.subject
    assert_equal ["admin-test@example.com"], mail.to
    assert_match unpaid_golfer.name, mail.body.encoded
    assert_match unpaid_golfer.email, mail.body.encoded
    assert_match "Awaiting Payment", mail.body.encoded
  end

  test "notify_new_registration_pending_payment returns nil without admin emails" do
    @org.update!(contact_email: nil)
    unpaid_golfer = golfers(:confirmed_unpaid)

    mail = AdminMailer.notify_new_registration_pending_payment(unpaid_golfer)

    assert_nil mail.to
  end
end
