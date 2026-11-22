require "test_helper"
require "base64"
require "openssl"

class Api::V1::DeliveryWebhooksControllerTest < ActionDispatch::IntegrationTest
  setup do
    @previous_delivery_token = ENV["DELIVERY_WEBHOOK_TOKEN"]
    @previous_resend_token = ENV["RESEND_WEBHOOK_TOKEN"]
    @previous_resend_secret = ENV["RESEND_WEBHOOK_SECRET"]
    @previous_clicksend_token = ENV["CLICKSEND_WEBHOOK_TOKEN"]
    ENV["DELIVERY_WEBHOOK_TOKEN"] = "test-webhook-secret"
    ENV["RESEND_WEBHOOK_TOKEN"] = nil
    ENV["RESEND_WEBHOOK_SECRET"] = nil
    ENV["CLICKSEND_WEBHOOK_TOKEN"] = nil
  end

  teardown do
    ENV["DELIVERY_WEBHOOK_TOKEN"] = @previous_delivery_token
    ENV["RESEND_WEBHOOK_TOKEN"] = @previous_resend_token
    ENV["RESEND_WEBHOOK_SECRET"] = @previous_resend_secret
    ENV["CLICKSEND_WEBHOOK_TOKEN"] = @previous_clicksend_token
  end

  def webhook_headers
    { "X-Webhook-Token" => "test-webhook-secret" }
  end

  def svix_secret_raw
    "test-svix-signing-secret-bytes-32"
  end

  def svix_secret_env
    "whsec_#{Base64.strict_encode64(svix_secret_raw)}"
  end

  def svix_headers(raw_body:, id: "msg_test_123", timestamp: Time.current.to_i.to_s, secret: svix_secret_raw, signature_header: nil)
    sig = Base64.strict_encode64(OpenSSL::HMAC.digest("SHA256", secret, "#{id}.#{timestamp}.#{raw_body}"))
    {
      "CONTENT_TYPE" => "application/json",
      "svix-id" => id,
      "svix-timestamp" => timestamp,
      "svix-signature" => signature_header || "v1,#{sig}"
    }
  end

  test "webhooks fail closed with 401 when no token is configured" do
    ENV["DELIVERY_WEBHOOK_TOKEN"] = nil

    post "/api/v1/webhooks/resend",
         params: { type: "email.delivered", data: { email_id: "email_unauth" } }

    assert_response :unauthorized
  end

  test "webhooks reject missing or invalid token with 401" do
    post "/api/v1/webhooks/resend",
         params: { type: "email.delivered", data: { email_id: "email_missing" } }
    assert_response :unauthorized

    post "/api/v1/webhooks/clicksend",
         params: { message_id: "sms_invalid", status_text: "Delivered" },
         headers: { "X-Webhook-Token" => "wrong-secret" }
    assert_response :unauthorized
  end

  test "resend webhook updates matching delivery" do
    delivery = MessageDelivery.create!(
      provider: "resend",
      channel: "email",
      purpose: "sponsor_portal_invite",
      recipient: "sponsor@example.com",
      status: "accepted",
      provider_message_id: "email_123"
    )

    post "/api/v1/webhooks/resend",
         params: {
           type: "email.delivered",
           created_at: "2026-05-12T10:05:00Z",
           data: { email_id: "email_123" }
         },
         headers: webhook_headers

    assert_response :success
    assert_equal "delivered", delivery.reload.status
    assert delivery.delivered_at.present?
    assert_equal 1, delivery.response_payload.fetch("events").length
  end

  test "resend webhook classifies email.suppressed as failed and preserves reason" do
    delivery = MessageDelivery.create!(
      provider: "resend",
      channel: "email",
      purpose: "sponsor_portal_invite",
      recipient: "suppressed@example.com",
      status: "accepted",
      provider_message_id: "email_suppressed_123"
    )

    post "/api/v1/webhooks/resend",
         params: {
           type: "email.suppressed",
           data: { email_id: "email_suppressed_123", reason: "Recipient on suppression list" }
         },
         headers: webhook_headers

    assert_response :success
    delivery.reload
    assert_equal "failed", delivery.status
    assert_equal "Recipient on suppression list", delivery.error_text
    assert delivery.failed_at.present?
  end

  test "delayed out-of-order email.sent event does not regress delivered status" do
    delivery = MessageDelivery.create!(
      provider: "resend",
      channel: "email",
      purpose: "sponsor_portal_invite",
      recipient: "sponsor@example.com",
      status: "accepted",
      provider_message_id: "email_order_123"
    )

    post "/api/v1/webhooks/resend",
         params: {
           type: "email.delivered",
           created_at: "2026-05-12T10:05:00Z",
           data: { email_id: "email_order_123" }
         },
         headers: webhook_headers
    assert_response :success

    post "/api/v1/webhooks/resend",
         params: {
           type: "email.sent",
           created_at: "2026-05-12T10:00:00Z",
           data: { email_id: "email_order_123" }
         },
         headers: webhook_headers
    assert_response :success

    delivery.reload
    assert_equal "delivered", delivery.status
    assert delivery.delivered_at.present?
    assert_equal 2, delivery.response_payload.fetch("events").length
  end

  test "clicksend webhook updates matching delivery failure" do
    delivery = MessageDelivery.create!(
      provider: "clicksend",
      channel: "sms",
      purpose: "raffle_winner_notification",
      recipient: "+16715550123",
      status: "accepted",
      provider_message_id: "sms_123"
    )

    post "/api/v1/webhooks/clicksend",
         params: {
           message_id: "sms_123",
           status_code: "400",
           status_text: "Message rejected by carrier",
           error_text: "Carrier rejected message"
         },
         headers: webhook_headers

    assert_response :success
    assert_equal "failed", delivery.reload.status
    assert_equal "Carrier rejected message", delivery.error_text
    assert delivery.failed_at.present?
  end

  test "webhooks append intermediate events instead of replacing history" do
    delivery = MessageDelivery.create!(
      provider: "resend",
      channel: "email",
      purpose: "sponsor_portal_invite",
      recipient: "sponsor@example.com",
      status: "accepted",
      provider_message_id: "email_history_123"
    )

    post "/api/v1/webhooks/resend",
         params: {
           type: "email.delivery_delayed",
           data: { email_id: "email_history_123", reason: "Temporary deferral" }
         },
         headers: webhook_headers
    assert_response :success

    post "/api/v1/webhooks/resend",
         params: {
           type: "email.delivered",
           data: { email_id: "email_history_123" }
         },
         headers: webhook_headers
    assert_response :success

    delivery.reload
    assert_equal "delivered", delivery.status
    assert_equal 2, delivery.response_payload.fetch("events").length
    assert_equal [ "delayed", "delivered" ], delivery.response_payload.fetch("events").map { |event| event.fetch("status") }
  end

  test "unknown resend events preserve the current status while recording the event" do
    delivery = MessageDelivery.create!(
      provider: "resend",
      channel: "email",
      purpose: "sponsor_portal_invite",
      recipient: "sponsor@example.com",
      status: "pending",
      provider_message_id: "email_unknown_123"
    )

    post "/api/v1/webhooks/resend",
         params: {
           type: "email.opened",
           data: { email_id: "email_unknown_123" }
         },
         headers: webhook_headers

    assert_response :success
    delivery.reload
    assert_equal "pending", delivery.status
    assert_equal "email.opened", delivery.provider_status_text
    assert_equal 1, delivery.response_payload.fetch("events").length
    assert_equal "pending", delivery.response_payload.fetch("events").first.fetch("status")
  end

  test "resend webhook without message id does not mutate nil-id deliveries" do
    delivery = MessageDelivery.create!(
      provider: "resend",
      channel: "email",
      purpose: "sponsor_portal_invite",
      recipient: "sponsor@example.com",
      status: "pending",
      provider_message_id: nil
    )

    post "/api/v1/webhooks/resend",
         params: {
           type: "email.delivered",
           data: {}
         },
         headers: webhook_headers

    assert_response :accepted
    delivery.reload
    assert_equal "pending", delivery.status
    assert_nil delivery.provider_status_text
    assert_empty delivery.response_payload
  end

  test "resend webhook with non-object data is accepted without retrying" do
    post "/api/v1/webhooks/resend",
         params: {
           type: "email.delivered",
           data: "unexpected"
         },
         headers: webhook_headers

    assert_response :accepted
    json = JSON.parse(response.body)
    assert_equal "Missing provider message id", json.fetch("message")
  end

  test "clicksend webhook without message id does not mutate nil-id deliveries" do
    delivery = MessageDelivery.create!(
      provider: "clicksend",
      channel: "sms",
      purpose: "raffle_winner_notification",
      recipient: "+16715550123",
      status: "pending",
      provider_message_id: nil
    )

    post "/api/v1/webhooks/clicksend",
         params: {
           status_code: "200",
           status_text: "Message delivered to the handset"
         },
         headers: webhook_headers

    assert_response :accepted
    delivery.reload
    assert_equal "pending", delivery.status
    assert_nil delivery.provider_status_text
    assert_empty delivery.response_payload
  end

  test "resend webhook verifies valid Svix HMAC-SHA256 signature" do
    ENV["RESEND_WEBHOOK_SECRET"] = svix_secret_env
    ENV["DELIVERY_WEBHOOK_TOKEN"] = nil

    delivery = MessageDelivery.create!(
      provider: "resend",
      channel: "email",
      purpose: "raffle_ticket_confirmation",
      recipient: "buyer@example.com",
      status: "accepted",
      provider_message_id: "email_svix_ok"
    )
    raw_body = {
      type: "email.delivered",
      created_at: "2026-05-12T10:05:00Z",
      data: { email_id: "email_svix_ok" }
    }.to_json

    post "/api/v1/webhooks/resend",
         params: raw_body,
         headers: svix_headers(raw_body: raw_body)

    assert_response :success
    assert_equal "delivered", delivery.reload.status
  end

  test "resend webhook accepts multi-signature Svix header when any v1 signature matches" do
    ENV["RESEND_WEBHOOK_SECRET"] = svix_secret_env
    ENV["DELIVERY_WEBHOOK_TOKEN"] = nil

    delivery = MessageDelivery.create!(
      provider: "resend",
      channel: "email",
      purpose: "raffle_ticket_confirmation",
      recipient: "buyer@example.com",
      status: "accepted",
      provider_message_id: "email_svix_multi"
    )
    raw_body = {
      type: "email.delivered",
      data: { email_id: "email_svix_multi" }
    }.to_json
    timestamp = Time.current.to_i.to_s
    valid_sig = Base64.strict_encode64(OpenSSL::HMAC.digest("SHA256", svix_secret_raw, "msg_multi.#{timestamp}.#{raw_body}"))
    multi_header = "v1,aW52YWxpZHNpZw== v2,b3RoZXJ2ZXJzaW9u v1,#{valid_sig}"

    post "/api/v1/webhooks/resend",
         params: raw_body,
         headers: svix_headers(raw_body: raw_body, id: "msg_multi", timestamp: timestamp, signature_header: multi_header)

    assert_response :success
    assert_equal "delivered", delivery.reload.status
  end

  test "resend webhook rejects invalid Svix signature, missing headers, and token fallback when secret is configured" do
    ENV["RESEND_WEBHOOK_SECRET"] = svix_secret_env
    ENV["DELIVERY_WEBHOOK_TOKEN"] = "test-webhook-secret"
    ENV["RESEND_WEBHOOK_TOKEN"] = "test-resend-token"

    raw_body = { type: "email.delivered", data: { email_id: "email_svix_bad" } }.to_json

    # Wrong signature
    post "/api/v1/webhooks/resend",
         params: raw_body,
         headers: svix_headers(raw_body: raw_body, secret: "wrong-secret-bytes-12345678901234")
    assert_response :unauthorized

    # Tampered body after signing
    post "/api/v1/webhooks/resend",
         params: { type: "email.bounced", data: { email_id: "email_svix_bad" } }.to_json,
         headers: svix_headers(raw_body: raw_body)
    assert_response :unauthorized

    # Missing Svix headers with token fallback must be rejected when RESEND_WEBHOOK_SECRET is set
    post "/api/v1/webhooks/resend",
         params: raw_body,
         headers: { "CONTENT_TYPE" => "application/json", "X-Webhook-Token" => "test-resend-token" }
    assert_response :unauthorized

    # Missing svix-id
    headers = svix_headers(raw_body: raw_body)
    headers.delete("svix-id")
    post "/api/v1/webhooks/resend", params: raw_body, headers: headers
    assert_response :unauthorized
  end

  test "resend webhook rejects expired, future, and non-integer Svix timestamps" do
    ENV["RESEND_WEBHOOK_SECRET"] = svix_secret_env
    raw_body = { type: "email.delivered", data: { email_id: "email_svix_ts" } }.to_json

    [
      (Time.current.to_i - 301).to_s,
      (Time.current.to_i + 301).to_s,
      "not-an-int",
      "#{Time.current.to_i}.5",
      "-100"
    ].each do |bad_timestamp|
      post "/api/v1/webhooks/resend",
           params: raw_body,
           headers: svix_headers(raw_body: raw_body, timestamp: bad_timestamp)
      assert_response :unauthorized, "Expected 401 for timestamp #{bad_timestamp.inspect}"
    end
  end

  test "resend webhook fails closed with 401 when RESEND_WEBHOOK_SECRET is malformed base64" do
    ENV["RESEND_WEBHOOK_SECRET"] = "whsec_!!!not-valid-base64!!!"
    raw_body = { type: "email.delivered", data: { email_id: "email_svix_malformed" } }.to_json

    post "/api/v1/webhooks/resend",
         params: raw_body,
         headers: svix_headers(raw_body: raw_body)

    assert_response :unauthorized
  end

  test "clicksend webhook still requires token and fails closed even when RESEND_WEBHOOK_SECRET is set" do
    ENV["RESEND_WEBHOOK_SECRET"] = svix_secret_env
    ENV["DELIVERY_WEBHOOK_TOKEN"] = nil
    ENV["CLICKSEND_WEBHOOK_TOKEN"] = nil

    post "/api/v1/webhooks/clicksend",
         params: { message_id: "sms_unauth", status_text: "Delivered" }

    assert_response :unauthorized
  end

  test "resend webhook falls back to data.tags.delivery_id and backfills provider_message_id when race occurs" do
    ENV["RESEND_WEBHOOK_SECRET"] = svix_secret_env

    delivery = MessageDelivery.create!(
      provider: "resend",
      channel: "email",
      purpose: "raffle_ticket_confirmation",
      recipient: "race@example.com",
      status: "pending",
      provider_message_id: nil
    )

    raw_body = {
      type: "email.delivered",
      created_at: "2026-05-12T10:05:00Z",
      data: {
        email_id: "email_race_backfill_123",
        tags: { delivery_id: delivery.id.to_s }
      }
    }.to_json

    post "/api/v1/webhooks/resend",
         params: raw_body,
         headers: svix_headers(raw_body: raw_body)

    assert_response :success
    delivery.reload
    assert_equal "delivered", delivery.status
    assert_equal "email_race_backfill_123", delivery.provider_message_id
    assert delivery.delivered_at.present?
  end

  test "resend webhook tag fallback supports array-format tags and ignores non-resend or mismatched deliveries" do
    delivery = MessageDelivery.create!(
      provider: "resend",
      channel: "email",
      purpose: "admin_invite",
      recipient: "arraytag@example.com",
      status: "pending",
      provider_message_id: nil
    )
    clicksend_delivery = MessageDelivery.create!(
      provider: "clicksend",
      channel: "sms",
      purpose: "raffle_ticket_confirmation",
      recipient: "+16715550123",
      status: "pending",
      provider_message_id: nil
    )
    different_resend_delivery = MessageDelivery.create!(
      provider: "resend",
      channel: "email",
      purpose: "admin_invite",
      recipient: "other@example.com",
      status: "accepted",
      provider_message_id: "email_existing_999"
    )

    post "/api/v1/webhooks/resend",
         params: {
           type: "email.delivered",
           data: {
             email_id: "email_array_tag_1",
             tags: [ { name: "delivery_id", value: delivery.id.to_s } ]
           }
         },
         as: :json,
         headers: webhook_headers
    assert_response :success
    assert_equal "delivered", delivery.reload.status
    assert_equal "email_array_tag_1", delivery.provider_message_id

    # Must not touch clicksend delivery
    post "/api/v1/webhooks/resend",
         params: {
           type: "email.delivered",
           data: {
             email_id: "email_cross_provider",
             tags: { delivery_id: clicksend_delivery.id.to_s }
           }
         },
         as: :json,
         headers: webhook_headers
    assert_response :accepted
    assert_equal "pending", clicksend_delivery.reload.status
    assert_nil clicksend_delivery.provider_message_id

    # Must not overwrite a delivery that already belongs to another email_id
    post "/api/v1/webhooks/resend",
         params: {
           type: "email.bounced",
           data: {
             email_id: "email_other_id",
             tags: { delivery_id: different_resend_delivery.id.to_s }
           }
         },
         as: :json,
         headers: webhook_headers
    assert_response :accepted
    assert_equal "accepted", different_resend_delivery.reload.status
    assert_equal "email_existing_999", different_resend_delivery.provider_message_id
  end
end
