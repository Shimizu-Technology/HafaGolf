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
    # Cross-tenant host mismatch must be rejected even for an otherwise authorized org admin.
    post "/api/v1/tournaments/#{@tournament_a.id}/sponsors/#{@sponsor.id}/portal_link",
         headers: auth_headers.merge("X-Tenant-Host" => "reef-portal.example.com")
    assert_response :not_found
    assert_nil @sponsor.reload.access_token

    # A tournament_admin without org-admin membership cannot mint portal links.
    tournament_helper = User.create!(
      email: "t-helper-#{SecureRandom.hex(3)}@example.com", name: "Event Helper",
      role: "tournament_admin", clerk_id: "clerk_th_#{SecureRandom.hex(4)}"
    )
    TournamentAssignment.create!(user: tournament_helper, tournament: @tournament_a)
    authenticate_as(tournament_helper)
    post "/api/v1/tournaments/#{@tournament_a.id}/sponsors/#{@sponsor.id}/portal_link", headers: auth_headers
    assert_response :forbidden
    assert_nil @sponsor.reload.access_token

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
    SponsorSlotSyncer.define_method(:sync_slots) { |_slots, **_opts| raise ActiveRecord::RecordInvalid, TeamMember.new }
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

  test "inactive sponsors and archived tournaments immediately lose portal access" do
    token = @sponsor.issue_portal_access_token!
    session = portal_session_for(@sponsor, host: "coral-portal.example.com")

    @sponsor.update!(active: false)
    get "/api/v1/sponsor_access/verify", params: { token: token }
    assert_response :unauthorized
    post "/api/v1/sponsor_access/confirm", params: { token: token, email: @shared_email }
    assert_response :unauthorized
    get "/api/v1/sponsor_slots", headers: { "X-Sponsor-Session" => session }
    assert_response :unauthorized
    get "/api/v1/sponsor_access/sponsorships", headers: { "X-Sponsor-Session" => session }
    assert_response :unauthorized
    post "/api/v1/sponsor_access/switch", params: { sponsor_id: @sponsor.id }, headers: { "X-Sponsor-Session" => session }
    assert_response :unauthorized

    @sponsor.update!(active: true)
    @tournament_a.update!(status: "archived")
    get "/api/v1/sponsor_slots", headers: { "X-Sponsor-Session" => session }
    assert_response :unauthorized
    post "/api/v1/sponsor_access/confirm", params: { token: token, email: @shared_email }
    assert_response :unauthorized
  end

  test "switching preserves the original session expiry and request_link keeps an existing valid token" do
    copied_token = @sponsor.issue_portal_access_token!
    post "/api/v1/sponsor_access/request_link", params: { email: @shared_email }
    assert_response :success
    assert_equal copied_token, @sponsor.reload.access_token, "request_link must not invalidate a still-valid copied link"

    session = portal_session_for(@sponsor, host: "coral-portal.example.com")
    original_exp = Sponsor.verify_portal_session_token(session).last

    travel 2.hours do
      post "/api/v1/sponsor_access/switch",
           params: { sponsor_id: @sponsor_next.id },
           headers: { "X-Sponsor-Session" => session, "X-Tenant-Host" => "coral-portal.example.com" }
      assert_response :success
      switched_exp = Sponsor.verify_portal_session_token(response.parsed_body["session_token"]).last
      assert_equal original_exp.to_i, switched_exp.to_i
    end
  end

  test "roster sync preserves existing shirt/handicap and staff payment status, clears waiver on replacement, and protects checked-in players" do
    session = portal_session_for(@sponsor)
    first, second = slots_for(@sponsor)

    patch "/api/v1/sponsor_slots/batch",
          params: { slots: [
            { id: first.id, player_name: "Ana Cruz", player_email: "ana@example.com", tshirt_size: "L", handicap: 14.5 },
            { id: second.id, player_name: "Ben Santos", tshirt_size: "M", handicap: 10.0 }
          ] },
          headers: { "X-Sponsor-Session" => session }, as: :json
    assert_response :success

    registration = @tournament_a.registrations.find_by!(sponsor_id: @sponsor.id, team_name: "Harbor Bank - Team 1")
    golfer = @tournament_a.golfers.find_by!(sponsor_id: @sponsor.id, team_name: "Harbor Bank - Team 1")
    member_one = registration.team_members.find_by!(sponsor_slot_id: first.id)
    member_two = registration.team_members.find_by!(sponsor_slot_id: second.id)

    # Simulate pre-migration legacy slots with nil shirt/handicap while roster already has values, plus staff refund.
    first.update_columns(tshirt_size: nil, handicap: nil)
    second.update_columns(tshirt_size: nil, handicap: nil)
    member_one.update_columns(waiver_accepted_at: Time.current, magic_link_token: "tok_old", magic_link_expires_at: 1.day.from_now)
    registration.update_columns(payment_status: "refunded")
    golfer.update_columns(payment_status: "refunded")

    # Saving team without touching shirt/handicap preserves teammate's values and staff payment_status.
    patch "/api/v1/sponsor_slots/batch",
          params: { slots: [
            { id: first.id, player_name: "Ana Cruz", player_email: "ana@example.com", player_phone: "671-555-9999", tshirt_size: nil, handicap: nil },
            { id: second.id, player_name: "Ben Santos", player_email: nil, player_phone: nil, tshirt_size: nil, handicap: nil }
          ] },
          headers: { "X-Sponsor-Session" => session }, as: :json
    assert_response :success
    assert_equal "L", member_one.reload.tshirt_size
    assert_equal BigDecimal("14.5"), member_one.handicap
    assert_equal "M", member_two.reload.tshirt_size
    assert_equal "L", golfer.reload.tshirt_size
    assert_equal "M", golfer.partner_tshirt_size
    assert_equal "refunded", registration.reload.payment_status
    assert_equal "refunded", golfer.payment_status

    # Replacing Ana Cruz with a different golfer clears the prior player's waiver and scoring credential.
    patch "/api/v1/sponsor_slots/batch",
          params: { slots: [
            { id: first.id, player_name: "Dana Lee", player_email: "dana@example.com", tshirt_size: nil, handicap: nil },
            { id: second.id, player_name: "Ben Santos", tshirt_size: nil, handicap: nil }
          ] },
          headers: { "X-Sponsor-Session" => session }, as: :json
    assert_response :success
    assert_equal "Dana Lee", member_one.reload.name
    assert_nil member_one.waiver_accepted_at
    assert_nil member_one.magic_link_token
    assert_nil member_one.tshirt_size

    # Once checked in, neither batch nor single-slot PATCH can silently replace or persist changes.
    member_one.check_in!
    patch "/api/v1/sponsor_slots/batch",
          params: { slots: [
            { id: first.id, player_name: "Someone Else" },
            { id: second.id, player_name: "Ben Santos" }
          ] },
          headers: { "X-Sponsor-Session" => session }, as: :json
    assert_response :unprocessable_entity
    assert_equal "Dana Lee", first.reload.player_name
    assert_equal "Dana Lee", member_one.reload.name

    patch "/api/v1/sponsor_slots/#{first.id}",
          params: { player_name: "Single Patch Intruder" },
          headers: { "X-Sponsor-Session" => session }, as: :json
    assert_response :unprocessable_entity
    assert_equal "Dana Lee", first.reload.player_name

    # Unrelated contact edit does not overwrite staff-entered shirt size or handicap.
    member_one.undo_check_in!
    member_one.update_columns(tshirt_size: "2XL", handicap: BigDecimal("8.5"))
    first.update_columns(tshirt_size: "M", handicap: BigDecimal("14.0"))
    patch "/api/v1/sponsor_slots/batch",
          params: { slots: [
            { id: first.id, player_name: "Dana Lee", player_email: "dana@example.com", player_phone: "671-555-7777", tshirt_size: "M", handicap: 14.0 },
            { id: second.id, player_name: "Ben Santos" }
          ] },
          headers: { "X-Sponsor-Session" => session }, as: :json
    assert_response :success
    assert_equal "2XL", member_one.reload.tshirt_size
    assert_equal BigDecimal("8.5"), member_one.handicap

    # Replacing a player without changing tshirt_size clears the stale value on the slot too so later saves never re-inherit it.
    first.update_columns(tshirt_size: "L", handicap: BigDecimal("11.0"))
    patch "/api/v1/sponsor_slots/batch",
          params: { slots: [
            { id: first.id, player_name: "Elena Cruz", player_email: "elena@example.com", tshirt_size: "L", handicap: 11.0 },
            { id: second.id, player_name: "Ben Santos" }
          ] },
          headers: { "X-Sponsor-Session" => session }, as: :json
    assert_response :success
    assert_nil first.reload.tshirt_size
    assert_nil first.handicap
    assert_nil member_one.reload.tshirt_size
    assert_nil member_one.handicap

    # Clearing an email on a checked-in player counts as an identity change and is blocked.
    member_one.check_in!
    patch "/api/v1/sponsor_slots/#{first.id}",
          params: { player_name: "Elena Cruz", player_email: nil },
          headers: { "X-Sponsor-Session" => session }, as: :json
    assert_response :unprocessable_entity
    assert_equal "elena@example.com", first.reload.player_email

    # Staff cancellation cannot be reopened by a subsequent portal save even after an earlier portal cancel.
    member_one.undo_check_in!
    registration.cancel!(reason: SponsorSlotSyncer::PORTAL_CANCEL_REASON)
    registration.update!(registration_status: "confirmed", refund_reason: nil, refunded_at: nil)
    registration.cancel!(admin: @admin_a, reason: "Withdrawn by committee")
    patch "/api/v1/sponsor_slots/batch",
          params: { slots: [
            { id: first.id, player_name: "Elena Cruz", player_email: "elena@example.com" },
            { id: second.id, player_name: "Ben Santos" }
          ] },
          headers: { "X-Sponsor-Session" => session }, as: :json
    assert_response :success
    assert_equal "cancelled", registration.reload.registration_status
  end

  test "lowering slot_count removes highest slots contiguously and reconciles the roster" do
    session = portal_session_for(@sponsor)
    s1, s2, s3, s4 = slots_for(@sponsor)

    patch "/api/v1/sponsor_slots/batch",
          params: { slots: [
            { id: s1.id, player_name: "Team One A" },
            { id: s2.id, player_name: "Team One B" },
            { id: s3.id, player_name: "Team Two A" },
            { id: s4.id, player_name: "Team Two B" }
          ] },
          headers: { "X-Sponsor-Session" => session }, as: :json
    assert_response :success
    assert_equal 2, @tournament_a.registrations.where(sponsor_id: @sponsor.id, registration_status: "confirmed").count

    @sponsor.update!(slot_count: 2)
    assert_equal [1, 2], @sponsor.sponsor_slots.order(:slot_number).pluck(:slot_number)
    team_two_reg = @tournament_a.registrations.find_by!(sponsor_id: @sponsor.id, team_name: "Harbor Bank - Team 2")
    assert_equal "cancelled", team_two_reg.registration_status
  end

  test "handicap_required is enforced on the API when saving filled sponsor slots" do
    @tournament_a.update!(handicap_required: true)
    session = portal_session_for(@sponsor)
    first, second = slots_for(@sponsor)

    patch "/api/v1/sponsor_slots/batch",
          params: { slots: [
            { id: first.id, player_name: "Ana Cruz", handicap: nil },
            { id: second.id, player_name: nil, handicap: nil }
          ] },
          headers: { "X-Sponsor-Session" => session }, as: :json
    assert_response :unprocessable_entity
    assert response.parsed_body["slot_errors"].key?(first.id.to_s)
  end
end
