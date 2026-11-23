# frozen_string_literal: true

require 'test_helper'

class HomepageConfigurableTest < ActiveSupport::TestCase
  setup do
    @org = Organization.create!(
      name: 'Studio Test Club',
      slug: "studio-test-#{SecureRandom.hex(4)}",
      subscription_status: 'active'
    )
    @tournament = TenantContext.with_organization(@org) do
      @org.tournaments.create!(
        name: 'Annual Charity Classic',
        year: 2027,
        status: 'open',
        theme_preset: 'charity-bright'
      )
    end
  end

  test 'accepts and normalizes valid 3-layer homepage_config on organization and tournament' do
    config = {
      'archetype' => 'ceremonial-light',
      'landing_mode' => 'direct_to_active_event',
      'hero_surface' => 'light_airy',
      'artwork_display' => 'emblem_lockup',
      'logo_display' => 'commemorative_banner',
      'eyebrow_label' => '  2027 Airport Week  ',
      'sections' => [
        { 'key' => 'event_details_card', 'enabled' => true },
        { 'key' => 'action_cards', 'enabled' => 'false' },
        { 'key' => 'contact_bar', 'enabled' => true }
      ],
      'ignored_extra_key' => 'dropped'
    }

    assert @org.update(homepage_config: config)
    @org.reload
    assert_equal 'ceremonial-light', @org.homepage_config['archetype']
    assert_equal 'direct_to_active_event', @org.homepage_config['landing_mode']
    assert_equal '2027 Airport Week', @org.homepage_config['eyebrow_label']
    assert_nil @org.homepage_config['ignored_extra_key']
    assert_equal false, @org.homepage_config['sections'][1]['enabled']

    TenantContext.with_organization(@org) do
      assert @tournament.update(homepage_config: { 'artwork_display' => 'showcase_split', 'hero_surface' => 'brand_gradient' })
      assert_equal 'showcase_split', @tournament.reload.homepage_config['artwork_display']
    end
  end

  test 'rejects invalid archetype, landing_mode, section keys, and duplicate sections' do
    @org.homepage_config = { 'archetype' => 'unknown-style' }
    assert_not @org.valid?
    assert_includes @org.errors[:homepage_config].join, 'archetype must be one of'

    @org.homepage_config = { 'landing_mode' => 'invalid_mode' }
    assert_not @org.valid?
    assert_includes @org.errors[:homepage_config].join, 'landing_mode must be one of'

    @org.homepage_config = { 'sections' => [{ 'key' => 'fake_section', 'enabled' => true }] }
    assert_not @org.valid?
    assert_includes @org.errors[:homepage_config].join, 'unknown section key'

    @org.homepage_config = {
      'sections' => [
        { 'key' => 'key_stats_bar', 'enabled' => true },
        { 'key' => 'key_stats_bar', 'enabled' => false }
      ]
    }
    assert_not @org.valid?
    assert_includes @org.errors[:homepage_config].join, 'duplicate section key'

    @org.homepage_config = { 'sections' => [{ 'key' => 'key_stats_bar', 'enabled' => { 'nested' => true } }] }
    assert_not @org.valid?
    assert_includes @org.errors[:homepage_config].join, 'enabled must be a boolean'

    @org.homepage_config = { 'sections' => [{ 'key' => 'key_stats_bar', 'enabled' => nil }] }
    assert_not @org.valid?
    assert_includes @org.errors[:homepage_config].join, 'enabled must be a boolean'

    @org.homepage_config = nil
    assert @org.valid?
    assert_equal({}, @org.homepage_config)
  end

  test 'clone service copies tournament homepage_config' do
    TenantContext.with_organization(@org) do
      @tournament.update!(homepage_config: { 'archetype' => 'charity-showcase', 'artwork_display' => 'showcase_split' })
      result = Tournaments::CloneService.new(
        source: @tournament,
        name: 'Annual Charity Classic 2028',
        year: 2028
      ).call
      assert_equal 'showcase_split', result.tournament.homepage_config['artwork_display']
    end
  end
end
