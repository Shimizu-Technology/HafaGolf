class ApplicationMailer < ActionMailer::Base
  DEFAULT_FROM_EMAIL = "noreply@shimizu-technology.com"
  DEFAULT_REPLY_TO_EMAIL = "support@shimizu-technology.com"

  def self.default_from_email
    ENV["MAILER_FROM_EMAIL"].presence || DEFAULT_FROM_EMAIL
  end

  def self.default_reply_to_email
    ENV["MAILER_REPLY_TO_EMAIL"].presence || DEFAULT_REPLY_TO_EMAIL
  end

  default from: -> { ApplicationMailer.default_from_email },
          reply_to: -> { ApplicationMailer.default_reply_to_email }
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
