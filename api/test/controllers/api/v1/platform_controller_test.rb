# frozen_string_literal: true

require "test_helper"

module Api
  module V1
    class PlatformControllerTest < ActionDispatch::IntegrationTest
      include ActiveJob::TestHelper

      setup do
        @org = Organization.create!(
          name: "Island Memorial Golf",
          slug: "island-memorial-test",
          primary_color: "#1E3A5F",
          subscription_status: "active"
        )
        @org.organization_domains.create!(hostname: "island-memorial.example.com", is_primary: true)
        @org.create_organization_payment_config!(
          payment_mode: "platform_collect",
          processor_provider: "stripe",
          platform_fee_per_registrant_cents: 400
        )
        @tournament = @org.tournaments.create!(
          name: "Memorial Classic 2026",
          slug: "memorial-classic-2026",
          year: 2026,
          status: "open",
          entry_fee: 15_000,
          registration_open: true
        )
        # Platform-collected paid golfer
        @tournament.golfers.create!(
          name: "Alex Reyes",
          email: "alex@example.com",
          phone: "671-555-0101",
          waiver_accepted_at: Time.current,
          team_category: "Male",
          registration_status: "confirmed",
          payment_status: "paid",
          payment_method: "stripe",
          payment_type: "stripe",
          payment_amount_cents: 15_000,
          stripe_account_origin: "platform_live",
          stripe_fee_cents: 465
        )
        # Direct cash golfer — must NOT inflate platform_collect gross/proceeds!
        @tournament.golfers.create!(
          name: "Cash Player",
          email: "cash@example.com",
          phone: "671-555-0102",
          waiver_accepted_at: Time.current,
          team_category: "Male",
          registration_status: "confirmed",
          payment_status: "paid",
          payment_method: "cash",
          payment_type: "pay_on_day",
          payment_amount_cents: 15_000
        )

        @super_admin = User.create!(
          clerk_id: "clerk_platform_super_1",
          email: "super@platform.example.com",
          name: "Platform Super",
          role: "super_admin"
        )
        @org_admin = User.create!(
          clerk_id: "clerk_platform_org_admin_1",
          email: "orgadmin@example.com",
          name: "Org Admin",
          role: "org_admin"
        )
        @org.add_admin(@org_admin)
      end

      def headers_for(user)
        authenticate_as(user)
        auth_headers
      end

      test "rejects non-super-admin users on overview, create, and update" do
        get "/api/v1/admin/platform/overview", headers: headers_for(@org_admin)
        assert_response :forbidden

        post "/api/v1/admin/platform/organizations",
             params: { organization: { name: "Blocked Org" } },
             headers: headers_for(@org_admin),
             as: :json
        assert_response :forbidden

        patch "/api/v1/admin/platform/organizations/#{@org.slug}",
              params: { organization: { status: "offseason" } },
              headers: headers_for(@org_admin),
              as: :json
        assert_response :forbidden
      end

      test "overview uses Settlements::Calculator excluding direct cash payments and separates finalized vs estimated KPI" do
        get "/api/v1/admin/platform/overview", headers: headers_for(@super_admin)
        assert_response :success
        body = JSON.parse(response.body)

        assert_operator body.dig("summary", "total_orgs"), :>=, 1
        assert_equal 0, body.dig("summary", "pending_payouts_cents")

        org_row = body["organizations"].find { |o| o["slug"] == @org.slug }
        assert_not_nil org_row
        assert_equal "active", org_row["status"]
        assert_equal 2, org_row["confirmed_golfers_count"]
        assert_equal "island-memorial.example.com", org_row["primary_host"]

        settlement_row = body["settlements"].find { |s| s["tournament_id"] == @tournament.id }
        assert_not_nil settlement_row
        assert_equal "uncalculated", settlement_row["settlement_status"]
        # Only the $150 Stripe platform-collected charge counts; cash golfer is excluded
        assert_equal 15_000, settlement_row["gross_cents"]
        assert_equal 465, settlement_row["processing_fee_cents"]
        assert_equal 400, settlement_row["platform_fee_cents"]
        assert_equal 14_135, settlement_row["organizer_proceeds_cents"]
        assert_equal 14_135, settlement_row["balance_due_cents"]
        assert_operator body.dig("summary", "estimated_pending_payouts_cents"), :>=, 14_135

        # Finalized settlement feeds pending_payouts_cents KPI
        TournamentSettlement.create!(
          organization: @org,
          tournament: @tournament,
          version: 1,
          status: "finalized",
          gross_cents: 15_000,
          refund_cents: 0,
          processing_fee_cents: 465,
          platform_fee_cents: 400,
          adjustment_cents: 0,
          net_cents: 15_000,
          organizer_proceeds_cents: 14_135,
          paid_cents: 4_135,
          payable_cents: 10_000,
          calculated_at: Time.current,
          source_digest: "abc123"
        )

        get "/api/v1/admin/platform/overview", headers: headers_for(@super_admin)
        assert_response :success
        body2 = JSON.parse(response.body)
        assert_equal 10_000, body2.dig("summary", "pending_payouts_cents")
        finalized_row = body2["settlements"].find { |s| s["tournament_id"] == @tournament.id }
        assert_equal "finalized", finalized_row["settlement_status"]
        assert_equal 10_000, finalized_row["balance_due_cents"]
      end

      test "create_organization creates org, domain, homepage_config, payment config, invites admins, and logs activity" do
        enqueued_invites = []
        original_perform_later = SendUserInviteEmailJob.method(:perform_later)
        SendUserInviteEmailJob.define_singleton_method(:perform_later) do |*args|
          enqueued_invites << args
        end

        begin
          post "/api/v1/admin/platform/organizations",
               params: {
                 organization: {
                   name: "Pacific Charity Cup",
                   slug: "pacific-charity-cup",
                   primary_color: "#0F4C5C",
                   accent_color: "#E36414",
                   theme_preset: "island-classic",
                   primary_domain: "pacific-charity.example.com",
                   homepage_config: {
                     archetype: "charity-showcase",
                     landing_mode: "org_hub",
                     hero_surface: "brand_gradient",
                     artwork_display: "showcase_split"
                   },
                   features: { raffle: true, donations: true },
                   payment_config: {
                     payment_mode: "platform_collect",
                     processor_provider: "stripe",
                     platform_fee_per_registrant_cents: 400,
                     payout_payee_name: "Pacific Charity Foundation"
                   },
                   admin_emails: ["chair@pacific-charity.example.com", "treasurer@pacific-charity.example.com"]
                 }
               },
               headers: headers_for(@super_admin),
               as: :json
        ensure
          SendUserInviteEmailJob.define_singleton_method(:perform_later, original_perform_later)
        end

        assert_response :created
        created = Organization.find_by!(slug: "pacific-charity-cup")
        assert_equal "charity-showcase", created.homepage_config["archetype"]
        assert_equal "pacific-charity.example.com", created.primary_host
        assert_equal "platform_collect", created.effective_payment_config.payment_mode
        assert_equal 2, created.organization_memberships.where(role: "admin").count
        assert_equal 2, enqueued_invites.size
        assert ActivityLog.exists?(organization: created, action: "organization_created")
      end

      test "create_organization validates emails/colors/conflicts and rolls back atomically on failure" do
        before_orgs = Organization.count
        before_domains = OrganizationDomain.count
        before_users = User.count

        # Invalid email
        post "/api/v1/admin/platform/organizations",
             params: { organization: { name: "Bad Email Org", slug: "bad-email-org", admin_emails: ["not-an-email"] } },
             headers: headers_for(@super_admin),
             as: :json
        assert_response :unprocessable_entity

        # Invalid hex accent_color
        post "/api/v1/admin/platform/organizations",
             params: { organization: { name: "Bad Color Org", slug: "bad-color-org", accent_color: "javascript:alert(1)" } },
             headers: headers_for(@super_admin),
             as: :json
        assert_response :unprocessable_entity

        # Duplicate domain rolls back org & user creation atomically
        post "/api/v1/admin/platform/organizations",
             params: {
               organization: {
                 name: "Duplicate Domain Org",
                 slug: "dup-domain-org",
                 primary_domain: "island-memorial.example.com",
                 admin_emails: ["rollback@example.com"]
               }
             },
             headers: headers_for(@super_admin),
             as: :json
        assert_response :unprocessable_entity

        assert_equal before_orgs, Organization.count
        assert_equal before_domains, OrganizationDomain.count
        assert_equal before_users, User.count
      end

      test "update_organization supports status transitions, preserves past_due, blocks conflicts, archives tenant resolution, and clears client_processor credentials" do
        # 404 for unknown slug
        patch "/api/v1/admin/platform/organizations/does-not-exist",
              params: { organization: { status: "active" } },
              headers: headers_for(@super_admin),
              as: :json
        assert_response :not_found

        # Invalid status
        patch "/api/v1/admin/platform/organizations/#{@org.slug}",
              params: { organization: { status: "bogus" } },
              headers: headers_for(@super_admin),
              as: :json
        assert_response :unprocessable_entity

        # Conflicting status + features.offseason_mode
        patch "/api/v1/admin/platform/organizations/#{@org.slug}",
              params: { organization: { status: "active", features: { offseason_mode: true } } },
              headers: headers_for(@super_admin),
              as: :json
        assert_response :unprocessable_entity

        # Preserves past_due when setting active
        @org.update!(subscription_status: "past_due", offseason_enabled: true)
        patch "/api/v1/admin/platform/organizations/#{@org.slug}",
              params: { organization: { status: "active" } },
              headers: headers_for(@super_admin),
              as: :json
        assert_response :success
        @org.reload
        assert_equal "past_due", @org.subscription_status
        assert_equal false, @org.offseason_enabled

        # Archiving sets canceled and blocks public tenant resolution
        patch "/api/v1/admin/platform/organizations/#{@org.slug}",
              params: { organization: { status: "archived" } },
              headers: headers_for(@super_admin),
              as: :json
        assert_response :success
        assert_equal "canceled", @org.reload.subscription_status

        get "/api/v1/tenant", params: { slug: @org.slug }
        assert_response :not_found

        # Switching away from client_processor clears encrypted keys and webhook token
        @org.organization_payment_config.update!(
          payment_mode: "client_processor",
          processor_provider: "stripe",
          encrypted_public_key: "pk_test_client_123456",
          encrypted_secret_key: "sk_test_client_123456",
          encrypted_webhook_secret: "whsec_client_123456"
        )
        assert_not_nil @org.organization_payment_config.webhook_endpoint_token

        patch "/api/v1/admin/platform/organizations/#{@org.slug}",
              params: {
                organization: {
                  status: "active",
                  features: { raffle: false },
                  payment_config: { payment_mode: "offline", processor_provider: "none" }
                }
              },
              headers: headers_for(@super_admin),
              as: :json
        assert_response :success
        pc = @org.reload.organization_payment_config
        assert_equal "offline", pc.payment_mode
        assert_nil pc.encrypted_public_key
        assert_nil pc.encrypted_secret_key
        assert_nil pc.encrypted_webhook_secret
        assert_nil pc.webhook_endpoint_token
        assert ActivityLog.exists?(organization: @org, action: "settings_updated")
      end
    end
  end
end
