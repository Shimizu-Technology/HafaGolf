require "test_helper"

class RackAttackRateLimitingTest < ActionDispatch::IntegrationTest
  FROZEN_MID_PERIOD_TIME = Time.utc(2026, 6, 1, 12, 0, 30)

  setup do
    travel_to FROZEN_MID_PERIOD_TIME
    @original_enabled = Rack::Attack.enabled
    @original_store = Rack::Attack.cache.store
    Rack::Attack.enabled = true
    Rack::Attack.cache.store = ActiveSupport::Cache::MemoryStore.new
    Rack::Attack.reset!
  end

  teardown do
    Rack::Attack.reset!
    Rack::Attack.cache.store = @original_store
    Rack::Attack.enabled = @original_enabled
    travel_back
  end

  test "throttles repeated public registration attempts per IP" do
    ip_env = { "REMOTE_ADDR" => "10.10.10.10" }

    10.times do
      post "/api/v1/golfers", params: {}, env: ip_env
      refute_equal 429, response.status
    end

    post "/api/v1/golfers", params: {}, env: ip_env
    assert_response :too_many_requests
  end

  test "throttles authenticated requests by bearer token fingerprint" do
    user = users(:super_admin)
    user.update!(clerk_id: "test_clerk_#{user.id}") if user.clerk_id.blank?

    headers = {
      "Authorization" => "Bearer test_token_#{user.id}"
    }
    ip_env = { "REMOTE_ADDR" => "10.10.20.20" }

    120.times do
      get "/api/v1/admin/organizations", headers: headers, env: ip_env
      refute_equal 429, response.status
    end

    get "/api/v1/admin/organizations", headers: headers, env: ip_env
    assert_response :too_many_requests
  end

  test "throttles public employee_numbers validate requests including .json and trailing slash variants" do
    ip_env = { "REMOTE_ADDR" => "10.10.30.30" }

    18.times do
      post "/api/v1/employee_numbers/validate", params: { employee_number: "TEST" }, env: ip_env
      refute_equal 429, response.status
    end

    post "/api/v1/employee_numbers/validate.json", params: { employee_number: "TEST" }, env: ip_env
    refute_equal 429, response.status

    post "/api/v1/employee_numbers/validate/", params: { employee_number: "TEST" }, env: ip_env
    refute_equal 429, response.status

    post "/api/v1/employee_numbers/validate.xml", params: { employee_number: "TEST" }, env: ip_env
    assert_response :too_many_requests
  end
end
