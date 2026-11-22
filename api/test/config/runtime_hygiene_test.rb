# frozen_string_literal: true

require "test_helper"

class RuntimeHygieneTest < ActionDispatch::IntegrationTest
  STRIPE_ENV_KEYS = %w[
    PLATFORM_STRIPE_SECRET_KEY
    PLATFORM_STRIPE_PUBLISHABLE_KEY
    PLATFORM_STRIPE_WEBHOOK_SECRET
    STRIPE_SECRET_KEY
    STRIPE_PUBLISHABLE_KEY
    STRIPE_WEBHOOK_SECRET
  ].freeze

  setup do
    @previous_env = STRIPE_ENV_KEYS.index_with { |k| ENV[k] }
    STRIPE_ENV_KEYS.each { |k| ENV[k] = nil }
  end

  teardown do
    @previous_env.each { |k, v| ENV[k] = v }
  end

  test "production ActionCable uses async adapter instead of solid_cable" do
    cable_config = YAML.safe_load(
      ERB.new(File.read(Rails.root.join("config/cable.yml"))).result,
      aliases: true
    )

    assert_equal "async", cable_config.dig("production", "adapter")
    assert_nil cable_config.dig("production", "polling_interval")
  end

  test "puma only loads solid_queue plugin when SOLID_QUEUE_IN_PUMA is explicitly true" do
    puma_source = File.read(Rails.root.join("config/puma.rb"))
    previous = ENV["SOLID_QUEUE_IN_PUMA"]

    eval_puma = lambda do |env_val|
      ENV["SOLID_QUEUE_IN_PUMA"] = env_val
      loaded = []
      sandbox = Object.new
      sandbox.define_singleton_method(:threads) { |*_| }
      sandbox.define_singleton_method(:port) { |*_| }
      sandbox.define_singleton_method(:workers) { |*_| }
      sandbox.define_singleton_method(:pidfile) { |*_| }
      sandbox.define_singleton_method(:plugin) { |name| loaded << name }
      sandbox.instance_eval(puma_source)
      loaded
    end

    assert_not_includes eval_puma.call(nil), :solid_queue
    assert_not_includes eval_puma.call("false"), :solid_queue
    assert_not_includes eval_puma.call("0"), :solid_queue
    assert_includes eval_puma.call("true"), :solid_queue
  ensure
    ENV["SOLID_QUEUE_IN_PUMA"] = previous
  end

  test "GET /up succeeds without issuing database queries" do
    sql_queries = []
    callback = lambda do |_name, _started, _finished, _unique_id, payload|
      sql_queries << payload[:sql] unless payload[:name] == "SCHEMA"
    end

    ActiveSupport::Notifications.subscribed(callback, "sql.active_record") do
      get "/up"
    end

    assert_response :success
    assert_empty sql_queries, "Expected /up to avoid DB queries so Neon can scale to zero, got: #{sql_queries.inspect}"
  end

  test "StripeConfig prefers PLATFORM_STRIPE_* then STRIPE_* then legacy Setting fallback" do
    setting = Setting.instance
    setting.update!(
      stripe_secret_key: "sk_test_from_setting",
      stripe_public_key: "pk_test_from_setting",
      stripe_webhook_secret: "whsec_from_setting"
    )

    assert_equal "sk_test_from_setting", StripeConfig.secret_key(setting: setting)
    assert_equal "pk_test_from_setting", StripeConfig.publishable_key(setting: setting)
    assert_equal "whsec_from_setting", StripeConfig.webhook_secret(setting: setting)
    assert StripeConfig.configured?(setting: setting)

    ENV["STRIPE_SECRET_KEY"] = "sk_test_from_env"
    ENV["STRIPE_PUBLISHABLE_KEY"] = "pk_test_from_env"
    ENV["STRIPE_WEBHOOK_SECRET"] = "whsec_from_env"

    assert_equal "sk_test_from_env", StripeConfig.secret_key(setting: setting)
    assert_equal "pk_test_from_env", StripeConfig.publishable_key(setting: setting)
    assert_equal "whsec_from_env", StripeConfig.webhook_secret(setting: setting)

    ENV["PLATFORM_STRIPE_SECRET_KEY"] = "sk_test_from_platform"
    ENV["PLATFORM_STRIPE_PUBLISHABLE_KEY"] = "pk_test_from_platform"
    ENV["PLATFORM_STRIPE_WEBHOOK_SECRET"] = "whsec_from_platform"

    assert_equal "sk_test_from_platform", StripeConfig.secret_key(setting: setting)
    assert_equal "pk_test_from_platform", StripeConfig.publishable_key(setting: setting)
    assert_equal "whsec_from_platform", StripeConfig.webhook_secret(setting: setting)
  end

  test "stripe webhook uses ENV Stripe credentials even when legacy Setting keys are blank" do
    Setting.instance.update!(
      stripe_secret_key: nil,
      stripe_webhook_secret: nil
    )
    ENV["PLATFORM_STRIPE_SECRET_KEY"] = "sk_test_platform_only"
    ENV["PLATFORM_STRIPE_WEBHOOK_SECRET"] = "whsec_platform_only"

    post "/api/v1/webhooks/stripe",
         params: { id: "evt_env_test", type: "unknown.event", data: { object: {} } }.to_json,
         headers: {
           "CONTENT_TYPE" => "application/json",
           "HTTP_STRIPE_SIGNATURE" => "t=1111,v1=invalid"
         }

    # Reached signature verification (400) rather than 503 service_unavailable
    assert_response :bad_request
  end
end
