# frozen_string_literal: true

require "test_helper"

class GolfFeaturesCatalogTest < ActiveSupport::TestCase
  EXPECTED_KEYS = %w[
    raffle
    live_scoring
    sponsors
    donations
    employee_pricing
    checkin_alpha_lanes
    walkin_registration
    waitlist
    sponsor_checkout
    tax_receipts
    offseason_mode
  ].freeze

  test "catalog defines all canonical HafaGolf feature keys with typed metadata" do
    assert_equal EXPECTED_KEYS.sort, GolfFeaturesCatalog.keys.sort
    assert_equal EXPECTED_KEYS.length, GolfFeaturesCatalog.all.length

    GolfFeaturesCatalog.all.each do |feature|
      assert feature.key.present?
      assert feature.label.present?
      assert feature.description.present?
      assert_includes GolfFeaturesCatalog::CATEGORY_LABELS.keys, feature.category
      assert_includes %w[organization tournament], feature.scope
      assert_includes [true, false], feature.default
      assert_kind_of Array, feature.requires
      feature.requires.each do |dep|
        assert GolfFeaturesCatalog.valid?(dep), "Dependency '#{dep}' on '#{feature.key}' must be in catalog"
      end
    end
  end

  test "catalog helper methods work cleanly" do
    assert GolfFeaturesCatalog.valid?(:raffle)
    assert GolfFeaturesCatalog.valid?("live_scoring")
    assert_not GolfFeaturesCatalog.valid?(:nonexistent_feature)
    assert_not GolfFeaturesCatalog.valid?(nil)

    assert_equal true, GolfFeaturesCatalog.default_for(:raffle)
    assert_equal true, GolfFeaturesCatalog.default_for(:live_scoring)
    assert_equal true, GolfFeaturesCatalog.default_for(:sponsors)
    assert_equal true, GolfFeaturesCatalog.default_for(:waitlist)
    assert_equal true, GolfFeaturesCatalog.default_for(:walkin_registration)
    assert_equal false, GolfFeaturesCatalog.default_for(:tax_receipts)
    assert_equal false, GolfFeaturesCatalog.default_for(:donations)
    assert_equal false, GolfFeaturesCatalog.default_for(:offseason_mode)

    assert_raises(ArgumentError) { GolfFeaturesCatalog.default_for(:unknown_flag) }

    json = GolfFeaturesCatalog.as_json
    assert_equal GolfFeaturesCatalog.all.length, json.length
    assert json.all? { |item| item.key?("key") && item.key?("label") && item.key?("category_label") && item.key?("tournament_overridable") }
  end

  test "validate_overrides rejects unknown keys, invalid types, and org-only keys in tournament scope" do
    assert_empty GolfFeaturesCatalog.validate_overrides({ "raffle" => false, "donations" => true, "waitlist" => nil }, scope: :organization)
    assert_empty GolfFeaturesCatalog.validate_overrides({ "raffle" => true, "live_scoring" => nil }, scope: :tournament)

    unknown_errors = GolfFeaturesCatalog.validate_overrides({ "made_up_flag" => true }, scope: :organization)
    assert unknown_errors.any? { |e| e.include?("made_up_flag") }

    scope_errors = GolfFeaturesCatalog.validate_overrides({ "offseason_mode" => true }, scope: :tournament)
    assert scope_errors.any? { |e| e.include?("organization level") }

    type_errors = GolfFeaturesCatalog.validate_overrides({ "raffle" => "definitely" }, scope: :organization)
    assert type_errors.any? { |e| e.include?("boolean") }
  end

  test "Features.for layers defaults, organization overrides, and tournament overrides" do
    org = Organization.create!(
      name: "Layering Org",
      slug: "layering-org-#{SecureRandom.hex(3)}",
      settings: {
        "features" => {
          "raffle" => false,
          "donations" => true,
          "live_scoring" => false
        }
      }
    )
    tournament = org.tournaments.create!(
      name: "Layering Event",
      slug: "layering-event-#{SecureRandom.hex(3)}",
      year: 2027,
      status: "open",
      raffle_enabled: true,
      config: {
        "features" => {
          "raffle" => true,
          "donations" => false
        }
      }
    )

    org_features = Features.for(org)
    assert org_features.disabled?(:raffle)
    assert org_features.enabled?(:donations)
    assert org_features.disabled?(:live_scoring)
    assert org_features.enabled?(:sponsors)
    assert org_features.disabled?(:tax_receipts)

    tournament_features = Features.for(org, tournament)
    assert tournament_features.enabled?(:raffle), "tournament override should override org false"
    assert tournament_features.disabled?(:donations), "tournament override should override org true"
    assert tournament_features.disabled?(:live_scoring), "unset tournament key should inherit org override"
    assert tournament_features.enabled?(:sponsors), "unset org & tournament keys should inherit catalog default"
    assert tournament_features.disabled?(:tax_receipts)

    assert_equal({ "raffle" => false, "donations" => true, "live_scoring" => false }, tournament_features.overrides[:organization])
    assert_equal({ "raffle" => true, "donations" => false }, tournament_features.overrides[:tournament])
    assert_equal GolfFeaturesCatalog.keys.sort, tournament_features.to_h.keys.sort

    assert_raises(ArgumentError) { tournament_features.enabled?(:not_in_catalog) }
  end

  test "Features.for honors legacy tournament.raffle_enabled == false when explicit override is unset" do
    org = Organization.create!(name: "Legacy Raffle Org", slug: "legacy-raffle-#{SecureRandom.hex(3)}")

    disabled_legacy = org.tournaments.create!(
      name: "No Raffle Legacy",
      slug: "no-raffle-#{SecureRandom.hex(3)}",
      year: 2027,
      status: "open",
      raffle_enabled: false
    )
    assert Features.for(org, disabled_legacy).disabled?(:raffle)

    # Explicit tournament feature override wins over legacy raffle_enabled: false
    disabled_legacy.update!(config: { "features" => { "raffle" => true } })
    assert Features.for(org, disabled_legacy).enabled?(:raffle)

    # Legacy raffle_enabled: true defers to org override when tournament override is unset
    org.update!(settings: { "features" => { "raffle" => false } })
    enabled_legacy = org.tournaments.create!(
      name: "Org Disabled Raffle",
      slug: "org-disabled-raffle-#{SecureRandom.hex(3)}",
      year: 2027,
      status: "open",
      raffle_enabled: true
    )
    assert Features.for(org, enabled_legacy).disabled?(:raffle)
  end

  test "Features.for enforces feature dependencies" do
    org = Organization.create!(
      name: "Deps Org",
      slug: "deps-org-#{SecureRandom.hex(3)}",
      settings: {
        "features" => {
          "sponsors" => false,
          "sponsor_checkout" => true
        }
      }
    )

    resolved = Features.for(org)
    assert resolved.disabled?(:sponsors)
    assert resolved.disabled?(:sponsor_checkout), "sponsor_checkout must resolve false when required sponsors feature is disabled"
  end

  test "every feature key referenced in API controllers and web UI exists in GolfFeaturesCatalog" do
    repo_root = Rails.root.join("..")
    referenced_keys = Set.new

    # Scan api/app for require_feature!, .enabled?, .disabled?, default_for
    Dir.glob(repo_root.join("api/app/**/*.rb")).each do |path|
      next if path.end_with?("golf_features_catalog.rb", "features.rb")

      content = File.read(path)
      content.scan(/require_feature!\(\s*[:'"]([a-z0-9_]+)['"]?/).each { |m| referenced_keys << m.first }
      content.scan(/Features\.for\([^)]*\)\.(?:enabled|disabled)\?\(\s*[:'"]([a-z0-9_]+)['"]?/).each { |m| referenced_keys << m.first }
    end

    # Scan web/src for isFeatureEnabled(..., 'key')
    Dir.glob(repo_root.join("web/src/**/*.{ts,tsx}")).each do |path|
      next if path.include?(".test.") || path.include?(".spec.")

      content = File.read(path)
      content.scan(/isFeatureEnabled\(\s*[^,]+,\s*['"]([a-z0-9_]+)['"]/).each { |m| referenced_keys << m.first }
    end

    assert referenced_keys.any?, "Expected to discover referenced feature keys in controllers/UI"
    referenced_keys.each do |key|
      assert GolfFeaturesCatalog.valid?(key), "Referenced feature key '#{key}' is missing from GolfFeaturesCatalog"
    end

    # Verify frontend FEATURE_KEYS array stays in exact sync with GolfFeaturesCatalog.keys
    web_features_ts = File.read(repo_root.join("web/src/utils/features.ts"))
    ts_array_match = web_features_ts.match(/export const FEATURE_KEYS = \[(.*?)\] as const;/m)
    assert_not_nil ts_array_match, "FEATURE_KEYS constant must exist in web/src/utils/features.ts"
    ts_keys = ts_array_match[1].scan(/'([a-z0-9_]+)'/).flatten
    assert_equal GolfFeaturesCatalog.keys.sort, ts_keys.sort, "Frontend FEATURE_KEYS must match GolfFeaturesCatalog.keys"
  end
end
