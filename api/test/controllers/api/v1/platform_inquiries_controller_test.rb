# frozen_string_literal: true

require "test_helper"

module Api
  module V1
    class PlatformInquiriesControllerTest < ActionDispatch::IntegrationTest
      setup do
        ActionMailer::Base.deliveries.clear
      end

      test "delivers a valid inquiry and returns created" do
        assert_difference -> { ActionMailer::Base.deliveries.size }, 1 do
          post "/api/v1/platform/inquiries", params: {
            inquiry: {
              name: "Jordan Reyes",
              email: "jordan@example.test",
              organization_name: "Pacific Charity Foundation",
              inquiry_type: "host_tournament",
              estimated_date: "October 2027",
              message: "We are planning a 36-team charity scramble and would love a walkthrough."
            }
          }, as: :json
        end

        assert_response :created
        body = JSON.parse(response.body)
        assert_equal true, body["submitted"]

        mail = ActionMailer::Base.deliveries.last
        assert_equal ["jordan@example.test"], mail.reply_to
        assert_includes mail.subject, "Host a tournament"
        assert_includes mail.subject, "Jordan Reyes"
      end

      test "rejects invalid inquiries with 422" do
        assert_no_difference -> { ActionMailer::Base.deliveries.size } do
          post "/api/v1/platform/inquiries", params: {
            inquiry: {
              name: "",
              email: "not-an-email",
              message: "short"
            }
          }, as: :json
        end

        assert_response :unprocessable_entity
        body = JSON.parse(response.body)
        assert_operator body["errors"].length, :>=, 3
      end

      test "silently accepts honeypot submissions without sending mail" do
        assert_no_difference -> { ActionMailer::Base.deliveries.size } do
          post "/api/v1/platform/inquiries", params: {
            inquiry: {
              name: "Bot",
              email: "bot@example.test",
              website: "https://spam.invalid",
              message: "Buy cheap links right now!"
            }
          }, as: :json
        end

        assert_response :ok
        assert_equal true, JSON.parse(response.body)["submitted"]
      end

      test "throttles repeated inquiries across canonical and duplicate-slash paths" do
        previous_enabled = Rack::Attack.enabled
        previous_cache = Rack::Attack.cache.store
        Rack::Attack.enabled = true
        Rack::Attack.cache.store = ActiveSupport::Cache::MemoryStore.new

        headers = { "REMOTE_ADDR" => "203.0.113.42" }
        payload = {
          inquiry: {
            name: "Jordan Reyes",
            email: "jordan@example.test",
            message: "We are planning a charity tournament and want a quick walkthrough."
          }
        }

        paths = [
          "/api/v1/platform/inquiries",
          "/api//v1/platform/inquiries",
          "/api/v1//platform/inquiries",
          "/api/v1/platform//inquiries",
          "/api//v1//platform/inquiries"
        ]

        paths.each do |path|
          post path, params: payload, headers: headers, as: :json
          assert_response :created
        end

        post "/api//v1/platform/inquiries", params: payload, headers: headers, as: :json
        assert_response :too_many_requests
      ensure
        Rack::Attack.enabled = previous_enabled
        Rack::Attack.cache.store = previous_cache
      end
    end
  end
end
