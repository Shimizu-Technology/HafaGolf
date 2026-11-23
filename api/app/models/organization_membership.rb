# frozen_string_literal: true

class OrganizationMembership < ApplicationRecord
  belongs_to :user
  belongs_to :organization

  CAPABILITIES = %w[
    check_in
    verify_door_payment
    raffle_sell
    raffle_draw
    manage_golfers
    manage_groups
    manage_sponsors
    manage_raffle_prizes
    view_reports
    manage_finances
    manage_settings
    manage_team
    send_broadcasts
    enter_scores
  ].freeze

  CAPABILITY_CATALOG = [
    { key: "check_in", label: "Player Check-In", category: "Day-Of Ops", description: "Search roster and check golfers in or out" },
    { key: "verify_door_payment", label: "Verify Door Payments", category: "Day-Of Ops", description: "Confirm cash, check, or card payments at the check-in desk" },
    { key: "raffle_sell", label: "Sell Raffle Tickets", category: "Raffle", description: "Sell walk-up raffle tickets and edit buyer contact info" },
    { key: "raffle_draw", label: "Run Live Raffle Draw", category: "Raffle", description: "Draw winners, reset prizes, and mark prizes claimed" },
    { key: "manage_raffle_prizes", label: "Manage Raffle Prizes & Void Tickets", category: "Raffle", description: "Create/edit prizes, mark tickets paid, and void tickets" },
    { key: "manage_golfers", label: "Manage Registrations", category: "Event Ops", description: "Edit golfers, promote/demote waitlist, cancel registrations" },
    { key: "manage_groups", label: "Hole Assignments & Pairings", category: "Event Ops", description: "Assign foursomes to holes and generate pairings" },
    { key: "manage_sponsors", label: "Manage Sponsors", category: "Event Ops", description: "Manage sponsor tiers, logos, and sponsor team slots" },
    { key: "enter_scores", label: "Enter Scores", category: "Scoring", description: "Enter and verify hole-by-hole scores on the course" },
    { key: "send_broadcasts", label: "Send Day-Of Broadcasts", category: "Communications", description: "Send tournament SMS/email announcements to golfers or groups" },
    { key: "view_reports", label: "View Financial & Payment Reports", category: "Finance", description: "View revenue totals, payment ledger, and reconciliation exports" },
    { key: "manage_finances", label: "Manage Refunds & Settlements", category: "Finance", description: "Issue refunds and manage payout settings" },
    { key: "manage_settings", label: "Organization & Event Settings", category: "Governance", description: "Edit branding, Homepage Studio, modules, and domains" },
    { key: "manage_team", label: "Manage Team & Roles", category: "Governance", description: "Invite, edit permissions, and remove staff or volunteers" }
  ].freeze

  COORDINATOR_CAPABILITIES = %w[
    check_in verify_door_payment raffle_sell raffle_draw
    manage_golfers manage_groups manage_sponsors manage_raffle_prizes
    view_reports send_broadcasts enter_scores
  ].freeze

  ROLE_PRESETS = {
    "org_admin" => {
      label: "Org Admin",
      description: "Full access to all events, finances, settings, Homepage Studio, and team management.",
      capabilities: CAPABILITIES
    },
    "admin" => {
      label: "Org Admin",
      description: "Full access to all events, finances, settings, Homepage Studio, and team management.",
      capabilities: CAPABILITIES
    },
    "coordinator" => {
      label: "Tournament Coordinator",
      description: "Runs event operations: registrations, pairings, sponsors, check-in, raffle draw, reports, and broadcasts. No billing, org settings, or team management.",
      capabilities: COORDINATOR_CAPABILITIES
    },
    "checkin_volunteer" => {
      label: "Check-In Volunteer",
      description: "Dedicated Check-In Station: search players, check them in, and verify door payments. No financial totals, settings, or raffle draw.",
      capabilities: %w[check_in verify_door_payment]
    },
    "raffle_volunteer" => {
      label: "Raffle Volunteer",
      description: "Dedicated Raffle POS Station: sell raffle tickets and resend buyer confirmations. Cannot draw winners, reset prizes, or view finances.",
      capabilities: %w[raffle_sell]
    },
    "scoring_marshal" => {
      label: "Scoring Marshal",
      description: "Course scoring access only: enter and verify hole scores.",
      capabilities: %w[enter_scores]
    },
    "volunteer" => {
      label: "Volunteer (Legacy)",
      description: "Legacy check-in and raffle ticket sales volunteer without financial or draw access.",
      capabilities: %w[check_in verify_door_payment raffle_sell]
    },
    "member" => {
      label: "Member",
      description: "Basic organization member without admin permissions.",
      capabilities: []
    }
  }.freeze

  CANONICAL_ROLES = %w[org_admin coordinator checkin_volunteer raffle_volunteer scoring_marshal].freeze
  ADMIN_ROLES = %w[admin org_admin].freeze
  STAFF_ROLES = %w[admin org_admin coordinator checkin_volunteer raffle_volunteer scoring_marshal volunteer].freeze
  ROLES = (CANONICAL_ROLES + %w[admin volunteer member]).freeze

  validates :role, presence: true, inclusion: { in: ROLES }
  validates :user_id, uniqueness: { scope: :organization_id, message: "is already a member of this organization" }
  validate :validate_permissions_shape
  validate :validate_scoped_tournament_ids

  scope :admins, -> { where(role: ADMIN_ROLES) }
  scope :members, -> { where(role: "member") }
  scope :volunteers, -> { where(role: %w[volunteer checkin_volunteer raffle_volunteer scoring_marshal]) }
  scope :staff, -> { where(role: STAFF_ROLES) }

  def self.role_catalog
    CANONICAL_ROLES.map do |key|
      meta = ROLE_PRESETS.fetch(key)
      {
        key: key,
        label: meta[:label],
        description: meta[:description],
        default_capabilities: meta[:capabilities]
      }
    end
  end

  def self.all_capabilities_map(value = true)
    CAPABILITIES.index_with { value }
  end

  def canonical_role
    return "org_admin" if role == "admin"

    role
  end

  def role_label
    ROLE_PRESETS.dig(role, :label) || role.to_s.humanize
  end

  def admin?
    ADMIN_ROLES.include?(role)
  end

  def member?
    role == "member"
  end

  def volunteer?
    %w[volunteer checkin_volunteer raffle_volunteer scoring_marshal].include?(role)
  end

  def effective_capabilities
    preset = ROLE_PRESETS.dig(role, :capabilities) || []
    base = CAPABILITIES.index_with { |cap| preset.include?(cap) }
    return base unless permissions.is_a?(Hash) && permissions.any?

    overrides = permissions.each_with_object({}) do |(k, v), acc|
      key = k.to_s
      acc[key] = v if CAPABILITIES.include?(key) && (v == true || v == false)
    end
    base.merge(overrides)
  end

  def tournament_allowed?(tournament_or_id)
    return true if admin?
    return true if scoped_tournament_ids.blank?

    tid = tournament_or_id.respond_to?(:id) ? tournament_or_id.id : tournament_or_id.to_i
    scoped_tournament_ids.include?(tid)
  end

  def can?(capability, tournament: nil)
    return false unless CAPABILITIES.include?(capability.to_s)
    return false if tournament.present? && !tournament_allowed?(tournament)

    effective_capabilities[capability.to_s] == true
  end

  def station_mode
    return nil if admin?

    caps = effective_capabilities
    admin_surface_caps = %w[manage_golfers manage_groups manage_sponsors manage_raffle_prizes view_reports manage_finances manage_settings manage_team send_broadcasts raffle_draw]
    return nil if admin_surface_caps.any? { |c| caps[c] }

    return "checkin" if caps["check_in"]
    return "raffle" if caps["raffle_sell"]
    return "scoring" if caps["enter_scores"]

    nil
  end

  def promote_to_admin!
    update!(role: "org_admin")
  end

  def demote_to_member!
    update!(role: "member", permissions: {}, scoped_tournament_ids: [])
  end

  private

  def validate_permissions_shape
    if permissions.nil?
      self.permissions = {}
      return
    end

    unless permissions.is_a?(Hash)
      errors.add(:permissions, "must be a JSON object of capability booleans")
      return
    end

    permissions.each do |k, v|
      unless CAPABILITIES.include?(k.to_s)
        errors.add(:permissions, "contains unknown capability '#{k}'")
      end
      unless v == true || v == false
        errors.add(:permissions, "'#{k}' must be a boolean")
      end
    end
  end

  def validate_scoped_tournament_ids
    if scoped_tournament_ids.nil?
      self.scoped_tournament_ids = []
      return
    end

    unless scoped_tournament_ids.is_a?(Array)
      errors.add(:scoped_tournament_ids, "must be an array of tournament IDs")
      return
    end

    cleaned = scoped_tournament_ids.map(&:to_i).select(&:positive?).uniq
    self.scoped_tournament_ids = cleaned
    return if cleaned.empty? || organization_id.blank?

    valid_count = Tournament.where(organization_id: organization_id, id: cleaned).count
    if valid_count != cleaned.size
      errors.add(:scoped_tournament_ids, "contains tournaments that do not belong to this organization")
    end
  end
end
