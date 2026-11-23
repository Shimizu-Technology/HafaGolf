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
    end
  end
end
