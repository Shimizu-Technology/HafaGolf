class SponsorMailer < ApplicationMailer
  def access_link(sponsor, token)
    @sponsor = sponsor
    @token = token
    @tournament = sponsor.tournament
    @org = @tournament&.organization
    @primary_color = @org&.primary_color.presence || '#0f766e'
    @org_name = @org&.name.presence || 'HafaGolf'

    @access_url = OrgUrlBuilder.sponsor_portal_url(sponsor, token)

    mail(
      to: sponsor.login_email,
      subject: "Your Sponsor Portal Access Link — #{@tournament&.name || 'Golf Tournament'}"
    )
  end
end
