require "test_helper"

class Api::V1::CheckInWaiversTest < ActionDispatch::IntegrationTest
  setup do
    @golfer = golfers(:confirmed_paid)
    @tournament = @golfer.tournament
    @organization = @tournament.organization
    @golfer.update_columns(waiver_accepted_at: nil, partner_name: "Another Player", partner_waiver_accepted_at: nil)
    @member = @tournament.registrations.create!(
      organization: @organization, registration_source: "admin",
      team_members_attributes: [{ name: "Roster Player" }]
    ).team_members.first

    @volunteer = users(:user_no_clerk)
    @volunteer.update!(clerk_id: "clerk_waiver_volunteer")
    @organization.organization_memberships.create!(user: @volunteer, role: "volunteer")

    @golfer_path = "/api/v1/golfers/#{@golfer.id}/mark_waiver_signed"
    @member_path = "/api/v1/team_members/#{@member.id}/mark_waiver_signed"
  end

  test "an authorized volunteer records each signature once and returns the persisted timestamp" do
    authenticate_as(@volunteer)

    assert_difference -> { ActivityLog.where(action: "waiver_signed", organization: @organization).count }, 2 do
      post @golfer_path, headers: auth_headers
      assert_response :ok
      assert response.parsed_body["waiver_accepted_at"].present?
      assert_nil response.parsed_body["partner_waiver_accepted_at"]

      post @member_path, headers: auth_headers
      assert_response :ok
      assert response.parsed_body.dig("team_member", "waiver_accepted_at").present?
    end

    golfer_time = @golfer.reload.waiver_accepted_at
    member_time = @member.reload.waiver_accepted_at
    assert_not_nil golfer_time
    assert_not_nil member_time

    travel 1.minute do
      assert_no_difference "ActivityLog.count" do
        post @golfer_path, headers: auth_headers
        assert_response :ok
        post @member_path, headers: auth_headers
        assert_response :ok
      end
    end
    assert_equal golfer_time, @golfer.reload.waiver_accepted_at
    assert_equal member_time, @member.reload.waiver_accepted_at
    assert_equal 2, ActivityLog.where(action: "waiver_signed", admin_id: @volunteer.id, tournament: @tournament).count
  end

  test "staff can record a legacy partner's signature independently" do
    authenticate_as(users(:user_one))
    post @golfer_path, params: { partner: true }, headers: auth_headers, as: :json

    assert_response :ok
    assert_nil @golfer.reload.waiver_accepted_at
    assert_not_nil @golfer.partner_waiver_accepted_at
    assert ActivityLog.find_by!(action: "waiver_signed", target_id: @golfer.id).metadata.fetch("partner")
  end

  test "signed team members expose their timestamp on registration details" do
    authenticate_as(users(:user_one))
    post @member_path, headers: auth_headers
    assert_response :ok

    get "/api/v1/registrations/#{@member.registration_id}", headers: auth_headers
    assert_response :ok
    assert_equal @member.reload.waiver_accepted_at.to_i,
                 Time.iso8601(response.parsed_body.dig("registration", "team_members", 0, "waiver_accepted_at")).to_i
  end

  test "anonymous and unrelated staff cannot mark a signature" do
    paths = [@golfer_path, @member_path]

    paths.each do |path|
      post path
      assert_response :unauthorized
    end

    outsider = User.create!(name: "Other Staff", role: "org_admin", email: "other-staff@example.test", clerk_id: "other_staff")
    other_org = Organization.create!(name: "Other Golf Club", slug: "other-golf-club")
    other_org.organization_memberships.create!(user: outsider, role: "volunteer")
    authenticate_as(outsider)

    assert_no_difference "ActivityLog.count" do
      paths.each do |path|
        post path, headers: auth_headers
        assert_includes [403, 404], response.status
      end
    end
    assert_nil @golfer.reload.waiver_accepted_at
    assert_nil @member.reload.waiver_accepted_at
  end

  test "staff with access are rejected on another organization's tenant host" do
    other_org = Organization.create!(name: "Coastal Club", slug: "coastal-club")
    other_org.organization_domains.create!(hostname: "coastal.golf.test", is_primary: true)
    authenticate_as(users(:super_admin))

    assert_no_difference "ActivityLog.count" do
      [@golfer_path, @member_path].each do |path|
        post path, headers: auth_headers.merge("X-Tenant-Host" => "coastal.golf.test")
        assert_response :forbidden
      end
    end
    assert_nil @golfer.reload.waiver_accepted_at
    assert_nil @member.reload.waiver_accepted_at
  end

  test "staff cannot record signatures when the waiver is disabled" do
    @tournament.update!(waiver_enabled: false)
    authenticate_as(@volunteer)

    assert_no_difference "ActivityLog.count" do
      [@golfer_path, @member_path].each do |path|
        post path, headers: auth_headers
        assert_response :unprocessable_entity
      end
    end
    assert_nil @golfer.reload.waiver_accepted_at
    assert_nil @member.reload.waiver_accepted_at
  end
end
