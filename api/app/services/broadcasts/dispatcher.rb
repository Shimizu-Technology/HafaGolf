# frozen_string_literal: true

require "erb"

module Broadcasts
  class Dispatcher
    def self.email_configured?
      ENV["RESEND_API_KEY"].present?
    end

    def self.sms_configured?
      SmsService.configured?
    end

    def self.dry_run_for?(channel)
      case channel.to_s.strip.downcase
      when "email"
        !email_configured?
      when "sms"
        !sms_configured?
      else # "both"
        !email_configured? && !sms_configured?
      end
    end

    def self.channel_plan(channel)
      normalized = channel.to_s.strip.downcase
      dry_run = dry_run_for?(normalized)
      if dry_run || normalized != "both"
        return { effective_channel: normalized, skipped_channel: nil, dry_run: dry_run }
      end

      if email_configured? && !sms_configured?
        { effective_channel: "email", skipped_channel: "sms", dry_run: false }
      elsif !email_configured? && sms_configured?
        { effective_channel: "sms", skipped_channel: "email", dry_run: false }
      else
        { effective_channel: "both", skipped_channel: nil, dry_run: false }
      end
    end

    def self.call(tournament:, sender:, audience:, target_group_ids:, channel:, subject:, message:)
      new(
        tournament: tournament,
        sender: sender,
        audience: audience,
        target_group_ids: target_group_ids,
        channel: channel,
        subject: subject,
        message: message
      ).call
    end

    def initialize(tournament:, sender:, audience:, target_group_ids:, channel:, subject:, message:)
      @tournament = tournament
      @organization = tournament.organization
      @sender = sender
      @audience = audience.to_s.strip.downcase
      @target_group_ids = Array(target_group_ids).map(&:to_i).select(&:positive?).uniq
      @channel = channel.to_s.strip.downcase
      @subject = subject.to_s.strip.presence
      @message = message.to_s.strip
    end

    def call
      plan = self.class.channel_plan(@channel)
      effective_channel = plan[:effective_channel]
      is_dry_run = plan[:dry_run]

      resolved = AudienceResolver.resolve(
        tournament: @tournament,
        audience: @audience,
        channel: effective_channel,
        target_group_ids: @target_group_ids
      )

      will_deliver_email = %w[email both].include?(effective_channel)
      will_deliver_sms = %w[sms both].include?(effective_channel)

      sent_count = 0
      failed_count = 0

      unless is_dry_run
        if will_deliver_email && self.class.email_configured?
          resolved.emails.each do |email|
            if deliver_email(email)
              sent_count += 1
            else
              failed_count += 1
            end
          end
        end

        if will_deliver_sms && self.class.sms_configured?
          resolved.phones.each do |phone|
            if deliver_sms(phone)
              sent_count += 1
            else
              failed_count += 1
            end
          end
        end
      end

      status = if is_dry_run
                 "dry_run"
               elsif sent_count.positive? || resolved.recipient_count.zero?
                 "completed"
               else
                 "failed"
               end

      announcement = @tournament.broadcast_announcements.create!(
        organization: @organization,
        sender: @sender,
        audience: @audience,
        target_group_ids: @audience == "specific_groups" ? @target_group_ids : [],
        channel: effective_channel,
        subject: @subject,
        message: @message,
        recipient_count: resolved.recipient_count,
        email_recipient_count: will_deliver_email ? resolved.email_count : 0,
        sms_recipient_count: will_deliver_sms ? resolved.sms_count : 0,
        sent_count: sent_count,
        failed_count: failed_count,
        dry_run: is_dry_run,
        status: status,
        sent_at: Time.current
      )

      ActivityLog.log(
        admin: @sender,
        action: "broadcast_sent",
        target: @tournament,
        tournament: @tournament,
        organization: @organization,
        details: "#{is_dry_run ? '[Dry Run] ' : ''}Sent #{effective_channel.upcase} broadcast to #{resolved.recipient_count} recipients (#{@audience})",
        metadata: {
          broadcast_announcement_id: announcement.id,
          audience: @audience,
          target_group_ids: announcement.target_group_ids,
          requested_channel: @channel,
          channel: effective_channel,
          skipped_channel: plan[:skipped_channel],
          recipient_count: resolved.recipient_count,
          sent_count: sent_count,
          failed_count: failed_count,
          dry_run: is_dry_run
        }
      )

      announcement
    end

    private

    def send_email?
      @channel == "email" || @channel == "both"
    end

    def send_sms?
      @channel == "sms" || @channel == "both"
    end

    def deliver_email(to_email)
      delivery = MessageDeliveryTracker.create!(
        provider: "resend",
        channel: "email",
        purpose: "tournament_broadcast",
        recipient: to_email,
        organization: @organization,
        tournament: @tournament,
        messageable: @tournament,
        request_payload: { subject: @subject, audience: @audience }
      )

      from_email = ApplicationMailer.default_from_email
      reply_to_email = ApplicationMailer.default_reply_to_email
      response = Resend::Emails.send({
        from: from_email,
        reply_to: reply_to_email,
        to: to_email,
        subject: @subject,
        html: build_email_html
      })

      parsed = response.respond_to?(:parsed_response) ? response.parsed_response : response
      provider_id = parsed.is_a?(Hash) ? (parsed["id"] || parsed[:id]) : nil
      MessageDeliveryTracker.track_result!(delivery, { success: true, status: "accepted", message_id: provider_id })
      true
    rescue StandardError => e
      Rails.logger.error("[Broadcasts::Dispatcher] Email error for #{to_email}: #{e.message}")
      MessageDeliveryTracker.track_result!(delivery, { success: false, status: "failed", error: e.message })
      false
    end

    def deliver_sms(to_phone)
      delivery = MessageDeliveryTracker.create!(
        provider: "clicksend",
        channel: "sms",
        purpose: "tournament_broadcast",
        recipient: to_phone,
        organization: @organization,
        tournament: @tournament,
        messageable: @tournament,
        request_payload: { audience: @audience }
      )

      sender_id = @organization&.sms_sender_id.presence
      sms_body = "[#{@tournament.short_name}] #{@message}"
      result = SmsService.send_sms(to: to_phone, message: sms_body, from: sender_id, source: "hafagolf_broadcast")
      MessageDeliveryTracker.track_result!(delivery, result)
      result.is_a?(Hash) && result[:success] == true
    rescue StandardError => e
      Rails.logger.error("[Broadcasts::Dispatcher] SMS error for #{to_phone}: #{e.message}")
      MessageDeliveryTracker.track_result!(delivery, { success: false, status: "failed", error: e.message })
      false
    end

    def build_email_html
      primary = @organization&.primary_color.presence || "#1e3a5f"
      org_name = ERB::Util.html_escape(@organization&.name.presence || "HafaGolf")
      event_name = ERB::Util.html_escape(@tournament.name)
      safe_subject = ERB::Util.html_escape(@subject.to_s)
      safe_body = ERB::Util.html_escape(@message).gsub(/\r?\n/, "<br>")

      <<~HTML
        <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 600px; margin: 0 auto; color: #1f2937;">
          <div style="background: #{ERB::Util.html_escape(primary)}; color: #ffffff; padding: 20px 24px; border-radius: 12px 12px 0 0;">
            <p style="margin: 0; font-size: 12px; text-transform: uppercase; letter-spacing: 0.08em; opacity: 0.85;">#{org_name}</p>
            <h1 style="margin: 6px 0 0; font-size: 20px; font-weight: 700;">#{event_name}</h1>
          </div>
          <div style="background: #ffffff; border: 1px solid #e5e7eb; border-top: 0; padding: 24px; border-radius: 0 0 12px 12px;">
            <h2 style="margin: 0 0 12px; font-size: 17px; color: #111827;">#{safe_subject}</h2>
            <p style="margin: 0; font-size: 15px; line-height: 1.6; color: #374151;">#{safe_body}</p>
          </div>
        </div>
      HTML
    end
  end
end
