# frozen_string_literal: true

require "test_helper"

class FeaturesEnforcementTest < ActionDispatch::IntegrationTest
  setup do
    @org = Organization.create!(
      name: "Features Club",
      slug: "features-club-#{SecureRandom.hex(3)}",
      primary_color: "#0f766e"
    )
    @org.organization_domains.create!(hostname: "features-#{@org.slug}.example.com", is_primary: true)

    @tournament = @org.tournaments.create!(
      name: "Features Open",
      slug: "features-open-#{SecureRandom.hex(3)}",
      year: 2027,
      status: "open",
      registration_open: true,
      raffle_enabled: true,
      max_capacity: 100,
      entry_fee: 15000
    )

    @admin = User.create!(
      email: "features-admin-#{SecureRandom.hex(4)}@example.com",
      name: "Features Admin",
      clerk_id: "test_clerk_features_admin_#{SecureRandom.hex(4)}",
      role: "org_admin"
    )
    @org.add_admin(@admin)
    @admin_headers = { "Authorization" => "Bearer test_token_#{@admin.id}" }

    @volunteer = User.create!(
      email: "features-vol-#{SecureRandom.hex(4)}@example.com",
      name: "Features Volunteer",
      clerk_id: "test_clerk_features_vol_#{SecureRandom.hex(4)}",
      role: "org_admin"
    )
    @org.add_member(@volunteer, role: "volunteer")
    @volunteer_headers = { "Authorization" => "Bearer test_token_#{@volunteer.id}" }

    @other_org = Organization.create!(
      name: "Other Club",
      slug: "other-club-#{SecureRandom.hex(3)}"
    )
    @other_tournament = @other_org.tournaments.create!(
      name: "Other Event",
      slug: "other-event-#{SecureRandom.hex(3)}",
      year: 2027,
      status: "open",
      raffle_enabled: true
    )

    @group = @tournament.groups.create!(group_number: 1, hole_number: 1)
    @golfer = @tournament.golfers.create!(
      group: @group,
      name: "Scoring Golfer",
      email: "scoring-#{SecureRandom.hex(3)}@example.com",
      phone: "671-555-0101",
      payment_type: "pay_on_day",
      payment_status: "paid",
      registration_status: "confirmed",
      waiver_accepted_at: Time.current,
      team_category: "Co-Ed"
    )
    @golfer_headers = { "Authorization" => "Bearer #{GolferAuth.generate_token(@golfer)}" }

    @sponsor = @tournament.sponsors.create!(
      name: "Gold Sponsor",
      tier: "gold",
      position: 1,
      active: true,
      login_email: "sponsor-#{SecureRandom.hex(3)}@example.com",
      slot_count: 2
    )
    @sponsor_access_token = @sponsor.generate_access_token!
    @sponsor_session_token = @sponsor.generate_portal_session_token!(verified_email: @sponsor.login_email)
  end

  test "disabling raffle blocks public and admin raffle endpoints with 403 and tournament override re-enables" do
    # Enabled by default
    get "/api/v1/tournaments/#{@tournament.id}/raffle/board"
    assert_response :success

    # Disable at organization level
    @org.update!(settings: { "features" => { "raffle" => false } })

    get "/api/v1/tournaments/#{@tournament.id}/raffle/board"
    assert_feature_disabled_response("raffle")

    get "/api/v1/tournaments/#{@tournament.id}/raffle/prizes"
    assert_feature_disabled_response("raffle")

    post "/api/v1/tournaments/#{@tournament.id}/raffle/prizes",
         params: { prize: { name: "Blocked Prize", tier: "standard", value_cents: 5000 } },
         headers: @admin_headers
    assert_feature_disabled_response("raffle")

    get "/api/v1/tournaments/#{@tournament.id}/raffle/admin/tickets", headers: @volunteer_headers
    assert_feature_disabled_response("raffle")

    # Tournament override re-enables raffle over org false
    @tournament.update!(config: { "features" => { "raffle" => true } })

    get "/api/v1/tournaments/#{@tournament.id}/raffle/board"
    assert_response :success

    post "/api/v1/tournaments/#{@tournament.id}/raffle/prizes",
         params: { prize: { name: "Enabled Prize", tier: "standard", value_cents: 5000 } },
         headers: @admin_headers
    assert_response :created
  end

  test "legacy tournament.raffle_enabled == false blocks raffle endpoints when feature override is unset" do
    @tournament.update!(raffle_enabled: false, config: {})

    get "/api/v1/tournaments/#{@tournament.id}/raffle/board"
    assert_feature_disabled_response("raffle")

    post "/api/v1/tournaments/#{@tournament.id}/raffle/prizes",
         params: { prize: { name: "Blocked Legacy Prize", tier: "standard", value_cents: 5000 } },
         headers: @admin_headers
    assert_feature_disabled_response("raffle")
  end

  test "disabling live_scoring blocks public and authenticated scoring endpoints with 403" do
    # Enabled by default
    get "/api/v1/tournaments/#{@tournament.id}/scores/leaderboard"
    assert_response :success

    # Disable at tournament level
    @tournament.update!(config: { "features" => { "live_scoring" => false } })

    get "/api/v1/tournaments/#{@tournament.id}/scores"
    assert_feature_disabled_response("live_scoring")

    get "/api/v1/tournaments/#{@tournament.id}/scores/leaderboard"
    assert_feature_disabled_response("live_scoring")

    get "/api/v1/tournaments/#{@tournament.id}/scores/scorecard",
        params: { group_id: @group.id },
        headers: @golfer_headers
    assert_feature_disabled_response("live_scoring")

    post "/api/v1/tournaments/#{@tournament.id}/scores",
         params: { score: { hole: 1, strokes: 4, golfer_id: @golfer.id, group_id: @group.id } },
         headers: @golfer_headers,
         as: :json
    assert_feature_disabled_response("live_scoring")

    post "/api/v1/tournaments/#{@tournament.id}/scores/batch",
         params: { scores: [{ hole: 1, strokes: 4, golfer_id: @golfer.id, group_id: @group.id }] },
         headers: @admin_headers,
         as: :json
    assert_feature_disabled_response("live_scoring")
  end

  test "disabling sponsors blocks public, admin, sponsor access, and sponsor slot endpoints with 403" do
    # Enabled by default
    get "/api/v1/tournaments/#{@tournament.id}/sponsors"
    assert_response :success

    get "/api/v1/sponsor_slots", headers: { "X-Sponsor-Session" => @sponsor_session_token }
    assert_response :success

    # Disable at organization level
    @org.update!(settings: { "features" => { "sponsors" => false } })

    get "/api/v1/tournaments/#{@tournament.id}/sponsors"
    assert_feature_disabled_response("sponsors")

    get "/api/v1/tournaments/#{@tournament.id}/sponsors/by_hole"
    assert_feature_disabled_response("sponsors")

    post "/api/v1/tournaments/#{@tournament.id}/sponsors",
         params: { sponsor: { name: "Blocked Sponsor", tier: "gold" } },
         headers: @admin_headers
    assert_feature_disabled_response("sponsors")

    # request_link returns generic 200 without sending email or rotating token (no email-enumeration oracle)
    original_token = @sponsor.reload.access_token
    sent_count = 0
    stub = ->(sponsor:, token:) { sent_count += 1; { success: true } }
    original_send = SponsorAccessEmailService.method(:send_access_link)
    SponsorAccessEmailService.define_singleton_method(:send_access_link, stub)
    begin
      post "/api/v1/sponsor_access/request_link",
           params: { email: @sponsor.login_email }
    ensure
      SponsorAccessEmailService.define_singleton_method(:send_access_link, original_send)
    end
    assert_response :success
    assert_equal "If that email is associated with a sponsor account, you will receive an access link.",
                 JSON.parse(response.body)["message"]
    assert_equal 0, sent_count
    assert_equal original_token, @sponsor.reload.access_token

    get "/api/v1/sponsor_access/verify",
        params: { token: @sponsor_access_token }
    assert_feature_disabled_response("sponsors")

    post "/api/v1/sponsor_access/confirm",
         params: { token: @sponsor_access_token, email: @sponsor.login_email }
    assert_feature_disabled_response("sponsors")

    get "/api/v1/sponsor_slots", headers: { "X-Sponsor-Session" => @sponsor_session_token }
    assert_feature_disabled_response("sponsors")
  end

  test "admin features endpoints read, update, validate, enforce tenant isolation, and reflect in public payloads" do
    get "/api/v1/admin/organizations/#{@org.slug}/features", headers: @admin_headers
    assert_response :success
    body = JSON.parse(response.body)
    assert_equal GolfFeaturesCatalog.keys.sort, body["catalog"].map { |c| c["key"] }.sort
    assert_equal true, body.dig("organization", "features", "raffle")
    assert_equal false, body.dig("organization", "features", "tax_receipts")

    # Update organization defaults
    patch "/api/v1/admin/organizations/#{@org.slug}/features",
          params: { organization_features: { raffle: false, donations: true, offseason_mode: true } },
          headers: @admin_headers,
          as: :json
    assert_response :success
    updated = JSON.parse(response.body)
    assert_equal false, updated.dig("organization", "features", "raffle")
    assert_equal true, updated.dig("organization", "features", "donations")
    assert_equal true, updated.dig("organization", "features", "offseason_mode")
    assert_equal true, @org.reload.offseason_enabled

    # Tournament override layers on top of org override
    patch "/api/v1/admin/organizations/#{@org.slug}/features",
          params: { tournament_id: @tournament.id, tournament_features: { raffle: true, live_scoring: false } },
          headers: @admin_headers,
          as: :json
    assert_response :success
    t_payload = JSON.parse(response.body)["tournaments"].find { |t| t["id"] == @tournament.id }
    assert_equal true, t_payload.dig("features", "raffle")
    assert_equal false, t_payload.dig("features", "live_scoring")
    assert_equal true, t_payload.dig("features", "donations")

    # Public tenant, organization, tournament, and admin tournament endpoints all expose resolved features
    get "/api/v1/tenant", headers: { "X-Tenant-Host" => "features-#{@org.slug}.example.com" }
    assert_response :success
    assert_equal false, JSON.parse(response.body).dig("organization", "features", "raffle")
    assert_equal true, JSON.parse(response.body).dig("organization", "features", "donations")

    get "/api/v1/organizations/#{@org.slug}"
    assert_response :success
    assert_equal true, JSON.parse(response.body).dig("features", "donations")

    get "/api/v1/organizations/#{@org.slug}/tournaments/#{@tournament.slug}"
    assert_response :success
    assert_equal true, JSON.parse(response.body).dig("features", "raffle")
    assert_equal false, JSON.parse(response.body).dig("features", "live_scoring")

    get "/api/v1/admin/organizations/#{@org.slug}/tournaments", headers: @admin_headers
    assert_response :success
    admin_t = JSON.parse(response.body)["tournaments"].find { |t| t["id"] == @tournament.id }
    assert_equal true, admin_t.dig("features", "raffle")
    assert_equal false, admin_t.dig("features", "live_scoring")

    # Updating org settings preserves server settings["features"] even if stale features are sent,
    # and syncs offseason_mode when offseason_enabled changes
    patch "/api/v1/admin/organizations/#{@org.slug}",
          params: {
            organization: {
              name: "Features Club Updated",
              offseason_enabled: false,
              settings: {
                homepage_tagline: "Welcome",
                features: { raffle: true, donations: false }
              }
            }
          },
          headers: @admin_headers,
          as: :json
    assert_response :success
    assert_equal false, @org.reload.settings.dig("features", "raffle")
    assert_equal true, @org.settings.dig("features", "donations")
    assert_equal false, @org.offseason_enabled
    assert_equal false, @org.settings.dig("features", "offseason_mode")
    assert_equal false, Features.for(@org).enabled?(:offseason_mode)

    # Clearing tournament override with null reverts to org default (false), and later re-enabling
    # raffle at the org level allows the tournament to inherit true cleanly (P1 regression)
    patch "/api/v1/admin/organizations/#{@org.slug}/features",
          params: { tournament_id: @tournament.id, tournament_features: { raffle: nil } },
          headers: @admin_headers,
          as: :json
    assert_response :success
    cleared_t = JSON.parse(response.body)["tournaments"].find { |t| t["id"] == @tournament.id }
    assert_equal false, cleared_t.dig("features", "raffle")
    assert_not cleared_t.fetch("feature_overrides").key?("raffle")
    assert_equal false, Features.for(@org.reload, @tournament.reload).enabled?(:raffle)

    patch "/api/v1/admin/organizations/#{@org.slug}/features",
          params: { organization_features: { raffle: true } },
          headers: @admin_headers,
          as: :json
    assert_response :success
    assert_equal true, Features.for(@org.reload, @tournament.reload).enabled?(:raffle)
    get "/api/v1/tournaments/#{@tournament.id}/raffle/board"
    assert_response :success

    # Reject unknown feature key
    patch "/api/v1/admin/organizations/#{@org.slug}/features",
          params: { organization_features: { bogus_feature: true } },
          headers: @admin_headers,
          as: :json
    assert_response :unprocessable_entity

    # Reject non-boolean feature values
    patch "/api/v1/admin/organizations/#{@org.slug}/features",
          params: { organization_features: { raffle: "definitely" } },
          headers: @admin_headers,
          as: :json
    assert_response :unprocessable_entity

    patch "/api/v1/admin/organizations/#{@org.slug}/features",
          params: { tournament_id: @tournament.id, tournament_features: { live_scoring: 123 } },
          headers: @admin_headers,
          as: :json
    assert_response :unprocessable_entity

    # Reject org-only feature in tournament overrides
    patch "/api/v1/admin/organizations/#{@org.slug}/features",
          params: { tournament_id: @tournament.id, tournament_features: { offseason_mode: false } },
          headers: @admin_headers,
          as: :json
    assert_response :unprocessable_entity

    # Volunteer is forbidden from reading/updating org features
    get "/api/v1/admin/organizations/#{@org.slug}/features", headers: @volunteer_headers
    assert_response :forbidden

    patch "/api/v1/admin/organizations/#{@org.slug}/features",
          params: { organization_features: { raffle: true } },
          headers: @volunteer_headers,
          as: :json
    assert_response :forbidden

    # Cross-org isolation: org admin cannot read/update another org or another org's tournament
    get "/api/v1/admin/organizations/#{@other_org.slug}/features", headers: @admin_headers
    assert_response :forbidden

    patch "/api/v1/admin/organizations/#{@other_org.slug}/features",
          params: { organization_features: { raffle: false } },
          headers: @admin_headers,
          as: :json
    assert_response :forbidden

    patch "/api/v1/admin/organizations/#{@org.slug}/features",
          params: { tournament_id: @other_tournament.id, tournament_features: { raffle: false } },
          headers: @admin_headers,
          as: :json
    assert_response :not_found
  end

  private

  def assert_feature_disabled_response(feature_key)
    assert_response :forbidden
    json = JSON.parse(response.body)
    assert_equal feature_key, json["feature"]
    assert_equal "Feature '#{feature_key}' is disabled for this event", json["error"]
  end
end
