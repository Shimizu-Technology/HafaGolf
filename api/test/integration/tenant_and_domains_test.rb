# frozen_string_literal: true

require "test_helper"

class TenantAndDomainsTest < ActionDispatch::IntegrationTest
  setup do
    @previous_admin_origin = ENV["ADMIN_ORIGIN"]
    @previous_frontend_url = ENV["FRONTEND_URL"]
    ENV["ADMIN_ORIGIN"] = "https://golf.shimizu-technology.com"
    ENV["FRONTEND_URL"] = "https://golf.shimizu-technology.com"

    @org_alpha = Organization.create!(
      name: "Alpha Golf Club",
      slug: "alpha-golf-#{SecureRandom.hex(3)}",
      primary_color: "#1e3a8a",
      offseason_enabled: false
    )
    @org_beta = Organization.create!(
      name: "Beta Charity Golf",
      slug: "beta-charity-#{SecureRandom.hex(3)}",
      primary_color: "#7f1d1d",
      offseason_enabled: true,
      offseason_title: "See you in 2027",
      offseason_message: "Registration opens next spring.",
      offseason_cta_label: "Visit Beta",
      offseason_cta_url: "https://beta.example.org"
    )

    @alpha_domain = @org_alpha.organization_domains.create!(
      hostname: "Alpha.Example.COM",
      is_primary: true,
      verified_at: Time.current
    )
    @beta_domain = @org_beta.organization_domains.create!(
      hostname: "https://beta.example.org:443/",
      is_primary: true,
      verified_at: Time.current
    )
  end

  teardown do
    ENV["ADMIN_ORIGIN"] = @previous_admin_origin
    ENV["FRONTEND_URL"] = @previous_frontend_url
    TenantCorsOrigins.invalidate!
  end

  test "hostname normalization strips scheme, port, path, and lowercases" do
    assert_equal "alpha.example.com", @alpha_domain.hostname
    assert_equal "beta.example.org", @beta_domain.hostname
  end

  test "two organizations on distinct hosts resolve independently via X-Tenant-Host" do
    get "/api/v1/tenant", headers: { "X-Tenant-Host" => "alpha.example.com" }
    assert_response :success
    alpha_json = JSON.parse(response.body)
    assert_equal "domain", alpha_json["resolved_by"]
    assert_equal @org_alpha.slug, alpha_json.dig("organization", "slug")
    assert_equal "alpha.example.com", alpha_json.dig("organization", "primary_host")
    assert_equal false, alpha_json.dig("organization", "offseason_enabled")

    get "/api/v1/tenant", headers: { "X-Tenant-Host" => "beta.example.org" }
    assert_response :success
    beta_json = JSON.parse(response.body)
    assert_equal "domain", beta_json["resolved_by"]
    assert_equal @org_beta.slug, beta_json.dig("organization", "slug")
    assert_equal true, beta_json.dig("organization", "offseason_enabled")
    assert_equal "See you in 2027", beta_json.dig("organization", "offseason_title")
  end

  test "unregistered host returns 404 on /api/v1/tenant" do
    get "/api/v1/tenant", headers: { "X-Tenant-Host" => "unknown.example.net" }
    assert_response :not_found
  end

  test "TenantCorsOrigins allows registered hosts and ADMIN_ORIGIN and rejects unregistered hosts" do
    TenantCorsOrigins.invalidate!

    assert TenantCorsOrigins.allowed?("https://golf.shimizu-technology.com")
    assert TenantCorsOrigins.allowed?("https://alpha.example.com")
    assert TenantCorsOrigins.allowed?("https://beta.example.org")
    assert_not TenantCorsOrigins.allowed?("https://evil.example.net")

    # Removing a domain invalidates cache and immediately revokes origin
    @beta_domain.destroy!
    assert_not TenantCorsOrigins.allowed?("https://beta.example.org")
  end

  test "OrgUrlBuilder uses organization primary host for public URLs and ADMIN_ORIGIN for admin URLs" do
    assert_equal "https://alpha.example.com/sponsor-portal?token=abc",
                 OrgUrlBuilder.public_url(@org_alpha, "/sponsor-portal?token=abc")
    assert_equal "https://golf.shimizu-technology.com/admin/login",
                 OrgUrlBuilder.admin_url("/admin/login")

    tournament = @org_alpha.tournaments.create!(
      name: "Alpha Classic",
      slug: "alpha-classic-2027",
      year: 2027,
      status: "open",
      registration_open: true
    )
    golfer = tournament.golfers.create!(
      name: "Player One",
      email: "player1@example.com",
      phone: "671-555-0100",
      team_category: "Co-Ed",
      payment_type: "pay_on_day",
      payment_status: "unpaid",
      registration_status: "confirmed",
      waiver_accepted_at: Time.current
    )
    golfer.generate_payment_token!
    golfer.generate_magic_link!

    assert_equal "https://alpha.example.com/pay/#{golfer.payment_token}", golfer.payment_link_url
    assert_equal "https://alpha.example.com/score/verify?token=#{golfer.magic_link_token}", golfer.magic_link_url
  end

  test "super admin can create organizations and manage domains while org admin is forbidden" do
    super_admin = User.create!(
      email: "super-tenant-#{SecureRandom.hex(4)}@example.com",
      role: "super_admin",
      clerk_id: "clerk_super_#{SecureRandom.hex(4)}"
    )
    org_admin = User.create!(
      email: "org-admin-tenant-#{SecureRandom.hex(4)}@example.com",
      role: "org_admin",
      clerk_id: "clerk_org_#{SecureRandom.hex(4)}"
    )
    @org_alpha.add_admin(org_admin)

    # Org admin cannot create orgs
    authenticate_as(org_admin)
    post "/api/v1/admin/organizations",
         params: { organization: { name: "Unauthorized Org" } },
         headers: auth_headers
    assert_response :forbidden

    # Super admin creates org with primary domain and initial admin
    authenticate_as(super_admin)
    post "/api/v1/admin/organizations",
         params: {
           organization: { name: "Island Invitational", primary_color: "#0f766e" },
           primary_domain: "island.example.com",
           admin_email: "owner-island@example.com"
         },
         headers: auth_headers
    assert_response :created
    created = JSON.parse(response.body)
    assert_equal "island.example.com", created["primary_host"]
    assert_equal 1, created["domains"].length
    assert_equal true, created["domains"].first["is_primary"]

    # Adding a second primary domain demotes the first
    post "/api/v1/admin/organizations/#{created['slug']}/domains",
         params: { domain: { hostname: "www.island.example.com", is_primary: true } },
         headers: auth_headers
    assert_response :created

    org = Organization.find_by_slug!(created["slug"])
    assert_equal "www.island.example.com", org.primary_host
    assert_equal 1, org.organization_domains.where(is_primary: true).count
  end

  test "users table enforces case-insensitive unique email index" do
    User.create!(
      email: "CaseTest@Example.com",
      clerk_id: "clerk_case_1_#{SecureRandom.hex(4)}",
      role: "org_admin"
    )

    assert_raises(ActiveRecord::RecordNotUnique) do
      User.connection.execute(
        "INSERT INTO users (email, clerk_id, role, created_at, updated_at) " \
        "VALUES ('casetest@example.com', 'clerk_case_2', 'org_admin', NOW(), NOW())"
      )
    end
  end
end
