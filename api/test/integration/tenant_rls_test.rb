# frozen_string_literal: true

require "test_helper"

class TenantRlsTest < ActiveSupport::TestCase
  # Disable transactional fixtures so we can manage explicit transactions & SET LOCAL ROLE cleanly
  self.use_transactional_tests = false

  TEST_ROLE = "hafagolf_rls_test_role"

  setup do
    @connection = ActiveRecord::Base.connection
    TenantRls.apply!(@connection)
    TenantRls.setup_app_role!(@connection, role_name: TEST_ROLE)

    TenantContext.with_platform_access do
      @org_a = Organization.create!(name: "RLS Alpha", slug: "rls-alpha-#{SecureRandom.hex(3)}")
      @org_b = Organization.create!(name: "RLS Beta", slug: "rls-beta-#{SecureRandom.hex(3)}")

      @tournament_a = @org_a.tournaments.create!(name: "RLS Alpha Cup", year: 2027, status: "open")
      @tournament_b = @org_b.tournaments.create!(name: "RLS Beta Cup", year: 2027, status: "open")

      @golfer_a = @tournament_a.golfers.create!(
        name: "RLS Golfer A",
        email: "rls-a-#{SecureRandom.hex(3)}@example.com",
        phone: "671-555-3001",
        team_category: "Co-Ed",
        payment_type: "pay_on_day",
        payment_status: "unpaid",
        registration_status: "confirmed",
        waiver_accepted_at: Time.current
      )
      @golfer_b = @tournament_b.golfers.create!(
        name: "RLS Golfer B",
        email: "rls-b-#{SecureRandom.hex(3)}@example.com",
        phone: "671-555-3002",
        team_category: "Co-Ed",
        payment_type: "pay_on_day",
        payment_status: "unpaid",
        registration_status: "confirmed",
        waiver_accepted_at: Time.current
      )

      @delivery_a = MessageDelivery.create!(
        organization: @org_a,
        tournament: @tournament_a,
        channel: "sms",
        provider: "clicksend",
        purpose: "raffle_purchase_confirmation",
        recipient: "+16715553001",
        status: "delivered"
      )
      @delivery_b = MessageDelivery.create!(
        organization: @org_b,
        tournament: @tournament_b,
        channel: "sms",
        provider: "clicksend",
        purpose: "raffle_purchase_confirmation",
        recipient: "+16715553002",
        status: "delivered"
      )
      @payment_config_a = @org_a.create_organization_payment_config!(
        payment_mode: "platform_collect",
        processor_provider: "stripe"
      )
      @payment_config_b = @org_b.create_organization_payment_config!(
        payment_mode: "offline",
        processor_provider: "none"
      )
      @settlement_a = @tournament_a.tournament_settlements.create!(
        organization: @org_a,
        version: 1,
        status: "draft",
        gross_cents: 10_000,
        net_cents: 10_000,
        organizer_proceeds_cents: 10_000,
        payable_cents: 10_000
      )
      @settlement_b = @tournament_b.tournament_settlements.create!(
        organization: @org_b,
        version: 1,
        status: "draft",
        gross_cents: 10_000,
        net_cents: 10_000,
        organizer_proceeds_cents: 10_000,
        payable_cents: 10_000
      )
      @payout_a = @settlement_a.tournament_payouts.create!(
        organization: @org_a,
        tournament: @tournament_a,
        amount_cents: 5_000,
        provider: "check",
        status: "pending"
      )
      @payout_b = @settlement_b.tournament_payouts.create!(
        organization: @org_b,
        tournament: @tournament_b,
        amount_cents: 5_000,
        provider: "check",
        status: "pending"
      )
    end
  end

  teardown do
    TenantContext.with_platform_access do
      tournament_ids = [@tournament_a&.id, @tournament_b&.id].compact
      org_ids = [@org_a&.id, @org_b&.id].compact

      TournamentPayout.where(organization_id: org_ids).delete_all if org_ids.any?
      TournamentSettlement.where(organization_id: org_ids).delete_all if org_ids.any?
      OrganizationPaymentConfig.where(organization_id: org_ids).delete_all if org_ids.any?

      ActivityLog.where(tournament_id: tournament_ids).delete_all if tournament_ids.any?
      ActivityLog.where(organization_id: org_ids).delete_all if org_ids.any?
      Score.where(tournament_id: tournament_ids).delete_all if tournament_ids.any?
      RaffleTicket.where(tournament_id: tournament_ids).delete_all if tournament_ids.any?
      MessageDelivery.where(organization_id: org_ids).delete_all if org_ids.any?
      Golfer.where(tournament_id: tournament_ids).delete_all if tournament_ids.any?
      TournamentAssignment.where(tournament_id: tournament_ids).delete_all if tournament_ids.any?
      Tournament.where(id: tournament_ids).delete_all if tournament_ids.any?
      Organization.where(id: org_ids).delete_all if org_ids.any?
    end
  end

  test "FORCE ROW LEVEL SECURITY fails closed with 0 rows when no tenant context or closed context is set" do
    as_non_owner_role do
      assert_equal 0, Tournament.where(id: [@tournament_a.id, @tournament_b.id]).count
      assert_equal 0, Golfer.where(id: [@golfer_a.id, @golfer_b.id]).count
      assert_equal 0, MessageDelivery.where(id: [@delivery_a.id, @delivery_b.id]).count
      assert_equal 0, OrganizationPaymentConfig.where(id: [@payment_config_a.id, @payment_config_b.id]).count
      assert_equal 0, TournamentSettlement.where(id: [@settlement_a.id, @settlement_b.id]).count
      assert_equal 0, TournamentPayout.where(id: [@payout_a.id, @payout_b.id]).count

      TenantContext.with_closed_access do
        assert_equal 0, Tournament.where(id: [@tournament_a.id, @tournament_b.id]).count
        assert_equal 0, Golfer.where(id: [@golfer_a.id, @golfer_b.id]).count
      end
    end
  end

  test "TenantContext.with_organization isolates reads and blocks cross-tenant writes at Postgres engine level" do
    as_non_owner_role do
      TenantContext.with_organization(@org_a) do
        visible_tournaments = Tournament.where(id: [@tournament_a.id, @tournament_b.id]).pluck(:id)
        assert_equal [@tournament_a.id], visible_tournaments

        visible_golfers = Golfer.where(id: [@golfer_a.id, @golfer_b.id]).pluck(:id)
        assert_equal [@golfer_a.id], visible_golfers

        visible_deliveries = MessageDelivery.where(id: [@delivery_a.id, @delivery_b.id]).pluck(:id)
        assert_equal [@delivery_a.id], visible_deliveries

        visible_configs = OrganizationPaymentConfig.where(id: [@payment_config_a.id, @payment_config_b.id]).pluck(:id)
        assert_equal [@payment_config_a.id], visible_configs

        visible_settlements = TournamentSettlement.where(id: [@settlement_a.id, @settlement_b.id]).pluck(:id)
        assert_equal [@settlement_a.id], visible_settlements

        visible_payouts = TournamentPayout.where(id: [@payout_a.id, @payout_b.id]).pluck(:id)
        assert_equal [@payout_a.id], visible_payouts

        # Org-scoped activity log with tournament_id: nil succeeds under org context
        org_log = ActivityLog.log(
          admin: nil,
          action: "admin_created",
          organization: @org_a,
          details: "Org-level admin created"
        )
        assert_equal @org_a.id, org_log.organization_id

        # Cross-tenant UPDATE affects 0 rows
        updated = Golfer.where(id: @golfer_b.id).update_all(name: "Hacked")
        assert_equal 0, updated

        # Cross-tenant INSERT is rejected by RLS WITH CHECK
        assert_raises(ActiveRecord::StatementInvalid) do
          ActiveRecord::Base.transaction(requires_new: true) do
            @tournament_b.golfers.create!(
              name: "Cross Tenant Insert",
              email: "cross-#{SecureRandom.hex(3)}@example.com",
              phone: "671-555-9999",
              team_category: "Co-Ed",
              payment_type: "pay_on_day",
              payment_status: "unpaid",
              registration_status: "confirmed",
              waiver_accepted_at: Time.current
            )
          end
        end
      end

      # Org B cannot see Org A's org-level activity log
      TenantContext.with_organization(@org_b) do
        assert_equal 0, ActivityLog.where(organization_id: @org_a.id).count
      end
    end

    # Verify Org B golfer was untouched
    TenantContext.with_platform_access do
      assert_equal "RLS Golfer B", @golfer_b.reload.name
    end
  end

  test "TenantContext.with_organizations enforces org-ID allowlist for verified org admins" do
    as_non_owner_role do
      TenantContext.with_organizations([@org_a.id]) do
        assert_equal [@tournament_a.id], Tournament.where(id: [@tournament_a.id, @tournament_b.id]).pluck(:id)
        assert_equal [@golfer_a.id], Golfer.where(id: [@golfer_a.id, @golfer_b.id]).pluck(:id)
        assert_equal 0, Golfer.where(id: @golfer_b.id).update_all(name: "Hacked By Admin A")
      end

      TenantContext.with_organizations([]) do
        assert_equal 0, Tournament.where(id: [@tournament_a.id, @tournament_b.id]).count
      end
    end
  end

  test "TenantContext.with_platform_access allows explicit platform reads across organizations" do
    as_non_owner_role do
      TenantContext.with_platform_access do
        visible_tournaments = Tournament.where(id: [@tournament_a.id, @tournament_b.id]).pluck(:id).sort
        assert_equal [@tournament_a.id, @tournament_b.id].sort, visible_tournaments
      end
    end
  end

  test "nested TenantContext does not mask SQL errors with InFailedSqlTransaction" do
    as_non_owner_role do
      err = assert_raises(ActiveRecord::StatementInvalid) do
        TenantContext.with_organization(@org_a) do
          ActiveRecord::Base.connection.execute("SELECT * FROM nonexistent_table_rls_check")
        end
      end
      assert_match(/nonexistent_table_rls_check/, err.message)
    end
  end

  test "ApplicationMailDeliveryJob deserializes Golfer GlobalID under non-owner fail-closed RLS role" do
    job = ApplicationMailDeliveryJob.new(
      "GolferMailer",
      "confirmation_email",
      "deliver_now",
      args: [@golfer_a]
    )
    serialized = job.serialize

    as_non_owner_role do
      # Without RLS context, Golfer cannot be found directly
      assert_equal 0, Golfer.where(id: @golfer_a.id).count

      # Deserializing via ApplicationMailDeliveryJob establishes platform RLS context cleanly
      deserialized_job = ActiveJob::Base.deserialize(serialized)
      deserialized_job.send(:deserialize_arguments_if_needed)
      args = deserialized_job.arguments
      assert_equal @golfer_a.id, args.last[:args].first.id
    end
  end

  private

  def as_non_owner_role
    ActiveRecord::Base.transaction do
      @connection.execute("SET LOCAL ROLE #{@connection.quote_column_name(TEST_ROLE)}")
      yield
    end
  end
end
