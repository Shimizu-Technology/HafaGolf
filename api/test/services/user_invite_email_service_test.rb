# frozen_string_literal: true

require "test_helper"

class UserInviteEmailServiceTest < ActiveSupport::TestCase
  setup do
    @previous_admin_origin = ENV["ADMIN_ORIGIN"]
    ENV["ADMIN_ORIGIN"] = "https://golf.shimizu-technology.com"
  end

  teardown do
    ENV["ADMIN_ORIGIN"] = @previous_admin_origin
  end

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

  test "send invite records successful Resend responses as accepted with org logo and ADMIN_ORIGIN link" do
    previous_key = ENV["RESEND_API_KEY"]
    previous_from = ENV["RESEND_FROM_EMAIL"]
    ENV["RESEND_API_KEY"] = "test_resend_key"
    ENV["RESEND_FROM_EMAIL"] = "noreply@example.com"

    captured_payload = nil
    org = organizations(:org_one)
    org.update!(logo_url: "https://cdn.example.com/org-logo.png", primary_color: "#1e3a8a")

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
      assert_equal "support@shimizu-technology.com", captured_payload.fetch(:reply_to)

      html = captured_payload.fetch(:html)
      assert_includes html, "https://cdn.example.com/org-logo.png"
      assert_includes html, "https://golf.shimizu-technology.com/admin/login?org=#{org.slug}"
      assert_includes html, "background: #1e3a8a"
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

  test "invite_html accepts HTTPS logos and omits HTTP and unsafe logo URLs" do
    invitee = User.new(email: "volunteer@example.com")

    https_html = UserInviteEmailService.send(
      :invite_html,
      user: invitee,
      invited_by: nil,
      role_label: "volunteer",
      org_name: "Pacific Crest Golf",
      brand_color: "#1e3a8a",
      org_slug: "pacific-crest",
      logo_url: "https://cdn.example.com/logo.png"
    )
    assert_includes https_html, "https://cdn.example.com/logo.png"
    assert_includes https_html, "background: #1e3a8a"

    http_html = UserInviteEmailService.send(
      :invite_html,
      user: invitee,
      invited_by: nil,
      role_label: "volunteer",
      org_name: "Insecure Logo Org",
      brand_color: "#ffffff",
      org_slug: "insecure-logo",
      logo_url: "http://cdn.example.com/logo.png"
    )
    assert_not_includes http_html, "http://cdn.example.com/logo.png"
    assert_not_includes http_html, "<img "
    assert_includes http_html, "background: #0f172a"
    refute_includes http_html, "background: #ffffff; border-radius"

    js_html = UserInviteEmailService.send(
      :invite_html,
      user: invitee,
      invited_by: nil,
      role_label: "volunteer",
      org_name: "Bright Charity",
      brand_color: "#ffffff",
      org_slug: "bright-charity",
      logo_url: "javascript:alert(1)"
    )
    assert_not_includes js_html, "javascript:"
    assert_not_includes js_html, "<img "
    assert_includes js_html, "background: #0f172a"
    assert_includes js_html, "https://golf.shimizu-technology.com/admin/login?org=bright-charity"

    data_html = UserInviteEmailService.send(
      :invite_html,
      user: invitee,
      invited_by: nil,
      role_label: "volunteer",
      org_name: "Data URI Org",
      brand_color: "#1e3a8a",
      org_slug: "data-uri-org",
      logo_url: "data:image/svg+xml,<svg/>"
    )
    assert_not_includes data_html, "data:image"
    assert_not_includes data_html, "<img "
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
