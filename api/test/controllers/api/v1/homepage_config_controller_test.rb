# frozen_string_literal: true

require "test_helper"

class Api::V1::HomepageConfigControllerTest < ActionDispatch::IntegrationTest
  def setup
    super
    @admin = admins(:admin_one)
    @admin.update!(clerk_id: "test_clerk_#{@admin.id}") if @admin.clerk_id.nil?
    authenticate_as(@admin)
    @org = organizations(:org_one)
    @tournament = tournaments(:tournament_one)
  end

  test "updates organization homepage_config, rejects malformed section flags, and allows nil reset" do
    patch "/api/v1/admin/organizations/#{@org.slug}",
          params: {
            organization: {
              homepage_config: {
                archetype: "ceremonial-light",
                landing_mode: "direct_to_active_event",
                sections: [{ key: "event_details_card", enabled: true }]
              }
            }
          },
          as: :json,
          headers: auth_headers

    assert_response :success
    body = JSON.parse(response.body)
    assert_equal "direct_to_active_event", body.dig("homepage_config", "landing_mode")

    patch "/api/v1/admin/organizations/#{@org.slug}",
          params: {
            organization: {
              homepage_config: {
                sections: [{ key: "event_details_card", enabled: { bad: true } }]
              }
            }
          },
          as: :json,
          headers: auth_headers

    assert_response :unprocessable_entity

    patch "/api/v1/admin/organizations/#{@org.slug}",
          params: { organization: { homepage_config: nil } },
          as: :json,
          headers: auth_headers

    assert_response :success
    assert_equal({}, @org.reload.homepage_config)
  end

  test "updates tournament homepage_config via tournaments endpoint and exposes it publicly" do
    patch "/api/v1/tournaments/#{@tournament.id}",
          params: {
            tournament: {
              homepage_config: {
                archetype: "charity-showcase",
                artwork_display: "showcase_split",
                sections: [{ key: "sponsor_wall", enabled: false }]
              }
            }
          },
          as: :json,
          headers: auth_headers

    assert_response :success
    assert_equal "showcase_split", @tournament.reload.homepage_config["artwork_display"]

    get "/api/v1/organizations/#{@org.slug}/tournaments/#{@tournament.slug}"
    assert_response :success
    pub = JSON.parse(response.body)
    assert_equal "showcase_split", pub.dig("homepage_config", "artwork_display")
  end
end
