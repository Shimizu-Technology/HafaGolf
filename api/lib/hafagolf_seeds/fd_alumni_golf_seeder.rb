# frozen_string_literal: true

require_relative "../hafagolf_migrations/database_guard"

module HafagolfSeeds
  # Idempotent seeder for the native FD Alumni Golf 2027 tenant on HafaGolf.
  # Configures:
  # - Organization (`fd-alumni-golf`) + primary host (`fd-golf.shimizu-technology.com`)
  # - Brand Kit (`crest-classic` maroon `#6B1D2F` & gold `#C5A059`)
  # - Payment config (`platform_collect`, $0 in-kind platform fee, Class of 2017 Bank of Guam payee)
  # - 2027 Foursome tournament (draft until Mar 15 open; `tax_receipt_enabled: false`)
  # - Priced Sponsor Tiers when `SponsorTier` table is present
  class FdAlumniGolfSeeder
    ORG_SLUG = "fd-alumni-golf"
    PRIMARY_HOST = "fd-golf.shimizu-technology.com"
    TOURNAMENT_SLUG = "fd-alumni-golf-2027"

    DEFAULT_SPONSOR_TIERS = [
      { key: "title", label: "Title Sponsor", price_cents: 500_000, included_player_slots: 8, max_quantity: 1, sort_order: 0, benefits: ["Event naming recognition", "2 Foursomes (8 players)", "Banner & digital spotlight"] },
      { key: "gold", label: "Gold Sponsor", price_cents: 250_000, included_player_slots: 4, max_quantity: 4, sort_order: 1, benefits: ["1 Foursome (4 players)", "Course signage", "Sponsor wall highlight"] },
      { key: "silver", label: "Silver Sponsor", price_cents: 150_000, included_player_slots: 4, max_quantity: 8, sort_order: 2, benefits: ["1 Foursome (4 players)", "Sponsor wall listing"] },
      { key: "hole", label: "Hole Sponsor", price_cents: 50_000, included_player_slots: 0, max_quantity: 18, sort_order: 3, benefits: ["Dedicated tee box sign", "Digital sponsor recognition"] }
    ].freeze

    def self.seed!(expected_db_name: ENV["EXPECTED_DB_NAME"])
      new(expected_db_name: expected_db_name).seed!
    end

    def initialize(expected_db_name: ENV["EXPECTED_DB_NAME"])
      @expected_db_name = expected_db_name
    end

    def seed!
      HafagolfMigrations::DatabaseGuard.verify!(expected_db_name: @expected_db_name)

      result = {}
      TenantContext.with_platform_access do
        ActiveRecord::Base.transaction(requires_new: true) do
          org = Organization.find_or_initialize_by(slug: ORG_SLUG)
          org.assign_attributes(
            name: "FD Alumni Golf",
            description: "Father Duenas Memorial School Alumni Golf Tournament hosted by Class of 2017",
            primary_color: "#6B1D2F",
            website_url: "https://#{PRIMARY_HOST}",
            subscription_status: "active",
            settings: (org.settings || {}).merge(
              "secondary_color" => "#4A1220",
              "accent_color" => "#C5A059",
              "features" => ((org.settings || {})["features"] || {}).merge(
                "sponsor_portal" => true,
                "sponsor_checkout" => true,
                "donations" => true,
                "waitlist" => true,
                "raffle" => false,
                "scoring" => false,
                "live_leaderboard" => false
              )
            )
          )
          org.save!

          if defined?(OrganizationDomain)
            domain = org.organization_domains.find_or_initialize_by(hostname: PRIMARY_HOST)
            domain.is_primary = true
            domain.save!
          end

          if defined?(OrganizationPaymentConfig)
            config = org.organization_payment_config || org.build_organization_payment_config
            config.assign_attributes(
              payment_mode: "platform_collect",
              processor_provider: "stripe",
              platform_fee_flat_cents: 0,
              platform_fee_per_registrant_cents: 0,
              platform_fee_cap_cents: nil,
              payout_payee_name: "FDAA Class of 2017",
              payout_bank_name: "Bank of Guam",
              payout_notes: "2027 FD Alumni Golf Tournament proceeds (in-kind $0 platform fee)"
            )
            config.save!
          end

          tournament = org.tournaments.find_or_initialize_by(slug: TOURNAMENT_SLUG)
          t_attrs = {
            name: "FD Alumni Golf Tournament 2027",
            year: 2027,
            edition: "2027 Alumni Classic",
            status: "draft",
            registration_open: false,
            event_date: Date.new(2027, 5, 15),
            format_name: "4-Person Scramble (Foursomes)",
            team_size: 4,
            max_capacity: 144,
            reserved_slots: 0,
            entry_fee: 15_000,
            checks_payable_to: "FDAA Class of 2017",
            theme_preset: "crest-classic"
          }
          t_attrs[:capacity_unit] = "players" if tournament.respond_to?(:capacity_unit=)
          t_attrs[:tax_receipt_enabled] = false if tournament.respond_to?(:tax_receipt_enabled=)
          tournament.assign_attributes(t_attrs)
          tournament.save!

          tiers_seeded = 0
          if defined?(SponsorTier)
            DEFAULT_SPONSOR_TIERS.each do |tier_def|
              tier = SponsorTier.find_or_initialize_by(tournament: tournament, key: tier_def[:key])
              tier.assign_attributes(
                organization: org,
                label: tier_def[:label],
                price_cents: tier_def[:price_cents],
                included_player_slots: tier_def[:included_player_slots],
                max_quantity: tier_def[:max_quantity],
                benefits: tier_def[:benefits],
                online_checkout_enabled: true,
                sort_order: tier_def[:sort_order]
              )
              tier.save!
              tiers_seeded += 1
            end
          end

          result = {
            organization_slug: org.slug,
            primary_host: PRIMARY_HOST,
            tournament_slug: tournament.slug,
            theme_preset: tournament.theme_preset,
            team_size: tournament.team_size,
            sponsor_tiers_seeded: tiers_seeded
          }
        end
      end

      result
    end
  end
end
