class TournamentSerializer < ActiveModel::Serializer
  attributes :id, :name, :slug, :year, :edition, :event_type, :status,
             :event_date, :registration_time, :start_time,
             :location_name, :location_address,
             :max_capacity, :reserved_slots,
             :entry_fee, :entry_fee_dollars,
             :format_name, :fee_includes, :tournament_info, :checks_payable_to,
             :contact_name, :contact_phone, :contact_email,
             :registration_open, :can_register,
             :confirmed_count, :public_confirmed_count, :sponsor_confirmed_count,
             :sponsor_reserved_teams, :waitlist_count,
             :capacity_remaining, :at_capacity,
             :public_capacity, :public_capacity_remaining, :public_at_capacity,
             :checked_in_count, :paid_count, :pending_payment_count,
             :display_name, :short_name,
             :organization_id, :organization_slug,
             # New configuration fields
             :tournament_format, :scoring_type, :team_size, :capacity_unit, :team_categories, :capacity_summary, :teams_per_start_position, :start_positions_per_hole, :players_per_start_position, :teams_per_hole, :players_per_hole, :allow_partial_teams,
             :handicap_required, :handicap_max,
             :use_flights, :flights_config,
             # Pricing
             :early_bird_fee, :early_bird_fee_dollars, :early_bird_deadline,
             :early_bird_active, :current_fee, :current_fee_dollars,
             :employee_entry_fee, :employee_entry_fee_dollars,
             # Registration
             :registration_deadline, :waitlist_enabled, :waitlist_max,
             # Payment
             :payment_instructions, :allow_cash, :allow_check, :allow_card,
             :payment_mode, :processor_provider, :external_checkout_configured,
             :swipe_simple_url, :walkin_swipe_simple_url,
             :entry_fee_display, :formatted_entry_fee_display, :banner_url_override, :logo_url_override,
             :primary_color_override, :accent_color_override, :signature_image_url_override,
             :theme_preset, :use_org_branding, :homepage_config,
             :commemorative_banner_url, :tribute_title, :tribute_subtitle, :story_photos,
             :waiver_enabled, :waiver_text, :show_public_sponsors, :sponsor_wall_title,
             # Raffle
             :raffle_enabled, :raffle_ticket_price_cents, :raffle_draw_time,
             :raffle_description, :raffle_auto_draw,
             :raffle_max_tickets_per_person, :raffle_tickets_per_purchase,
             :raffle_include_with_registration, :raffle_hold_winner_on_screen, :raffle_bundles,
             # Walk-in
             :walkin_fee, :walkin_registration_open,
             # Sponsor
             :sponsor_edit_deadline, :sponsor_tiers, :allow_sponsor_check_invoice,
             # IRS >$75 Quid-Pro-Quo Tax Receipts
             :tax_receipt_enabled, :tax_org_name, :tax_org_ein,
             :fmv_per_player_cents, :tax_receipt_disclaimer,
             # Schedule
             :check_in_time, :shotgun_start, :tee_times_enabled, :tee_time_interval_minutes,
             :event_schedule,
             # Course configuration
             :total_holes, :course_configs,
             # Resolved platform features
             :features, :feature_overrides,
             :created_at, :updated_at

  def organization_slug
    object.organization&.slug
  end

  def early_bird_fee_dollars
    object.early_bird_fee_dollars
  end

  def early_bird_active
    object.early_bird_active?
  end

  def current_fee
    object.current_fee
  end

  def current_fee_dollars
    object.current_fee_dollars
  end

  def entry_fee_dollars
    object.entry_fee_dollars
  end

  def formatted_entry_fee_display
    object.formatted_entry_fee_display
  end

  def payment_mode
    memoized_payment_config&.payment_mode || "offline"
  end

  def processor_provider
    memoized_payment_config&.processor_provider || "none"
  end

  def external_checkout_configured
    object.swipe_simple_url.present? || memoized_payment_config&.external_checkout_url.present?
  end

  def memoized_payment_config
    return @memoized_payment_config if defined?(@memoized_payment_config)

    @memoized_payment_config = object.organization&.effective_payment_config
  end

  def employee_entry_fee_dollars
    object.employee_entry_fee_dollars
  end

  def can_register
    object.can_register?
  end

  def confirmed_count
    memoized_capacity_summary[:confirmed_units]
  end

  def public_confirmed_count
    memoized_capacity_summary[:public_confirmed_units]
  end

  def sponsor_confirmed_count
    memoized_capacity_summary[:sponsor_confirmed_units]
  end

  def sponsor_reserved_teams
    object.sponsor_reserved_teams
  end

  def waitlist_count
    memoized_capacity_summary[:waitlist_units]
  end

  def capacity_remaining
    memoized_capacity_summary[:remaining]
  end

  def at_capacity
    memoized_capacity_summary[:at_capacity]
  end

  def public_capacity
    memoized_capacity_summary[:public_capacity]
  end

  def public_capacity_remaining
    memoized_capacity_summary[:public_remaining]
  end

  def public_at_capacity
    memoized_capacity_summary[:public_at_capacity]
  end

  def checked_in_count
    object.checked_in_count
  end

  def paid_count
    object.paid_count
  end

  def pending_payment_count
    object.pending_payment_count
  end

  def display_name
    object.display_name
  end

  def short_name
    object.short_name
  end

  def sponsor_tiers
    object.sponsor_tier_list
  end

  def raffle_include_with_registration
    object.raffle_include_with_registration?
  end

  def raffle_hold_winner_on_screen
    object.raffle_hold_winner_on_screen?
  end

  def raffle_bundles
    object.raffle_bundles
  end

  def course_configs
    object.course_configs
  end

  def team_categories
    object.team_categories
  end

  def capacity_summary
    memoized_capacity_summary
  end

  def memoized_capacity_summary
    @memoized_capacity_summary ||= object.capacity_summary
  end

  def features
    Features.for(object.organization, object).to_h
  end

  def feature_overrides
    Features.for(object.organization, object).tournament_overrides
  end

  def created_at
    object.created_at.in_time_zone('Guam').iso8601
  end

  def updated_at
    object.updated_at.in_time_zone('Guam').iso8601
  end
end
