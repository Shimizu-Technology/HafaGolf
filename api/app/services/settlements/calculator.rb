# frozen_string_literal: true

require "digest"

module Settlements
  # Computes a cent-exact, deterministic payout statement for a tournament.
  #
  # Accounting rules:
  # - Only platform-collected online charges (Stripe via platform_collect) are
  #   included in gross_cents / refund_cents / processing_fee_cents / organizer_proceeds_cents.
  #   Payments collected directly by the organization (cash, check, external_link,
  #   client_processor) are reported separately in `breakdown_json[:direct_collected]`
  #   and never inflate Shimizu's payout obligation.
  # - Processing fees use actual recorded `stripe_fee_cents` when present and fall back
  #   to exact integer math (2.9% + $0.30 per charge, rounded half-up) otherwise.
  # - Platform fee uses `OrganizationPaymentConfig` (`flat + per_registrant * count`,
  #   capped at `platform_fee_cap_cents` when set; 0 when no paid charges/registrants exist).
  class Calculator
    Result = Data.define(
      :gross_cents,
      :refund_cents,
      :processing_fee_cents,
      :platform_fee_cents,
      :adjustment_cents,
      :net_cents,
      :organizer_proceeds_cents,
      :breakdown_json,
      :source_digest,
      :line_items
    )

    def self.call(tournament, adjustment_cents: 0)
      new(tournament, adjustment_cents: adjustment_cents).call
    end

    def initialize(tournament, adjustment_cents: 0)
      @tournament = tournament
      @organization = tournament.organization
      @payment_config = @organization.effective_payment_config
      @adjustment_cents = adjustment_cents.to_i
    end

    def call
      golfers = @tournament.golfers.order(:id).to_a
      raffle_tickets = @tournament.raffle_tickets.order(:id).to_a

      platform_reg_charges = []
      direct_reg_totals = { count: 0, gross_cents: 0, refund_cents: 0 }
      line_items = []
      digest_rows = []

      golfers.each do |golfer|
        next if golfer.payment_type == "sponsor"

        amount = registration_charge_cents(golfer)
        refund = clamped_refund_cents(golfer, amount)
        next if amount <= 0 && refund <= 0

        if platform_collected_golfer?(golfer)
          fee_cents, fee_source = resolve_processing_fee(amount, golfer.stripe_fee_cents)
          platform_reg_charges << {
            id: golfer.id,
            amount_cents: amount,
            refund_cents: refund,
            fee_cents: fee_cents,
            fee_source: fee_source,
            active_paid: golfer.payment_status == "paid" && golfer.registration_status != "cancelled" && refund < amount
          }
          line_items << {
            source_type: "registration",
            source_id: golfer.id,
            label: golfer.name,
            email: golfer.email,
            payment_status: golfer.payment_status,
            payment_method: golfer.payment_method || "stripe",
            stripe_account_origin: golfer.stripe_account_origin,
            gross_cents: amount,
            refund_cents: refund,
            processing_fee_cents: fee_cents,
            fee_source: fee_source,
            paid_at: golfer.paid_at&.iso8601,
            refunded_at: golfer.refunded_at&.iso8601
          }
          digest_rows << [
            "golfer",
            golfer.id,
            golfer.payment_status,
            golfer.registration_status,
            amount,
            refund,
            golfer.stripe_fee_cents,
            golfer.payment_method,
            golfer.stripe_account_origin
          ]
        elsif golfer.payment_status.in?(%w[paid refunded])
          direct_reg_totals[:count] += 1
          direct_reg_totals[:gross_cents] += amount
          direct_reg_totals[:refund_cents] += refund
        end
      end

      platform_raffle_charges = []
      direct_raffle_totals = { count: 0, gross_cents: 0 }

      raffle_tickets.each do |ticket|
        price = ticket.price_cents.to_i
        next if price <= 0

        if platform_collected_raffle_ticket?(ticket)
          fee_cents = estimate_stripe_fee_cents(price)
          platform_raffle_charges << {
            id: ticket.id,
            amount_cents: price,
            refund_cents: 0,
            fee_cents: fee_cents,
            fee_source: "estimated"
          }
          line_items << {
            source_type: "raffle",
            source_id: ticket.id,
            label: "Raffle #{ticket.display_number} (#{ticket.purchaser_display})",
            email: ticket.purchaser_email,
            payment_status: ticket.payment_status,
            payment_method: ticket.payment_method,
            stripe_account_origin: nil,
            gross_cents: price,
            refund_cents: 0,
            processing_fee_cents: fee_cents,
            fee_source: "estimated",
            paid_at: ticket.purchased_at&.iso8601,
            refunded_at: nil
          }
          digest_rows << ["raffle_ticket", ticket.id, ticket.payment_status, price, ticket.payment_method]
        elsif ticket.payment_status == "paid"
          direct_raffle_totals[:count] += 1
          direct_raffle_totals[:gross_cents] += price
        end
      end

      reg_gross = platform_reg_charges.sum { |c| c[:amount_cents] }
      reg_refunds = platform_reg_charges.sum { |c| c[:refund_cents] }
      reg_fees = platform_reg_charges.sum { |c| c[:fee_cents] }
      raffle_gross = platform_raffle_charges.sum { |c| c[:amount_cents] }
      raffle_fees = platform_raffle_charges.sum { |c| c[:fee_cents] }

      gross_cents = reg_gross + raffle_gross
      refund_cents = reg_refunds
      processing_fee_cents = reg_fees + raffle_fees

      billable_registrant_count = platform_reg_charges.count { |c| c[:active_paid] }
      platform_fee_cents = calculate_platform_fee_cents(
        gross_cents: gross_cents,
        billable_registrant_count: billable_registrant_count
      )

      net_cents = gross_cents - refund_cents
      organizer_proceeds_cents = net_cents - processing_fee_cents - platform_fee_cents + @adjustment_cents

      actual_fee_count = platform_reg_charges.count { |c| c[:fee_source] == "actual" }
      estimated_fee_count = platform_reg_charges.count { |c| c[:fee_source] == "estimated" } + platform_raffle_charges.size

      breakdown = {
        "payment_mode" => @payment_config.payment_mode,
        "registrations" => {
          "charge_count" => platform_reg_charges.size,
          "billable_registrant_count" => billable_registrant_count,
          "gross_cents" => reg_gross,
          "refund_cents" => reg_refunds,
          "processing_fee_cents" => reg_fees
        },
        "raffle" => {
          "charge_count" => platform_raffle_charges.size,
          "gross_cents" => raffle_gross,
          "processing_fee_cents" => raffle_fees
        },
        "sponsorships" => {
          "charge_count" => 0,
          "gross_cents" => 0,
          "refund_cents" => 0,
          "processing_fee_cents" => 0
        },
        "donations" => {
          "charge_count" => 0,
          "gross_cents" => 0,
          "refund_cents" => 0,
          "processing_fee_cents" => 0
        },
        "processing_fees" => {
          "actual_fee_count" => actual_fee_count,
          "estimated_fee_count" => estimated_fee_count,
          "estimation_formula" => "2.9% + $0.30 per online Stripe charge when actual Stripe fee is not recorded"
        },
        "platform_fee" => {
          "flat_cents" => @payment_config.platform_fee_flat_cents.to_i,
          "per_registrant_cents" => @payment_config.platform_fee_per_registrant_cents.to_i,
          "cap_cents" => @payment_config.platform_fee_cap_cents,
          "billable_registrant_count" => billable_registrant_count,
          "computed_cents" => platform_fee_cents
        },
        "direct_collected" => {
          "registrations" => direct_reg_totals.transform_keys(&:to_s),
          "raffle" => direct_raffle_totals.transform_keys(&:to_s)
        }
      }

      digest_payload = {
        tournament_id: @tournament.id,
        payment_mode: @payment_config.payment_mode,
        fee_config: [
          @payment_config.platform_fee_flat_cents.to_i,
          @payment_config.platform_fee_per_registrant_cents.to_i,
          @payment_config.platform_fee_cap_cents
        ],
        adjustment_cents: @adjustment_cents,
        rows: digest_rows
      }
      source_digest = Digest::SHA256.hexdigest(JSON.generate(digest_payload))

      Result.new(
        gross_cents: gross_cents,
        refund_cents: refund_cents,
        processing_fee_cents: processing_fee_cents,
        platform_fee_cents: platform_fee_cents,
        adjustment_cents: @adjustment_cents,
        net_cents: net_cents,
        organizer_proceeds_cents: organizer_proceeds_cents,
        breakdown_json: breakdown,
        source_digest: source_digest,
        line_items: line_items
      )
    end

    private

    def platform_collected_golfer?(golfer)
      return false unless golfer.payment_status.in?(%w[paid refunded])

      origin = golfer.stripe_account_origin.to_s
      return false if origin.start_with?("client_processor:") || origin.start_with?("legacy_")
      return true if origin.start_with?("platform_")

      # Legacy/pre-tag Stripe charges on an org configured for platform_collect
      @payment_config.platform_collect? && golfer.payment_method == "stripe"
    end

    def platform_collected_raffle_ticket?(ticket)
      return false unless ticket.payment_status == "paid"

      @payment_config.platform_collect? && ticket.payment_method == "stripe"
    end

    def registration_charge_cents(golfer)
      return golfer.payment_amount_cents.to_i if golfer.payment_amount_cents.to_i.positive?
      return @tournament.entry_fee.to_i if golfer.payment_status.in?(%w[paid refunded])

      0
    end

    def clamped_refund_cents(golfer, gross_amount)
      raw = golfer.refund_amount_cents.to_i
      return 0 if raw <= 0

      [raw, gross_amount].min
    end

    def resolve_processing_fee(amount_cents, recorded_fee_cents)
      return [recorded_fee_cents.to_i, "actual"] unless recorded_fee_cents.nil?

      [estimate_stripe_fee_cents(amount_cents), "estimated"]
    end

    # Exact integer math for 2.9% + $0.30 rounded half-up (zero float drift)
    def estimate_stripe_fee_cents(amount_cents)
      return 0 if amount_cents <= 0

      ((amount_cents * 290) + 5000) / 10_000 + 30
    end

    def calculate_platform_fee_cents(gross_cents:, billable_registrant_count:)
      return 0 if gross_cents <= 0 && billable_registrant_count <= 0

      flat = @payment_config.platform_fee_flat_cents.to_i
      per_reg = @payment_config.platform_fee_per_registrant_cents.to_i * billable_registrant_count
      raw = flat + per_reg
      cap = @payment_config.platform_fee_cap_cents
      cap.present? ? [raw, cap.to_i].min : raw
    end
  end
end
