require "test_helper"

class ClicksendClientTest < ActiveSupport::TestCase
  test "normalizes top-level success with per-message failure as failed" do
    response = {
      "response_code" => "SUCCESS",
      "response_msg" => "Messages queued.",
      "data" => {
        "messages" => [
          {
            "message_id" => "sms_failed_123",
            "status_code" => "400",
            "status_text" => "INVALID_RECIPIENT"
          }
        ]
      }
    }

    result = ClicksendClient.send(:normalize_send_response, response)

    assert_equal false, result.fetch(:success)
    assert_equal "failed", result.fetch(:status)
    assert_equal "sms_failed_123", result.fetch(:message_id)
    assert_equal "INVALID_RECIPIENT", result.fetch(:error)
  end

  test "normalizes accepted per-message response" do
    response = {
      "response_code" => "SUCCESS",
      "response_msg" => "Messages queued.",
      "data" => {
        "messages" => [
          {
            "message_id" => "sms_ok_123",
            "status_code" => "200",
            "status_text" => "Success: Message queued."
          }
        ]
      }
    }

    result = ClicksendClient.send(:normalize_send_response, response)

    assert_equal true, result.fetch(:success)
    assert_equal "accepted", result.fetch(:status)
    assert_equal "sms_ok_123", result.fetch(:message_id)
  end

  test "normalizes provider account failures as failed even with top-level success" do
    response = {
      "response_code" => "SUCCESS",
      "response_msg" => "Messages queued.",
      "data" => {
        "messages" => [
          {
            "message_id" => "sms_credit_123",
            "status_code" => "INSUFFICIENT_CREDIT",
            "status_text" => "INSUFFICIENT_CREDIT"
          }
        ]
      }
    }

    result = ClicksendClient.send(:normalize_send_response, response)

    assert_equal false, result.fetch(:success)
    assert_equal "failed", result.fetch(:status)
    assert_equal "sms_credit_123", result.fetch(:message_id)
    assert_equal "INSUFFICIENT_CREDIT", result.fetch(:error)
  end

  test "normalizes top-level success with blank message details as accepted" do
    response = {
      "response_code" => "SUCCESS",
      "response_msg" => "",
      "data" => {
        "messages" => [
          {
            "message_id" => "sms_blank_123"
          }
        ]
      }
    }

    result = ClicksendClient.send(:normalize_send_response, response)

    assert_equal true, result.fetch(:success)
    assert_equal "accepted", result.fetch(:status)
    assert_equal "sms_blank_123", result.fetch(:message_id)
  end

  test "normalizes documented per-message status field as failed" do
    response = {
      "response_code" => "SUCCESS",
      "response_msg" => "Messages queued for delivery.",
      "data" => {
        "messages" => [
          {
            "message_id" => "sms_invalid_123",
            "status" => "INVALID_RECIPIENT"
          }
        ]
      }
    }

    result = ClicksendClient.send(:normalize_send_response, response)

    assert_equal false, result.fetch(:success)
    assert_equal "failed", result.fetch(:status)
    assert_equal "sms_invalid_123", result.fetch(:message_id)
    assert_equal "INVALID_RECIPIENT", result.fetch(:provider_status_code)
  end

  test "normalizes per-message THROTTLED status as failed despite top-level queued message" do
    response = {
      "response_code" => "SUCCESS",
      "response_msg" => "Messages queued for delivery.",
      "data" => {
        "messages" => [
          {
            "message_id" => "sms_throttled_123",
            "status" => "THROTTLED"
          }
        ]
      }
    }

    result = ClicksendClient.send(:normalize_send_response, response)

    assert_equal false, result.fetch(:success)
    assert_equal "failed", result.fetch(:status)
    assert_equal "sms_throttled_123", result.fetch(:message_id)
    assert_equal "THROTTLED", result.fetch(:provider_status_code)
  end

  test "send_sms parameterizes from and source with HafaGolf defaults and 11-char truncation" do
    previous_user = ENV["CLICKSEND_USERNAME"]
    previous_key = ENV["CLICKSEND_API_KEY"]
    previous_sender = ENV["CLICKSEND_SENDER_ID"]
    ENV["CLICKSEND_USERNAME"] = "test_user"
    ENV["CLICKSEND_API_KEY"] = "test_key"
    ENV["CLICKSEND_SENDER_ID"] = nil

    captured_payloads = []
    fake_response = Struct.new(:code, :body).new(
      "200",
      {
        "response_code" => "SUCCESS",
        "response_msg" => "Messages queued.",
        "data" => { "messages" => [ { "message_id" => "sms_param_1", "status_code" => "200", "status_text" => "Success" } ] }
      }.to_json
    )
    fake_http = Object.new
    fake_http.define_singleton_method(:use_ssl=) { |_| }
    fake_http.define_singleton_method(:open_timeout=) { |_| }
    fake_http.define_singleton_method(:read_timeout=) { |_| }
    fake_http.define_singleton_method(:request) do |req|
      captured_payloads << JSON.parse(req.body)
      fake_response
    end

    with_singleton_method(Net::HTTP, :new, ->(*_) { fake_http }) do
      # Default sender & source
      ClicksendClient.send_sms(to: "6715550123", body: "Hello")
      # ENV fallback sender
      ENV["CLICKSEND_SENDER_ID"] = "EnvSender"
      ClicksendClient.send_sms(to: "6715550123", body: "Hello 2")
      # Explicit from (over 11 chars -> truncated) and custom source
      ClicksendClient.send_sms(to: "6715550123", body: "Hello 3", from: "VeryLongSenderName", source: "custom_src")
    end

    msg1 = captured_payloads[0].fetch("messages").first
    assert_equal "HafaGolf", msg1.fetch("from")
    assert_equal "hafagolf", msg1.fetch("source")

    msg2 = captured_payloads[1].fetch("messages").first
    assert_equal "EnvSender", msg2.fetch("from")
    assert_equal "hafagolf", msg2.fetch("source")

    msg3 = captured_payloads[2].fetch("messages").first
    assert_equal "VeryLongSen", msg3.fetch("from")
    assert_equal "custom_src", msg3.fetch("source")
  ensure
    ENV["CLICKSEND_USERNAME"] = previous_user
    ENV["CLICKSEND_API_KEY"] = previous_key
    ENV["CLICKSEND_SENDER_ID"] = previous_sender
  end

  test "RaffleSmsService and SmsService pass organization sms_sender_id to ClicksendClient" do
    org = organizations(:org_one)
    org.update!(sms_sender_id: "RotaryGolf")
    tournament = tournaments(:tournament_one)
    ticket = tournament.raffle_tickets.create!(
      purchaser_name: "Sender Buyer",
      purchaser_phone: "+16715550123",
      price_cents: 500,
      payment_status: "paid",
      purchased_at: Time.current
    )
    prize = tournament.raffle_prizes.create!(
      name: "Putter",
      tier: "standard",
      value_cents: 15000,
      won: true,
      won_at: Time.current,
      winning_ticket: ticket,
      winner_name: "Sender Buyer",
      winner_phone: "+16715550123"
    )
    golfer = golfers(:confirmed_unpaid)

    captured_calls = []
    send_stub = lambda do |to:, body:, from: nil, source: nil|
      captured_calls << { to: to, body: body, from: from, source: source }
      { success: true, status: "accepted", message_id: "sms_sender_#{captured_calls.length}" }
    end

    with_singleton_method(ClicksendClient, :configured?, -> { true }) do
      with_singleton_method(ClicksendClient, :send_sms, send_stub) do
        RaffleSmsService.purchase_confirmation(
          tickets: [ ticket ],
          buyer_phone: "+16715550123",
          buyer_name: "Sender Buyer",
          tournament: tournament
        )
        purchase_delivery = MessageDelivery.last
        assert_equal org.id, purchase_delivery.organization_id

        RaffleSmsService.winner_notification(raffle_prize: prize)
        winner_delivery = MessageDelivery.last
        assert_equal org.id, winner_delivery.organization_id

        SmsService.send_registration_confirmation(golfer)
      end
    end

    assert_operator captured_calls.length, :>=, 3
    captured_calls.each do |call|
      assert_equal "RotaryGolf", call.fetch(:from)
    end
  end

  private

  def with_singleton_method(klass, method_name, replacement)
    original = klass.method(method_name)
    klass.define_singleton_method(method_name, &replacement)
    yield
  ensure
    klass.define_singleton_method(method_name) do |*args, **kwargs, &block|
      original.call(*args, **kwargs, &block)
    end
  end
end
