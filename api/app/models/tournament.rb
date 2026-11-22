# frozen_string_literal: true

class Tournament < ApplicationRecord
  MAX_COURSE_HOLES = 18

  # Associations
  belongs_to :organization
  has_many :golfers, dependent: :restrict_with_error
  has_many :registrations, dependent: :restrict_with_error
  has_many :team_members, dependent: :restrict_with_error
  has_many :groups, dependent: :restrict_with_error
  has_many :scores, dependent: :destroy
  has_many :raffle_prizes, dependent: :destroy
  has_many :raffle_sale_batches, dependent: :destroy
  has_many :raffle_tickets, dependent: :destroy
  has_many :sponsors, dependent: :destroy
  has_many :activity_logs, dependent: :nullify
  has_many :message_deliveries, dependent: :nullify
  has_many :tournament_assignments, dependent: :destroy
  has_many :assigned_users, through: :tournament_assignments, source: :user

  # Validations
  validates :name, presence: true
  validates :year, presence: true, numericality: { only_integer: true }
  validates :status, presence: true, inclusion: { in: %w[draft open closed in_progress completed archived] }
  validates :max_capacity, numericality: { only_integer: true, greater_than: 0 }, allow_nil: true
  validates :entry_fee, numericality: { only_integer: true, greater_than_or_equal_to: 0 }, allow_nil: true
  validates :slug, uniqueness: { scope: :organization_id, case_sensitive: false }, allow_blank: true
  validates :event_type, presence: true, inclusion: { in: %w[golf_tournament gala] }
  validate :course_configs_are_valid

  # Callbacks
  before_validation :generate_slug, on: :create
  before_validation :normalize_course_configs_in_config

  # Scopes
  scope :active, -> { where.not(status: 'archived') }
  scope :archived, -> { where(status: 'archived') }
  scope :open_for_registration, -> { where(status: 'open', registration_open: true) }
  scope :by_year, ->(year) { where(year: year) }
  scope :recent, -> { order(year: :desc, created_at: :desc) }
  scope :for_organization, ->(org) { where(organization: org) }

  # Status constants
  STATUSES = %w[draft open closed in_progress completed archived].freeze
  EVENT_TYPES = %w[golf_tournament gala].freeze
  CAPACITY_UNITS = %w[players teams].freeze
  CANONICAL_THEME_PACKS = %w[default-clean charity-bright memorial-formal crest-classic].freeze
  LEGACY_THEME_PRESETS = %w[classic premium minimal event].freeze
  THEME_PRESETS = (CANONICAL_THEME_PACKS + LEGACY_THEME_PRESETS).freeze

  validates :theme_preset, presence: true, inclusion: { in: THEME_PRESETS }
  validates :capacity_unit, presence: true, inclusion: { in: CAPACITY_UNITS }

  def team_categories
    raw = config&.dig('team_categories')
    return [] unless raw.is_a?(Array)

    raw.map { |c| c.to_s.strip }.reject(&:blank?).uniq
  end

  def team_categories_enabled?
    team_categories.any?
  end

  def resolved_theme_pack
    return theme_preset if CANONICAL_THEME_PACKS.include?(theme_preset)

    'default-clean'
  end
  
  # Default sponsor tier definitions
  DEFAULT_SPONSOR_TIERS = [
    { 'key' => 'title',    'label' => 'Title Sponsor',    'sort_order' => 0 },
    { 'key' => 'platinum', 'label' => 'Platinum',         'sort_order' => 1 },
    { 'key' => 'gold',     'label' => 'Gold',             'sort_order' => 2 },
    { 'key' => 'silver',   'label' => 'Silver',           'sort_order' => 3 },
    { 'key' => 'bronze',   'label' => 'Bronze',           'sort_order' => 4 },
    { 'key' => 'hole',     'label' => 'Hole Sponsor',     'sort_order' => 5 }
  ].freeze

  def sponsor_tier_list
    custom = config&.dig('sponsor_tiers')
    return DEFAULT_SPONSOR_TIERS if custom.blank?
    custom.sort_by { |t| t['sort_order'].to_i }
  end

  def sponsor_tier_keys
    sponsor_tier_list.map { |t| t['key'] }
  end

  # Whether complimentary raffle tickets are included with registration
  def raffle_include_with_registration?
    config&.dig('raffle_include_with_registration') == true
  end

  # Whether the public raffle board holds a drawn winner on screen until cleared or next draw
  def raffle_hold_winner_on_screen?
    value = config&.dig('raffle_hold_winner_on_screen')
    return true if value.nil?

    ActiveModel::Type::Boolean.new.cast(value)
  end

  # Configurable raffle bundle options for point-of-sale UI
  DEFAULT_RAFFLE_BUNDLES = [
    { 'quantity' => 4,  'price_cents' => 2000,  'label' => '$20 for 4 tickets' },
    { 'quantity' => 12, 'price_cents' => 5000,  'label' => '$50 for 12 tickets' },
    { 'quantity' => 25, 'price_cents' => 10000, 'label' => '$100 for 25 tickets' }
  ].freeze
  DEFAULT_COURSE_KEY = 'course-1'.freeze

  def raffle_bundles
    custom = config&.dig('raffle_bundles')
    return DEFAULT_RAFFLE_BUNDLES if custom.blank?
    custom
  end

  def course_configs
    current_inputs = course_configs_cache_inputs
    return @course_configs_cache if @course_configs_cache_inputs == current_inputs

    @course_configs_cache_inputs = current_inputs
    @course_configs_cache = self.class.normalize_course_configs(
      current_inputs[:raw_course_configs],
      fallback_hole_count: current_inputs[:fallback_hole_count],
      fallback_course_name: current_inputs[:fallback_course_name]
    )
  end

  def default_course_key
    course_configs.first&.dig('key') || DEFAULT_COURSE_KEY
  end

  def course_config_for(course_key)
    key = course_key.presence || default_course_key
    course_configs.find { |course| course['key'] == key }
  end

  def course_name_for(course_key)
    course_config_for(course_key)&.dig('name') || 'Course'
  end

  def hole_count_for_course(course_key)
    course_config_for(course_key)&.dig('hole_count').to_i
  end

  def multi_course_setup?
    course_configs.length > 1
  end

  def teams_per_start_position
    configured = config&.dig('teams_per_start_position').to_i
    configured.positive? ? configured : 1
  end

  def start_positions_per_hole
    return nil unless config.is_a?(Hash) && config.deep_stringify_keys.key?('start_positions_per_hole')

    configured = config.deep_stringify_keys['start_positions_per_hole'].to_i
    configured.positive? ? configured : nil
  end

  def players_per_start_position
    raw = config&.dig('players_per_start_position')
    if valid_positive_integer_config?(raw)
      return raw.to_i
    end

    (team_size.presence || Group::MAX_GOLFERS_DEFAULT) * teams_per_start_position
  end

  def teams_per_hole
    return nil unless start_positions_per_hole.present?

    teams_per_start_position * start_positions_per_hole
  end

  def players_per_hole
    return nil unless start_positions_per_hole.present?

    players_per_start_position * start_positions_per_hole
  end

  def starting_position_prefix(course_key)
    return nil unless multi_course_setup?

    course_name_for(course_key)
  end

  def starting_hole_description(course_key, hole_number)
    return nil unless hole_number.present?

    if multi_course_setup?
      "#{course_name_for(course_key)} Hole #{hole_number}"
    else
      "Hole #{hole_number}"
    end
  end

  # Format constants
  FORMATS = %w[scramble stroke stableford best_ball match captain_choice custom].freeze
  
  # Scoring type constants
  SCORING_TYPES = %w[gross net both stableford].freeze
  
  # Team size constants
  TEAM_SIZES = [1, 2, 4].freeze

  # Format validations
  validates :tournament_format, inclusion: { in: FORMATS }, allow_nil: true
  validates :scoring_type, inclusion: { in: SCORING_TYPES }, allow_nil: true
  validates :team_size, inclusion: { in: TEAM_SIZES }, allow_nil: true
  validate :team_size_not_below_existing_registrations
  validate :teams_per_start_position_is_valid
  validate :players_per_start_position_is_valid
  validate :start_positions_per_hole_is_valid
  
  # Alias for backwards compatibility with 'format_name' column
  def format
    tournament_format
  end

  # Class methods
  def self.current_for(organization)
    return nil unless organization

    scope = for_organization(organization)
    scope.open_for_registration.recent.first || scope.active.recent.first
  end

  def self.find_by_org_and_slug!(organization, slug)
    for_organization(organization).find_by!(slug: slug.downcase)
  end

  # Status checks
  def draft?
    status == 'draft'
  end

  def open?
    status == 'open'
  end

  def closed?
    status == 'closed'
  end

  def in_progress?
    status == 'in_progress'
  end

  def completed?
    status == 'completed'
  end

  def archived?
    status == 'archived'
  end

  def golf_tournament?
    event_type == 'golf_tournament'
  end

  def gala?
    event_type == 'gala'
  end

  # Money helpers
  def entry_fee_dollars
    return 0.00 if entry_fee.nil?
    entry_fee / 100.0
  end

  def early_bird_fee_dollars
    return 0.00 if early_bird_fee.nil?
    early_bird_fee / 100.0
  end

  def current_fee
    early_bird_active? ? early_bird_fee : entry_fee
  end

  def current_fee_dollars
    (current_fee || 0) / 100.0
  end

  # Early bird pricing
  def early_bird_active?
    return false if early_bird_fee.nil? || early_bird_deadline.nil?
    Time.current < early_bird_deadline
  end

  def early_bird_expired?
    return true if early_bird_deadline.nil?
    Time.current >= early_bird_deadline
  end

  # Registration deadlines
  def registration_deadline_passed?
    return false if registration_deadline.nil?
    Time.current >= registration_deadline
  end

  def can_register?
    return false unless open? && registration_open? && !registration_deadline_passed?
    return true unless public_at_capacity?
    return false unless waitlist_enabled?
    return true if waitlist_max.nil? || waitlist_max == 0
    waitlist_count < waitlist_max
  end

  # Single-query stats computation — replaces 8+ individual COUNT queries
  def golfer_stats
    @golfer_stats ||= begin
      row = Golfer.where(tournament_id: id).pick(
        Arel.sql("COUNT(*) FILTER (WHERE registration_status = 'confirmed')"),
        Arel.sql("COUNT(*) FILTER (WHERE registration_status = 'confirmed' AND payment_type != 'sponsor')"),
        Arel.sql("COUNT(*) FILTER (WHERE registration_status = 'confirmed' AND payment_type = 'sponsor')"),
        Arel.sql("COUNT(*) FILTER (WHERE registration_status = 'confirmed' AND payment_status = 'paid')"),
        Arel.sql("COUNT(*) FILTER (WHERE registration_status = 'confirmed' AND payment_status != 'paid' AND payment_type != 'sponsor')"),
        Arel.sql("COUNT(*) FILTER (WHERE registration_status = 'waitlist')"),
        Arel.sql("COUNT(*) FILTER (WHERE checked_in_at IS NOT NULL)")
      )
      {
        confirmed: row[0].to_i,
        public_confirmed: row[1].to_i,
        sponsor_confirmed: row[2].to_i,
        paid: row[3].to_i,
        pending_payment: row[4].to_i,
        waitlist: row[5].to_i,
        checked_in: row[6].to_i
      }
    end
  end

  def confirmed_count
    golfer_stats[:confirmed]
  end

  def public_confirmed_count
    golfer_stats[:public_confirmed]
  end

  def sponsor_confirmed_count
    golfer_stats[:sponsor_confirmed]
  end

  def sponsor_reserved_slots
    if sponsors.loaded?
      sponsors.select(&:active?).sum(&:slot_count).to_i
    else
      sponsors.active.sum(:slot_count).to_i
    end
  end

  def sponsor_reserved_teams
    @sponsor_reserved_teams ||= begin
      divisor = [team_size.to_i, 1].max
      active_sponsors = sponsors.loaded? ? sponsors.select(&:active?) : sponsors.active.to_a
      active_sponsors.sum do |sponsor|
        slots = sponsor.slot_count.to_i
        slots.positive? ? ((slots + divisor - 1) / divisor) : 0
      end
    end
  end

  def sponsor_reserved_units
    capacity_unit == "teams" ? sponsor_reserved_teams : sponsor_reserved_slots
  end

  def capacity_summary
    unit = capacity_unit.presence || "players"
    effective_team_size = [team_size.to_i, 1].max
    sponsor_slots_total = sponsor_reserved_slots
    sponsor_reserved = unit == "teams" ? sponsor_reserved_teams : sponsor_slots_total
    effective_reserved = [reserved_slots.to_i, sponsor_reserved].max
    public_cap = max_capacity.nil? ? nil : [max_capacity - effective_reserved, 0].max

    # Registrations + TeamMembers counts
    reg_confirmed_count = registrations.confirmed.count
    reg_public_confirmed_count = registrations.confirmed.where("COALESCE(payment_type, '') != 'sponsor'").count
    reg_sponsor_confirmed_count = registrations.confirmed.where(payment_type: "sponsor").count
    reg_waitlist_count = registrations.waitlist.count

    reg_confirmed_players = team_members.joins(:registration)
      .where(registrations: { registration_status: "confirmed" })
      .count
    reg_public_confirmed_players = team_members.joins(:registration)
      .where(registrations: { registration_status: "confirmed" })
      .where("COALESCE(registrations.payment_type, '') != 'sponsor'")
      .count
    reg_sponsor_confirmed_players = team_members.joins(:registration)
      .where(registrations: { registration_status: "confirmed", payment_type: "sponsor" })
      .count
    reg_waitlist_players = team_members.joins(:registration)
      .where(registrations: { registration_status: "waitlist" })
      .count

    # Unlinked legacy golfers (not bridged to a Registration via golfer_id)
    bridged_golfer_ids = registrations.where.not(golfer_id: nil).select(:golfer_id)
    unlinked_golfers = golfers.where.not(id: bridged_golfer_ids)

    legacy_row = unlinked_golfers.pick(
      Arel.sql("COUNT(*) FILTER (WHERE registration_status = 'confirmed')"),
      Arel.sql("COUNT(*) FILTER (WHERE registration_status = 'confirmed' AND COALESCE(payment_type, '') != 'sponsor')"),
      Arel.sql("COUNT(*) FILTER (WHERE registration_status = 'confirmed' AND payment_type = 'sponsor')"),
      Arel.sql("COUNT(*) FILTER (WHERE registration_status = 'waitlist')"),
      Arel.sql("COALESCE(SUM(CASE WHEN registration_status = 'confirmed' THEN CASE WHEN NULLIF(partner_name, '') IS NOT NULL THEN 2 ELSE 1 END ELSE 0 END), 0)"),
      Arel.sql("COALESCE(SUM(CASE WHEN registration_status = 'confirmed' AND COALESCE(payment_type, '') != 'sponsor' THEN CASE WHEN NULLIF(partner_name, '') IS NOT NULL THEN 2 ELSE 1 END ELSE 0 END), 0)"),
      Arel.sql("COALESCE(SUM(CASE WHEN registration_status = 'confirmed' AND payment_type = 'sponsor' THEN CASE WHEN NULLIF(partner_name, '') IS NOT NULL THEN 2 ELSE 1 END ELSE 0 END), 0)"),
      Arel.sql("COALESCE(SUM(CASE WHEN registration_status = 'waitlist' THEN CASE WHEN NULLIF(partner_name, '') IS NOT NULL THEN 2 ELSE 1 END ELSE 0 END), 0)")
    )

    confirmed_regs_count = reg_confirmed_count + legacy_row[0].to_i
    public_confirmed_regs_count = reg_public_confirmed_count + legacy_row[1].to_i
    sponsor_confirmed_regs_count = reg_sponsor_confirmed_count + legacy_row[2].to_i
    waitlist_regs_count = reg_waitlist_count + legacy_row[3].to_i

    confirmed_players_count = reg_confirmed_players + legacy_row[4].to_i
    public_confirmed_players_count = reg_public_confirmed_players + legacy_row[5].to_i
    sponsor_confirmed_players_count = reg_sponsor_confirmed_players + legacy_row[6].to_i
    waitlist_players_count = reg_waitlist_players + legacy_row[7].to_i

    if unit == "teams"
      confirmed_units = confirmed_regs_count
      public_confirmed_units = public_confirmed_regs_count
      sponsor_confirmed_units = sponsor_confirmed_regs_count
      waitlist_units = waitlist_regs_count
    else
      confirmed_units = confirmed_players_count
      public_confirmed_units = public_confirmed_players_count
      sponsor_confirmed_units = sponsor_confirmed_players_count
      waitlist_units = waitlist_players_count
    end

    overall_remaining = max_capacity.nil? ? nil : [max_capacity - confirmed_units, 0].max
    raw_public_remaining = public_cap.nil? ? nil : [public_cap - public_confirmed_units, 0].max
    bounded_public_remaining =
      if overall_remaining.nil?
        raw_public_remaining
      elsif raw_public_remaining.nil?
        overall_remaining
      else
        [raw_public_remaining, overall_remaining].min
      end

    {
      capacity_unit: unit,
      team_size: effective_team_size,
      allow_partial_teams: allow_partial_teams?,
      max_capacity: max_capacity,
      reserved_slots: reserved_slots.to_i,
      sponsor_reserved_slots: sponsor_slots_total,
      sponsor_reserved: sponsor_reserved,
      effective_reserved: effective_reserved,
      public_capacity: public_cap,
      confirmed_units: confirmed_units,
      public_confirmed_units: public_confirmed_units,
      sponsor_confirmed_units: sponsor_confirmed_units,
      waitlist_units: waitlist_units,
      confirmed_registrations_count: confirmed_regs_count,
      confirmed_players_count: confirmed_players_count,
      waitlist_registrations_count: waitlist_regs_count,
      waitlist_players_count: waitlist_players_count,
      remaining: overall_remaining,
      public_remaining: bounded_public_remaining,
      at_capacity: max_capacity.present? && overall_remaining <= 0,
      public_at_capacity: public_cap.present? && bounded_public_remaining <= 0
    }
  end

  def public_capacity_available_for?(player_count: 1)
    summary = capacity_summary
    return true if summary[:max_capacity].nil?

    units_needed = summary[:capacity_unit] == "teams" ? 1 : [player_count.to_i, 1].max
    summary[:public_remaining] >= units_needed && summary[:remaining] >= units_needed
  end

  def registration_waitlist_full?(player_count: 1)
    return false if waitlist_max.nil? || waitlist_max.to_i <= 0

    summary = capacity_summary
    units_needed = summary[:capacity_unit] == "teams" ? 1 : [player_count.to_i, 1].max
    summary[:waitlist_units] + units_needed > waitlist_max.to_i
  end

  def registration_status_for_new_entry(player_count: 1, registration_source: "public", payment_type: nil)
    return "confirmed" if registration_source == "admin" || payment_type == "sponsor"
    return "confirmed" if public_capacity_available_for?(player_count: player_count)

    waitlist_enabled? ? "waitlist" : "confirmed"
  end

  def can_accept_public_registration?(player_count: 1)
    return false unless open? && registration_open? && !registration_deadline_passed?
    return true if public_capacity_available_for?(player_count: player_count)
    return false unless waitlist_enabled?

    !registration_waitlist_full?(player_count: player_count)
  end

  def paid_count
    golfer_stats[:paid]
  end

  def pending_payment_count
    golfer_stats[:pending_payment]
  end

  def waitlist_count
    golfer_stats[:waitlist]
  end

  def checked_in_count
    golfer_stats[:checked_in]
  end

  def capacity_remaining
    return nil if max_capacity.nil?
    remaining = max_capacity - confirmed_count
    remaining.negative? ? 0 : remaining
  end

  def public_capacity
    return max_capacity if max_capacity.nil?
    reserved = [reserved_slots || 0, sponsor_reserved_teams].max
    public_cap = max_capacity - reserved
    public_cap.negative? ? 0 : public_cap
  end

  def public_capacity_remaining
    return public_capacity if public_capacity.nil?
    remaining = public_capacity - public_confirmed_count
    remaining.negative? ? 0 : remaining
  end

  def public_at_capacity?
    return false if max_capacity.nil?
    public_confirmed_count >= public_capacity
  end

  def at_capacity?
    return false if max_capacity.nil?
    confirmed_count >= max_capacity
  end

  # Display helpers
  def display_name
    "#{edition} #{name} (#{year})".strip
  end

  def short_name
    name.presence || "#{year} Tournament"
  end

  def full_url(base_url = nil)
    return nil unless organization
    return "#{base_url.to_s.chomp('/')}/#{slug}" if base_url.present?

    OrgUrlBuilder.public_url(organization, "/#{slug}")
  end

  # Actions
  def archive!
    update!(status: 'archived', registration_open: false, walkin_registration_open: false)
  end

  def can_open_registration?
    status.in?(%w[draft closed])
  end

  def open_registration!
    unless can_open_registration?
      errors.add(:status, 'must be draft or closed to open registration')
      raise ActiveRecord::RecordInvalid, self
    end

    update!(status: 'open', registration_open: true)
  end

  def close_registration!
    update!(registration_open: false, walkin_registration_open: false)
  end

  def can_complete?
    status.in?(%w[open closed in_progress])
  end

  def start!
    update!(status: 'in_progress', registration_open: false, walkin_registration_open: false)
  end

  def complete!
    unless can_complete?
      errors.add(:status, 'must be open, closed, or in progress to complete')
      raise ActiveRecord::RecordInvalid, self
    end

    update!(status: 'completed', registration_open: false, walkin_registration_open: false)
  end

  # Copy tournament for next year
  def copy_for_next_year
    Tournament.new(
      organization: organization,
      event_type: event_type,
      name: name,
      year: year + 1,
      edition: increment_edition,
      status: 'draft',
      event_date: nil,
      registration_time: registration_time,
      check_in_time: check_in_time,
      start_time: start_time,
      location_name: location_name,
      location_address: location_address,
      tournament_format: tournament_format,
      scoring_type: scoring_type,
      team_size: team_size,
      capacity_unit: capacity_unit,
      allow_partial_teams: allow_partial_teams,
      shotgun_start: shotgun_start,
      tee_times_enabled: tee_times_enabled,
      tee_time_interval_minutes: tee_time_interval_minutes,
      total_holes: total_holes,
      total_par: total_par,
      course_name: course_name,
      tee_name: tee_name,
      course_rating: course_rating,
      slope_rating: slope_rating,
      hole_pars: hole_pars,
      hole_handicaps: hole_handicaps,
      use_flights: use_flights,
      flights_config: flights_config,
      handicap_required: handicap_required,
      handicap_max: handicap_max,
      max_capacity: max_capacity,
      reserved_slots: reserved_slots,
      entry_fee: entry_fee,
      entry_fee_display: entry_fee_display,
      early_bird_fee: early_bird_fee,
      employee_entry_fee: employee_entry_fee,
      employee_discount_enabled: employee_discount_enabled,
      format_name: format_name,
      fee_includes: fee_includes,
      checks_payable_to: checks_payable_to,
      payment_instructions: payment_instructions,
      allow_cash: allow_cash,
      allow_check: allow_check,
      allow_card: allow_card,
      waitlist_enabled: waitlist_enabled,
      waitlist_max: waitlist_max,
      contact_name: contact_name,
      contact_phone: contact_phone,
      contact_email: contact_email,
      raffle_enabled: raffle_enabled,
      raffle_ticket_price_cents: raffle_ticket_price_cents,
      raffle_description: raffle_description,
      raffle_auto_draw: raffle_auto_draw,
      raffle_max_tickets_per_person: raffle_max_tickets_per_person,
      raffle_tickets_per_purchase: raffle_tickets_per_purchase,
      walkin_fee: walkin_fee,
      sponsor_edit_deadline: sponsor_edit_deadline,
      event_schedule: event_schedule,
      tournament_info: tournament_info,
      public_listed: public_listed,
      use_org_branding: use_org_branding,
      theme_preset: theme_preset,
      primary_color_override: primary_color_override,
      accent_color_override: accent_color_override,
      logo_url_override: logo_url_override,
      signature_image_url_override: signature_image_url_override,
      banner_url_override: banner_url_override,
      swipe_simple_url: swipe_simple_url,
      walkin_swipe_simple_url: walkin_swipe_simple_url,
      registration_open: false,
      walkin_registration_open: false,
      config: config&.deep_dup || {}
    )
  end

  private

  def course_configs_cache_inputs
    {
      raw_course_configs: config&.dig('course_configs')&.deep_dup,
      fallback_hole_count: total_holes || 18,
      fallback_course_name: course_name.presence || 'Course'
    }
  end

  def normalize_course_configs_in_config
    @course_configs_input_present = false
    @raw_course_configs_input = nil

    return unless config.is_a?(Hash)

    stringified = config.deep_stringify_keys
    @course_configs_input_present = stringified.key?('course_configs')
    @raw_course_configs_input = stringified['course_configs']
    if @course_configs_input_present
      stringified['course_configs'] = self.class.normalize_course_configs(
        stringified['course_configs'],
        fallback_hole_count: total_holes || 18,
        fallback_course_name: course_name.presence || 'Course'
      )
    end

    self.config = stringified
  end

  def course_configs_are_valid
    validate_raw_course_configs_input if @course_configs_input_present
  end

  def valid_positive_integer_config?(value)
    return false if value.nil? || value == true || value == false
    return value.positive? if value.is_a?(Integer)
    return false unless value.is_a?(String) && value.strip.match?(/\A\d+\z/)

    value.strip.to_i.positive?
  end

  def team_size_not_below_existing_registrations
    return unless persisted? && will_save_change_to_team_size? && team_size.present?

    max_existing = TeamMember.joins(:registration)
      .where(registrations: { tournament_id: id })
      .where.not(registrations: { registration_status: "cancelled" })
      .group(:registration_id)
      .count
      .values
      .max
      .to_i

    return if max_existing <= team_size

    errors.add(:team_size, "cannot be reduced below #{max_existing} because existing active registrations have #{max_existing} players")
  end

  def players_per_start_position_is_valid
    return unless config.is_a?(Hash) && config.deep_stringify_keys.key?('players_per_start_position')

    value = config.deep_stringify_keys['players_per_start_position']
    return if value.nil? || (value.is_a?(String) && value.strip.empty?)

    if valid_positive_integer_config?(value) && value.to_i <= 16
      return
    end

    errors.add(:config, 'Players per start position must be an integer between 1 and 16')
  end

  def teams_per_start_position_is_valid
    return unless config.is_a?(Hash) && config.deep_stringify_keys.key?('teams_per_start_position')

    value = config.deep_stringify_keys['teams_per_start_position']
    numeric = value.to_i
    return if value.to_s == numeric.to_s && numeric.positive? && numeric <= 4

    errors.add(:config, 'Teams per start position must be an integer between 1 and 4')
  end

  def start_positions_per_hole_is_valid
    return unless config.is_a?(Hash) && config.deep_stringify_keys.key?('start_positions_per_hole')

    value = config.deep_stringify_keys['start_positions_per_hole']
    return if value.blank?

    numeric = value.to_i
    return if value.to_s == numeric.to_s && numeric.positive? && numeric <= 26

    errors.add(:config, 'Start positions per hole must be blank or an integer between 1 and 26')
  end

  def validate_raw_course_configs_input
    raw_configs = Array(@raw_course_configs_input)

    if raw_configs.blank?
      errors.add(:config, 'At least one course must be configured')
      return
    end

    effective_keys = raw_configs.filter_map.with_index do |entry, idx|
      next unless entry.respond_to?(:to_h)

      self.class.normalized_course_config_key(entry.to_h.stringify_keys, idx)
    end

    if effective_keys.uniq.length != effective_keys.length
      errors.add(:config, 'Course configuration keys must be unique')
      return
    end

    invalid = raw_configs.any? do |entry|
      next true unless entry.respond_to?(:to_h)

      data = entry.to_h.stringify_keys
      hole_count = data['hole_count'].to_i
      data['name'].to_s.strip.blank? || hole_count <= 0 || hole_count > MAX_COURSE_HOLES
    end

    errors.add(:config, "Course configuration is invalid") if invalid
  end

  def self.normalize_course_configs(raw_configs, fallback_hole_count:, fallback_course_name:)
    entries = Array(raw_configs).filter_map.with_index do |entry, idx|
      next unless entry.respond_to?(:to_h)

      data = entry.to_h.stringify_keys
      name = data['name'].to_s.strip
      hole_count = data['hole_count'].to_i
      next if name.blank? || hole_count <= 0

      {
        'key' => normalized_course_config_key(data, idx),
        'name' => name,
        'hole_count' => hole_count
      }
    end

    if entries.blank?
      [{
        'key' => DEFAULT_COURSE_KEY,
        'name' => fallback_course_name.presence || 'Course',
        'hole_count' => [fallback_hole_count.to_i, 1].max
      }]
    else
      entries.uniq { |course| course['key'] }
    end
  end

  def self.normalized_course_config_key(data, idx)
    data['key'].to_s.strip.presence || "course-#{idx + 1}"
  end

  def generate_slug
    return if slug.present?
    return unless name.present?

    base_slug = name.downcase.gsub(/[^a-z0-9]+/, '-').gsub(/^-|-$/, '')
    base_slug = "#{base_slug}-#{year}" if year.present?
    
    # Ensure uniqueness within organization
    candidate = base_slug
    counter = 1
    while Tournament.exists?(organization_id: organization_id, slug: candidate)
      candidate = "#{base_slug}-#{counter}"
      counter += 1
    end
    
    self.slug = candidate
  end

  def increment_edition
    return '1st' if edition.blank?
    
    current_num = edition.to_i
    next_num = current_num + 1
    
    case next_num
    when 1 then '1st'
    when 2 then '2nd'
    when 3 then '3rd'
    else "#{next_num}th"
    end
  end
end
