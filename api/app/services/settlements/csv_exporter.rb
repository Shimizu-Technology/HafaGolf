# frozen_string_literal: true

require "csv"

module Settlements
  class CsvExporter
    FORMULA_PREFIXES = %w[= + - @].freeze

    def self.call(settlement:, line_items:, payouts:)
      new(settlement: settlement, line_items: line_items, payouts: payouts).call
    end

    def initialize(settlement:, line_items:, payouts:)
      @settlement = settlement
      @tournament = settlement.tournament
      @organization = settlement.organization
      @line_items = line_items
      @payouts = payouts
    end

    def call
      breakdown = @settlement.breakdown_json.is_a?(Hash) ? @settlement.breakdown_json : {}
      payment_mode = breakdown["payment_mode"].presence || @organization.effective_payment_config.payment_mode
      owed_to_platform_cents = breakdown.dig("platform_fee", "owed_to_platform_cents").to_i
      direct = breakdown["direct_collected"].is_a?(Hash) ? breakdown["direct_collected"] : {}

      CSV.generate(headers: false) do |csv|
        csv << ["Payout Settlement Statement"]
        csv << ["Organization", safe_cell(@organization.name)]
        csv << ["Tournament", safe_cell(@tournament.name)]
        csv << ["Payment Mode", safe_cell(payment_mode)]
        csv << ["Statement Version", @settlement.version]
        csv << ["Status", @settlement.status]
        csv << ["Calculated At", @settlement.calculated_at&.iso8601]
        csv << ["Finalized At", @settlement.finalized_at&.iso8601]
        csv << []

        csv << ["Summary Metric", "Amount (USD)", "Cents"]
        csv << ["Gross Platform Collected", dollars(@settlement.gross_cents), @settlement.gross_cents]
        csv << ["Refunds", dollars(-@settlement.refund_cents), -@settlement.refund_cents]
        csv << ["Net Collected", dollars(@settlement.net_cents), @settlement.net_cents]
        csv << ["Processing Fees", dollars(-@settlement.processing_fee_cents), -@settlement.processing_fee_cents]
        csv << ["Platform Fee", dollars(-@settlement.platform_fee_cents), -@settlement.platform_fee_cents]
        csv << ["Adjustments", dollars(@settlement.adjustment_cents), @settlement.adjustment_cents]
        csv << ["Organizer Proceeds", dollars(@settlement.organizer_proceeds_cents), @settlement.organizer_proceeds_cents]
        csv << ["Paid Out", dollars(@settlement.paid_cents), @settlement.paid_cents]
        csv << ["Balance Owed (Payable)", dollars(@settlement.payable_cents), @settlement.payable_cents]
        if payment_mode != "platform_collect" || owed_to_platform_cents.positive?
          csv << ["Platform Fee Owed to Platform", dollars(owed_to_platform_cents), owed_to_platform_cents]
        end
        csv << []

        direct_gross = %w[registrations raffle sponsorships donations].sum { |k| direct.dig(k, "gross_cents").to_i }
        if direct_gross.positive? || payment_mode != "platform_collect"
          csv << ["Directly Collected by Organization (Not Held by Platform)"]
          csv << ["Category", "Count", "Gross (USD)", "Refunds (USD)"]
          %w[registrations sponsorships donations raffle].each do |cat|
            row = direct[cat].is_a?(Hash) ? direct[cat] : {}
            csv << [
              cat.capitalize,
              row["count"].to_i,
              dollars(row["gross_cents"].to_i),
              dollars(row["refund_cents"].to_i)
            ]
          end
          csv << []
        end

        csv << ["Recorded Payouts"]
        csv << ["Payout ID", "Status", "Provider", "Check / Reference #", "Payee", "Bank", "Amount (USD)", "Paid At", "Notes"]
        @payouts.each do |payout|
          snapshot = payout.payee_snapshot || {}
          csv << [
            payout.id,
            payout.status,
            payout.provider,
            safe_cell(payout.provider_payout_id),
            safe_cell(snapshot["payee_name"]),
            safe_cell(snapshot["bank_name"]),
            dollars(payout.amount_cents),
            payout.paid_at&.iso8601,
            safe_cell(payout.notes)
          ]
        end
        csv << []

        csv << ["Itemized Platform Charges"]
        csv << ["Source Type", "Source ID", "Name / Description", "Email", "Payment Status", "Method", "Origin", "Gross (USD)", "Refund (USD)", "Processing Fee (USD)", "Fee Source", "Paid At"]
        @line_items.each do |item|
          csv << [
            item[:source_type],
            item[:source_id],
            safe_cell(item[:label]),
            safe_cell(item[:email]),
            item[:payment_status],
            safe_cell(item[:payment_method]),
            safe_cell(item[:stripe_account_origin]),
            dollars(item[:gross_cents]),
            dollars(item[:refund_cents]),
            dollars(item[:processing_fee_cents]),
            item[:fee_source],
            item[:paid_at]
          ]
        end
      end
    end

    private

    def dollars(cents)
      format("%.2f", cents.to_i / 100.0)
    end

    def safe_cell(value)
      str = value.to_s
      return "" if str.empty?

      stripped = str.lstrip
      if FORMULA_PREFIXES.include?(str[0]) || FORMULA_PREFIXES.include?(stripped[0]) || str.start_with?("\t", "\r")
        "'#{str}"
      else
        str
      end
    end
  end
end
