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
  end

  teardown do
    TenantContext.with_platform_access do
      MessageDelivery.where(id: [@delivery_a&.id, @delivery_b&.id].compact).delete_all
      Golfer.where(id: [@golfer_a&.id, @golfer_b&.id].compact).delete_all
      Tournament.where(id: [@tournament_a&.id, @tournament_b&.id].compact).delete_all
      Organization.where(id: [@org_a&.id, @org_b&.id].compact).delete_all
    end
  end

  test "FORCE ROW LEVEL SECURITY fails closed with 0 rows when no tenant context is set" do
    as_non_owner_role do
      assert_equal 0, Tournament.where(id: [@tournament_a.id, @tournament_b.id]).count
      assert_equal 0, Golfer.where(id: [@golfer_a.id, @golfer_b.id]).count
      assert_equal 0, MessageDelivery.where(id: [@delivery_a.id, @delivery_b.id]).count
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
    end

    # Verify Org B golfer was untouched
    assert_equal "RLS Golfer B", @golfer_b.reload.name
  end

  test "TenantContext.with_platform_access allows explicit platform reads across organizations" do
    as_non_owner_role do
      TenantContext.with_platform_access do
        visible_tournaments = Tournament.where(id: [@tournament_a.id, @tournament_b.id]).pluck(:id).sort
        assert_equal [@tournament_a.id, @tournament_b.id].sort, visible_tournaments
      end
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
