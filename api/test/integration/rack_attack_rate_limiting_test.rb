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

  test "throttles ticket checks per IP and tournament including format suffixes and HEAD" do
    path = "/api/v1/tournaments/#{tournaments(:tournament_one).id}/raffle/check_ticket"
    ip = { "REMOTE_ADDR" => "10.10.40.40" }
    params = { ticket_number: "TIX-0001" }

    179.times do
      get path, params: params, env: ip
      assert_response :ok
    end
    head "#{path}.json", params: params, env: ip
    assert_response :ok

    get "#{path}/", params: params, env: ip
    assert_response :too_many_requests

    get path, params: params, env: { "REMOTE_ADDR" => "10.10.40.41" }
    assert_response :ok
  end

end
