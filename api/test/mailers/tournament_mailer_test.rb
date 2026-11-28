# frozen_string_literal: true

require "test_helper"

class TournamentMailerTest < ActiveSupport::TestCase
  setup do
    @golfer = golfers(:confirmed_paid)
    @previous_resend_key = ENV["RESEND_API_KEY"]
    @previous_reply_to = ENV["MAILER_REPLY_TO_EMAIL"]
    ENV["RESEND_API_KEY"] = "test_resend_key"
    ENV["MAILER_REPLY_TO_EMAIL"] = nil
  end

  teardown do
    ENV["RESEND_API_KEY"] = @previous_resend_key
    ENV["MAILER_REPLY_TO_EMAIL"] = @previous_reply_to
  end

  test "reminder_email sets default support reply_to" do
    captured_payload = nil
    fake_response = Struct.new(:parsed_response).new({ "id" => "email_tournament_123" })

    with_singleton_method(Resend::Emails, :send, ->(payload) {
      captured_payload = payload
      fake_response
    }) do
      result = TournamentMailer.reminder_email(@golfer)
      assert_equal({ "id" => "email_tournament_123" }, result)
    end

    assert_equal "noreply@shimizu-technology.com", captured_payload.fetch(:from)
    assert_equal "support@shimizu-technology.com", captured_payload.fetch(:reply_to)
    assert_equal @golfer.email, captured_payload.fetch(:to)
  end

  test "reminder_email respects MAILER_REPLY_TO_EMAIL env override" do
    ENV["MAILER_REPLY_TO_EMAIL"] = "custom-reply@example.test"
    captured_payload = nil
    fake_response = Struct.new(:parsed_response).new({ "id" => "email_tournament_456" })

    with_singleton_method(Resend::Emails, :send, ->(payload) {
      captured_payload = payload
      fake_response
    }) do
      TournamentMailer.reminder_email(@golfer)
    end

    assert_equal "custom-reply@example.test", captured_payload.fetch(:reply_to)
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
