# frozen_string_literal: true

require "test_helper"

class Api::V1::PlatformControllerTest < ActionDispatch::IntegrationTest
  def setup
    super
    @super_admin = admins(:admin_one)
    @super_admin.update!(role: "super_admin", clerk_id: "clerk_super_#{@super_admin.id}")
    @org_admin = User.create!(
      email: "org-only-#{SecureRandom.hex(4)}@example.com",
      name: "Org Only",
      role: "org_admin",
      clerk_id: "clerk_org_only_#{SecureRandom.hex(4)}"
    )
    organizations(:org_one).add_admin(@org_admin)
  end

  test "blocks non-super-admins from platform overview and wizard" do
    authenticate_as(@org_admin)

    get "/api/v1/admin/platform/overview", headers: auth_headers
    assert_response :forbidden

    post "/api/v1/admin/platform/organizations",
         params: { organization: { name: "Blocked Org" } },
         as: :json,
         headers: auth_headers
    assert_response :forbidden
  end

  test "super admin loads overview with summary, organizations, and platform_collect settlements" do
    org = organizations(:org_one)
    pc = org.organization_payment_config || org.build_organization_payment_config
    pc.update!(payment_mode: "platform_collect", processor_provider: "stripe", platform_fee_per_registrant_cents: 400)

    authenticate_as(@super_admin)
    get "/api/v1/admin/platform/overview", headers: auth_headers
    assert_response :success

    data = JSON.parse(response.body)
    assert data["summary"]["total_orgs"] >= 1
    assert data["feature_catalog"].is_a?(Array)
    assert data["organizations"].any? { |o| o["slug"] == org.slug }
    assert data["settlements"].any? { |s| s["organization_slug"] == org.slug }
  end

  test "super admin wizard creates org with domain, modules, payment mode, homepage_config, and initial admins" do
    authenticate_as(@super_admin)

    post "/api/v1/admin/platform/organizations",
         params: {
           organization: {
             name: "Marianas Classic Golf",
             slug: "marianas-classic",
             primary_color: "#0F3D5E",
             accent_color: "#D4AF37",
             primary_domain: "marianasclassic.example.com",
             homepage_config: { archetype: "ceremonial-light", landing_mode: "direct_to_active_event" },
             features: { raffle: true, sponsors: true, donations: true },
             payment_config: { payment_mode: "platform_collect", processor_provider: "stripe", platform_fee_per_registrant_cents: 400 },
             admin_emails: ["chair@marianasclassic.example.com", "treasurer@marianasclassic.example.com"]
           }
         },
         as: :json,
         headers: auth_headers

    assert_response :created
    org = Organization.find_by!(slug: "marianas-classic")
    assert_equal "marianasclassic.example.com", org.primary_host
    assert_equal "direct_to_active_event", org.homepage_config["landing_mode"]
    assert_equal "platform_collect", org.effective_payment_config.payment_mode
    assert_equal 2, org.organization_memberships.where(role: "admin").count
    assert_equal true, Features.for(org).enabled?(:donations)
  end

  test "super admin updates org status, module overrides, and payment mode" do
    org = organizations(:org_one)
    authenticate_as(@super_admin)

    patch "/api/v1/admin/platform/organizations/#{org.slug}",
          params: {
            organization: {
              status: "offseason",
              features: { donations: true, raffle: false },
              payment_config: { payment_mode: "offline", processor_provider: "none" }
            }
          },
          as: :json,
          headers: auth_headers

    assert_response :success
    body = JSON.parse(response.body)["organization"]
    assert_equal "offseason", body["status"]
    assert_equal true, body["offseason_enabled"]
    assert_equal true, body["features"]["donations"]
    assert_equal false, body["features"]["raffle"]
    assert_equal "offline", body["payment_mode"]
  end
end
