# frozen_string_literal: true

class GolfFeaturesCatalog
  Feature = Struct.new(
    :key,
    :label,
    :description,
    :category,
    :default,
    :scope,
    :requires,
    keyword_init: true
  ) do
    def tournament_overridable?
      scope == "tournament"
    end

    def category_label
      GolfFeaturesCatalog::CATEGORY_LABELS.fetch(category, category.to_s.titleize)
    end

    def as_json(_options = nil)
      {
        "key" => key,
        "label" => label,
        "description" => description,
        "category" => category,
        "category_label" => category_label,
        "default" => default,
        "scope" => scope,
        "tournament_overridable" => tournament_overridable?,
        "requires" => requires
      }
    end
  end

  CATEGORY_LABELS = {
    "fundraising" => "Fundraising & Sponsors",
    "event_day" => "Event Day & Gameplay",
    "registration" => "Registration & Pricing",
    "site" => "Public Site"
  }.freeze

  FEATURES = [
    Feature.new(
      key: "raffle",
      label: "Raffle & Live Draw",
      description: "Raffle tickets, POS, live draw board",
      category: "fundraising",
      default: true,
      scope: "tournament",
      requires: [].freeze
    ).freeze,
    Feature.new(
      key: "live_scoring",
      label: "Live Scoring & Leaderboard",
      description: "Mobile PWA scorecards & live leaderboard",
      category: "event_day",
      default: true,
      scope: "tournament",
      requires: [].freeze
    ).freeze,
    Feature.new(
      key: "sponsors",
      label: "Sponsors & Portal",
      description: "Sponsor management, hole signage, sponsor portal",
      category: "fundraising",
      default: true,
      scope: "tournament",
      requires: [].freeze
    ).freeze,
    Feature.new(
      key: "donations",
      label: "Online Donations",
      description: "Standalone online donations page",
      category: "fundraising",
      default: false,
      scope: "tournament",
      requires: [].freeze
    ).freeze,
    Feature.new(
      key: "employee_pricing",
      label: "Employee Discount Pricing",
      description: "Employee-number discounted entry pricing",
      category: "registration",
      default: false,
      scope: "tournament",
      requires: [].freeze
    ).freeze,
    Feature.new(
      key: "checkin_alpha_lanes",
      label: "Alphabetical Check-In Lanes",
      description: "Split A–J / K–Z check-in lanes",
      category: "event_day",
      default: false,
      scope: "tournament",
      requires: [].freeze
    ).freeze,
    Feature.new(
      key: "walkin_registration",
      label: "Walk-In Registration",
      description: "Day-of walk-in registration & payment",
      category: "registration",
      default: true,
      scope: "tournament",
      requires: [].freeze
    ).freeze,
    Feature.new(
      key: "waitlist",
      label: "Automatic Waitlist",
      description: "Automatic capacity waitlist & promotion",
      category: "registration",
      default: true,
      scope: "tournament",
      requires: [].freeze
    ).freeze,
    Feature.new(
      key: "sponsor_checkout",
      label: "Online Sponsor Checkout",
      description: "Online priced sponsor tier checkout",
      category: "fundraising",
      default: false,
      scope: "tournament",
      requires: %w[sponsors].freeze
    ).freeze,
    Feature.new(
      key: "tax_receipts",
      label: "Quid-Pro-Quo Tax Receipts",
      description: "IRS >$75 FMV quid-pro-quo receipt copy",
      category: "fundraising",
      default: false,
      scope: "tournament",
      requires: [].freeze
    ).freeze,
    Feature.new(
      key: "offseason_mode",
      label: "Off-Season Mode",
      description: "Between-events landing page",
      category: "site",
      default: false,
      scope: "organization",
      requires: [].freeze
    ).freeze
  ].freeze

  FEATURES_BY_KEY = FEATURES.index_by(&:key).freeze
  KEYS = FEATURES.map(&:key).freeze
  DEFAULTS = FEATURES.each_with_object({}) { |feature, hash| hash[feature.key] = feature.default }.freeze

  class << self
    def all
      FEATURES
    end

    def keys
      KEYS
    end

    def find(key)
      FEATURES_BY_KEY[key.to_s]
    end

    def valid?(key)
      return false if key.nil?

      FEATURES_BY_KEY.key?(key.to_s)
    end

    def default_for(key)
      feature = find(key)
      raise ArgumentError, "Unknown feature key: #{key.inspect}" unless feature

      feature.default
    end

    def defaults
      DEFAULTS.dup
    end

    def tournament_overridable?(key)
      feature = find(key)
      return false unless feature

      feature.tournament_overridable?
    end

    def as_json(_options = nil)
      FEATURES.map(&:as_json)
    end

    # Validates an overrides hash for either :organization or :tournament scope.
    # Allows true, false, or nil (nil clears an override).
    # Returns an array of error messages (empty when valid).
    def validate_overrides(raw_overrides, scope: :organization)
      unless raw_overrides.is_a?(Hash)
        return ["Features payload must be an object"]
      end

      errors = []
      raw_overrides.each do |raw_key, value|
        key = raw_key.to_s
        unless valid?(key)
          errors << "Unknown feature key '#{key}'"
          next
        end

        if scope.to_sym == :tournament && !tournament_overridable?(key)
          errors << "Feature '#{key}' can only be configured at the organization level"
          next
        end

        unless value.nil? || value == true || value == false
          errors << "Feature '#{key}' must be a boolean or null"
        end
      end

      errors
    end
  end
end
