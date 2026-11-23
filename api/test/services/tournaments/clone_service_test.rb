# frozen_string_literal: true

require "test_helper"

module Tournaments
  class CloneServiceTest < ActiveSupport::TestCase
    setup do
      @org_a = Organization.create!(
        name: "Pacific Island Golf",
        slug: "pacific-island-#{SecureRandom.hex(3)}",
        primary_color: "#1e3a8a"
      )
      @org_b = Organization.create!(
        name: "Harbor Classic Golf",
        slug: "harbor-classic-#{SecureRandom.hex(3)}",
        primary_color: "#7c2d12",
        settings: { "theme_preset" => "crest-classic" }
      )

      @org_a_admin = User.create!(
        email: "org-a-admin-#{SecureRandom.hex(3)}@example.com",
        name: "Org A Admin",
        role: "org_admin",
        clerk_id: "clerk_org_a_#{SecureRandom.hex(4)}"
      )
      @org_a.add_admin(@org_a_admin)

      @super_admin = User.create!(
        email: "platform-super-#{SecureRandom.hex(3)}@example.com",
        name: "Platform Super Admin",
        role: "super_admin",
        clerk_id: "clerk_super_#{SecureRandom.hex(4)}"
      )

      @source = @org_a.tournaments.create!(
        name: "Island Open",
        year: 2026,
        edition: "5th Annual",
        status: "open",
        registration_open: true,
        walkin_registration_open: true,
        event_date: "May 2, 2026",
        registration_deadline: 2.days.ago,
        early_bird_deadline: 10.days.ago,
        sponsor_edit_deadline: 5.days.ago,
        raffle_draw_time: 1.day.ago,
        registration_time: "06:30 am",
        check_in_time: "07:00 am",
        start_time: "08:00 am",
        location_name: "Ocean View Country Club",
        location_address: "123 Fairway Rd",
        tournament_format: "scramble",
        scoring_type: "net",
        team_size: 2,
        allow_partial_teams: true,
        total_holes: 18,
        total_par: 72,
        course_name: "Ocean Course",
        hole_pars: { "1" => 4, "2" => 5, "3" => 3 },
        hole_handicaps: { "1" => 7, "2" => 3, "3" => 15 },
        max_capacity: 72,
        reserved_slots: 10,
        entry_fee: 30000,
        entry_fee_display: "$300/team",
        early_bird_fee: 25000,
        walkin_fee: 35000,
        contact_name: "Jordan Organizer",
        contact_phone: "671-555-0100",
        contact_email: "events@pacific-island.example",
        checks_payable_to: "Pacific Island Golf Association",
        payment_instructions: "Make checks payable to Pacific Island Golf",
        swipe_simple_url: "https://swipesimple.com/links/stale-2026",
        walkin_swipe_simple_url: "https://swipesimple.com/links/stale-walkin-2026",
        theme_preset: "charity-bright",
        use_org_branding: false,
        primary_color_override: "#0ea5e9",
        accent_color_override: "#f59e0b",
        logo_url_override: "https://cdn.example.com/org-a-logo.png",
        banner_url_override: "https://cdn.example.com/org-a-banner.png",
        signature_image_url_override: "https://cdn.example.com/org-a-sig.png",
        raffle_enabled: true,
        raffle_ticket_price_cents: 500,
        raffle_description: "Grand banquet raffle",
        config: {
          "course_configs" => [
            { "key" => "hibiscus", "name" => "Hibiscus", "hole_count" => 9 },
            { "key" => "plumeria", "name" => "Plumeria", "hole_count" => 9 }
          ],
          "teams_per_start_position" => 2,
          "start_positions_per_hole" => 2,
          "sponsor_tiers" => [
            { "key" => "title", "label" => "Presenting", "sort_order" => 0 },
            { "key" => "gold", "label" => "Gold", "sort_order" => 1 },
            { "key" => "hole", "label" => "Hole", "sort_order" => 2 }
          ],
          "raffle_bundles" => [
            { "quantity" => 5, "price_cents" => 2000, "label" => "$20 for 5" },
            { "quantity" => 15, "price_cents" => 5000, "label" => "$50 for 15" }
          ],
          "raffle_include_with_registration" => true,
          "features" => {
            "raffle" => true,
            "donations" => true,
            "offseason_mode" => true,
            "not_a_real_feature" => true
          },
          "secondary_color" => "#0284c7",
          "font_family" => "Playfair Display",
          "header_style" => "bold"
        }
      )

      # Create operational data that MUST NEVER be copied
      @group = @source.groups.create!(group_number: 1, hole_number: 1, starting_course_key: "hibiscus")
      @golfer = @source.golfers.create!(
        name: "Alex Player",
        email: "alex-#{SecureRandom.hex(3)}@example.com",
        phone: "671-555-0199",
        team_category: "Co-Ed",
        payment_type: "pay_on_day",
        payment_status: "paid",
        registration_status: "confirmed",
        group: @group,
        waiver_accepted_at: Time.current
      )
      @source.scores.create!(
        golfer: @golfer,
        group: @group,
        hole: 1,
        strokes: 4,
        score_type: "individual"
      )
      @batch = @source.raffle_sale_batches.create!(
        buyer_name: "Alex Player",
        buyer_phone: "+16715550199",
        quantity: 1,
        total_cents: 500,
        payment_method: "cash",
        purchased_at: Time.current
      )
      @ticket = @source.raffle_tickets.create!(
        golfer: @golfer,
        raffle_sale_batch: @batch,
        purchaser_name: "Alex Player",
        purchaser_email: @golfer.email,
        purchaser_phone: "+16715550199",
        payment_status: "paid",
        price_cents: 500,
        purchased_at: Time.current
      )
      @prize = @source.raffle_prizes.create!(
        name: "Round-Trip Airfare",
        tier: "grand",
        description: "Two business class tickets",
        value_cents: 250_000,
        position: 1,
        sponsor_name: "Island Air",
        sponsor_logo_url: "https://cdn.example.com/airline.png",
        image_url: "https://cdn.example.com/prize.png",
        won: true,
        won_at: Time.current,
        claimed: true,
        claimed_at: Time.current,
        winning_ticket: @ticket,
        winner_name: "Alex Player",
        winner_email: @golfer.email,
        winner_phone: "+16715550199",
        draw_id: SecureRandom.uuid,
        draw_eligible_ticket_count: 10,
        draw_preview_ticket_numbers: [@ticket.ticket_number]
      )
      @sponsor = @source.sponsors.create!(
        name: "Oceanic Bank",
        tier: "gold",
        website_url: "https://oceanic.example.com",
        description: "Gold partner",
        logo_url: "https://cdn.example.com/oceanic.png",
        login_email: "events@oceanic.example.com",
        slot_count: 2,
        position: 1,
        active: true
      )
      @sponsor.generate_access_token!
      @sponsor.sponsor_slots.first.update!(
        player_name: "Sponsor VIP",
        player_email: "vip@oceanic.example.com",
        player_phone: "671-555-0188",
        confirmed_at: Time.current
      )
      @source.message_deliveries.create!(
        organization: @org_a,
        channel: "email",
        provider: "resend",
        purpose: "raffle_ticket_confirmation",
        recipient: @golfer.email,
        status: "delivered"
      )
      ActivityLog.log(
        admin: @org_a_admin,
        action: "tournament_updated",
        target: @source,
        tournament: @source,
        organization: @org_a,
        details: "Prior year edit"
      )
    end

    test "increment_edition handles ordinals including teens and suffixes" do
      assert_equal "6th Annual", CloneService.increment_edition("5th Annual")
      assert_equal "2nd", CloneService.increment_edition("1st")
      assert_equal "3rd Annual Classic", CloneService.increment_edition("2nd Annual Classic")
      assert_equal "12th Annual", CloneService.increment_edition("11th Annual")
      assert_equal "13th Annual", CloneService.increment_edition("12th Annual")
      assert_equal "14th Annual", CloneService.increment_edition("13th Annual")
      assert_equal "21st Annual", CloneService.increment_edition("20th Annual")
      assert_equal "22nd", CloneService.increment_edition("21st")
      assert_equal "Spring Edition", CloneService.increment_edition("Spring Edition")
      assert_nil CloneService.increment_edition(nil)
      assert_nil CloneService.increment_edition("   ")
    end

    test "next-year draft copies event media, waiver settings, and sponsor wall settings" do
      attrs = {
        commemorative_banner_url: "/images/commemorative.png",
        tribute_title: "Celebrating our founders",
        tribute_subtitle: "Open to the whole community",
        story_photos: [{ "url" => "/images/founders.png", "caption" => "The first event" }],
        waiver_enabled: false,
        waiver_text: "An organizer-specific release.",
        show_public_sponsors: false,
        sponsor_wall_title: "Event Partners"
      }
      @source.update!(attrs)

      cloned = CloneService.call(source: @source, actor: @org_a_admin).tournament.reload

      assert_equal "draft", cloned.status
      assert_equal attrs.stringify_keys, cloned.attributes.slice(*attrs.stringify_keys.keys)
    end

    test "same-org next-year clone clears dates/deadlines/payment URLs, sets draft, preserves config/branding, and copies zero operational records" do
      result = CloneService.call(source: @source, actor: @org_a_admin)
      cloned = result.tournament

      assert cloned.persisted?
      assert_equal @org_a.id, cloned.organization_id
      assert_equal "Island Open", cloned.name
      assert_equal 2027, cloned.year
      assert_equal "6th Annual", cloned.edition
      assert_not_equal @source.slug, cloned.slug

      # Operational state reset
      assert_equal "draft", cloned.status
      assert_not cloned.registration_open
      assert_not cloned.walkin_registration_open

      # Past dates & deadlines cleared
      assert_nil cloned.event_date
      assert_nil cloned.registration_deadline
      assert_nil cloned.early_bird_deadline
      assert_nil cloned.sponsor_edit_deadline
      assert_nil cloned.raffle_draw_time

      # Stale external payment URLs cleared + warning flagged
      assert_nil cloned.swipe_simple_url
      assert_nil cloned.walkin_swipe_simple_url
      assert result.metadata[:requires_payment_url_review]
      assert result.warnings.any? { |w| w.include?("External payment URLs were cleared") }

      # Configuration & format preserved
      assert_equal 2, cloned.team_size
      assert_equal 4, cloned.players_per_start_position
      assert_equal @source.course_configs, cloned.course_configs
      assert_equal({ "1" => 4, "2" => 5, "3" => 3 }, cloned.hole_pars)
      assert_equal 30000, cloned.entry_fee
      assert_equal 72, cloned.max_capacity
      assert_equal 10, cloned.reserved_slots
      assert_equal @source.raffle_bundles, cloned.raffle_bundles
      assert_equal true, cloned.raffle_enabled

      # Feature overrides sanitized to valid tournament-overridable catalog keys
      assert_equal({ "raffle" => true, "donations" => true }, cloned.config["features"])

      # Same-org branding & contact info preserved
      assert_equal "charity-bright", cloned.theme_preset
      assert_equal false, cloned.use_org_branding
      assert_equal "#0ea5e9", cloned.primary_color_override
      assert_equal "#f59e0b", cloned.accent_color_override
      assert_equal "https://cdn.example.com/org-a-logo.png", cloned.logo_url_override
      assert_equal "https://cdn.example.com/org-a-banner.png", cloned.banner_url_override
      assert_equal "https://cdn.example.com/org-a-sig.png", cloned.signature_image_url_override
      assert_equal "#0284c7", cloned.config["secondary_color"]
      assert_equal "Playfair Display", cloned.config["font_family"]
      assert_equal "Jordan Organizer", cloned.contact_name
      assert_equal "671-555-0100", cloned.contact_phone
      assert_equal "Pacific Island Golf Association", cloned.checks_payable_to

      # ZERO operational records copied (and default options skip sponsors & prizes)
      assert_equal 0, cloned.golfers.count
      assert_equal 0, cloned.groups.count
      assert_equal 0, cloned.scores.count
      assert_equal 0, cloned.raffle_tickets.count
      assert_equal 0, cloned.raffle_sale_batches.count
      assert_equal 0, cloned.raffle_prizes.count
      assert_equal 0, cloned.sponsors.count
      assert_equal 0, cloned.message_deliveries.count

      # ActivityLog written on target organization (only the single clone entry)
      logs = ActivityLog.where(tournament_id: cloned.id)
      assert_equal 1, logs.count
      assert_equal "tournament_cloned", logs.first.action
      assert_equal @org_a.id, logs.first.organization_id
      assert_equal @org_a_admin.id, logs.first.admin_id
    end

    test "same-org clone supports name, year, edition, and event_date overrides and unique slug collisions" do
      first = CloneService.call(
        source: @source,
        actor: @org_a_admin,
        name: "Island Open",
        year: 2028,
        edition: "7th Annual",
        event_date: "May 8, 2028"
      ).tournament

      second = CloneService.call(
        source: @source,
        actor: @org_a_admin,
        name: "Island Open",
        year: 2028,
        edition: "7th Annual"
      ).tournament

      assert_equal 2028, first.year
      assert_equal "7th Annual", first.edition
      assert_equal "May 8, 2028", first.event_date
      assert_nil second.event_date
      assert_not_equal first.slug, second.slug
    end

    test "optional copy_raffle_prizes copies templates without winners, tickets, or draw history" do
      result = CloneService.call(
        source: @source,
        actor: @org_a_admin,
        copy_raffle_prizes: true
      )
      cloned = result.tournament

      assert_equal 1, result.metadata[:copied_raffle_prizes_count]
      assert_equal 1, cloned.raffle_prizes.count
      copied_prize = cloned.raffle_prizes.first

      assert_equal "Round-Trip Airfare", copied_prize.name
      assert_equal "grand", copied_prize.tier
      assert_equal "Two business class tickets", copied_prize.description
      assert_equal 250_000, copied_prize.value_cents
      assert_equal 1, copied_prize.position

      assert_equal false, copied_prize.won
      assert_nil copied_prize.won_at
      assert_equal false, copied_prize.claimed
      assert_nil copied_prize.claimed_at
      assert_nil copied_prize.winning_ticket_id
      assert_nil copied_prize.winner_name
      assert_nil copied_prize.winner_email
      assert_nil copied_prize.winner_phone
      assert_nil copied_prize.draw_id
      assert_nil copied_prize.draw_eligible_ticket_count
      assert_equal [], copied_prize.draw_preview_ticket_numbers
      assert_nil copied_prize.sponsor_name
      assert_nil copied_prize.sponsor_logo_url
    end

    test "optional copy_sponsor_shells creates inactive directory shells with zero filled player slots and nil magic tokens" do
      result = CloneService.call(
        source: @source,
        actor: @org_a_admin,
        copy_sponsor_shells: true
      )
      cloned = result.tournament

      assert_equal 1, result.metadata[:copied_sponsor_shells_count]
      assert_equal 1, cloned.sponsors.count

      shell = cloned.sponsors.first
      assert_equal "Oceanic Bank", shell.name
      assert_equal "gold", shell.tier
      assert_equal "https://oceanic.example.com", shell.website_url
      assert_equal "events@oceanic.example.com", shell.login_email
      assert_equal 2, shell.slot_count

      # Draft/inactive status, nil magic tokens, zero filled player slots, zero golfers
      assert_equal false, shell.active
      assert_nil shell.access_token
      assert_nil shell.access_token_expires_at
      assert_equal 0, shell.golfers.count
      assert shell.sponsor_slots.all? { |s| s.player_name.nil? && s.player_email.nil? && s.player_phone.nil? && s.confirmed_at.nil? }
    end

    test "cross-org template clone succeeds for super_admin, strips source branding/contacts/payment URLs/sponsors, and writes log on target org" do
      result = CloneService.call(
        source: @source,
        actor: @super_admin,
        name: "Harbor Invitational",
        year: 2027,
        target_organization_id: @org_b.id,
        copy_sponsor_shells: true, # must be ignored in cross-org mode!
        copy_raffle_prizes: true
      )
      cloned = result.tournament

      assert cloned.persisted?
      assert_equal "cross_org_template", result.metadata[:mode]
      assert_equal @org_b.id, cloned.organization_id
      assert_equal "Harbor Invitational", cloned.name
      assert_equal "draft", cloned.status
      assert_not cloned.registration_open
      assert_not cloned.walkin_registration_open

      # Cloned structure & templates preserved
      assert_equal 2, cloned.team_size
      assert_equal @source.course_configs, cloned.course_configs
      assert_equal({ "1" => 4, "2" => 5, "3" => 3 }, cloned.hole_pars)
      assert_equal @source.raffle_bundles, cloned.raffle_bundles
      assert_equal({ "raffle" => true, "donations" => true }, cloned.config["features"])
      assert_equal 1, cloned.raffle_prizes.count

      # Source-org-specific branding, contacts, payment URLs, and config keys stripped
      assert_equal true, cloned.use_org_branding
      assert_equal "crest-classic", cloned.theme_preset
      assert_nil cloned.primary_color_override
      assert_nil cloned.accent_color_override
      assert_nil cloned.logo_url_override
      assert_nil cloned.banner_url_override
      assert_nil cloned.signature_image_url_override
      assert_nil cloned.contact_name
      assert_nil cloned.contact_phone
      assert_nil cloned.contact_email
      assert_nil cloned.checks_payable_to
      assert_nil cloned.payment_instructions
      assert_nil cloned.swipe_simple_url
      assert_nil cloned.walkin_swipe_simple_url
      assert_nil cloned.config["secondary_color"]
      assert_nil cloned.config["font_family"]
      assert_nil cloned.config["header_style"]

      # Sponsors NEVER copied across orgs even if requested
      assert_equal 0, cloned.sponsors.count
      assert_equal 0, result.metadata[:copied_sponsor_shells_count]
      assert result.warnings.any? { |w| w.include?("Sponsor directory shells cannot be copied across organizations") }

      # ActivityLog belongs strictly to target organization
      log = ActivityLog.find_by!(tournament_id: cloned.id, action: "tournament_cloned")
      assert_equal @org_b.id, log.organization_id
      assert_equal @super_admin.id, log.admin_id
    end

    test "non-super-admin cannot perform cross-org template clone even if admin of both orgs" do
      @org_b.add_admin(@org_a_admin)

      assert_no_difference ["Tournament.count", "Sponsor.count", "RafflePrize.count", "ActivityLog.count"] do
        assert_raises(CloneService::AuthorizationError) do
          CloneService.call(
            source: @source,
            actor: @org_a_admin,
            target_organization_id: @org_b.id
          )
        end
      end
    end

    test "missing target organization raises TargetOrganizationNotFoundError without creating records" do
      assert_no_difference "Tournament.count" do
        assert_raises(CloneService::TargetOrganizationNotFoundError) do
          CloneService.call(
            source: @source,
            actor: @super_admin,
            target_organization_id: SecureRandom.uuid
          )
        end
      end
    end
  end
end
