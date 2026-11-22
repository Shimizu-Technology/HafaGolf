class ApplicationMailer < ActionMailer::Base
  default from: ENV.fetch("MAILER_FROM_EMAIL", "noreply@shimizu-technology.com")
  layout "mailer"
  helper MailerHelper

  private

  def set_org_branding
    org = @golfer&.tournament&.organization
    @primary_color = org&.primary_color.presence || '#0f766e'
    @org_name = org&.name.presence || 'HafaGolf'
    @org_logo_url = org&.logo_url
  end
end
