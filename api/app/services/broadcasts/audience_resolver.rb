# frozen_string_literal: true

module Broadcasts
  class AudienceResolver
    Result = Struct.new(
      :emails,
      :phones,
      :email_count,
      :sms_count,
      :recipient_count,
      keyword_init: true
    )

    def self.resolve(tournament:, audience:, channel:, target_group_ids: [])
      new(
        tournament: tournament,
        audience: audience,
        channel: channel,
        target_group_ids: target_group_ids
      ).resolve
    end

    def initialize(tournament:, audience:, channel:, target_group_ids: [])
      @tournament = tournament
      @audience = audience.to_s.strip.downcase
      @channel = channel.to_s.strip.downcase
      @target_group_ids = Array(target_group_ids).map(&:to_i).select(&:positive?).uniq
    end

    def resolve
      contacts = collect_contacts

      emails = []
      phones = []
      seen_emails = {}
      seen_phones = {}
      reachable_people = 0

      contacts.each do |contact|
        email = normalize_email(contact[:email])
        phone = normalize_phone(contact[:phone])

        new_email = email.present? && !seen_emails[email]
        new_phone = phone.present? && !seen_phones[phone]

        seen_emails[email] = true if new_email
        seen_phones[phone] = true if new_phone

        emails << email if new_email
        phones << phone if new_phone

        case @channel
        when "email"
          reachable_people += 1 if new_email
        when "sms"
          reachable_people += 1 if new_phone
        else # "both"
          reachable_people += 1 if new_email || new_phone
        end
      end

      Result.new(
        emails: emails,
        phones: phones,
        email_count: emails.size,
        sms_count: phones.size,
        recipient_count: reachable_people
      )
    end

    private

    def collect_contacts
      case @audience
      when "sponsors"
        collect_sponsor_contacts
      when "specific_groups"
        return [] if @target_group_ids.empty?

        valid_group_ids = @tournament.groups.where(id: @target_group_ids).pluck(:id)
        return [] if valid_group_ids.empty?

        collect_player_contacts(group_ids: valid_group_ids)
      when "checked_in"
        collect_player_contacts(checked_in: true)
      when "unchecked_in"
        collect_player_contacts(checked_in: false)
      else # "all_confirmed"
        collect_player_contacts
      end
    end

    def collect_sponsor_contacts
      @tournament.sponsors.active.filter_map do |sponsor|
        next if sponsor.login_email.blank?

        { email: sponsor.login_email, phone: nil }
      end
    end

    def collect_player_contacts(checked_in: nil, group_ids: nil)
      contacts = []

      # 1. Registrations + TeamMembers (confirmed only)
      reg_scope = @tournament.registrations.confirmed
      reg_scope = reg_scope.where(group_id: group_ids) if group_ids.present?

      member_scope = TeamMember.joins(:registration).merge(reg_scope)
      if checked_in == true
        member_scope = member_scope.where.not(team_members: { checked_in_at: nil })
      elsif checked_in == false
        member_scope = member_scope.where(team_members: { checked_in_at: nil })
      end

      member_scope.includes(:registration).find_each do |member|
        email = member.email.presence || (member.is_captain? ? member.registration.contact_email : nil)
        phone = member.phone.presence || member.mobile.presence || (member.is_captain? ? member.registration.contact_phone : nil)
        contacts << { email: email, phone: phone }
      end

      # 2. Legacy confirmed Golfers (plus partners)
      golfer_scope = @tournament.golfers.confirmed
      golfer_scope = golfer_scope.where(group_id: group_ids) if group_ids.present?
      if checked_in == true
        golfer_scope = golfer_scope.checked_in
      elsif checked_in == false
        golfer_scope = golfer_scope.not_checked_in
      end

      golfer_scope.find_each do |golfer|
        contacts << { email: golfer.email, phone: golfer.phone.presence || golfer.mobile.presence }
        if golfer.partner_name.present? && (golfer.partner_email.present? || golfer.partner_phone.present?)
          contacts << { email: golfer.partner_email, phone: golfer.partner_phone }
        end
      end

      contacts
    end

    def normalize_email(raw)
      val = raw.to_s.strip.downcase
      return nil if val.blank?
      return nil unless val.match?(URI::MailTo::EMAIL_REGEXP)

      val
    end

    def normalize_phone(raw)
      digits = raw.to_s.gsub(/\D/, "")
      return nil if digits.length < 10

      ClicksendClient.normalize_phone(raw)
    end
  end
end
