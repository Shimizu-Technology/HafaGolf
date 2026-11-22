# frozen_string_literal: true

class RaffleDrawReadinessService
  MAX_ISSUES = 25
  ISSUE_SEVERITY = {
    "missing_name" => 0,
    "failed_delivery" => 1,
    "no_contact" => 2,
    "unconfirmed_delivery" => 3
  }.freeze

  def initialize(tournament, delivery_summary_service: nil)
    @tournament = tournament
    @delivery_summary_service = delivery_summary_service || RaffleDeliverySummaryService.new(tournament)
  end

  def report
    rows = load_active_paid_rows
    eligible_ticket_count = 0
    missing_name_count = 0
    paid_groups = {}
    comp_missing_name_issues = []

    rows.each do |row|
      eligible_ticket_count += 1 unless row[:is_winner]

      name_missing = missing_name?(row[:purchaser_name], row[:golfer_name])
      missing_name_count += 1 if name_missing

      if paid_pos_row?(row)
        group_key = row[:batch_id].present? ? [ :batch, row[:batch_id] ] : [ :ticket, row[:id] ]
        group = (paid_groups[group_key] ||= {
          ticket_id: row[:id],
          ticket_number: row[:ticket_number].to_s.upcase,
          raffle_sale_batch_id: row[:batch_id],
          ticket_ids: [],
          ticket_count: 0,
          buyer_name: resolved_buyer_name(row),
          buyer_phone: row[:purchaser_phone].presence || row[:batch_phone].presence,
          buyer_email: row[:purchaser_email].presence || row[:batch_email].presence,
          missing_name: false,
          price_cents: row[:price_cents].to_i,
          payment_status: row[:payment_status],
          created_at: row[:created_at]
        })
        group[:ticket_ids] << row[:id]
        group[:ticket_count] += 1
        group[:missing_name] ||= name_missing
      elsif name_missing
        comp_missing_name_issues << {
          ticket_id: row[:id],
          ticket_number: row[:ticket_number].to_s.upcase,
          raffle_sale_batch_id: nil,
          ticket_count: 1,
          buyer_name: row[:purchaser_name].to_s.strip.presence,
          buyer_phone: row[:purchaser_phone].presence,
          buyer_phone_masked: mask_recipient(row[:purchaser_phone]),
          buyer_email: row[:purchaser_email].presence,
          buyer_email_masked: mask_recipient(row[:purchaser_email]),
          sms_status: "none",
          email_status: "none",
          sms_error: nil,
          email_error: nil,
          issue_reason: "missing_name",
          issue_reasons: [ "missing_name" ]
        }
      end
    end

    confirmed_delivered_count = 0
    failed_delivery_count = 0
    unconfirmed_delivery_count = 0
    issues = comp_missing_name_issues.dup

    paid_groups.each_value do |group|
      delivery = resolve_group_delivery(group)
      sms_status = delivery[:sms][:status]
      email_status = delivery[:email][:status]
      has_phone = group[:buyer_phone].present?
      has_email = group[:buyer_email].present?

      sms_delivered = has_phone && sms_status == "delivered"
      email_delivered = has_email && email_status == "delivered"
      sms_failed = has_phone && RaffleDeliverySummaryService::FAILED_STATUSES.include?(sms_status)
      email_failed = has_email && RaffleDeliverySummaryService::FAILED_STATUSES.include?(email_status)

      reasons = []
      reasons << "missing_name" if group[:missing_name]

      if sms_delivered || email_delivered
        confirmed_delivered_count += 1
      elsif sms_failed || email_failed
        failed_delivery_count += 1
        reasons << "failed_delivery"
      else
        unconfirmed_delivery_count += 1
        reasons << ((!has_phone && !has_email) ? "no_contact" : "unconfirmed_delivery")
      end

      next if reasons.empty?

      primary_reason = reasons.min_by { |reason| ISSUE_SEVERITY.fetch(reason, 99) }
      issues << {
        ticket_id: group[:ticket_id],
        ticket_number: group[:ticket_number],
        raffle_sale_batch_id: group[:raffle_sale_batch_id],
        ticket_count: group[:ticket_count],
        buyer_name: group[:buyer_name],
        buyer_phone: group[:buyer_phone],
        buyer_phone_masked: mask_recipient(group[:buyer_phone]),
        buyer_email: group[:buyer_email],
        buyer_email_masked: mask_recipient(group[:buyer_email]),
        sms_status: sms_status,
        email_status: email_status,
        sms_error: delivery[:sms][:error_text],
        email_error: delivery[:email][:error_text],
        issue_reason: primary_reason,
        issue_reasons: reasons
      }
    end

    issues.sort_by! do |issue|
      [
        ISSUE_SEVERITY.fetch(issue[:issue_reason], 99),
        issue[:ticket_id].to_i
      ]
    end

    ready = eligible_ticket_count.positive? &&
            missing_name_count.zero? &&
            failed_delivery_count.zero? &&
            unconfirmed_delivery_count.zero?

    remaining_prize_count = @tournament.raffle_prizes.available.count
    unsynced_registration_count = compute_unsynced_registration_count

    {
      ready: ready,
      eligible_ticket_count: eligible_ticket_count,
      paid_buyer_batch_count: paid_groups.size,
      confirmed_delivered_count: confirmed_delivered_count,
      unconfirmed_delivery_count: unconfirmed_delivery_count,
      failed_delivery_count: failed_delivery_count,
      missing_name_count: missing_name_count,
      remaining_prize_count: remaining_prize_count,
      registration_tickets_included: @tournament.raffle_include_with_registration?,
      unsynced_registration_count: unsynced_registration_count,
      issues_total_count: issues.size,
      issues_truncated: issues.size > MAX_ISSUES,
      issues: issues.first(MAX_ISSUES),
      checked_at: Time.current.iso8601
    }
  end

  private

  def load_active_paid_rows
    raw_rows = @tournament.raffle_tickets
      .active
      .paid
      .with_eligible_participant
      .joins("LEFT OUTER JOIN raffle_sale_batches ON raffle_sale_batches.id = raffle_tickets.raffle_sale_batch_id")
      .order(:id)
      .pluck(
        "raffle_tickets.id",
        "raffle_tickets.ticket_number",
        "raffle_tickets.raffle_sale_batch_id",
        "raffle_tickets.purchaser_name",
        "raffle_tickets.purchaser_email",
        "raffle_tickets.purchaser_phone",
        "raffle_tickets.price_cents",
        "raffle_tickets.payment_status",
        "raffle_tickets.is_winner",
        "golfers.name",
        "raffle_sale_batches.buyer_name",
        "raffle_sale_batches.buyer_email",
        "raffle_sale_batches.buyer_phone",
        "raffle_tickets.created_at"
      )

    raw_rows.map do |r|
      {
        id: r[0],
        ticket_number: r[1],
        batch_id: r[2],
        purchaser_name: r[3],
        purchaser_email: r[4],
        purchaser_phone: r[5],
        price_cents: r[6],
        payment_status: r[7],
        is_winner: r[8] == true,
        golfer_name: r[9],
        batch_name: r[10],
        batch_email: r[11],
        batch_phone: r[12],
        created_at: r[13]
      }
    end
  end

  def paid_pos_row?(row)
    row[:batch_id].present? || row[:price_cents].to_i.positive?
  end

  def missing_name?(purchaser_name, golfer_name)
    RaffleDeliverySummaryService.missing_buyer_name?(purchaser_name, golfer_name)
  end

  def resolved_buyer_name(row)
    row[:purchaser_name].to_s.strip.presence ||
      row[:golfer_name].to_s.strip.presence ||
      row[:batch_name].to_s.strip.presence
  end

  def resolve_group_delivery(group)
    # Check across all tickets in the batch so deliveries attached to any ticket in the batch are found.
    best_sms = { status: "none", error_text: nil, last_event_at: nil, recipient: nil }
    best_email = { status: "none", error_text: nil, last_event_at: nil, recipient: nil }

    group[:ticket_ids].each do |tid|
      summary = @delivery_summary_service.summary_for_attributes(
        ticket_id: tid,
        batch_id: group[:raffle_sale_batch_id],
        purchaser_email: group[:buyer_email],
        purchaser_phone: group[:buyer_phone],
        price_cents: group[:price_cents],
        payment_status: group[:payment_status]
      )
      best_sms = pick_preferred_channel_summary(best_sms, summary[:sms])
      best_email = pick_preferred_channel_summary(best_email, summary[:email])
    end

    { sms: best_sms, email: best_email }
  end

  def pick_preferred_channel_summary(current, candidate)
    return candidate if current[:status] == "none" && candidate[:status] != "none"
    return current if candidate[:status] == "none"
    return candidate if candidate[:status] == "delivered" && current[:status] != "delivered"
    return current if current[:status] == "delivered" && candidate[:status] != "delivered"

    if candidate[:last_event_at].to_s > current[:last_event_at].to_s
      candidate
    else
      current
    end
  end

  def compute_unsynced_registration_count
    return 0 unless @tournament.raffle_include_with_registration?

    rows = @tournament.golfers
      .active
      .where(registration_status: %w[confirmed pending])
      .joins(
        "LEFT OUTER JOIN raffle_tickets ON raffle_tickets.golfer_id = golfers.id " \
        "AND COALESCE(raffle_tickets.price_cents, 0) = 0 " \
        "AND raffle_tickets.payment_status != 'voided'"
      )
      .group("golfers.id", "golfers.partner_name")
      .pluck("golfers.partner_name", Arel.sql("COUNT(raffle_tickets.id)"))

    rows.count do |partner_name, existing_count|
      expected = partner_name.present? ? 2 : 1
      existing_count.to_i < expected
    end
  end

  def mask_recipient(recipient)
    value = recipient.to_s.strip
    return nil if value.blank?

    if value.include?("@")
      local, domain = value.split("@", 2)
      masked_local = local.present? ? "#{local[0]}***" : "***"
      return "#{masked_local}@#{domain}"
    end

    digits = value.gsub(/\D/, "")
    return "****#{digits.last(4)}" if digits.length >= 4

    "****"
  end
end
