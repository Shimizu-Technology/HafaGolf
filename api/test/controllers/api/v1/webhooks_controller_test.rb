# frozen_string_literal: true

require "test_helper"

class Api::V1::WebhooksControllerTest < ActionDispatch::IntegrationTest
  def setup
    super
    @original_platform_secret = ENV["PLATFORM_STRIPE_SECRET_KEY"]
    @original_platform_webhook = ENV["PLATFORM_STRIPE_WEBHOOK_SECRET"]
    @original_env_secret = ENV["STRIPE_SECRET_KEY"]
    @original_env_webhook = ENV["STRIPE_WEBHOOK_SECRET"]
    @original_app_env = ENV["APP_ENV"]
    ENV["PLATFORM_STRIPE_SECRET_KEY"] = "sk_test_phase_c"
    ENV["PLATFORM_STRIPE_WEBHOOK_SECRET"] = nil
    ENV["STRIPE_SECRET_KEY"] = nil
    ENV["STRIPE_WEBHOOK_SECRET"] = nil
    ENV["APP_ENV"] = nil
  end

  def teardown
    ENV["PLATFORM_STRIPE_SECRET_KEY"] = @original_platform_secret
    ENV["PLATFORM_STRIPE_WEBHOOK_SECRET"] = @original_platform_webhook
    ENV["STRIPE_SECRET_KEY"] = @original_env_secret
    ENV["STRIPE_WEBHOOK_SECRET"] = @original_env_webhook
    ENV["APP_ENV"] = @original_app_env
    super
  end

  test "stripe webhook accepts unsigned payload in local test when webhook secret is missing" do
    payload = {
      id: "evt_unsigned_allowed",
      type: "unknown.event",
      data: { object: {} }
    }.to_json

    post "/api/v1/webhooks/stripe",
         params: payload,
         headers: { "CONTENT_TYPE" => "application/json" }

    assert_response :ok
  end

  test "stripe webhook fails closed in production and staging when webhook secret is missing" do
    payload = {
      id: "evt_missing_secret_production",
      type: "unknown.event",
      data: { object: {} }
    }.to_json

    original_env = Rails.env
    Rails.env = ActiveSupport::StringInquirer.new("production")
    begin
      post "/api/v1/webhooks/stripe",
           params: payload,
           headers: { "CONTENT_TYPE" => "application/json" }
      assert_response :bad_request
    ensure
      Rails.env = original_env
    end

    ENV["APP_ENV"] = "staging"
    post "/api/v1/webhooks/stripe",
         params: payload,
         headers: { "CONTENT_TYPE" => "application/json" }
    assert_response :bad_request
  end

  test "stripe webhook rejects invalid signature when webhook secret is configured" do
    ENV["PLATFORM_STRIPE_WEBHOOK_SECRET"] = "whsec_phase_c"

    payload = {
      id: "evt_invalid_signature",
      type: "unknown.event",
      data: { object: {} }
    }.to_json

    post "/api/v1/webhooks/stripe",
         params: payload,
         headers: {
           "CONTENT_TYPE" => "application/json",
           "HTTP_STRIPE_SIGNATURE" => "t=1111,v1=invalid"
         }

    assert_response :bad_request
  end

  test "checkout completed webhook marks golfer paid with stripe_account_origin" do
    golfer = golfers(:confirmed_unpaid)
    assert_equal "unpaid", golfer.payment_status

    payload = {
      id: "evt_checkout_completed",
      type: "checkout.session.completed",
      data: {
        object: {
          id: "cs_completed_123",
          payment_intent: "pi_completed_123",
          amount_total: 12500,
          metadata: { golfer_id: golfer.id.to_s }
        }
      }
    }.to_json

    post "/api/v1/webhooks/stripe",
         params: payload,
         headers: { "CONTENT_TYPE" => "application/json" }

    assert_response :ok
    golfer.reload
    assert_equal "paid", golfer.payment_status
    assert_equal "pi_completed_123", golfer.stripe_payment_intent_id
    assert_equal "platform_live", golfer.stripe_account_origin
    assert_equal "stripe", golfer.payment_method
  end

  test "checkout completed webhook confirms pending registration when payment succeeds" do
    golfer = create_pending_golfer

    payload = {
      id: "evt_pending_checkout_completed",
      type: "checkout.session.completed",
      data: {
        object: {
          id: "cs_pending_123",
          payment_intent: "pi_pending_123",
          metadata: { golfer_id: golfer.id.to_s }
        }
      }
    }.to_json

    post "/api/v1/webhooks/stripe",
         params: payload,
         headers: { "CONTENT_TYPE" => "application/json" }

    assert_response :ok
    golfer.reload
    assert_equal "paid", golfer.payment_status
    assert_equal "confirmed", golfer.registration_status
    assert_equal "pi_pending_123", golfer.stripe_payment_intent_id
    assert_equal "stripe", golfer.payment_method
  end

  test "duplicate checkout completed delivery is idempotent for already paid golfer" do
    golfer = golfers(:confirmed_unpaid)

    payload = {
      id: "evt_duplicate_delivery",
      type: "checkout.session.completed",
      data: {
        object: {
          id: "cs_duplicate_123",
          payment_intent: "pi_duplicate_123",
          metadata: { golfer_id: golfer.id.to_s }
        }
      }
    }.to_json

    post "/api/v1/webhooks/stripe",
         params: payload,
         headers: { "CONTENT_TYPE" => "application/json" }
    assert_response :ok

    golfer.reload
    assert_equal "paid", golfer.payment_status

    assert_no_changes -> { golfer.reload.updated_at } do
      post "/api/v1/webhooks/stripe",
           params: payload,
           headers: { "CONTENT_TYPE" => "application/json" }
      assert_response :ok
    end
  end

  private

  def create_pending_golfer
    tournament = tournaments(:tournament_one)
    tournament.golfers.create!(
      name: "Pending Webhook Golfer",
      email: "pending-webhook-#{SecureRandom.hex(4)}@example.com",
      phone: "671-555-0199",
      payment_type: "stripe",
      payment_status: "unpaid",
      registration_status: "pending",
      team_category: "Co-Ed",
      waiver_accepted_at: Time.current
    )
  end
end
