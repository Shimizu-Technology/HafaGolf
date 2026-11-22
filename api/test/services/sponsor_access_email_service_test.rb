require "test_helper"

class SponsorAccessEmailServiceTest < ActiveSupport::TestCase
  setup do
    @previous_resend_key = ENV["RESEND_API_KEY"]
    @previous_from = ENV["MAILER_FROM_EMAIL"]
    ENV["RESEND_API_KEY"] = "test_resend_key"
    ENV["MAILER_FROM_EMAIL"] = "noreply@example.com"

    @organization = Organization.create!(
      name: "Sponsor Service Test Org",
      slug: "sponsor-service-test-org-#{SecureRandom.hex(4)}"
    )
    @tournament = @organization.tournaments.create!(
      name: "Sponsor Service Invitational",
      slug: "sponsor-service-invitational-#{SecureRandom.hex(4)}",
      year: 2026,
      status: "open",
      registration_open: true
    )
    @sponsor = @tournament.sponsors.create!(
      name: "Gold Sponsor LLC",
      tier: "gold",
      position: 1,
      active: true,
      login_email: "portal@goldsponsor.example.com",
      slot_count: 2
    )
  end

  teardown do
    ENV["RESEND_API_KEY"] = @previous_resend_key
    ENV["MAILER_FROM_EMAIL"] = @previous_from
  end

  test "send_access_link renders token-bearing email and records accepted delivery" do
    captured_payload = nil
    token = "sponsor_token_abc123"

    with_singleton_method(Resend::Emails, :send, ->(payload) {
      captured_payload = payload
      { "id" => "email_sponsor_ok_123" }
    }) do
      result = SponsorAccessEmailService.send_access_link(sponsor: @sponsor, token: token)

      assert_equal true, result.fetch(:success)
      assert_equal "accepted", result.fetch(:status)
      assert_equal "email_sponsor_ok_123", result.fetch(:message_id)
    end

    assert_equal @sponsor.login_email, captured_payload.fetch(:to)
    assert_includes captured_payload.fetch(:html), token

    delivery = MessageDelivery.last
    assert_equal "accepted", delivery.status
    assert_equal "sponsor_portal_invite", delivery.purpose
    assert_equal "email_sponsor_ok_123", delivery.provider_message_id
    assert_equal @sponsor, delivery.messageable
  end

  test "send_access_link records Resend soft API error as failed" do
    with_singleton_method(Resend::Emails, :send, ->(*) {
      { "statusCode" => 422, "message" => "Domain not verified" }
    }) do
      result = SponsorAccessEmailService.send_access_link(sponsor: @sponsor, token: "sponsor_token_fail")

      assert_equal false, result.fetch(:success)
      assert_equal "failed", result.fetch(:status)
      assert_equal "Domain not verified", result.fetch(:error)
    end

    delivery = MessageDelivery.last
    assert_equal "failed", delivery.status
    assert_equal "Domain not verified", delivery.error_text
    assert delivery.failed_at.present?
  end

  private

  def with_singleton_method(klass, method_name, replacement)
    original = klass.method(method_name)
    klass.define_singleton_method(method_name, &replacement)
    yield
  ensure
    klass.define_singleton_method(method_name) do |*args, **kwargs, &block|
      original.call(*args, **kwargs, &block)
    end
  end
end
