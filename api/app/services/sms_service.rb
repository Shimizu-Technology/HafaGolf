# frozen_string_literal: true

class SmsService
  def self.configured?
    ClicksendClient.configured?
  end

  def self.send_sms(to:, message:, from: nil, source: nil)
    return { success: false, error: "ClickSend not configured" } unless configured?
    return { success: false, error: "Invalid phone" } if to.blank?

    ClicksendClient.send_sms(to: to, body: message, from: from, source: source)
  end

  def self.send_registration_confirmation(golfer)
    return unless golfer.phone.present?

    tournament = golfer.tournament
    sender_id = tournament&.organization&.sms_sender_id.presence
    contact_suffix = tournament.contact_phone.present? ? " Questions? Call #{tournament.contact_phone}." : ""

    message = "You're registered for #{tournament.name}! " \
              "#{tournament.event_date} at #{tournament.location_name}. " \
              "Check-in: #{tournament.registration_time}.#{contact_suffix}"

    send_sms(to: golfer.phone, message: message, from: sender_id)

    # Also SMS partner if they have a different phone
    if golfer.partner_phone.present? && golfer.partner_phone != golfer.phone
      partner_message = "#{golfer.name} registered you for #{tournament.name}! " \
                        "#{tournament.event_date} at #{tournament.location_name}. " \
                        "Check-in: #{tournament.registration_time}."
      send_sms(to: golfer.partner_phone, message: partner_message, from: sender_id)
    end
  end
end
