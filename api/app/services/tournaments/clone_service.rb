# frozen_string_literal: true

module Tournaments
  class CloneService
    class AuthorizationError < StandardError; end
    class TargetOrganizationNotFoundError < StandardError; end

    Result = Struct.new(:tournament, :warnings, :metadata, keyword_init: true)

    CROSS_ORG_STRIPPED_CONFIG_KEYS = %w[
      branding
      primary_color
      secondary_color
      accent_color
      header_style
      font_family
      logo_url
      banner_url
      signature_image_url
      contact_name
      contact_phone
      contact_email
      checks_payable_to
      payment_instructions
      swipe_simple_url
      walkin_swipe_simple_url
    ].freeze

    def self.call(source:, actor: nil, **options)
      new(source: source, actor: actor, **options).call
    end

    def self.increment_edition(edition)
      return nil if edition.blank?

      str = edition.to_s.strip
      match = str.match(/\b(\d+)(st|nd|rd|th)?\b/i)
      return str unless match

      next_num = match[1].to_i + 1
      str.sub(match[0], ordinalize_number(next_num))
    end

    def self.ordinalize_number(number)
      abs_num = number.to_i.abs
      if (11..13).include?(abs_num % 100)
        "#{number}th"
      else
        case abs_num % 10
        when 1 then "#{number}st"
        when 2 then "#{number}nd"
        when 3 then "#{number}rd"
        else "#{number}th"
        end
      end
    end

    def initialize(
      source:,
      actor: nil,
      name: nil,
      year: nil,
      edition: :unspecified,
      event_date: nil,
      registration_deadline: nil,
      early_bird_deadline: nil,
      sponsor_edit_deadline: nil,
      raffle_draw_time: nil,
      copy_sponsor_shells: false,
      copy_raffle_prizes: false,
      target_organization_id: nil,
      target_organization: nil
    )
      @source = source
      @actor = actor
      @name = name
      @year = year
      @edition = edition
      @event_date = event_date
      @registration_deadline = registration_deadline
      @early_bird_deadline = early_bird_deadline
      @sponsor_edit_deadline = sponsor_edit_deadline
      @raffle_draw_time = raffle_draw_time
      @copy_sponsor_shells = ActiveModel::Type::Boolean.new.cast(copy_sponsor_shells) == true
      @copy_raffle_prizes = ActiveModel::Type::Boolean.new.cast(copy_raffle_prizes) == true
      @target_organization = target_organization
      @target_organization_id = target_organization&.id || target_organization_id.presence
    end

    def cross_org?
      @target_organization_id.present? && @target_organization_id.to_s != @source.organization_id.to_s
    end

    def build_tournament(target_org: nil)
      resolved_target = target_org || resolve_target_organization_for_build
      attrs = base_tournament_attributes(resolved_target)
      attrs.merge!(cross_org? ? cross_org_branding_and_contact_attributes(resolved_target) : same_org_branding_and_contact_attributes)
      Tournament.new(attrs)
    end

    def call
      authorize_actor!
      target_org = resolve_target_organization!

      warnings = []
      copied_sponsor_shells_count = 0
      copied_raffle_prizes_count = 0
      source_had_external_payment_urls = @source.swipe_simple_url.present? || @source.walkin_swipe_simple_url.present?

      cloned_tournament = execute_in_tenant_context(target_org) do
        ActiveRecord::Base.transaction(requires_new: true) do
          source_prizes = @copy_raffle_prizes ? @source.raffle_prizes.ordered.to_a : []
          source_sponsors = (!cross_org? && @copy_sponsor_shells) ? @source.sponsors.ordered.to_a : []

          tournament = build_tournament(target_org: target_org)
          tournament.save!

          if source_prizes.any?
            copied_raffle_prizes_count = copy_raffle_prize_templates!(tournament, source_prizes)
          end

          if source_sponsors.any?
            copied_sponsor_shells_count = copy_sponsor_directory_shells!(tournament, source_sponsors)
          end

          warnings = build_warnings(
            target_org: target_org,
            source_had_external_payment_urls: source_had_external_payment_urls,
            copied_sponsor_shells_count: copied_sponsor_shells_count
          )

          metadata = build_metadata(
            target_org: target_org,
            source_had_external_payment_urls: source_had_external_payment_urls,
            copied_sponsor_shells_count: copied_sponsor_shells_count,
            copied_raffle_prizes_count: copied_raffle_prizes_count
          )

          log_clone_activity!(tournament, target_org: target_org, metadata: metadata)

          Result.new(
            tournament: tournament,
            warnings: warnings,
            metadata: metadata
          )
        end
      end

      cloned_tournament
    end

    private

    def authorize_actor!
      if cross_org?
        unless @actor&.super_admin?
          raise AuthorizationError, "Forbidden: Super admin access is required to clone a tournament across organizations"
        end
      elsif @actor.present? && !@actor.can_manage?(@source)
        raise AuthorizationError, "Forbidden: You do not have permission to clone this tournament"
      end
    end

    def resolve_target_organization_for_build
      return @target_organization if @target_organization.present?
      return @source.organization unless cross_org?

      Organization.find_by(id: @target_organization_id) ||
        raise(TargetOrganizationNotFoundError, "Target organization not found")
    end

    def resolve_target_organization!
      return @source.organization unless cross_org?
      return @target_organization if @target_organization.present?

      org = Organization.find_by(id: @target_organization_id)
      raise TargetOrganizationNotFoundError, "Target organization not found" unless org

      org
    end

    def execute_in_tenant_context(target_org, &block)
      if cross_org?
        TenantContext.with_platform_access(&block)
      else
        TenantContext.with_organization(target_org, &block)
      end
    end

    def resolved_year
      return @year.to_i if @year.present? && @year.to_i.positive?

      @source.year.to_i + 1
    end

    def resolved_edition
      return self.class.increment_edition(@source.edition) if @edition == :unspecified

      @edition.presence
    end

    def base_tournament_attributes(target_org)
      {
        organization: target_org,
        event_type: @source.event_type,
        name: @name.presence || @source.name,
        slug: nil,
        year: resolved_year,
        edition: resolved_edition,
        status: "draft",
        registration_open: false,
        walkin_registration_open: false,

        # Dates & deadlines cleared unless explicitly supplied
        event_date: @event_date.presence,
        registration_deadline: @registration_deadline.presence,
        early_bird_deadline: @early_bird_deadline.presence,
        sponsor_edit_deadline: @sponsor_edit_deadline.presence,
        raffle_draw_time: @raffle_draw_time.presence,

        # External payment URLs are never silently carried forward
        swipe_simple_url: nil,
        walkin_swipe_simple_url: nil,

        # Schedule & venue
        registration_time: @source.registration_time,
        check_in_time: @source.check_in_time,
        start_time: @source.start_time,
        location_name: @source.location_name,
        location_address: @source.location_address,
        event_schedule: @source.event_schedule,
        tournament_info: @source.tournament_info,

        # Format, gameplay & course structure
        tournament_format: @source.tournament_format,
        scoring_type: @source.scoring_type,
        team_size: @source.team_size,
        capacity_unit: @source.capacity_unit,
        allow_partial_teams: @source.allow_partial_teams,
        shotgun_start: @source.shotgun_start,
        tee_times_enabled: @source.tee_times_enabled,
        tee_time_interval_minutes: @source.tee_time_interval_minutes,
        total_holes: @source.total_holes,
        total_par: @source.total_par,
        course_name: @source.course_name,
        tee_name: @source.tee_name,
        course_rating: @source.course_rating,
        slope_rating: @source.slope_rating,
        hole_pars: @source.hole_pars&.deep_dup || {},
        hole_handicaps: @source.hole_handicaps&.deep_dup || {},
        use_flights: @source.use_flights,
        flights_config: @source.flights_config&.deep_dup || {},
        handicap_required: @source.handicap_required,
        handicap_max: @source.handicap_max,

        # Capacity, pricing & registration rules
        max_capacity: @source.max_capacity,
        reserved_slots: @source.reserved_slots,
        entry_fee: @source.entry_fee,
        entry_fee_display: @source.entry_fee_display,
        early_bird_fee: @source.early_bird_fee,
        employee_entry_fee: @source.employee_entry_fee,
        employee_discount_enabled: @source.employee_discount_enabled,
        walkin_fee: @source.walkin_fee,
        format_name: @source.format_name,
        fee_includes: @source.fee_includes,
        allow_cash: @source.allow_cash,
        allow_check: @source.allow_check,
        allow_card: @source.allow_card,
        waitlist_enabled: @source.waitlist_enabled,
        waitlist_max: @source.waitlist_max,
        public_listed: @source.public_listed,
        directory_listed: false,

        # Raffle configuration (operational status stays draft)
        raffle_enabled: @source.raffle_enabled,
        raffle_ticket_price_cents: @source.raffle_ticket_price_cents,
        raffle_description: @source.raffle_description,
        raffle_auto_draw: @source.raffle_auto_draw,
        raffle_max_tickets_per_person: @source.raffle_max_tickets_per_person,
        raffle_tickets_per_purchase: @source.raffle_tickets_per_purchase,

        # Structured config (course_configs, raffle_bundles, sponsor_tiers, feature overrides)
        config: cloned_config
      }
    end

    def same_org_branding_and_contact_attributes
      {
        use_org_branding: @source.use_org_branding,
        theme_preset: @source.theme_preset,
        homepage_config: (@source.homepage_config || {}).deep_dup,
        primary_color_override: @source.primary_color_override,
        accent_color_override: @source.accent_color_override,
        logo_url_override: @source.logo_url_override,
        signature_image_url_override: @source.signature_image_url_override,
        banner_url_override: @source.banner_url_override,
        commemorative_banner_url: @source.commemorative_banner_url,
        tribute_title: @source.tribute_title,
        tribute_subtitle: @source.tribute_subtitle,
        story_photos: @source.story_photos.deep_dup,
        waiver_enabled: @source.waiver_enabled,
        waiver_text: @source.waiver_text,
        show_public_sponsors: @source.show_public_sponsors,
        sponsor_wall_title: @source.sponsor_wall_title,
        contact_name: @source.contact_name,
        contact_phone: @source.contact_phone,
        contact_email: @source.contact_email,
        checks_payable_to: @source.checks_payable_to,
        payment_instructions: @source.payment_instructions
      }
    end

    def cross_org_branding_and_contact_attributes(target_org)
      org_theme_preset = target_org.settings&.dig("theme_preset")
      resolved_theme_preset = if Tournament::THEME_PRESETS.include?(org_theme_preset)
                                org_theme_preset
                              else
                                "default-clean"
                              end

      {
        use_org_branding: true,
        theme_preset: resolved_theme_preset,
        primary_color_override: nil,
        accent_color_override: nil,
        logo_url_override: nil,
        signature_image_url_override: nil,
        banner_url_override: nil,
        contact_name: nil,
        contact_phone: nil,
        contact_email: nil,
        checks_payable_to: nil,
        payment_instructions: nil
      }
    end

    def cloned_config
      raw = @source.config.is_a?(Hash) ? @source.config.deep_stringify_keys.deep_dup : {}

      if raw.key?("features")
        sanitized_features = sanitize_feature_overrides(raw["features"])
        if sanitized_features.any?
          raw["features"] = sanitized_features
        else
          raw.delete("features")
        end
      end

      if cross_org?
        CROSS_ORG_STRIPPED_CONFIG_KEYS.each { |key| raw.delete(key) }
      end

      raw
    end

    def sanitize_feature_overrides(raw_features)
      return {} unless raw_features.is_a?(Hash)

      raw_features.each_with_object({}) do |(raw_key, value), acc|
        key = raw_key.to_s
        next unless GolfFeaturesCatalog.valid?(key)
        next unless GolfFeaturesCatalog.tournament_overridable?(key)
        next unless value == true || value == false

        acc[key] = value
      end
    end

    def copy_raffle_prize_templates!(target_tournament, source_prizes)
      count = 0
      source_prizes.each do |prize|
        target_tournament.raffle_prizes.create!(
          name: prize.name,
          tier: prize.tier,
          description: prize.description,
          value_cents: prize.value_cents,
          position: prize.position,
          won: false,
          won_at: nil,
          claimed: false,
          claimed_at: nil,
          winning_ticket_id: nil,
          winner_name: nil,
          winner_email: nil,
          winner_phone: nil,
          draw_id: nil,
          draw_eligible_ticket_count: nil,
          draw_preview_ticket_numbers: [],
          sponsor_name: nil,
          sponsor_logo_url: nil,
          image_url: nil
        )
        count += 1
      end
      count
    end

    def copy_sponsor_directory_shells!(target_tournament, source_sponsors)
      count = 0
      source_sponsors.each do |sponsor|
        target_tournament.sponsors.create!(
          name: sponsor.name,
          tier: sponsor.tier,
          website_url: sponsor.website_url,
          description: sponsor.description,
          logo_url: sponsor.logo_url,
          login_email: sponsor.login_email,
          slot_count: sponsor.slot_count,
          position: sponsor.position,
          course_key: sponsor.course_key,
          hole_number: sponsor.hole_number,
          active: false,
          access_token: nil,
          access_token_expires_at: nil
        )
        count += 1
      end
      count
    end

    def build_warnings(target_org:, source_had_external_payment_urls:, copied_sponsor_shells_count:)
      warnings = []

      if source_had_external_payment_urls
        warnings << "External payment URLs were cleared from the cloned tournament. Review and update payment links before opening registration."
      end

      if cross_org?
        warnings << "Source organization branding overrides, contact details, check instructions, and sponsors were stripped for #{target_org.name}. Configure them before publishing."
        if @copy_sponsor_shells
          warnings << "Sponsor directory shells cannot be copied across organizations and were skipped."
        end
      elsif @copy_sponsor_shells && copied_sponsor_shells_count.positive?
        warnings << "Copied #{copied_sponsor_shells_count} sponsor #{'shell'.pluralize(copied_sponsor_shells_count)} in inactive draft state with zero filled player slots and no portal links."
      end

      warnings
    end

    def build_metadata(target_org:, source_had_external_payment_urls:, copied_sponsor_shells_count:, copied_raffle_prizes_count:)
      {
        mode: cross_org? ? "cross_org_template" : "same_org",
        source_tournament_id: @source.id,
        source_organization_id: @source.organization_id,
        target_organization_id: target_org.id,
        requires_payment_url_review: source_had_external_payment_urls,
        copied_sponsor_shells_count: copied_sponsor_shells_count,
        copied_raffle_prizes_count: copied_raffle_prizes_count
      }
    end

    def log_clone_activity!(tournament, target_org:, metadata:)
      details = if cross_org?
                  "Cloned tournament #{tournament.display_name} as template into #{target_org.name} (from source ##{@source.id})"
                else
                  "Cloned tournament #{tournament.display_name} from #{@source.display_name}"
                end

      ActivityLog.log(
        admin: @actor,
        action: "tournament_cloned",
        target: tournament,
        tournament: tournament,
        organization: target_org,
        details: details,
        metadata: metadata
      )
    end
  end
end
