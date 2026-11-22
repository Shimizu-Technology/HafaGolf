require "test_helper"

class UserInviteEmailServiceTest < ActiveSupport::TestCase
  test "send invite records Resend soft API errors as failed" do
    previous_key = ENV["RESEND_API_KEY"]
    previous_from = ENV["RESEND_FROM_EMAIL"]
    ENV["RESEND_API_KEY"] = "test_resend_key"
    ENV["RESEND_FROM_EMAIL"] = "noreply@example.com"

    with_singleton_method(Resend::Emails, :send, ->(*) {
      { "statusCode" => 422, "message" => "Invalid email" }
    }) do
      result = UserInviteEmailService.send_invite(
        user: users(:user_no_clerk),
        invited_by: users(:user_one),
        role: "admin"
      )

      delivery = MessageDelivery.last
      assert_equal false, result
      assert_equal "failed", delivery.status
      assert_equal "admin_invite", delivery.purpose
      assert_equal "Invalid email", delivery.error_text
      assert_equal 422, delivery.response_payload.fetch("statusCode")
      assert delivery.failed_at.present?
    end
  ensure
    ENV["RESEND_API_KEY"] = previous_key
    ENV["RESEND_FROM_EMAIL"] = previous_from
  end

  test "send invite records successful Resend responses as accepted" do
    previous_key = ENV["RESEND_API_KEY"]
    previous_from = ENV["RESEND_FROM_EMAIL"]
    ENV["RESEND_API_KEY"] = "test_resend_key"
    ENV["RESEND_FROM_EMAIL"] = "noreply@example.com"

    captured_payload = nil
    org = organizations(:org_one)

    with_singleton_method(Resend::Emails, :send, ->(payload) {
      captured_payload = payload
      { "id" => "email_invite_123" }
    }) do
      result = UserInviteEmailService.send_invite(
        user: users(:user_no_clerk),
        invited_by: users(:user_one),
        role: "admin",
        organization: org
      )

      delivery = MessageDelivery.last
      assert_equal true, result
      assert_equal "accepted", delivery.status
      assert_equal "admin_invite", delivery.purpose
      assert_equal "email_invite_123", delivery.provider_message_id
      assert_equal org.id, delivery.organization_id
      assert_equal [ { name: "delivery_id", value: delivery.id.to_s } ], captured_payload.fetch(:tags)
    end
  ensure
    ENV["RESEND_API_KEY"] = previous_key
    ENV["RESEND_FROM_EMAIL"] = previous_from
  end

  test "send invite returns false after recording Resend exceptions" do
    previous_key = ENV["RESEND_API_KEY"]
    previous_from = ENV["RESEND_FROM_EMAIL"]
    ENV["RESEND_API_KEY"] = "test_resend_key"
    ENV["RESEND_FROM_EMAIL"] = "noreply@example.com"

    with_singleton_method(Resend::Emails, :send, ->(*) {
      raise Timeout::Error, "Resend timeout"
    }) do
      result = UserInviteEmailService.send_invite(
        user: users(:user_no_clerk),
        invited_by: users(:user_one),
        role: "admin"
      )

      delivery = MessageDelivery.last
      assert_equal false, result
      assert_equal "failed", delivery.status
      assert_equal "Resend timeout", delivery.error_text
    end
  ensure
    ENV["RESEND_API_KEY"] = previous_key
    ENV["RESEND_FROM_EMAIL"] = previous_from
  end

  test "send invite falls back to dark color for low-contrast light brand colors and preserves dark brand colors" do
    previous_key = ENV["RESEND_API_KEY"]
    previous_from = ENV["RESEND_FROM_EMAIL"]
    ENV["RESEND_API_KEY"] = "test_resend_key"
    ENV["RESEND_FROM_EMAIL"] = "noreply@example.com"

    captured_html = []
    light_org = Organization.create!(name: "Light Brand Org", slug: "light-brand-org", primary_color: "#ffffff")
    dark_org = Organization.create!(name: "Dark Brand Org", slug: "dark-brand-org", primary_color: "#1e3a8a")

    with_singleton_method(Resend::Emails, :send, ->(payload) {
      captured_html << payload.fetch(:html)
      { "id" => "email_color_test" }
    }) do
      UserInviteEmailService.send_invite(user: users(:user_no_clerk), invited_by: users(:user_one), organization: light_org)
      UserInviteEmailService.send_invite(user: users(:user_no_clerk), invited_by: users(:user_one), organization: dark_org)
    end

    assert_includes captured_html[0], "background: #0f172a"
    refute_includes captured_html[0], "background: #ffffff; border-radius"
    assert_includes captured_html[1], "background: #1e3a8a"
  ensure
    ENV["RESEND_API_KEY"] = previous_key
    ENV["RESEND_FROM_EMAIL"] = previous_from
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
