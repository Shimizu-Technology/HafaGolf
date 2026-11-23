# frozen_string_literal: true

require "test_helper"

class AddonsAndSponsorCheckTest < ActionDispatch::IntegrationTest
  setup do
    @org = Organization.create!(
      name: "Pacific Charity Club",
      slug: "pacific-charity-#{SecureRandom.hex(3)}",
      primary_color: "#1B3A4B",
      subscription_status: "active",
      settings: {
        "features" => {
          "sponsors" => true,
          "sponsor_checkout" => true
        }
      }
    )
    @org.organization_domains.create!(hostname: "club-#{@org.slug}.example.com", is_primary: true)
    @org.create_organization_payment_config!(
      payment_mode: "offline",
      processor_provider: "none",
      test_mode: false
    )

    @tournament = @org.tournaments.create!(
      name: "Pacific Charity Classic 2027",
      slug: "charity-classic-#{SecureRandom.hex(2)}",
      year: 2027,
      status: "open",
      registration_open: true,
      public_listed: true,
      entry_fee: 15_000,
      max_capacity: 144,
      team_size: 2,
      capacity_unit: "teams",
      allow_partial_teams: true,
      waiver_enabled: true,
      checks_payable_to: "Pacific Charity Foundation",
      allow_sponsor_check_invoice: true
    )

    @org_admin = User.create!(
      clerk_id: "clerk_v35_admin_#{SecureRandom.hex(3)}",
      email: "admin-#{SecureRandom.hex(3)}@charity.example.com",
      name: "Club Admin",
      role: "org_admin"
    )
    @org.organization_memberships.create!(user: @org_admin, role: "org_admin")

    @checkin_vol = User.create!(
      clerk_id: "clerk_v35_vol_#{SecureRandom.hex(3)}",
      email: "vol-#{SecureRandom.hex(3)}@charity.example.com",
      name: "Check-In Volunteer",
      role: "tournament_admin"
    )
    @org.organization_memberships.create!(user: @checkin_vol, role: "checkin_volunteer")
  end

  def headers_for(user)
    { "Authorization" => "Bearer test_token_#{user.id}" }
  end

  test "add-on CRUD enforces manage_settings RBAC and public index returns active items only" do
    # Check-in volunteer cannot create add-ons
    post "/api/v1/tournaments/#{@tournament.id}/add_ons",
         params: { add_on: { name: "Mulligan Pack", price_cents: 2_000, category: "mulligans" } },
         headers: headers_for(@checkin_vol),
         as: :json
    assert_response :forbidden

    # Org admin creates active and inactive add-ons
    post "/api/v1/tournaments/#{@tournament.id}/add_ons",
         params: {
           add_on: {
             name: "Mulligan Pack",
             description: "2 mulligans per pack",
             price_cents: 2_000,
             max_quantity_per_order: 2,
             max_total_quantity: 5,
             category: "mulligans",
             active: true
           }
         },
         headers: headers_for(@org_admin),
         as: :json
    assert_response :created
    active_add_on = JSON.parse(response.body)["add_on"]
    assert_equal "Mulligan Pack", active_add_on["name"]
    assert_equal 2_000, active_add_on["price_cents"]
    assert_equal 0, active_add_on["sold_quantity"]

    post "/api/v1/tournaments/#{@tournament.id}/add_ons",
         params: {
           add_on: {
             name: "Hidden VIP Pack",
             price_cents: 10_000,
             category: "super_ticket",
             active: false
           }
         },
         headers: headers_for(@org_admin),
         as: :json
    assert_response :created
    hidden_add_on = JSON.parse(response.body)["add_on"]

    # Public index only exposes active items and omits admin sold_quantity
    get "/api/v1/tournaments/#{@tournament.id}/add_ons"
    assert_response :success
    public_list = JSON.parse(response.body)["add_ons"]
    assert_equal [active_add_on["id"]], public_list.map { |a| a["id"] }
    assert_nil public_list.first["sold_quantity"]
    assert_equal 5, public_list.first["remaining_quantity"]

    # Admin index exposes both active and inactive + sold_quantity
    get "/api/v1/tournaments/#{@tournament.id}/add_ons", headers: headers_for(@org_admin)
    assert_response :success
    admin_list = JSON.parse(response.body)["add_ons"]
    assert_equal 2, admin_list.length
    assert_includes admin_list.map { |a| a["id"] }, hidden_add_on["id"]

    # Unused add-on is hard-deleted
    delete "/api/v1/tournaments/#{@tournament.id}/add_ons/#{hidden_add_on['id']}", headers: headers_for(@org_admin)
    assert_response :success
    assert_equal true, JSON.parse(response.body)["deleted"]
    assert_not TournamentAddOn.exists?(hidden_add_on["id"])
  end

  test "registration with add-ons enforces limits, snapshots server prices, surfaces check-in badge, and soft-deactivates purchased add-ons" do
    mulligan = @tournament.tournament_add_ons.create!(
      organization: @org,
      name: "Mulligan Pack",
      price_cents: 2_000,
      max_quantity_per_order: 2,
      max_total_quantity: 3,
      category: "mulligans",
      active: true,
      sort_order: 0
    )
    super_ticket = @tournament.tournament_add_ons.create!(
      organization: @org,
      name: "Super Ticket Bundle",
      price_cents: 5_000,
      max_quantity_per_order: 2,
      category: "super_ticket",
      active: true,
      sort_order: 1
    )

    # Rejects duplicate array entries attempting to exceed max_quantity_per_order
    post "/api/v1/tournaments/#{@tournament.id}/registrations",
         params: {
           organization_slug: @org.slug,
           registration: {
             team_name: "Over Limit Team",
             payment_type: "pay_on_day",
             team_members: [
               { name: "Alex Cruz", email: "alex-over@example.com", phone: "+16715550101", waiver_accepted: true }
             ]
           },
           add_ons: [
             { add_on_id: mulligan.id, quantity: 2 },
             { add_on_id: mulligan.id, quantity: 1 }
           ]
         },
         as: :json
    assert_response :unprocessable_entity
    assert_match(/limited to 2/i, JSON.parse(response.body)["errors"].join(" "))

    # Valid registration with 2x Mulligan Pack ($40) + 1x Super Ticket Bundle ($50) + $150 entry = $240
    # Client-supplied bogus unit_price_cents must be completely ignored
    post "/api/v1/tournaments/#{@tournament.id}/registrations",
         params: {
           organization_slug: @org.slug,
           registration: {
             team_name: "Island Eagles",
             payment_type: "pay_on_day",
             team_members: [
               { name: "Kai Santos", email: "kai@example.com", phone: "+16715550102", waiver_accepted: true }
             ]
           },
           add_ons: [
             { add_on_id: mulligan.id, quantity: 2, unit_price_cents: 1 },
             { add_on_id: super_ticket.id, quantity: 1, unit_price_cents: 1 }
           ]
         },
         as: :json
    assert_response :created
    reg_json = JSON.parse(response.body)["registration"]
    assert_equal 9_000, reg_json["add_ons_total_cents"]
    assert_equal 24_000, reg_json["payment_amount_cents"]
    assert_equal "2× Mulligan Pack · 1× Super Ticket Bundle", reg_json["add_ons_summary"]

    # Price change on add-on later must not alter historical snapshot
    mulligan.update!(price_cents: 3_500)
    assert_equal 2_000, GolferAddOn.find_by!(registration_id: reg_json["id"], tournament_add_on_id: mulligan.id).unit_price_cents

    # Remaining total cap is 1 (3 max - 2 sold); requesting 2 fails
    post "/api/v1/golfers",
         params: {
           tournament_id: @tournament.id,
           organization_slug: @org.slug,
           waiver_accepted: true,
           golfer: {
             name: "Cap Exceeded Golfer",
             email: "cap@example.com",
             phone: "+16715550103",
             payment_type: "pay_on_day",
             team_category: "Male"
           },
           add_ons: [{ add_on_id: mulligan.id, quantity: 2 }]
         },
         as: :json
    assert_response :unprocessable_entity
    assert_match(/Only 1 of Mulligan Pack remaining/i, JSON.parse(response.body)["errors"].join(" "))

    # Requesting 1 succeeds on legacy /golfers endpoint too
    post "/api/v1/golfers",
         params: {
           tournament_id: @tournament.id,
           organization_slug: @org.slug,
           waiver_accepted: true,
           golfer: {
             name: "Maria Reyes",
             email: "maria@example.com",
             phone: "+16715550104",
             payment_type: "pay_on_day",
             team_category: "Female"
           },
           add_ons: [{ add_on_id: mulligan.id, quantity: 1 }]
         },
         as: :json
    assert_response :created
    golfer_json = JSON.parse(response.body)["golfer"]
    assert_equal "1× Mulligan Pack", golfer_json["add_ons_summary"]
    assert_equal 3_500, golfer_json["add_ons_total_cents"]

    # Check-in volunteer sees add_ons_summary in admin_tournament, but NOT financial price totals
    get "/api/v1/admin/organizations/#{@org.slug}/tournaments/#{@tournament.slug}", headers: headers_for(@checkin_vol)
    assert_response :success
    vol_golfer = JSON.parse(response.body)["golfers"].find { |g| g["email"] == "maria@example.com" }
    assert_equal "1× Mulligan Pack", vol_golfer["add_ons_summary"]
    assert_nil vol_golfer["add_ons_total_cents"]
    assert_nil vol_golfer["add_ons"].first["unit_price_cents"]

    # Org admin sees both add_ons_summary AND add_ons_total_cents
    get "/api/v1/admin/organizations/#{@org.slug}/tournaments/#{@tournament.slug}", headers: headers_for(@org_admin)
    assert_response :success
    admin_golfer = JSON.parse(response.body)["golfers"].find { |g| g["email"] == "maria@example.com" }
    assert_equal 3_500, admin_golfer["add_ons_total_cents"]

    # Deleting a purchased add-on soft-deactivates it instead of destroying
    delete "/api/v1/tournaments/#{@tournament.id}/add_ons/#{mulligan.id}", headers: headers_for(@org_admin)
    assert_response :success
    delete_body = JSON.parse(response.body)
    assert_equal true, delete_body["deactivated"]
    assert_equal false, mulligan.reload.active
  end

  test "sponsor reserve_check holds tier capacity, generates itemized invoice, and mark_check_paid activates with RBAC" do
    tier = @tournament.sponsor_tiers.create!(
      organization: @org,
      key: "platinum",
      label: "Platinum Sponsor",
      description: "Premier tournament banner and foursome",
      price_cents: 250_000,
      included_player_slots: 4,
      max_quantity: 1,
      benefits: ["4 player entries", "Banner on Hole 1"],
      online_checkout_enabled: true,
      sort_order: 0
    )

    # Index exposes check invoice config
    get "/api/v1/tournaments/#{@tournament.id}/sponsor_tiers"
    assert_response :success
    index_body = JSON.parse(response.body)
    assert_equal true, index_body["allow_sponsor_check_invoice"]
    assert_equal "Pacific Charity Foundation", index_body["checks_payable_to"]
    assert_equal 1, index_body["sponsor_tiers"].first["remaining_quantity"]

    # Reserve by check works even when organization payment_mode is offline
    post "/api/v1/tournaments/#{@tournament.id}/sponsor_tiers/#{tier.id}/reserve_check",
         params: {
           sponsor: {
             name: "Marianas Concrete Corp",
             email: "ap@marianasconcrete.example.com",
             website_url: "https://marianasconcrete.example.com"
           }
         },
         as: :json
    assert_response :created
    res_body = JSON.parse(response.body)
    sponsor_data = res_body["sponsor"]
    invoice = res_body["invoice"]

    assert_equal "pending_check", sponsor_data["payment_status"]
    assert_equal "check", sponsor_data["payment_type"]
    assert sponsor_data["invoice_number"].present?
    assert_equal sponsor_data["invoice_number"], invoice["invoice_number"]
    assert_equal "Pacific Charity Foundation", invoice["checks_payable_to"]
    assert_equal 250_000, invoice["amount_cents"]
    assert_equal 4, invoice["included_player_slots"]

    sponsor = Sponsor.find(sponsor_data["id"])
    assert_equal false, sponsor.active
    assert_equal 0, sponsor.sponsor_slots.count
    assert_equal 0, tier.reload.remaining_quantity
    assert_equal true, tier.sold_out?

    # Second reservation on sold-out tier is blocked
    post "/api/v1/tournaments/#{@tournament.id}/sponsor_tiers/#{tier.id}/reserve_check",
         params: { sponsor: { name: "Second Sponsor", email: "second@example.com" } },
         as: :json
    assert_response :unprocessable_entity
    assert_match(/sold out/i, JSON.parse(response.body)["error"])

    # Check-in volunteer cannot mark sponsor check paid (403)
    post "/api/v1/tournaments/#{@tournament.id}/sponsors/#{sponsor.id}/mark_check_paid",
         params: { check_number: "9999" },
         headers: headers_for(@checkin_vol),
         as: :json
    assert_response :forbidden

    # Org admin marks check paid -> activates sponsor & provisions 4 SponsorSlots
    post "/api/v1/tournaments/#{@tournament.id}/sponsors/#{sponsor.id}/mark_check_paid",
         params: { check_number: "1042", check_notes: "Deposited at Bank of Guam" },
         headers: headers_for(@org_admin),
         as: :json
    assert_response :success
    activated = JSON.parse(response.body)["sponsor"]
    assert_equal "paid", activated["payment_status"]
    assert_equal true, activated["active"]
    assert_equal "1042", activated["check_number"]
    assert_equal "Deposited at Bank of Guam", activated["check_notes"]
    assert_equal 4, sponsor.reload.sponsor_slots.count

    # Already paid & active rejects duplicate mark_check_paid
    post "/api/v1/tournaments/#{@tournament.id}/sponsors/#{sponsor.id}/mark_check_paid",
         params: { check_number: "1042" },
         headers: headers_for(@org_admin),
         as: :json
    assert_response :unprocessable_entity

    # Disabled allow_sponsor_check_invoice rejects check reservations
    @tournament.update!(allow_sponsor_check_invoice: false)
    tier2 = @tournament.sponsor_tiers.create!(
      organization: @org,
      key: "silver",
      label: "Silver Sponsor",
      price_cents: 50_000,
      included_player_slots: 2,
      online_checkout_enabled: true
    )
    post "/api/v1/tournaments/#{@tournament.id}/sponsor_tiers/#{tier2.id}/reserve_check",
         params: { sponsor: { name: "Blocked Corp", email: "blocked@example.com" } },
         as: :json
    assert_response :unprocessable_entity
    assert_match(/not enabled/i, JSON.parse(response.body)["error"])
  end
end
