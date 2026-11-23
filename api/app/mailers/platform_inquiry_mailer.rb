# frozen_string_literal: true

class PlatformInquiryMailer < ApplicationMailer
  INQUIRY_TYPE_LABELS = {
    "host_tournament" => "Host a tournament",
    "join_tournament" => "Join an event",
    "sponsorship" => "Sponsorship / demo",
    "general" => "General question"
  }.freeze

  def inquiry_received(inquiry)
    @inquiry = inquiry.symbolize_keys
    @type_label = INQUIRY_TYPE_LABELS.fetch(@inquiry[:inquiry_type].to_s, "General question")
    @received_at = Time.current.in_time_zone("Guam").strftime("%B %d, %Y at %I:%M %p ChST")

    recipients = resolve_contact_recipients
    subject_org = @inquiry[:organization_name].present? ? " (#{@inquiry[:organization_name]})" : ""

    mail(
      to: recipients,
      reply_to: @inquiry[:email],
      subject: "[HafaGolf Contact] #{@type_label}: #{@inquiry[:name]}#{subject_org}"
    )
  end

  private

  def resolve_contact_recipients
    raw = ENV["PLATFORM_CONTACT_EMAIL"].presence ||
          ENV["PLATFORM_ADMIN_EMAIL"].presence ||
          "leon@shimizu-technology.com"
    raw.to_s.split(",").map(&:strip).reject(&:blank?)
  end
end
