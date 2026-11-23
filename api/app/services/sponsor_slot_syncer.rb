# frozen_string_literal: true

class SponsorSlotSyncer
  # Syncs SponsorSlot data into BOTH:
  # 1. Real-teams `Registration` + `TeamMember` records (grouped by `tournament.team_size`
  #    with a 1:1 `team_members.sponsor_slot_id` link so re-editing a player in the Sponsor
  #    Portal updates that exact TeamMember idempotently).
  # 2. Legacy `Golfer` records (grouped by 2) so existing legacy callers and tests remain unbroken.

  def initialize(sponsor)
    @sponsor = sponsor
    @tournament = sponsor.tournament
  end

  def sync_all
    ActiveRecord::Base.transaction(requires_new: true) do
      @sponsor.lock!
      slots = @sponsor.sponsor_slots.reload.order(:slot_number).to_a

      # Legacy Golfer sync (pairs) — capture synced golfers by slot_id so Registrations bridge cleanly
      # Note: complimentary raffle tickets are created once on Registration (not duplicated on Golfer).
      golfer_by_slot_id = {}
      slots.each_slice(2).with_index do |(captain_slot, partner_slot), team_idx|
        synced_golfer = sync_team(captain_slot, partner_slot, team_idx + 1)
        next unless synced_golfer

        golfer_by_slot_id[captain_slot.id] = synced_golfer if captain_slot
        golfer_by_slot_id[partner_slot.id] = synced_golfer if partner_slot
      end

      # Real teams Registration + TeamMember sync (1, 2, or 4 per team_size)
      team_size = effective_team_size
      slots.each_slice(team_size).with_index do |team_slots, team_idx|
        bridged_golfer = team_slots.filter_map { |s| golfer_by_slot_id[s.id] }.first
        sync_registration_team(team_slots, team_idx + 1, bridged_golfer: bridged_golfer)
      end
    end
  end

  # Returns true on success, raises on failure so callers can surface the error.
  def sync_slot(slot)
    ActiveRecord::Base.transaction(requires_new: true) do
      @sponsor.lock!
      fresh_slot = @sponsor.sponsor_slots.find(slot.id)

      # 1. Legacy Golfer pair sync
      legacy_team_number = ((fresh_slot.slot_number - 1) / 2) + 1
      pair_start = (legacy_team_number - 1) * 2 + 1
      captain_slot = @sponsor.sponsor_slots.find_by(slot_number: pair_start)
      partner_slot = @sponsor.sponsor_slots.find_by(slot_number: pair_start + 1)
      synced_golfer = sync_team(captain_slot, partner_slot, legacy_team_number)

      # 2. Real teams Registration + TeamMember sync
      team_size = effective_team_size
      reg_team_number = ((fresh_slot.slot_number - 1) / team_size) + 1
      range_start = (reg_team_number - 1) * team_size + 1
      range_end = range_start + team_size - 1
      team_slots = @sponsor.sponsor_slots.where(slot_number: range_start..range_end).order(:slot_number).to_a
      sync_registration_team(team_slots, reg_team_number, bridged_golfer: synced_golfer)
    end

    true
  end

  # Syncs every team touched by a batch save exactly once (one legacy pair sync per
  # pair and one Registration sync per real team) inside a single transaction.
  def sync_slots(slots)
    slot_numbers = Array(slots).map(&:slot_number).uniq
    return true if slot_numbers.empty?

    ActiveRecord::Base.transaction(requires_new: true) do
      @sponsor.lock!
      all_slots = @sponsor.sponsor_slots.reload.order(:slot_number).to_a
      by_number = all_slots.index_by(&:slot_number)

      golfer_by_pair = {}
      slot_numbers.map { |n| ((n - 1) / 2) + 1 }.uniq.sort.each do |pair_number|
        pair_start = (pair_number - 1) * 2 + 1
        golfer_by_pair[pair_number] = sync_team(by_number[pair_start], by_number[pair_start + 1], pair_number)
      end

      team_size = effective_team_size
      slot_numbers.map { |n| ((n - 1) / team_size) + 1 }.uniq.sort.each do |team_number|
        range_start = (team_number - 1) * team_size + 1
        team_slots = (range_start...(range_start + team_size)).filter_map { |n| by_number[n] }
        bridged_golfer = team_slots.filter_map { |s| golfer_by_pair[((s.slot_number - 1) / 2) + 1] }.first
        sync_registration_team(team_slots, team_number, bridged_golfer: bridged_golfer)
      end
    end

    true
  end

  private

  def effective_team_size
    [@tournament.team_size.to_i, 1].max
  end

  # =========================================================================
  # Real Teams Sync (Registration + TeamMember with 1:1 sponsor_slot_id)
  # =========================================================================

  def sync_registration_team(team_slots, team_number, bridged_golfer: nil)
    slots = Array(team_slots).compact.sort_by(&:slot_number)
    return if slots.empty?

    filled_slots = slots.select { |s| s.player_name.to_s.strip.present? }
    expected_team_name = "#{@sponsor.name} - Team #{team_number}"
    registration = find_existing_registration(slots, expected_team_name)

    if filled_slots.empty?
      if registration && !registration.cancelled?
        Registration.transaction(requires_new: true) do
          registration.cancel!(reason: "Team cancelled via sponsor portal")
        end
        append_audit(registration, "Team cancelled — all sponsor slots cleared via sponsor portal")
      end
      return
    end

    captain_slot = filled_slots.first
    contact_email = captain_email_for(captain_slot, team_number)
    contact_phone = captain_slot.player_phone&.strip.presence || "N/A"
    team_size = effective_team_size

    bridge_golfer_id = resolve_bridge_golfer_id(bridged_golfer, registration)

    Registration.transaction(requires_new: true) do
      if registration
        reg_update = {
          team_name: expected_team_name,
          sponsor_id: @sponsor.id,
          contact_name: captain_slot.player_name.strip,
          contact_email: contact_email,
          contact_phone: contact_phone,
          company: @sponsor.name,
          payment_type: "sponsor",
          payment_status: "paid",
          registration_source: "sponsor",
          registration_status: "confirmed"
        }
        reg_update[:golfer_id] = bridge_golfer_id if bridge_golfer_id.present?
        registration.update!(reg_update)

        # Remove team_members for slots that were cleared
        cleared_slot_ids = (slots - filled_slots).map(&:id)
        if cleared_slot_ids.any?
          registration.team_members.where(sponsor_slot_id: cleared_slot_ids).destroy_all
        end

        # Upsert 1:1 TeamMember per filled SponsorSlot
        filled_slots.each do |slot|
          pos = ((slot.slot_number - 1) % team_size) + 1
          is_cap = (slot.id == captain_slot.id)
          member_attrs = {
            organization_id: @tournament.organization_id,
            tournament_id: @tournament.id,
            sponsor_slot_id: slot.id,
            position: pos,
            is_captain: is_cap,
            name: slot.player_name.strip,
            email: slot.player_email&.strip&.downcase.presence,
            phone: slot.player_phone&.strip.presence,
            tshirt_size: slot.tshirt_size.presence,
            handicap: slot.handicap,
            company: @sponsor.name
          }

          existing_member = registration.team_members.find_by(sponsor_slot_id: slot.id) ||
                            registration.team_members.find_by(position: pos)
          if existing_member
            existing_member.update!(member_attrs)
          else
            registration.team_members.create!(member_attrs)
          end
        end
      else
        members_attrs = filled_slots.map do |slot|
          pos = ((slot.slot_number - 1) % team_size) + 1
          {
            organization_id: @tournament.organization_id,
            tournament_id: @tournament.id,
            sponsor_slot_id: slot.id,
            position: pos,
            is_captain: slot.id == captain_slot.id,
            name: slot.player_name.strip,
            email: slot.player_email&.strip&.downcase.presence,
            phone: slot.player_phone&.strip.presence,
            tshirt_size: slot.tshirt_size.presence,
            handicap: slot.handicap,
            company: @sponsor.name
          }
        end

        registration = @tournament.registrations.create!(
          organization_id: @tournament.organization_id,
          sponsor_id: @sponsor.id,
          golfer_id: bridge_golfer_id,
          team_name: expected_team_name,
          contact_name: captain_slot.player_name.strip,
          contact_email: contact_email,
          contact_phone: contact_phone,
          company: @sponsor.name,
          payment_type: "sponsor",
          payment_status: "paid",
          paid_at: Time.current,
          registration_source: "sponsor",
          registration_status: "confirmed",
          team_members_attributes: members_attrs
        )
        append_audit(registration, "Created via sponsor portal by #{@sponsor.name}")
      end
    end

    begin
      registration.reload.create_raffle_tickets!
    rescue => e
      Rails.logger.warn("Failed to create registration raffle tickets for #{registration.display_team_name}: #{e.message}")
    end
  end

  def resolve_bridge_golfer_id(bridged_golfer, current_registration)
    return nil unless bridged_golfer&.id.present?
    return bridged_golfer.id if current_registration&.golfer_id == bridged_golfer.id

    already_linked = Registration.where(golfer_id: bridged_golfer.id)
    already_linked = already_linked.where.not(id: current_registration.id) if current_registration&.persisted?
    already_linked.exists? ? nil : bridged_golfer.id
  end

  def find_existing_registration(slots, expected_team_name)
    slot_ids = slots.map(&:id)
    if slot_ids.any?
      existing_member = TeamMember.includes(:registration).find_by(sponsor_slot_id: slot_ids)
      return existing_member.registration if existing_member&.registration
    end

    @tournament.registrations.find_by(sponsor_id: @sponsor.id, team_name: expected_team_name)
  end

  # =========================================================================
  # Legacy Golfer Sync (kept intact for backwards compatibility)
  # =========================================================================

  def sync_team(captain_slot, partner_slot, team_number)
    captain_name = captain_slot&.player_name&.strip.presence
    expected_team_name = "#{@sponsor.name} - Team #{team_number}"
    email = captain_email_for(captain_slot, team_number)

    golfer = find_existing_golfer(expected_team_name, email, team_number)

    if captain_name.nil?
      if golfer && golfer.registration_status != 'cancelled'
        Golfer.transaction do
          golfer.clear_group_assignment! if golfer.group.present?
          golfer.cancel!(reason: "Team cancelled via sponsor portal")
        end
        append_audit(golfer, "Team cancelled — captain slot cleared via sponsor portal")
      end
      return
    end

    attrs = {
      name: captain_name,
      email: email,
      phone: captain_slot&.player_phone.presence || 'N/A',
      partner_name: partner_slot&.player_name&.strip.presence,
      partner_email: partner_slot&.player_email&.strip.presence,
      partner_phone: partner_slot&.player_phone&.strip.presence,
      tshirt_size: captain_slot&.tshirt_size.presence,
      partner_tshirt_size: partner_slot&.tshirt_size.presence,
      sponsor_id: @sponsor.id,
      sponsor_name: @sponsor.name,
      payment_type: 'sponsor',
      payment_status: 'paid',
      registration_status: 'confirmed',
      is_team_captain: true,
      team_name: expected_team_name,
      company: @sponsor.name,
      paid_at: Time.current,
    }

    if golfer
      update_attrs = attrs.except(:paid_at)
      changes = detect_changes(golfer, update_attrs)
      golfer.update!(update_attrs)
      append_audit(golfer, "Updated via sponsor portal: #{changes}") if changes.present?
      golfer
    else
      new_golfer = @tournament.golfers.create!(attrs)
      append_audit(new_golfer, "Created via sponsor portal by #{@sponsor.name}")
      new_golfer
    end
  end

  def captain_email_for(captain_slot, team_number)
    real_email = captain_slot&.player_email&.strip&.downcase.presence
    real_email || "sponsor-#{@sponsor.id}-team#{team_number}@sponsored.local"
  end

  def find_existing_golfer(expected_team_name, email, team_number)
    # Primary: find by the stable team_name + sponsor_id (survives email/name changes)
    golfer = @tournament.golfers.find_by(team_name: expected_team_name, sponsor_id: @sponsor.id)
    return golfer if golfer

    # Fallback: find by email + sponsor_id (for records created before team_name was set)
    golfer = @tournament.golfers.find_by(email: email, sponsor_id: @sponsor.id)
    return golfer if golfer

    # Fallback: check placeholder email
    placeholder = "sponsor-#{@sponsor.id}-team#{team_number}@sponsored.local"
    @tournament.golfers.find_by(email: placeholder, sponsor_id: @sponsor.id) if email != placeholder
  end

  def detect_changes(golfer, attrs)
    tracked = [:name, :email, :phone, :partner_name, :partner_email, :partner_phone]
    changes = tracked.filter_map do |field|
      old_val = golfer.send(field)
      new_val = attrs[field]
      next if old_val.to_s.strip == new_val.to_s.strip
      "#{field}: '#{old_val}' → '#{new_val}'"
    end
    changes.join(', ')
  end

  def append_audit(record, message)
    timestamp = Time.current.strftime('%Y-%m-%d %H:%M %Z')
    entry = "[#{timestamp}] #{message}"
    existing = record.notes.to_s
    new_notes = existing.present? ? "#{existing}\n#{entry}" : entry
    record.update_column(:notes, new_notes)
  end
end
