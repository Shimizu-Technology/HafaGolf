require "test_helper"

class Api::V1::PublicPresentationTest < ActionDispatch::IntegrationTest
  def setup
    super
    @organization = organizations(:org_one)
    @organization.organization_domains.create!(hostname: "spring.golf.test", is_primary: true)
    @tournament = tournaments(:tournament_one)
    authenticate_as(users(:user_one))
  end

  test "database defaults keep waivers and tournament sponsors enabled and event media optional" do
    assert_equal [], @tournament.story_photos
    assert @tournament.waiver_enabled?
    assert @tournament.show_public_sponsors?
    assert_nil @tournament.commemorative_banner_url
    assert_nil @tournament.tribute_title
    assert_nil @tournament.tribute_subtitle
    assert_nil @tournament.waiver_text
    assert_nil @tournament.sponsor_wall_title
    assert_nil @organization.reversed_logo_url
    assert_not @organization.show_homepage_sponsors?
    assert_equal :datetime, TeamMember.type_for_attribute("waiver_accepted_at").type
  end

  test "organization branding is editable and serialized on public and tenant lookups" do
    attrs = { reversed_logo_url: "/images/reversed.png", show_homepage_sponsors: true }

    patch "/api/v1/admin/organizations/#{@organization.slug}", params: { organization: attrs }, headers: auth_headers, as: :json
    assert_response :ok
    assert_equal attrs.stringify_keys, response.parsed_body.slice(*attrs.stringify_keys.keys)

    get "/api/v1/organizations/#{@organization.slug}"
    assert_response :ok
    assert_equal attrs.stringify_keys, response.parsed_body.slice(*attrs.stringify_keys.keys)

    get "/api/v1/tenant", headers: { "X-Tenant-Host" => "spring.golf.test" }
    assert_response :ok
    assert_equal attrs.stringify_keys, response.parsed_body.fetch("organization").slice(*attrs.stringify_keys.keys)

    patch "/api/v1/admin/organizations/#{@organization.slug}",
          params: { organization: { reversed_logo_url: "data:text/html,abc" } }, headers: auth_headers, as: :json
    assert_response :unprocessable_entity
    assert_equal "/images/reversed.png", @organization.reload.reversed_logo_url
  end

  test "admin tournament settings reach public detail and hide the sponsor wall when disabled" do
    @tournament.sponsors.create!(name: "Sample Sponsor", tier: "gold", active: true)
    attrs = {
      commemorative_banner_url: "/images/anniversary.png",
      tribute_title: "In remembrance",
      tribute_subtitle: "Celebrating a life on the green",
      story_photos: [
        { url: "/images/first.jpg", caption: "First tournament" },
        { url: "/rails/active_storage/blobs/redirect/id/second.png", caption: nil },
        { url: "https://example.test/third.jpg", caption: "Third tournament" }
      ],
      waiver_enabled: false,
      waiver_text: "A custom release.\n\nA second paragraph.",
      show_public_sponsors: false,
      sponsor_wall_title: "Event Partners"
    }

    patch "/api/v1/tournaments/#{@tournament.id}", params: { tournament: attrs }, headers: auth_headers, as: :json
    assert_response :ok
    assert_equal attrs.deep_stringify_keys, response.parsed_body.slice(*attrs.stringify_keys.keys)

    path = "/api/v1/organizations/#{@organization.slug}/tournaments/#{@tournament.slug}"
    get path
    assert_response :ok
    assert_equal attrs.deep_stringify_keys, response.parsed_body.slice(*attrs.stringify_keys.keys)
    assert_empty response.parsed_body.fetch("sponsors")

    @tournament.reload.update!(show_public_sponsors: true)
    get path
    assert_response :ok
    assert_equal ["Sample Sponsor"], response.parsed_body.fetch("sponsors").pluck("name")
  end

  test "invalid story photo shapes, URLs, and counts are rejected without changing the stored photos" do
    saved_photos = [{ "url" => "https://example.test/valid.jpg" }]
    @tournament.update!(story_photos: saved_photos)

    [nil, "oops", { url: "/images/one.png" }, ["oops"], [{ url: "javascript:alert(1)" }],
     [{ url: "/images/%2e%2e/other.png" }], [{ url: "//example.test/images/one.png" }],
     [{ url: "/images/one.png", caption: { text: "not a string" } }], saved_photos * 4].each do |photos|
      patch "/api/v1/tournaments/#{@tournament.id}",
            params: { tournament: { story_photos: photos } }, headers: auth_headers, as: :json
      assert_response :unprocessable_entity
      assert_equal saved_photos, @tournament.reload.story_photos
    end

    patch "/api/v1/tournaments/#{@tournament.id}",
          params: { tournament: { commemorative_banner_url: "javascript:alert(1)" } }, headers: auth_headers, as: :json
    assert_response :unprocessable_entity
  end

  test "org-specific tournament creation accepts the media and waiver controls" do
    post "/api/v1/admin/organizations/#{@organization.slug}/tournaments",
         params: { tournament: {
           name: "Spring Invitational", year: 2027,
           commemorative_banner_url: "http://example.test/anniversary.png",
           story_photos: [{ url: "/images/story.webp" }],
           waiver_enabled: false,
           sponsor_wall_title: "Spring Partners"
         } },
         headers: auth_headers, as: :json

    assert_response :created
    tournament = @organization.tournaments.find_by!(name: "Spring Invitational")
    assert_equal [{ "url" => "/images/story.webp" }], tournament.story_photos
    assert_equal "http://example.test/anniversary.png", tournament.commemorative_banner_url
    assert_not tournament.waiver_enabled?
    assert_equal "Spring Partners", tournament.sponsor_wall_title
  end
end
