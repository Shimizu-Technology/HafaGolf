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

  test "invite_html uses organization branding, logo, accessible color, and ADMIN_ORIGIN org link" do
    org = Organization.create!(
      name: "Pacific Crest Golf",
      slug: "pacific-crest-#{SecureRandom.hex(3)}",
      primary_color: "#1e3a8a",
      logo_url: "https://cdn.example.com/logo.png"
    )
    inviter = User.create!(
      email: "inviter-#{SecureRandom.hex(3)}@example.com",
      name: "Organizer Jane",
      role: "org_admin",
      clerk_id: "clerk_inviter_#{SecureRandom.hex(4)}"
    )
    invitee = User.create!(
      email: "invitee-#{SecureRandom.hex(3)}@example.com",
      role: "org_admin",
      clerk_id: "pending_#{SecureRandom.hex(6)}"
    )

    html = UserInviteEmailService.send(
      :invite_html,
      user: invitee,
      invited_by: inviter,
      role_label: "admin",
      org_name: org.name,
      brand_color: org.primary_color,
      org_slug: org.slug,
      logo_url: org.logo_url
    )

    assert_includes html, "Pacific Crest Golf"
    assert_includes html, "#1e3a8a"
    assert_includes html, "https://cdn.example.com/logo.png"
    assert_includes html, "https://golf.shimizu-technology.com/admin/login?org=#{org.slug}"
    assert_includes html, invitee.email
  end

  test "invite_html ignores unsafe logo URLs and falls back on low-contrast brand colors" do
    invitee = User.new(email: "volunteer@example.com")
    html = UserInviteEmailService.send(
      :invite_html,
      user: invitee,
      invited_by: nil,
      role_label: "volunteer",
      org_name: "Bright Charity",
      brand_color: "#ffffff",
      org_slug: "bright-charity",
      logo_url: "javascript:alert(1)"
    )

    assert_not_includes html, "javascript:"
    assert_includes html, "#0f172a"
    assert_includes html, "https://golf.shimizu-technology.com/admin/login?org=bright-charity"
  end
end
