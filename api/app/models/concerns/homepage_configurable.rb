# frozen_string_literal: true

module HomepageConfigurable
  extend ActiveSupport::Concern

  ARCHETYPES = %w[
    ceremonial-light
    charity-showcase
    scenic-photo
    varsity-crest
    clean-editorial
  ].freeze

  LANDING_MODES = %w[
    direct_to_active_event
    org_hub
  ].freeze

  HERO_SURFACES = %w[
    light_airy
    brand_gradient
    dark_editorial
    photo_scrim
  ].freeze

  ARTWORK_DISPLAYS = %w[
    showcase_split
    full_bleed_bg
    emblem_lockup
    none
  ].freeze

  LOGO_DISPLAYS = %w[
    auto
    commemorative_banner
    org_logo
    reversed_logo
    none
  ].freeze

  SECTION_KEYS = %w[
    key_stats_bar
    event_details_card
    action_cards
    story_strip
    sponsor_wall
    raffle_spotlight
    contact_bar
  ].freeze

  ALLOWED_KEYS = %w[
    archetype
    landing_mode
    hero_surface
    artwork_display
    logo_display
    eyebrow_label
    sections
  ].freeze

  VALID_BOOLEAN_VALUES = [true, false, 'true', 'false', 1, 0, '1', '0'].freeze

  included do
    before_validation :normalize_homepage_config
    validate :validate_homepage_config
  end

  private

  def normalize_homepage_config
    if homepage_config.nil?
      self.homepage_config = {}
      return
    end
    return unless homepage_config.is_a?(Hash)

    normalized = homepage_config.deep_stringify_keys.slice(*ALLOWED_KEYS)

    %w[archetype landing_mode hero_surface artwork_display logo_display].each do |key|
      if normalized.key?(key)
        val = normalized[key].to_s.strip
        val.empty? ? normalized.delete(key) : (normalized[key] = val)
      end
    end

    if normalized.key?('eyebrow_label')
      val = normalized['eyebrow_label'].to_s.strip
      val.empty? ? normalized.delete('eyebrow_label') : (normalized['eyebrow_label'] = val)
    end

    if normalized.key?('sections') && normalized['sections'].is_a?(Array)
      normalized['sections'] = normalized['sections'].map do |entry|
        if entry.is_a?(Hash)
          h = entry.stringify_keys
          raw_enabled = h.key?('enabled') ? h['enabled'] : true
          coerced_enabled =
            if VALID_BOOLEAN_VALUES.include?(raw_enabled)
              ActiveModel::Type::Boolean.new.cast(raw_enabled)
            else
              raw_enabled
            end
          {
            'key' => h['key'].to_s.strip,
            'enabled' => coerced_enabled
          }
        else
          entry
        end
      end
    end

    self.homepage_config = normalized
  end

  def validate_homepage_config
    unless homepage_config.is_a?(Hash)
      errors.add(:homepage_config, 'must be a JSON object')
      return
    end

    cfg = homepage_config.deep_stringify_keys
    validate_enum_field(cfg, 'archetype', ARCHETYPES)
    validate_enum_field(cfg, 'landing_mode', LANDING_MODES)
    validate_enum_field(cfg, 'hero_surface', HERO_SURFACES)
    validate_enum_field(cfg, 'artwork_display', ARTWORK_DISPLAYS)
    validate_enum_field(cfg, 'logo_display', LOGO_DISPLAYS)

    if cfg.key?('eyebrow_label') && cfg['eyebrow_label'].to_s.length > 120
      errors.add(:homepage_config, 'eyebrow_label must be 120 characters or fewer')
    end

    return unless cfg.key?('sections')

    sections = cfg['sections']
    unless sections.is_a?(Array)
      errors.add(:homepage_config, 'sections must be an array')
      return
    end

    seen = []
    sections.each do |entry|
      unless entry.is_a?(Hash)
        errors.add(:homepage_config, 'each section must be an object with key and enabled')
        return
      end

      key = entry['key'].to_s
      unless SECTION_KEYS.include?(key)
        errors.add(:homepage_config, "contains unknown section key '#{key}'")
        return
      end

      unless entry['enabled'] == true || entry['enabled'] == false
        errors.add(:homepage_config, "section '#{key}' enabled must be a boolean")
        return
      end

      if seen.include?(key)
        errors.add(:homepage_config, "contains duplicate section key '#{key}'")
        return
      end
      seen << key
    end
  end

  def validate_enum_field(cfg, key, allowed)
    return unless cfg.key?(key) && cfg[key].present?
    return if allowed.include?(cfg[key].to_s)

    errors.add(:homepage_config, "#{key} must be one of: #{allowed.join(', ')}")
  end
end
