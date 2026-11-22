# frozen_string_literal: true

require "test_helper"

# End-to-end HTTP smoke test running against PostgreSQL as a NON-OWNER, NON-BYPASSRLS
# database role (`hafagolf_rls_test_role`) so FORCE ROW LEVEL SECURITY is actively
# enforced by the database engine across real Rails controller requests:
# public registration -> admin list + cross-org isolation -> raffle draw readiness -> raffle draw.
class RlsNonOwnerE2eTest < ActionDispatch::IntegrationTest
  self.use_transactional_tests = false

  TEST_ROLE = "hafagolf_rls_test_role"

  setup do
    @connection = ActiveRecord::Base.connection
    TenantRls.apply!(@connection)
    TenantRls.setup_app_role!(@connection, role_name: TEST_ROLE)

    TenantContext.with_platform_access do
      @org_a = Organization.create!(
        name: "E2E RLS Org A",
        slug: "e2e-rls-a-#{SecureRandom.hex(3)}",
        primary_color: "#1B3A4B",
        settings: { "features" => { "raffle" => true, "waitlist" => true } }
      )
      @org_b = Organization.create!(
        name: "E2E RLS Org B",
        slug: "e2e-rls-b-#{SecureRandom.hex(3)}",
        primary_color: "#0F766E",
        settings: { "features" => { "raffle" => true, "waitlist" => true } }
      )

      @domain_a = @org_a.organization_domains.create!(hostname: "e2e-a-#{SecureRandom.hex(3)}.example.com", is_primary: true)
      @domain_b = @org_b.organization_domains.create!(hostname: "e2e-b-#{SecureRandom.hex(3)}.example.com", is_primary: true)

      @tournament_a = @org_a.tournaments.create!(
        name: "E2E Alpha Cup",
        slug: "e2e-alpha-#{SecureRandom.hex(3)}",
        year: 2027,
        status: "open",
        registration_open: true,
        raffle_enabled: true,
        entry_fee: 12_500,
        max_capacity: 144
      )
      @tournament_b = @org_b.tournaments.create!(
        name: "E2E Beta Cup",
        slug: "e2e-beta-#{SecureRandom.hex(3)}",
        year: 2027,
        status: "open",
        registration_open: true,
        raffle_enabled: true,
        entry_fee: 12_500,
        max_capacity: 144
      )

      @admin_a = User.create!(
        email: "e2e-admin-a-#{SecureRandom.hex(3)}@example.com",
        name: "E2E Admin A",
        role: "org_admin",
        clerk_id: "clerk_e2e_a_#{SecureRandom.hex(4)}"
      )
      OrganizationMembership.create!(user: @admin_a, organization: @org_a, role: "admin")

      @admin_b = User.create!(
        email: "e2e-admin-b-#{SecureRandom.hex(3)}@example.com",
        name: "E2E Admin B",
        role: "org_admin",
        clerk_id: "clerk_e2e_b_#{SecureRandom.hex(4)}"
      )
      OrganizationMembership.create!(user: @admin_b, organization: @org_b, role: "admin")

      @prize_a = @tournament_a.raffle_prizes.create!(
        name: "E2E Grand Prize",
        value_cents: 50_000,
        tier: "grand",
        position: 1
      )
      @ticket_a = @tournament_a.raffle_tickets.create!(
        ticket_number: "E2E27-0001",
        sequence_number: 1,
        purchaser_name: "Alice Ticket",
        purchaser_email: "alice-ticket@example.com",
        purchaser_phone: "+16715554001",
        price_cents: 1_000,
        payment_status: "paid",
        payment_method: "cash",
        purchased_at: Time.current
      )
      MessageDelivery.create!(
        organization: @org_a,
        tournament: @tournament_a,
        messageable: @ticket_a,
        channel: "sms",
        provider: "clicksend",
        purpose: "raffle_purchase_confirmation",
        recipient: "+16715554001",
        status: "delivered"
      )
    end
  end

  teardown do
    @connection.execute("RESET ROLE") rescue nil
    TenantContext.with_platform_access do
      t_ids = [@tournament_a&.id, @tournament_b&.id].compact
      o_ids = [@org_a&.id, @org_b&.id].compact
      u_ids = [@admin_a&.id, @admin_b&.id].compact

      ActivityLog.where(tournament_id: t_ids).delete_all if t_ids.any?
      ActivityLog.where(organization_id: o_ids).delete_all if o_ids.any?
      MessageDelivery.where(organization_id: o_ids).delete_all if o_ids.any?
      RafflePrize.where(tournament_id: t_ids).update_all(winning_ticket_id: nil) if t_ids.any?
      RaffleTicket.where(tournament_id: t_ids).delete_all if t_ids.any?
      RafflePrize.where(tournament_id: t_ids).delete_all if t_ids.any?
      Golfer.where(tournament_id: t_ids).delete_all if t_ids.any?
      Tournament.where(id: t_ids).delete_all if t_ids.any?
      OrganizationDomain.where(organization_id: o_ids).delete_all if o_ids.any?
      OrganizationMembership.where(organization_id: o_ids).delete_all if o_ids.any?
      Organization.where(id: o_ids).delete_all if o_ids.any?
      User.where(id: u_ids).delete_all if u_ids.any?
    end
  end

  test "full request flow executes cleanly under non-owner RLS role while blocking cross-tenant reads" do
    with_non_owner_role do
      # Confirm Postgres actually enforces RLS on this connection
      status = TenantRls.status(@connection)
      assert_equal true, status[:enforced_for_current_role], "Expected non-owner RLS enforcement"

      # 1. Public registration on Org A host succeeds under non-owner RLS role
      post "/api/v1/golfers",
           params: {
             tournament_id: @tournament_a.id,
             golfer: {
               name: "RLS E2E Player",
               email: "rls-e2e-#{SecureRandom.hex(4)}@example.com",
               phone: "671-555-8888",
               team_category: "Co-Ed",
               payment_type: "pay_on_day"
             },
             waiver_accepted: true
           },
           headers: { "X-Tenant-Host" => @domain_a.hostname }
      assert_response :created, "Public registration failed under non-owner RLS: #{response.body}"
      created_id = JSON.parse(response.body).dig("golfer", "id")
      assert_not_nil created_id

      # 2. Org A admin sees the registered golfer
      get "/api/v1/golfers",
          params: { tournament_id: @tournament_a.id },
          headers: auth_headers_for(@admin_a)
      assert_response :success
      golfers_a = JSON.parse(response.body)["golfers"]
      assert_includes golfers_a.map { |g| g["id"] }, created_id

      # 3. Org B admin CANNOT read Org A's tournament golfers
      get "/api/v1/golfers",
          params: { tournament_id: @tournament_a.id },
          headers: auth_headers_for(@admin_b)
      assert_includes [403, 404], response.status

      # 4. Org A admin checks raffle draw readiness under non-owner RLS role
      get "/api/v1/tournaments/#{@tournament_a.id}/raffle/draw_readiness",
          headers: auth_headers_for(@admin_a)
      assert_response :success
      readiness = JSON.parse(response.body)
      assert_equal 1, readiness["eligible_ticket_count"]

      # 5. Org A admin draws raffle prize under non-owner RLS role (skipped-wrapper action!)
      post "/api/v1/tournaments/#{@tournament_a.id}/raffle/prizes/#{@prize_a.id}/draw",
           headers: auth_headers_for(@admin_a)
      assert_response :success, "Raffle draw failed under non-owner RLS: #{response.body}"
      TenantContext.with_organization(@org_a) do
        @prize_a.reload
        assert_equal true, @prize_a.won
        assert_equal @ticket_a.id, @prize_a.winning_ticket_id
      end
    end
  end

  private

  def with_non_owner_role
    @connection.execute("SET ROLE #{TEST_ROLE}")
    yield
  ensure
    @connection.execute("RESET ROLE")
  end

  def auth_headers_for(user)
    { "Authorization" => "Bearer test_token_#{user.id}" }
  end
end
