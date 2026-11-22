# frozen_string_literal: true

class Features
  def self.for(organization, tournament = nil)
    new(organization, tournament)
  end

  attr_reader :organization, :tournament, :organization_overrides, :tournament_overrides

  def initialize(organization, tournament = nil)
    @tournament = tournament
    @organization = organization || tournament&.organization
    @organization_overrides = extract_overrides(@organization&.settings&.dig("features"), scope: :organization)
    @tournament_overrides = extract_overrides(@tournament&.config&.dig("features"), scope: :tournament)
    @resolved = compute_resolved.freeze
  end

  def enabled?(key)
    feature_key = normalize_key!(key)
    @resolved.fetch(feature_key)
  end

  def disabled?(key)
    !enabled?(key)
  end

  def to_h
    @resolved.dup
  end

  def as_json(_options = nil)
    to_h
  end

  def overrides
    {
      organization: @organization_overrides.dup,
      tournament: @tournament_overrides.dup
    }
  end

  private

  def normalize_key!(key)
    feature_key = key.to_s
    unless GolfFeaturesCatalog.valid?(feature_key)
      raise ArgumentError, "Unknown feature key: #{key.inspect}"
    end

    feature_key
  end

  def extract_overrides(raw, scope:)
    return {} unless raw.is_a?(Hash)

    raw.each_with_object({}) do |(raw_key, value), acc|
      key = raw_key.to_s
      next unless GolfFeaturesCatalog.valid?(key)
      next if scope == :tournament && !GolfFeaturesCatalog.tournament_overridable?(key)
      next unless value == true || value == false

      acc[key] = value
    end
  end

  def compute_resolved
    values = GolfFeaturesCatalog.defaults

    # Layer 1.5: Legacy organization.offseason_enabled when explicit override is unset
    if @organization&.offseason_enabled == true && !@organization_overrides.key?("offseason_mode")
      values["offseason_mode"] = true
    end

    # Layer 2: Organization overrides
    @organization_overrides.each do |key, value|
      values[key] = value
    end

    # Layer 3: Tournament overrides + legacy tournament.raffle_enabled fallback
    if @tournament.present?
      if !@tournament_overrides.key?("raffle") && @tournament.raffle_enabled == false
        values["raffle"] = false
      end

      @tournament_overrides.each do |key, value|
        values[key] = value
      end
    end

    # Layer 4: Enforce catalog dependency requirements (e.g. sponsor_checkout requires sponsors)
    GolfFeaturesCatalog.all.each do |feature|
      next if feature.requires.empty?
      next unless values[feature.key]

      if feature.requires.any? { |dep| !values[dep] }
        values[feature.key] = false
      end
    end

    values
  end
end
