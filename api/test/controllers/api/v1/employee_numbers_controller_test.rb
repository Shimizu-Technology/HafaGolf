# frozen_string_literal: true

require "test_helper"

class Api::V1::EmployeeNumbersControllerTest < ActionDispatch::IntegrationTest
  setup do
    @org_a = Organization.create!(
      name: "Alpha Club",
      slug: "alpha-emp-#{SecureRandom.hex(3)}",
      settings: { "features" => { "employee_pricing" => true } }
    )
    @org_a.organization_domains.create!(hostname: "alpha-#{@org_a.slug}.example.com", is_primary: true)

    @tournament_a = @org_a.tournaments.create!(
      name: "Alpha Memorial",
      slug: "alpha-memorial-#{SecureRandom.hex(3)}",
      year: 2027,
      status: "open",
      registration_open: true,
      max_capacity: 100,
      entry_fee: 12500,
      employee_entry_fee: 5000
    )

    @org_b = Organization.create!(
      name: "Beta Club",
      slug: "beta-emp-#{SecureRandom.hex(3)}",
      settings: { "features" => { "employee_pricing" => true } }
    )
    @org_b.organization_domains.create!(hostname: "beta-#{@org_b.slug}.example.com", is_primary: true)

    @tournament_b = @org_b.tournaments.create!(
      name: "Beta Classic",
      slug: "beta-classic-#{SecureRandom.hex(3)}",
      year: 2027,
      status: "open",
      registration_open: true,
      max_capacity: 100,
      entry_fee: 15000,
      employee_entry_fee: 6000
    )

    @admin_a = User.create!(
      email: "admin-a-#{SecureRandom.hex(4)}@example.com",
      name: "Admin A",
      clerk_id: "clerk_admin_a_#{SecureRandom.hex(4)}",
      role: "org_admin"
    )
    @org_a.add_admin(@admin_a)
    @admin_a_headers = { "Authorization" => "Bearer test_token_#{@admin_a.id}" }

    @volunteer_a = User.create!(
      email: "vol-a-#{SecureRandom.hex(4)}@example.com",
      name: "Volunteer A",
      clerk_id: "clerk_vol_a_#{SecureRandom.hex(4)}",
      role: "org_admin"
    )
    @org_a.add_member(@volunteer_a, role: "volunteer")
    @volunteer_a_headers = { "Authorization" => "Bearer test_token_#{@volunteer_a.id}" }

    @admin_b = User.create!(
      email: "admin-b-#{SecureRandom.hex(4)}@example.com",
      name: "Admin B",
      clerk_id: "clerk_admin_b_#{SecureRandom.hex(4)}",
      role: "org_admin"
    )
    @org_b.add_admin(@admin_b)
    @admin_b_headers = { "Authorization" => "Bearer test_token_#{@admin_b.id}" }

    @emp_a1 = @tournament_a.employee_numbers.create!(
      organization: @org_a,
      employee_number: "EMP-1001",
      employee_name: "Alice Santos"
    )
    @emp_b1 = @tournament_b.employee_numbers.create!(
      organization: @org_b,
      employee_number: "BETA-9001",
      employee_name: "Bob Cruz"
    )
  end

  test "all endpoints return 403 when employee_pricing feature is disabled" do
    @org_a.update!(settings: { "features" => { "employee_pricing" => false } })

    post "/api/v1/employee_numbers/validate",
         params: { tournament_id: @tournament_a.id, employee_number: "EMP-1001" },
         headers: { "X-Tenant-Host" => "alpha-#{@org_a.slug}.example.com" }
    assert_feature_disabled("employee_pricing")

    get "/api/v1/employee_numbers",
        params: { tournament_id: @tournament_a.id },
        headers: @admin_a_headers
    assert_feature_disabled("employee_pricing")

    post "/api/v1/employee_numbers",
         params: { tournament_id: @tournament_a.id, employee_number: "EMP-2002" },
         headers: @admin_a_headers
    assert_feature_disabled("employee_pricing")

    post "/api/v1/employee_numbers/bulk_create",
         params: { tournament_id: @tournament_a.id, employee_numbers: ["EMP-2003"] },
         headers: @admin_a_headers,
         as: :json
    assert_feature_disabled("employee_pricing")

    patch "/api/v1/employee_numbers/#{@emp_a1.id}",
          params: { employee_name: "Updated" },
          headers: @admin_a_headers
    assert_feature_disabled("employee_pricing")

    delete "/api/v1/employee_numbers/#{@emp_a1.id}",
           headers: @admin_a_headers
    assert_feature_disabled("employee_pricing")
  end

  test "public validate endpoint checks availability case-insensitively and enforces cross-org isolation" do
    host_a = { "X-Tenant-Host" => "alpha-#{@org_a.slug}.example.com" }

    post "/api/v1/employee_numbers/validate",
         params: { tournament_id: @tournament_a.id, employee_number: "  emp-1001  " },
         headers: host_a
    assert_response :success
    body = JSON.parse(response.body)
    assert_equal true, body["valid"]
    assert_equal true, body["available"]
    assert_not body.key?("employee_name"), "Public validate must not leak employee_name"
    assert_equal 5000, body["employee_entry_fee_cents"]

    # Invalid number
    post "/api/v1/employee_numbers/validate",
         params: { tournament_id: @tournament_a.id, employee_number: "DOES-NOT-EXIST" },
         headers: host_a
    assert_response :success
    body = JSON.parse(response.body)
    assert_equal false, body["valid"]
    assert_equal false, body["available"]
    assert_not body.key?("employee_name")

    # Cross-org: Org A host cannot validate Org B's employee number via Org A tournament
    post "/api/v1/employee_numbers/validate",
         params: { tournament_id: @tournament_a.id, employee_number: "BETA-9001" },
         headers: host_a
    assert_response :success
    body = JSON.parse(response.body)
    assert_equal false, body["valid"]
    assert_equal false, body["available"]
    assert_not body.key?("employee_name")

    # Cross-org: Org A host cannot target Org B's tournament_id
    post "/api/v1/employee_numbers/validate",
         params: { tournament_id: @tournament_b.id, employee_number: "BETA-9001" },
         headers: host_a
    assert_response :not_found
    body = JSON.parse(response.body)
    assert_equal false, body["valid"]
    assert_not body.key?("employee_name")
  end

  test "admin CRUD, search, bulk_create, release, and delete with used protection" do
    # Index with stats
    get "/api/v1/employee_numbers",
        params: { tournament_id: @tournament_a.id },
        headers: @admin_a_headers
    assert_response :success
    data = JSON.parse(response.body)
    assert_equal 1, data["employee_numbers"].length
    assert_equal({ "total" => 1, "used" => 0, "available" => 1 }, data["stats"])

    # Create single
    post "/api/v1/employee_numbers",
         params: {
           tournament_id: @tournament_a.id,
           employee_number: { employee_number: "emp-1002", employee_name: "Dana Reyes" }
         },
         headers: @admin_a_headers,
         as: :json
    assert_response :created
    created = JSON.parse(response.body)["employee_number"]
    assert_equal "EMP-1002", created["employee_number"]
    assert_equal "Dana Reyes", created["employee_name"]

    # Bulk create with CSV text (including header row, duplicates, and existing number)
    csv_payload = <<~CSV
      employee_number,employee_name
      EMP-1001,Duplicate Existing
      emp-1003,Chris Lim
      EMP-1003,Duplicate In Batch
      EMP-1004,Pat Flores
    CSV

    post "/api/v1/employee_numbers/bulk_create",
         params: { tournament_id: @tournament_a.id, csv_text: csv_payload },
         headers: @admin_a_headers,
         as: :json
    assert_response :created
    bulk = JSON.parse(response.body)
    assert_equal 2, bulk["created"]
    assert_equal 2, bulk["skipped"]
    assert_equal [], bulk["errors"]
    assert_equal 4, bulk.dig("stats", "total")

    # Search filter
    get "/api/v1/employee_numbers",
        params: { tournament_id: @tournament_a.id, search: "Chris" },
        headers: @admin_a_headers
    assert_response :success
    search_data = JSON.parse(response.body)
    assert_equal ["EMP-1003"], search_data["employee_numbers"].map { |r| r["employee_number"] }

    # Claim via golfer and verify delete is blocked until released
    golfer = @tournament_a.golfers.create!(
      name: "Alice Santos",
      email: "alice-#{SecureRandom.hex(3)}@example.com",
      phone: "+16715551111",
      team_category: "Female",
      payment_type: "pay_on_day",
      payment_status: "unpaid",
      registration_status: "confirmed",
      waiver_accepted_at: Time.current
    )
    @emp_a1.claim!(golfer)

    delete "/api/v1/employee_numbers/#{@emp_a1.id}", headers: @admin_a_headers
    assert_response :unprocessable_entity

    # Release via PATCH
    patch "/api/v1/employee_numbers/#{@emp_a1.id}",
          params: { release: true },
          headers: @admin_a_headers,
          as: :json
    assert_response :success
    assert_equal false, JSON.parse(response.body).dig("employee_number", "used")
    assert_equal false, golfer.reload.is_employee?

    # Now delete succeeds
    delete "/api/v1/employee_numbers/#{@emp_a1.id}", headers: @admin_a_headers
    assert_response :no_content
    assert_not EmployeeNumber.exists?(@emp_a1.id)
  end

  test "cross-org admins and volunteers cannot access or mutate employee numbers" do
    # Volunteer forbidden
    get "/api/v1/employee_numbers",
        params: { tournament_id: @tournament_a.id },
        headers: @volunteer_a_headers
    assert_response :forbidden

    # Org A admin cannot list Org B
    get "/api/v1/employee_numbers",
        params: { tournament_id: @tournament_b.id },
        headers: @admin_a_headers
    assert_response :forbidden

    # Org A admin cannot create in Org B
    post "/api/v1/employee_numbers",
         params: { tournament_id: @tournament_b.id, employee_number: "HACK-1" },
         headers: @admin_a_headers,
         as: :json
    assert_response :forbidden

    # Org A admin cannot update or delete Org B's employee number
    patch "/api/v1/employee_numbers/#{@emp_b1.id}",
          params: { employee_name: "Tampered" },
          headers: @admin_a_headers,
          as: :json
    assert_response :forbidden

    delete "/api/v1/employee_numbers/#{@emp_b1.id}", headers: @admin_a_headers
    assert_response :forbidden
    assert EmployeeNumber.exists?(@emp_b1.id)
  end

  test "golfer registration claims employee number atomically, blocks reuse, rejects when disabled, and releases on cancel" do
    host_a = { "X-Tenant-Host" => "alpha-#{@org_a.slug}.example.com" }

    # Register golfer with employee number
    post "/api/v1/golfers",
         params: {
           tournament_id: @tournament_a.id,
           waiver_accepted: true,
           is_employee: true,
           employee_number: "emp-1001",
           golfer: {
             name: "Alice Santos",
             email: "alice-reg-#{SecureRandom.hex(3)}@example.com",
             phone: "+16715551234",
             payment_type: "pay_on_day",
             team_category: "Co-Ed"
           }
         },
         headers: host_a,
         as: :json
    assert_response :created
    body = JSON.parse(response.body)
    golfer_json = body["golfer"]
    assert_equal true, golfer_json["is_employee"]
    assert_equal "EMP-1001", golfer_json["employee_number"]
    assert_equal 5000, golfer_json["payment_amount_cents"]
    assert_equal 5000, golfer_json["expected_entry_fee_cents"]
    assert @emp_a1.reload.used?
    assert_equal golfer_json["id"], @emp_a1.used_by_golfer_id

    # Attempting to register a second golfer with the same employee number fails cleanly
    post "/api/v1/golfers",
         params: {
           tournament_id: @tournament_a.id,
           waiver_accepted: true,
           is_employee: true,
           employee_number: "EMP-1001",
           golfer: {
             name: "Second Player",
             email: "second-#{SecureRandom.hex(3)}@example.com",
             phone: "+16715551235",
             payment_type: "pay_on_day",
             team_category: "Co-Ed"
           }
         },
         headers: host_a,
         as: :json
    assert_response :unprocessable_entity
    assert_match(/already been used/i, response.body)

    # Cross-org: Org B's employee number is rejected on Org A's tournament
    post "/api/v1/golfers",
         params: {
           tournament_id: @tournament_a.id,
           waiver_accepted: true,
           is_employee: true,
           employee_number: "BETA-9001",
           golfer: {
             name: "Cross Org Attempt",
             email: "cross-#{SecureRandom.hex(3)}@example.com",
             phone: "+16715551236",
             payment_type: "pay_on_day",
             team_category: "Co-Ed"
           }
         },
         headers: host_a,
         as: :json
    assert_response :unprocessable_entity

    # Cancelling golfer releases the employee number so another golfer can use it
    post "/api/v1/golfers/#{golfer_json['id']}/cancel",
         params: { reason: "Withdrew" },
         headers: @admin_a_headers,
         as: :json
    assert_response :success
    assert_not @emp_a1.reload.used?
    assert_nil @emp_a1.used_by_golfer_id

    # Disabling employee_pricing rejects registration requesting employee discount with 403
    @org_a.update!(settings: { "features" => { "employee_pricing" => false } })
    post "/api/v1/golfers",
         params: {
           tournament_id: @tournament_a.id,
           waiver_accepted: true,
           is_employee: true,
           employee_number: "EMP-1001",
           golfer: {
             name: "Blocked Employee",
             email: "blocked-#{SecureRandom.hex(3)}@example.com",
             phone: "+16715551237",
             payment_type: "pay_on_day",
             team_category: "Co-Ed"
           }
         },
         headers: host_a,
         as: :json
    assert_feature_disabled("employee_pricing")
  end

  test "blank tournament employee_entry_fee rejects validation and registration without burning employee number" do
    host_a = { "X-Tenant-Host" => "alpha-#{@org_a.slug}.example.com" }
    @tournament_a.update!(employee_entry_fee: nil)

    post "/api/v1/employee_numbers/validate",
         params: { tournament_id: @tournament_a.id, employee_number: "EMP-1001" },
         headers: host_a
    assert_response :unprocessable_entity

    post "/api/v1/golfers",
         params: {
           tournament_id: @tournament_a.id,
           waiver_accepted: true,
           is_employee: true,
           employee_number: "EMP-1001",
           golfer: {
             name: "Unconfigured Fee Player",
             email: "unconfigured-#{SecureRandom.hex(3)}@example.com",
             phone: "+16715551239",
             payment_type: "pay_on_day",
             team_category: "Co-Ed"
           }
         },
         headers: host_a,
         as: :json
    assert_response :unprocessable_entity
    assert_not @emp_a1.reload.used?, "Employee number must not be burned when employee_entry_fee is blank"
  end

  test "admin golfer update blocks setting is_employee true without a claimed employee number and allows clearing false" do
    regular = @tournament_a.golfers.create!(
      name: "Regular Golfer",
      email: "regular-#{SecureRandom.hex(3)}@example.com",
      phone: "+16715551240",
      team_category: "Co-Ed",
      payment_type: "pay_on_day",
      payment_status: "unpaid",
      registration_status: "confirmed",
      waiver_accepted_at: Time.current
    )

    patch "/api/v1/golfers/#{regular.id}",
          params: { golfer: { is_employee: true } },
          headers: @admin_a_headers,
          as: :json
    assert_response :unprocessable_entity
    assert_not regular.reload.is_employee?

    # Claim via EmployeeNumber then clear via PATCH is_employee: false
    @emp_a1.claim!(regular)
    assert regular.reload.is_employee?

    patch "/api/v1/golfers/#{regular.id}",
          params: { golfer: { is_employee: false } },
          headers: @admin_a_headers,
          as: :json
    assert_response :success
    assert_not regular.reload.is_employee?
    assert_not @emp_a1.reload.used?
  end

  test "employee_numbers update rolls back release when rename fails uniqueness validation" do
    other_emp = @tournament_a.employee_numbers.create!(
      organization: @org_a,
      employee_number: "EMP-9999"
    )
    golfer = @tournament_a.golfers.create!(
      name: "Claimed Golfer",
      email: "claimed-#{SecureRandom.hex(3)}@example.com",
      phone: "+16715551241",
      team_category: "Co-Ed",
      payment_type: "pay_on_day",
      payment_status: "unpaid",
      registration_status: "confirmed",
      waiver_accepted_at: Time.current
    )
    @emp_a1.claim!(golfer)

    patch "/api/v1/employee_numbers/#{@emp_a1.id}",
          params: { release: true, employee_number: other_emp.employee_number },
          headers: @admin_a_headers,
          as: :json
    assert_response :unprocessable_entity

    assert @emp_a1.reload.used?, "Release must roll back when rename fails"
    assert_equal golfer.id, @emp_a1.used_by_golfer_id
    assert golfer.reload.is_employee?
  end

  private

  def assert_feature_disabled(feature_key)
    assert_response :forbidden
    json = JSON.parse(response.body)
    assert_equal feature_key, json["feature"]
  end
end
