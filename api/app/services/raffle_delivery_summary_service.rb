# frozen_string_literal: true

class RaffleDeliverySummaryService
  FAILED_STATUSES = %w[failed bounced complained].freeze
  UNCONFIRMED_STATUSES = %w[pending accepted delayed skipped].freeze

  def initialize(tournament)
    @tournament = tournament
    @latest_by_ticket = {}
    @latest_by_batch = {}
    preload_deliveries!
  end

  def summary_for_ticket(ticket)
    summary_for_attributes(
      ticket_id: ticket.id,
      batch_id: ticket.raffle_sale_batch_id,
      purchaser_email: ticket.purchaser_email,
      purchaser_phone: ticket.purchaser_phone,
      price_cents: ticket.price_cents,
      payment_status: ticket.payment_status
    )
  end

  def summary_for_attributes(ticket_id:, batch_id:, purchaser_email:, purchaser_phone:, price_cents:, payment_status:)
    sms_delivery = latest_delivery_for(ticket_id: ticket_id, batch_id: batch_id, channel: "sms")
    email_delivery = latest_delivery_for(ticket_id: ticket_id, batch_id: batch_id, channel: "email")

    sms_summary = format_channel(sms_delivery)
    email_summary = format_channel(email_delivery)
    needs_attention, attention_reason = compute_attention(
      sms_status: sms_summary[:status],
      email_status: email_summary[:status],
      purchaser_email: purchaser_email,
      purchaser_phone: purchaser_phone,
      price_cents: price_cents,
      payment_status: payment_status
    )

    {
      sms: sms_summary,
      email: email_summary,
      needs_attention: needs_attention,
      attention_reason: attention_reason
    }
  end

  def needs_attention_ticket_ids
    @needs_attention_ticket_ids ||= begin
      rows = @tournament.raffle_tickets.active.pluck(
        :id,
        :raffle_sale_batch_id,
        :purchaser_email,
        :purchaser_phone,
        :price_cents,
        :payment_status
      )

      rows.each_with_object([]) do |(id, batch_id, email, phone, price_cents, payment_status), ids|
        summary = summary_for_attributes(
          ticket_id: id,
          batch_id: batch_id,
          purchaser_email: email,
          purchaser_phone: phone,
          price_cents: price_cents,
          payment_status: payment_status
        )
        ids << id if summary[:needs_attention]
      end
    end
  end

  private

  def preload_deliveries!
    deliveries = MessageDelivery
      .where(tournament_id: @tournament.id, messageable_type: "RaffleTicket")
      .joins("LEFT JOIN raffle_tickets ON raffle_tickets.id = message_deliveries.messageable_id")
      .select(
        "message_deliveries.id",
        "message_deliveries.channel",
        "message_deliveries.status",
        "message_deliveries.recipient",
        "message_deliveries.error_text",
        "message_deliveries.last_event_at",
        "message_deliveries.delivered_at",
        "message_deliveries.failed_at",
        "message_deliveries.created_at",
        "message_deliveries.messageable_id",
        "message_deliveries.request_payload",
        "message_deliveries.metadata",
        "raffle_tickets.raffle_sale_batch_id AS resolved_batch_id"
      )
      .order(created_at: :desc, id: :desc)

    deliveries.each do |delivery|
      channel = delivery.channel.to_s

      if delivery.messageable_id.present?
        @latest_by_ticket[[ delivery.messageable_id, channel ]] ||= delivery
      end

      batch_id = delivery.read_attribute(:resolved_batch_id).presence ||
                 delivery.metadata&.dig("raffle_sale_batch_id").presence
      if batch_id.present?
        @latest_by_batch[[ batch_id.to_i, channel ]] ||= delivery
      end

      ticket_ids = Array(delivery.request_payload&.dig("ticket_ids")) |
                   Array(delivery.metadata&.dig("ticket_ids"))
      ticket_ids.each do |tid|
        next if tid.blank?

        @latest_by_ticket[[ tid.to_i, channel ]] ||= delivery
      end
    end
  end

  def latest_delivery_for(ticket_id:, batch_id:, channel:)
    by_ticket = @latest_by_ticket[[ ticket_id, channel ]]
    by_batch = batch_id.present? ? @latest_by_batch[[ batch_id.to_i, channel ]] : nil

    return by_ticket if by_batch.nil?
    return by_batch if by_ticket.nil?

    [ by_ticket, by_batch ].max_by { |d| [ d.created_at, d.id ] }
  end

  def format_channel(delivery)
    if delivery.nil?
      return {
        status: "none",
        error_text: nil,
        last_event_at: nil,
        recipient: nil
      }
    end

    event_time = delivery.last_event_at || delivery.delivered_at || delivery.failed_at || delivery.created_at
    {
      status: delivery.status,
      error_text: delivery.error_text,
      last_event_at: event_time&.iso8601,
      recipient: delivery.recipient
    }
  end

  def compute_attention(sms_status:, email_status:, purchaser_email:, purchaser_phone:, price_cents:, payment_status:)
    return [ false, nil ] if payment_status == "voided"

    if purchaser_email.blank? && purchaser_phone.blank?
      return [ true, "no_contact" ]
    end

    sms_failed = purchaser_phone.present? && FAILED_STATUSES.include?(sms_status)
    email_failed = purchaser_email.present? && FAILED_STATUSES.include?(email_status)
    if sms_failed || email_failed
      return [ true, "failed" ]
    end

    sms_delivered = purchaser_phone.present? && sms_status == "delivered"
    email_delivered = purchaser_email.present? && email_status == "delivered"
    if sms_delivered || email_delivered
      return [ false, nil ]
    end

    sms_unconfirmed = purchaser_phone.present? && UNCONFIRMED_STATUSES.include?(sms_status)
    email_unconfirmed = purchaser_email.present? && UNCONFIRMED_STATUSES.include?(email_status)
    if sms_unconfirmed || email_unconfirmed
      return [ true, "unconfirmed" ]
    end

    if price_cents.to_i > 0
      return [ true, "unconfirmed" ]
    end

    [ false, nil ]
  end
end
