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

  test "StripeConfig reads PLATFORM_STRIPE_* before STRIPE_* strictly from ENV" do
    assert_nil StripeConfig.secret_key
    assert_nil StripeConfig.publishable_key
    assert_nil StripeConfig.webhook_secret
    assert_not StripeConfig.configured?

    ENV["STRIPE_SECRET_KEY"] = "sk_test_from_env"
    ENV["STRIPE_PUBLISHABLE_KEY"] = "pk_test_from_env"
    ENV["STRIPE_WEBHOOK_SECRET"] = "whsec_from_env"

    assert_equal "sk_test_from_env", StripeConfig.secret_key
    assert_equal "pk_test_from_env", StripeConfig.publishable_key
    assert_equal "whsec_from_env", StripeConfig.webhook_secret
    assert StripeConfig.configured?

    ENV["PLATFORM_STRIPE_SECRET_KEY"] = "sk_test_from_platform"
    ENV["PLATFORM_STRIPE_PUBLISHABLE_KEY"] = "pk_test_from_platform"
    ENV["PLATFORM_STRIPE_WEBHOOK_SECRET"] = "whsec_from_platform"

    assert_equal "sk_test_from_platform", StripeConfig.secret_key
    assert_equal "pk_test_from_platform", StripeConfig.publishable_key
    assert_equal "whsec_from_platform", StripeConfig.webhook_secret
  end

  test "stripe webhook uses ENV platform Stripe credentials" do
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

  test "production database config disables prepared_statements by default for Neon transaction pooling" do
    db_yml_path = Rails.root.join("config/database.yml")
    previous = ENV["DB_PREPARED_STATEMENTS"]

    ENV.delete("DB_PREPARED_STATEMENTS")
    default_config = YAML.safe_load(ERB.new(File.read(db_yml_path)).result, aliases: true)
    assert_equal false, default_config.dig("production", "prepared_statements")

    ENV["DB_PREPARED_STATEMENTS"] = "true"
    enabled_config = YAML.safe_load(ERB.new(File.read(db_yml_path)).result, aliases: true)
    assert_equal true, enabled_config.dig("production", "prepared_statements")
  ensure
    ENV["DB_PREPARED_STATEMENTS"] = previous
  end

  test "production ActionCable allowed_request_origins dynamically allows registered tenant domains and ADMIN_ORIGIN" do
    prod_source = File.read(Rails.root.join("config/environments/production.rb"))

    # Evaluate config/environments/production.rb against a minimal config collector to extract
    # the exact action_cable.allowed_request_origins value configured for production.
    captured_origins = nil
    fake_config = Class.new do
      def initialize
        @nested = Hash.new { |h, k| h[k] = ActiveSupport::OrderedOptions.new }
        @values = ActiveSupport::OrderedOptions.new
      end

      def method_missing(name, *args)
        if name.end_with?("=")
          @values[name.to_s.delete_suffix("=")] = args.first
        elsif args.empty?
          @nested[name]
        else
          super
        end
      end

      def respond_to_missing?(*_args)
        true
      end
    end.new

    fake_app = Struct.new(:config) do
      def configure(&block)
        instance_eval(&block)
      end
    end.new(fake_config)

    original_app = Rails.application
    original_env = Rails.env
    previous_admin_origin = ENV["ADMIN_ORIGIN"]

    begin
      Rails.application = fake_app
      eval(prod_source, binding, Rails.root.join("config/environments/production.rb").to_s) # rubocop:disable Security/Eval
    ensure
      Rails.application = original_app
    end

    captured_origins = fake_config.action_cable.allowed_request_origins
    assert_not_empty captured_origins

    org = organizations(:org_one)
    org.organization_domains.find_or_create_by!(hostname: "ws-tenant.example.com") { |d| d.is_primary = false }
    TenantCorsOrigins.invalidate!

    ENV["ADMIN_ORIGIN"] = "https://golf.shimizu-technology.com"
    Rails.env = ActiveSupport::StringInquirer.new("production")

    server = ActionCable::Server::Base.new
    server.config.disable_request_forgery_protection = false
    server.config.allow_same_origin_as_host = false
    server.config.allowed_request_origins = captured_origins

    check_origin = lambda do |origin|
      env = {
        "HTTP_HOST" => "hafagolf-api.onrender.com",
        "rack.url_scheme" => "https",
        "PATH_INFO" => "/cable"
      }
      env["HTTP_ORIGIN"] = origin unless origin.nil?
      conn = ApplicationCable::Connection.new(server, env)
      conn.send(:allow_request_origin?)
    end

    assert check_origin.call("https://ws-tenant.example.com"), "Expected registered HTTPS tenant domain to be allowed"
    assert check_origin.call("https://golf.shimizu-technology.com"), "Expected ADMIN_ORIGIN to be allowed"
    assert_not check_origin.call("http://ws-tenant.example.com"), "Expected non-HTTPS tenant domain to be rejected in production"
    assert_not check_origin.call("https://unregistered.example.net"), "Expected unregistered domain to be rejected"
    assert_not check_origin.call(nil), "Expected missing Origin header to be rejected"
  ensure
    Rails.env = original_env if defined?(original_env) && original_env
    ENV["ADMIN_ORIGIN"] = previous_admin_origin
    TenantCorsOrigins.invalidate!
  end
end
