# frozen_string_literal: true

require "test_helper"

class RegistrationTest < ActiveSupport::TestCase
  setup do
    @org = organizations(:org_one)
    @admin = users(:user_one)
  end

  def create_tournament(attrs = {})
    defaults = {
      name: "Real Teams Open #{SecureRandom.hex(3)}",
      year: 2027,
      status: "open",
      registration_open: true,
      team_size: 4,
      capacity_unit: "players",
      max_capacity: 16,
      allow_partial_teams: false,
      waitlist_enabled: true,
      entry_fee: 40000
    }
    @org.tournaments.create!(defaults.merge(attrs))
  end

  def member_hashes(count, prefix: "p")
    (1..count).map do |i|
      {
        name: "Player #{prefix.upcase}#{i}",
        email: "#{prefix}#{i}-#{SecureRandom.hex(3)}@example.com",
        phone: "+1671555#{format('%04d', rand(1000..9999))}",
        tshirt_size: "L",
        waiver_accepted_at: Time.current
      }
    end
  end

  # =========================================================================
  # Team sizes 1, 2, 4 & partial teams
  # =========================================================================

  test "supports 1-player individual, 2-player pairs, and 4-player foursome registrations" do
    solo_t = create_tournament(team_size: 1, capacity_unit: "players")
    solo = solo_t.registrations.create!(
      payment_type: "stripe",
      team_members_attributes: member_hashes(1, prefix: "solo")
    )
    assert_equal 1, solo.team_members.count
    assert_equal @org.id, solo.organization_id
    assert solo.captain.is_captain?
    assert_equal solo.captain.email, solo.contact_email

    pair_t = create_tournament(team_size: 2, capacity_unit: "teams")
    pair = pair_t.registrations.create!(
      payment_type: "swipe_simple",
      team_members_attributes: member_hashes(2, prefix: "pair")
    )
    assert_equal 2, pair.team_members.count
    assert_equal [1, 2], pair.team_members.order(:position).pluck(:position)

    foursome_t = create_tournament(team_size: 4, capacity_unit: "players")
    foursome = foursome_t.registrations.create!(
      team_name: "Island Foursome",
      payment_type: "stripe",
      team_members_attributes: member_hashes(4, prefix: "four")
    )
    assert_equal 4, foursome.team_members.count
    assert_equal [1, 2, 3, 4], foursome.team_members.order(:position).pluck(:position)
  end

  test "partial teams allowed when allow_partial_teams is true and rejected when false" do
    strict_t = create_tournament(team_size: 4, allow_partial_teams: false)
    partial_strict = strict_t.registrations.build(
      registration_source: "public",
      payment_type: "stripe",
      team_members_attributes: member_hashes(2, prefix: "strict")
    )
    assert_not partial_strict.valid?
    assert_includes partial_strict.errors[:team_members].join, "must include exactly 4 players"

    # Admin and sponsor can still register partial teams on strict tournaments
    admin_partial = strict_t.registrations.build(
      registration_source: "admin",
      payment_type: "pay_on_day",
      team_members_attributes: member_hashes(2, prefix: "adm")
    )
    assert admin_partial.valid?

    sponsor_partial = strict_t.registrations.build(
      registration_source: "sponsor",
      payment_type: "sponsor",
      team_members_attributes: member_hashes(2, prefix: "spn")
    )
    assert sponsor_partial.valid?

    # Public partial team allowed when allow_partial_teams: true
    flexible_t = create_tournament(team_size: 4, allow_partial_teams: true)
    partial_ok = flexible_t.registrations.create!(
      registration_source: "public",
      payment_type: "stripe",
      team_members_attributes: member_hashes(2, prefix: "flex")
    )
    assert_equal 2, partial_ok.player_count
    assert_equal "confirmed", partial_ok.registration_status
  end

  test "team_category is optional unless tournament configures categories" do
    open_t = create_tournament(team_size: 2, config: {})
    reg = open_t.registrations.create!(
      payment_type: "stripe",
      team_category: nil,
      team_members_attributes: member_hashes(2, prefix: "nocat")
    )
    assert_nil reg.team_category

    cat_t = create_tournament(team_size: 2, config: { "team_categories" => %w[Open Senior Women] })
    missing_cat = cat_t.registrations.build(
      payment_type: "stripe",
      team_category: nil,
      team_members_attributes: member_hashes(2, prefix: "catmiss")
    )
    assert_not missing_cat.valid?
    assert_includes missing_cat.errors[:team_category], "can't be blank"

    wrong_cat = cat_t.registrations.build(
      payment_type: "stripe",
      team_category: "Co-Ed",
      team_members_attributes: member_hashes(2, prefix: "catwrong")
    )
    assert_not wrong_cat.valid?
    assert_includes wrong_cat.errors[:team_category].join, "must be one of: Open, Senior, Women"

    valid_cat = cat_t.registrations.build(
      payment_type: "stripe",
      team_category: "Senior",
      team_members_attributes: member_hashes(2, prefix: "catok")
    )
    assert valid_cat.valid?
  end

  test "rejects duplicate emails among active public team_members in the same tournament" do
    t = create_tournament(team_size: 2)
    dup_email = "dup-#{SecureRandom.hex(3)}@example.com"

    first = t.registrations.create!(
      registration_source: "public",
      payment_type: "stripe",
      team_members_attributes: [
        { name: "Player One", email: dup_email, phone: "+16715550101" },
        { name: "Player Two", email: "p2-#{SecureRandom.hex(3)}@example.com", phone: "+16715550102" }
      ]
    )

    second = t.registrations.build(
      registration_source: "public",
      payment_type: "stripe",
      team_members_attributes: [
        { name: "Other Captain", email: "cap-#{SecureRandom.hex(3)}@example.com", phone: "+16715550103" },
        { name: "Duplicate Teammate", email: dup_email.upcase, phone: "+16715550104" }
      ]
    )
    assert_not second.valid?
    assert_includes second.errors[:base].join, "already registered"

    # Cancelling the first registration frees the email for re-registration
    first.cancel!(admin: @admin, reason: "Withdrew")
    assert second.valid?
  end

  # =========================================================================
  # Capacity & Waitlist under 'players' vs 'teams' (including sponsor slots)
  # =========================================================================

  test "enforces capacity and waitlist under capacity_unit players including partial teams and sponsor slots" do
    t = create_tournament(
      team_size: 4,
      capacity_unit: "players",
      max_capacity: 10,
      allow_partial_teams: true,
      waitlist_enabled: true
    )

    # Sponsor reserves 4 player slots -> public_capacity = 10 - 4 = 6 players
    t.sponsors.create!(name: "Gold Sponsor", tier: "gold", slot_count: 4, active: true)

    summary = t.capacity_summary
    assert_equal "players", summary[:capacity_unit]
    assert_equal 4, summary[:sponsor_reserved]
    assert_equal 6, summary[:public_capacity]

    # 4-player foursome fits (4 <= 6) -> confirmed
    reg1 = t.registrations.create!(
      payment_type: "stripe",
      team_members_attributes: member_hashes(4, prefix: "pl1")
    )
    assert_equal "confirmed", reg1.registration_status

    # 2-player partial team fits (4 + 2 = 6 <= 6) -> confirmed
    reg2 = t.registrations.create!(
      payment_type: "stripe",
      team_members_attributes: member_hashes(2, prefix: "pl2")
    )
    assert_equal "confirmed", reg2.registration_status

    # Next 2-player partial team exceeds public capacity (6 + 2 > 6) -> waitlist
    reg3 = t.registrations.create!(
      payment_type: "stripe",
      team_members_attributes: member_hashes(2, prefix: "pl3")
    )
    assert_equal "waitlist", reg3.registration_status

    after_summary = t.capacity_summary
    assert_equal 6, after_summary[:confirmed_units]
    assert_equal 2, after_summary[:waitlist_units]
    assert_equal 0, after_summary[:public_remaining]
    assert after_summary[:public_at_capacity]
  end

  test "enforces capacity and waitlist under capacity_unit teams including sponsor slots" do
    t = create_tournament(
      team_size: 4,
      capacity_unit: "teams",
      max_capacity: 3,
      allow_partial_teams: true,
      waitlist_enabled: true
    )

    # Sponsor has 4 player slots -> 4 / 4 = 1 sponsor-reserved team -> public_capacity = 2 teams
    t.sponsors.create!(name: "Platinum Sponsor", tier: "platinum", slot_count: 4, active: true)

    summary = t.capacity_summary
    assert_equal "teams", summary[:capacity_unit]
    assert_equal 1, summary[:sponsor_reserved]
    assert_equal 2, summary[:public_capacity]

    reg1 = t.registrations.create!(
      payment_type: "stripe",
      team_members_attributes: member_hashes(4, prefix: "tm1")
    )
    assert_equal "confirmed", reg1.registration_status

    # Partial team still counts as 1 team unit under capacity_unit == 'teams'
    reg2 = t.registrations.create!(
      payment_type: "stripe",
      team_members_attributes: member_hashes(2, prefix: "tm2")
    )
    assert_equal "confirmed", reg2.registration_status

    # 3rd public team exceeds public_capacity (2) -> waitlist
    reg3 = t.registrations.create!(
      payment_type: "stripe",
      team_members_attributes: member_hashes(4, prefix: "tm3")
    )
    assert_equal "waitlist", reg3.registration_status
  end

  # =========================================================================
  # Per-player check-in on 4-player team (1/4, 4/4)
  # =========================================================================

  test "per-player check-in tracks partial (1/4) and full (4/4) team check-in" do
    t = create_tournament(team_size: 4)
    reg = t.registrations.create!(
      payment_type: "stripe",
      team_members_attributes: member_hashes(4, prefix: "chk")
    )

    assert_equal 0, reg.checked_in_count
    assert_not reg.all_checked_in?
    assert_not reg.partially_checked_in?

    members = reg.team_members.order(:position).to_a
    members[0].check_in!(admin: @admin)
    reg.reload

    assert_equal 1, reg.checked_in_count
    assert reg.partially_checked_in?
    assert_not reg.all_checked_in?
    assert_equal @admin.id, members[0].reload.checked_in_by_id

    members[1..3].each { |m| m.check_in!(admin: @admin) }
    reg.reload

    assert_equal 4, reg.checked_in_count
    assert reg.all_checked_in?
    assert_not reg.partially_checked_in?

    members[3].undo_check_in!
    reg.reload
    assert_equal 3, reg.checked_in_count
    assert_not reg.all_checked_in?
  end

  test "TeamMember magic link generation, lookup, and clearing" do
    t = create_tournament(team_size: 1)
    reg = t.registrations.create!(
      payment_type: "stripe",
      team_members_attributes: member_hashes(1, prefix: "ml")
    )
    member = reg.captain

    token = member.generate_magic_link!
    assert_equal member.id, TeamMember.find_by_magic_link(token)&.id

    member.clear_magic_link!
    assert_nil TeamMember.find_by_magic_link(token)
  end

  # =========================================================================
  # Group placement enforcing player-count cap
  # =========================================================================

  test "group placement enforces player-count cap for 4 solos, 2 pairs, 1 foursome, 2 partial pairs, and rejects 3 + 2 = 5" do
    # 1) 4 solos in 1 starting position
    solo_t = create_tournament(team_size: 1, config: { "teams_per_start_position" => 4 })
    solo_group = solo_t.groups.create!(group_number: 1, hole_number: 1)
    4.times do |i|
      solo = solo_t.registrations.create!(payment_type: "stripe", team_members_attributes: member_hashes(1, prefix: "gs#{i}"))
      assert solo_group.add_registration(solo), "Solo #{i + 1} should fit"
    end
    assert_equal 4, solo_group.player_count
    fifth_solo = solo_t.registrations.create!(payment_type: "stripe", team_members_attributes: member_hashes(1, prefix: "gs5"))
    assert_not solo_group.add_registration(fifth_solo)

    # 2) 2 pairs in 1 starting position
    pair_t = create_tournament(team_size: 2, config: { "teams_per_start_position" => 2 })
    pair_group = pair_t.groups.create!(group_number: 1, hole_number: 2)
    p1 = pair_t.registrations.create!(payment_type: "stripe", team_members_attributes: member_hashes(2, prefix: "gp1"))
    p2 = pair_t.registrations.create!(payment_type: "stripe", team_members_attributes: member_hashes(2, prefix: "gp2"))
    p3 = pair_t.registrations.create!(payment_type: "stripe", team_members_attributes: member_hashes(2, prefix: "gp3"))
    assert pair_group.add_registration(p1)
    assert pair_group.add_registration(p2)
    assert_equal 4, pair_group.player_count
    assert_not pair_group.add_registration(p3)

    # 3) 1 foursome, 2 partial pairs allowed; 3 + 2 = 5 rejected
    four_t = create_tournament(team_size: 4, allow_partial_teams: true)
    group_full = four_t.groups.create!(group_number: 1, hole_number: 3)
    foursome = four_t.registrations.create!(payment_type: "stripe", team_members_attributes: member_hashes(4, prefix: "gf1"))
    assert group_full.add_registration(foursome)
    assert_equal 4, group_full.player_count

    group_partials = four_t.groups.create!(group_number: 2, hole_number: 4)
    part_a = four_t.registrations.create!(payment_type: "stripe", team_members_attributes: member_hashes(2, prefix: "gfa"))
    part_b = four_t.registrations.create!(payment_type: "stripe", team_members_attributes: member_hashes(2, prefix: "gfb"))
    assert group_partials.add_registration(part_a)
    assert group_partials.add_registration(part_b)
    assert_equal 4, group_partials.player_count

    group_overflow = four_t.groups.create!(group_number: 3, hole_number: 5)
    trio = four_t.registrations.create!(payment_type: "stripe", team_members_attributes: member_hashes(3, prefix: "gft"))
    duo = four_t.registrations.create!(payment_type: "stripe", team_members_attributes: member_hashes(2, prefix: "gfd"))
    assert group_overflow.add_registration(trio)
    assert_not group_overflow.add_registration(duo), "3 + 2 = 5 players must be rejected"
    assert_equal 3, group_overflow.player_count
  end

  # =========================================================================
  # SponsorSlotSyncer 1:1 sponsor_slot_id idempotent create + edit
  # =========================================================================

  test "SponsorSlotSyncer syncs 4 sponsor slots into 1 Registration with 4 TeamMembers linked 1:1 and updates idempotently" do
    t = create_tournament(team_size: 4, capacity_unit: "players")
    sponsor = t.sponsors.create!(name: "Island Bank", tier: "platinum", slot_count: 4, active: true)
    slots = sponsor.sponsor_slots.order(:slot_number).to_a
    assert_equal 4, slots.size

    slots.each_with_index do |slot, idx|
      slot.update!(
        player_name: "Sponsor Player #{idx + 1}",
        player_email: "sp#{idx + 1}-#{SecureRandom.hex(3)}@example.com",
        player_phone: "+1671555020#{idx + 1}"
      )
    end

    SponsorSlotSyncer.new(sponsor).sync_all

    regs = t.registrations.where(sponsor_id: sponsor.id)
    assert_equal 1, regs.count
    reg = regs.first
    assert_equal "sponsor", reg.payment_type
    assert_equal "paid", reg.payment_status
    assert_equal "confirmed", reg.registration_status
    assert_equal 4, reg.team_members.count
    assert_equal slots.map(&:id), reg.team_members.order(:position).pluck(:sponsor_slot_id)

    # Re-edit slot 3 in Sponsor Portal and re-sync -> exact same TeamMember updated idempotently!
    slot3 = slots[2]
    original_member3_id = reg.team_members.find_by!(sponsor_slot_id: slot3.id).id
    slot3.update!(player_name: "Updated Player Three", player_email: "updated-sp3@example.com")

    SponsorSlotSyncer.new(sponsor).sync_slot(slot3)

    assert_equal 1, t.registrations.where(sponsor_id: sponsor.id).count
    assert_equal 4, reg.reload.team_members.count
    updated_member3 = reg.team_members.find_by!(sponsor_slot_id: slot3.id)
    assert_equal original_member3_id, updated_member3.id
    assert_equal "Updated Player Three", updated_member3.name
    assert_equal "updated-sp3@example.com", updated_member3.email
  end

  # =========================================================================
  # Score DB check constraint
  # =========================================================================

  test "Score enforces registration_id for team scores and team_member_id for individual scores at model and DB levels" do
    t = create_tournament(team_size: 4)
    group = t.groups.create!(group_number: 1, hole_number: 1)
    reg = t.registrations.create!(
      group: group,
      payment_type: "stripe",
      team_members_attributes: member_hashes(4, prefix: "sc")
    )
    member = reg.captain

    # Valid team score with registration_id
    team_score = Score.create!(
      tournament: t,
      group: group,
      registration: reg,
      score_type: "team",
      hole: 1,
      strokes: 4
    )
    assert team_score.persisted?

    # Valid individual score with team_member_id
    indiv_score = Score.create!(
      tournament: t,
      group: group,
      team_member: member,
      score_type: "individual",
      hole: 1,
      strokes: 5
    )
    assert indiv_score.persisted?

    # Model rejects mismatched type
    bad_team = Score.new(tournament: t, group: group, registration: reg, score_type: "individual", hole: 2, strokes: 4)
    assert_not bad_team.valid?

    bad_indiv = Score.new(tournament: t, group: group, team_member: member, score_type: "team", hole: 2, strokes: 4)
    assert_not bad_indiv.valid?

    # DB CHECK constraint also rejects mismatched combos even when validations are bypassed
    assert_raises(ActiveRecord::StatementInvalid) do
      ActiveRecord::Base.transaction(requires_new: true) do
        Score.new(
          tournament: t,
          group: group,
          registration_id: reg.id,
          team_member_id: nil,
          score_type: "individual",
          hole: 3,
          strokes: 4
        ).save!(validate: false)
      end
    end

    assert_raises(ActiveRecord::StatementInvalid) do
      ActiveRecord::Base.transaction(requires_new: true) do
        Score.new(
          tournament: t,
          group: group,
          registration_id: nil,
          team_member_id: member.id,
          score_type: "team",
          hole: 4,
          strokes: 4
        ).save!(validate: false)
      end
    end

    assert_raises(ActiveRecord::StatementInvalid) do
      ActiveRecord::Base.transaction(requires_new: true) do
        Score.new(
          tournament: t,
          group: group,
          registration_id: reg.id,
          team_member_id: member.id,
          score_type: "team",
          hole: 5,
          strokes: 4
        ).save!(validate: false)
      end
    end
  end

  # =========================================================================
  # Registration#create_raffle_tickets! idempotent for 4-player foursome
  # =========================================================================

  test "create_raffle_tickets! creates 4 complimentary tickets for a foursome idempotently" do
    t = create_tournament(
      team_size: 4,
      raffle_enabled: true,
      config: { "raffle_include_with_registration" => true }
    )
    reg = t.registrations.create!(
      payment_type: "stripe",
      team_members_attributes: member_hashes(4, prefix: "raf")
    )

    first_run = reg.create_raffle_tickets!
    assert_equal 4, first_run.size
    assert_equal 4, t.raffle_tickets.where(registration_id: reg.id).count
    assert_equal reg.team_members.order(:position).pluck(:id),
                 t.raffle_tickets.where(registration_id: reg.id).order(:id).pluck(:team_member_id)

    # Re-running after editing a player's name updates idempotently without creating duplicates
    member2 = reg.team_members.order(:position).second
    member2.update!(name: "Renamed Foursome Player")

    second_run = reg.create_raffle_tickets!
    assert_equal 4, second_run.size
    assert_equal 4, t.raffle_tickets.where(registration_id: reg.id).count
    assert_equal "Renamed Foursome Player",
                 t.raffle_tickets.find_by!(registration_id: reg.id, team_member_id: member2.id).purchaser_name
  end
end
