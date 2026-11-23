# frozen_string_literal: true

require "test_helper"

class SponsorPortalTeamSaveTest < ActionDispatch::IntegrationTest
  setup do
    @org_a = Organization.create!(name: "Coral Links Club", slug: "coral-links-#{SecureRandom.hex(3)}")
    @org_b = Organization.create!(name: "Reef Point Club", slug: "reef-point-#{SecureRandom.hex(3)}")
    @org_a.organization_domains.create!(hostname: "coral-portal.example.com", is_primary: true, verified_at: Time.current)
    @org_b.organization_domains.create!(hostname: "reef-portal.example.com", is_primary: true, verified_at: Time.current)

    @tournament_a = @org_a.tournaments.create!(
      name: "Coral Classic 2026", slug: "coral-classic-2026-#{SecureRandom.hex(2)}", year: 2026,
      status: "open", registration_open: true, public_listed: true, team_size: 2
    )
    @tournament_a_next = @org_a.tournaments.create!(
      name: "Coral Classic 2027", slug: "coral-classic-2027-#{SecureRandom.hex(2)}", year: 2027,
      status: "open", registration_open: true, public_listed: false, team_size: 4
    )
    @tournament_b = @org_b.tournaments.create!(
      name: "Reef Open 2026", slug: "reef-open-2026-#{SecureRandom.hex(2)}", year: 2026,
      status: "open", registration_open: true, public_listed: true, team_size: 2
    )

    @admin_a = User.create!(email: "admin-a-#{SecureRandom.hex(3)}@example.com", name: "Admin A",
                            role: "org_admin", clerk_id: "clerk_a_#{SecureRandom.hex(4)}")
    @org_a.add_admin(@admin_a)
    @admin_b = User.create!(email: "admin-b-#{SecureRandom.hex(3)}@example.com", name: "Admin B",
                            role: "org_admin", clerk_id: "clerk_b_#{SecureRandom.hex(4)}")
    @org_b.add_admin(@admin_b)

    @shared_email = "hr-#{SecureRandom.hex(3)}@sponsor.example.com"
    @sponsor = @tournament_a.sponsors.create!(name: "Harbor Bank", tier: "gold", active: true,
                                              login_email: @shared_email, slot_count: 4)
    @sponsor_next = @tournament_a_next.sponsors.create!(name: "Harbor Bank", tier: "gold", active: true,
                                                        login_email: @shared_email.upcase, slot_count: 4)
    @sponsor_other_org = @tournament_b.sponsors.create!(name: "Harbor Bank", tier: "gold", active: true,
                                                        login_email: @shared_email, slot_count: 2)
  end

  def portal_session_for(sponsor, host: nil)
    token = sponsor.generate_access_token!
    headers = host ? { "X-Tenant-Host" => host } : {}
    post "/api/v1/sponsor_access/confirm", params: { token: token, email: sponsor.login_email.downcase }, headers: headers
    assert_response :success
    response.parsed_body.fetch("session_token")
  end

  def slots_for(sponsor)
    sponsor.sponsor_slots.order(:slot_number).to_a
  end

  # ---------------------------------------------------------------------------
  # Admin: direct portal link
  # ---------------------------------------------------------------------------

  test "org admin can copy a direct portal link that is org-scoped, logged, and usable" do
    authenticate_as(@admin_a)

    assert_difference -> { ActivityLog.where(action: "sponsor_portal_link_copied").count }, 1 do
      post "/api/v1/tournaments/#{@tournament_a.id}/sponsors/#{@sponsor.id}/portal_link", headers: auth_headers
    end
    assert_response :success

    body = response.parsed_body
    @sponsor.reload
    assert_equal "https://coral-portal.example.com/sponsor-portal?token=#{@sponsor.access_token}", body["url"]
    assert_in_delta (Time.current + Sponsor::ACCESS_TOKEN_EXPIRY).to_i, Time.zone.parse(body["expires_at"]).to_i, 5
    assert @sponsor.portal_link_issued_at.present?

    log = ActivityLog.where(action: "sponsor_portal_link_copied").last
    assert_equal @org_a.id, log.organization_id
    assert_equal @tournament_a.id, log.tournament_id
    assert_equal "Sponsor", log.target_type
    assert_equal @sponsor.id, log.target_id
    refute_includes log.metadata.to_json, @sponsor.access_token, "raw token must never be logged"

    # Copying again keeps the same link working (no rotation of an already-sent link).
    post "/api/v1/tournaments/#{@tournament_a.id}/sponsors/#{@sponsor.id}/portal_link", headers: auth_headers
    assert_response :success
    assert_equal body["url"], response.parsed_body["url"]

    # The link still requires the sponsor's email before any player data is shown.
    token = @sponsor.reload.access_token
    get "/api/v1/sponsor_access/verify", params: { token: token }, headers: { "X-Tenant-Host" => "coral-portal.example.com" }
    assert_response :success
    assert_nil response.parsed_body["slots"]
    post "/api/v1/sponsor_access/confirm", params: { token: token, email: "someone-else@example.com" }
    assert_response :forbidden
  end

  test "portal link rejects other-org admins, anonymous callers, mismatched tournaments, and missing emails" do
    post "/api/v1/tournaments/#{@tournament_a.id}/sponsors/#{@sponsor.id}/portal_link"
    assert_response :unauthorized

    authenticate_as(@admin_b)
    assert_no_difference -> { ActivityLog.count } do
      post "/api/v1/tournaments/#{@tournament_a.id}/sponsors/#{@sponsor.id}/portal_link", headers: auth_headers
    end
    assert_includes [403, 404], response.status
    assert_nil response.parsed_body["url"]

    # Org B admin cannot reach an Org A sponsor through their own tournament id either.
    post "/api/v1/tournaments/#{@tournament_b.id}/sponsors/#{@sponsor.id}/portal_link", headers: auth_headers
    assert_response :not_found

    authenticate_as(@admin_a)
    @sponsor.update!(login_email: nil)
    post "/api/v1/tournaments/#{@tournament_a.id}/sponsors/#{@sponsor.id}/portal_link", headers: auth_headers
    assert_response :unprocessable_entity
    assert_nil @sponsor.reload.access_token
  end

  test "send portal invite emails only the chosen sponsor and is activity logged" do
    authenticate_as(@admin_a)
    previous_key = ENV["RESEND_API_KEY"]
    ENV.delete("RESEND_API_KEY")

    post "/api/v1/tournaments/#{@tournament_a.id}/sponsors/#{@sponsor.id}/send_portal_invite", headers: auth_headers
    assert_response :unprocessable_entity
    assert_match(/Copy Portal Link/, response.parsed_body["error"])
    log = ActivityLog.where(action: "sponsor_portal_invite_sent").last
    assert_equal false, log.metadata["success"]
    assert_nil @sponsor_next.reload.access_token, "other sponsorships sharing the email are untouched"
  ensure
    ENV["RESEND_API_KEY"] = previous_key if previous_key
  end

  # ---------------------------------------------------------------------------
  # Admin: manage listing vs public listing
  # ---------------------------------------------------------------------------

  test "admin manage listing includes fill progress and portal status while the public listing hides them" do
    slots_for(@sponsor).first(3).each_with_index { |slot, i| slot.update!(player_name: "Player #{i + 1}") }
    @sponsor.generate_access_token!
    @tournament_a.sponsors.create!(name: "Quiet Partner", tier: "silver", active: false, slot_count: 2)

    get "/api/v1/tournaments/#{@tournament_a.id}/sponsors/manage"
    assert_response :unauthorized

    authenticate_as(@admin_b)
    get "/api/v1/tournaments/#{@tournament_a.id}/sponsors/manage", headers: auth_headers
    assert_includes [403, 404], response.status

    authenticate_as(@admin_a)
    get "/api/v1/tournaments/#{@tournament_a.id}/sponsors/manage", headers: auth_headers
    assert_response :success
    body = response.parsed_body
    row = body["sponsors"].find { |s| s["id"] == @sponsor.id }
    assert_equal 3, row["slots_filled"]
    assert_equal 4, row["slot_count"]
    assert_equal true, row["has_active_portal_link"]
    assert row["portal_link_issued_at"].present?
    assert_equal @shared_email, row["login_email"]
    assert_equal 2, body["sponsors"].length, "inactive sponsors stay visible to admins"
    assert_equal({ "total_sponsors" => 2, "active_sponsors" => 1, "portal_slots_total" => 4, "portal_slots_filled" => 3 }, body["summary"])
    assert_equal 2, body.dig("tournament", "team_size")
    assert_equal "https://coral-portal.example.com/#{@tournament_a.slug}", body.dig("tournament", "public_page_url")

    get "/api/v1/tournaments/#{@tournament_a.id}/sponsors"
    assert_response :success
    public_row = response.parsed_body["sponsors"].find { |s| s["id"] == @sponsor.id }
    %w[login_email slots_filled has_active_portal_link payment_status payment_amount_cents].each do |field|
      refute public_row.key?(field), "public sponsor listing must not expose #{field}"
    end
  end

  # ---------------------------------------------------------------------------
  # Sponsor portal: batch team save
  # ---------------------------------------------------------------------------

  test "save team writes every player at once and syncs golfer plus registration team members" do
    session = portal_session_for(@sponsor)
    first, second = slots_for(@sponsor)

    patch "/api/v1/sponsor_slots/batch",
          params: { slots: [
            { id: first.id, player_name: " Ana Cruz ", player_email: "ANA@example.com", player_phone: "671-555-0001", tshirt_size: "l", handicap: 12.4 },
            { id: second.id, player_name: "Ben Santos", player_email: "", player_phone: "", tshirt_size: "XL", handicap: "" }
          ] },
          headers: { "X-Sponsor-Session" => session }, as: :json
    assert_response :success

    body = response.parsed_body
    assert_equal 2, body["filled_count"]
    assert_equal 4, body["slot_count"]
    assert_equal %w[Ana\ Cruz Ben\ Santos], body["slots"].pluck("player_name")
    assert_equal "L", body["slots"].first["tshirt_size"]
    assert_equal 12.4, body["slots"].first["handicap"]

    registration = @tournament_a.registrations.find_by!(sponsor_id: @sponsor.id, team_name: "Harbor Bank - Team 1")
    members = registration.team_members.order(:position)
    assert_equal ["Ana Cruz", "Ben Santos"], members.map(&:name)
    assert_equal ["L", "XL"], members.map(&:tshirt_size)
    assert_equal BigDecimal("12.4"), members.first.handicap
    assert_equal "ana@example.com", members.first.email
    assert_equal [first.id, second.id], members.map(&:sponsor_slot_id)

    golfer = @tournament_a.golfers.find_by!(sponsor_id: @sponsor.id, team_name: "Harbor Bank - Team 1")
    assert_equal "Ana Cruz", golfer.name
    assert_equal "Ben Santos", golfer.partner_name
    assert_equal "L", golfer.tshirt_size
    assert_equal "XL", golfer.partner_tshirt_size

    # The second team was not touched.
    refute @tournament_a.registrations.exists?(sponsor_id: @sponsor.id, team_name: "Harbor Bank - Team 2")

    get "/api/v1/sponsor_slots", headers: { "X-Sponsor-Session" => session }
    assert_response :success
    assert_equal 2, response.parsed_body.dig("tournament", "team_size")
    assert_equal false, response.parsed_body.dig("tournament", "handicap_required")
    assert_equal "XL", response.parsed_body["slots"].second["tshirt_size"]
  end

  test "save team is all-or-nothing on invalid players, foreign slots, and roster sync failures" do
    session = portal_session_for(@sponsor)
    first, second = slots_for(@sponsor)
    foreign_slot = slots_for(@sponsor_other_org).first

    patch "/api/v1/sponsor_slots/batch",
          params: { slots: [
            { id: first.id, player_name: "Ana Cruz" },
            { id: second.id, player_name: "Ben Santos", handicap: 99 }
          ] },
          headers: { "X-Sponsor-Session" => session }, as: :json
    assert_response :unprocessable_entity
    assert response.parsed_body["slot_errors"].key?(second.id.to_s)
    assert_nil first.reload.player_name

    patch "/api/v1/sponsor_slots/batch", params: { slots: ["not-a-player"] },
          headers: { "X-Sponsor-Session" => session }, as: :json
    assert_response :unprocessable_entity

    patch "/api/v1/sponsor_slots/batch",
          params: { slots: [{ id: first.id, player_name: "Ana Cruz" }, { id: foreign_slot.id, player_name: "Intruder" }] },
          headers: { "X-Sponsor-Session" => session }, as: :json
    assert_response :not_found
    assert_nil first.reload.player_name
    assert_nil foreign_slot.reload.player_name

    original = SponsorSlotSyncer.instance_method(:sync_slots)
    SponsorSlotSyncer.define_method(:sync_slots) { |_slots| raise ActiveRecord::RecordInvalid, TeamMember.new }
    begin
      patch "/api/v1/sponsor_slots/batch",
            params: { slots: [{ id: first.id, player_name: "Ana Cruz" }, { id: second.id, player_name: "Ben Santos" }] },
            headers: { "X-Sponsor-Session" => session }, as: :json
    ensure
      SponsorSlotSyncer.define_method(:sync_slots, original)
    end
    assert_response :unprocessable_entity
    assert_match(/Nothing was saved/, response.parsed_body["error"])
    assert_nil first.reload.player_name
    assert_nil second.reload.player_name
    refute @tournament_a.registrations.exists?(sponsor_id: @sponsor.id)
  end

  test "save team is locked after the edit deadline" do
    session = portal_session_for(@sponsor)
    @tournament_a.update!(sponsor_edit_deadline: 1.hour.ago)

    patch "/api/v1/sponsor_slots/batch",
          params: { slots: [{ id: slots_for(@sponsor).first.id, player_name: "Late Entry" }] },
          headers: { "X-Sponsor-Session" => session }, as: :json
    assert_response :forbidden
    assert_nil slots_for(@sponsor).first.player_name

    get "/api/v1/sponsor_slots", headers: { "X-Sponsor-Session" => session }
    assert_equal true, response.parsed_body.dig("tournament", "edit_deadline_passed")
  end

  # ---------------------------------------------------------------------------
  # Sponsor portal: multi-tournament switching (same org only)
  # ---------------------------------------------------------------------------

  test "sponsorships and switch stay inside the session's organization" do
    archived = @org_a.tournaments.create!(name: "Coral Classic 2025", slug: "coral-classic-2025-#{SecureRandom.hex(2)}",
                                          year: 2025, status: "archived", registration_open: false)
    archived_sponsor = archived.sponsors.create!(name: "Harbor Bank", tier: "gold", active: true,
                                                 login_email: @shared_email, slot_count: 2)
    other_email_sponsor = @tournament_a_next.sponsors.create!(name: "Different Co", tier: "gold", active: true,
                                                              login_email: "other@example.com", slot_count: 2)
    session = portal_session_for(@sponsor, host: "coral-portal.example.com")

    get "/api/v1/sponsor_access/sponsorships", headers: { "X-Sponsor-Session" => session, "X-Tenant-Host" => "coral-portal.example.com" }
    assert_response :success
    listed = response.parsed_body["sponsorships"]
    assert_equal [@sponsor_next.id, @sponsor.id], listed.pluck("sponsor_id"), "newest event first, same org only"
    assert_equal [false, true], listed.pluck("current")
    assert_equal ["Coral Classic 2027", "Coral Classic 2026"], listed.pluck("tournament_name")

    [@sponsor_other_org.id, archived_sponsor.id, other_email_sponsor.id].each do |forbidden_id|
      post "/api/v1/sponsor_access/switch", params: { sponsor_id: forbidden_id }, headers: { "X-Sponsor-Session" => session }
      assert_response :not_found
      assert_nil response.parsed_body["session_token"]
    end

    post "/api/v1/sponsor_access/switch", params: { sponsor_id: @sponsor_next.id },
         headers: { "X-Sponsor-Session" => session, "X-Tenant-Host" => "coral-portal.example.com" }
    assert_response :success
    switched = response.parsed_body
    assert_equal @sponsor_next.id, switched.dig("sponsor", "id")
    assert_equal "Coral Classic 2027", switched.dig("tournament", "name")
    assert_equal 4, switched.dig("tournament", "team_size")

    get "/api/v1/sponsor_slots", headers: { "X-Sponsor-Session" => switched["session_token"] }
    assert_response :success
    assert_equal slots_for(@sponsor_next).map(&:id), response.parsed_body["slots"].pluck("id")

    # A session from Org A is rejected outright on Org B's host.
    get "/api/v1/sponsor_access/sponsorships", headers: { "X-Sponsor-Session" => session, "X-Tenant-Host" => "reef-portal.example.com" }
    assert_response :unauthorized
  end

  test "sponsorships require a portal session" do
    get "/api/v1/sponsor_access/sponsorships"
    assert_response :unauthorized

    post "/api/v1/sponsor_access/switch", params: { sponsor_id: @sponsor_next.id }, headers: { "X-Sponsor-Session" => "forged" }
    assert_response :unauthorized
  end
end
