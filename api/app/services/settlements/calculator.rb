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
      registrations = @tournament.registrations.includes(:team_members).order(:id).to_a
      bridged_golfer_ids = registrations.filter_map(&:golfer_id).to_set
      golfers = @tournament.golfers.order(:id).to_a
      raffle_tickets = @tournament.raffle_tickets.order(:id).to_a
      sponsors = @tournament.sponsors.includes(:sponsor_tier).order(:id).to_a
      donations = @tournament.donations.order(:id).to_a

      platform_reg_charges = []
      direct_reg_totals = { count: 0, gross_cents: 0, refund_cents: 0 }
      line_items = []
      digest_rows = []

      registrations.each do |registration|
        next if registration.payment_type == "sponsor"

        amount = registration_charge_cents(registration)
        refund = clamped_refund_cents(registration, amount)
        next if amount <= 0 && refund <= 0

        if platform_collected_record?(registration)
          recorded_fee = registration.respond_to?(:stripe_fee_cents) ? registration.stripe_fee_cents : nil
          fee_cents, fee_source = resolve_processing_fee(amount, recorded_fee)
          player_count = [registration.player_count, 1].max
          platform_reg_charges << {
            id: "reg:#{registration.id}",
            amount_cents: amount,
            refund_cents: refund,
            fee_cents: fee_cents,
            fee_source: fee_source,
            registrant_count: player_count,
            active_paid: registration.payment_status == "paid" && registration.registration_status != "cancelled" && refund < amount
          }
          line_items << {
            source_type: "registration",
            source_id: registration.id,
            label: registration.team_name.presence || registration.contact_name.presence || "Registration ##{registration.id}",
            email: registration.contact_email,
            payment_status: registration.payment_status,
            payment_method: registration.payment_method || "stripe",
            stripe_account_origin: registration.stripe_account_origin,
            gross_cents: amount,
            refund_cents: refund,
            processing_fee_cents: fee_cents,
            fee_source: fee_source,
            paid_at: registration.paid_at&.iso8601,
            refunded_at: registration.refunded_at&.iso8601
          }
          digest_rows << [
            "registration",
            registration.id,
            registration.payment_status,
            registration.registration_status,
            amount,
            refund,
            recorded_fee,
            registration.payment_method,
            registration.stripe_account_origin,
            registration.stripe_payment_intent_id
          ]
        elsif registration.payment_status.in?(%w[paid refunded])
          direct_reg_totals[:count] += 1
          direct_reg_totals[:gross_cents] += amount
          direct_reg_totals[:refund_cents] += refund
        end
      end

      golfers.each do |golfer|
        next if golfer.payment_type == "sponsor"
        next if bridged_golfer_ids.include?(golfer.id)

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
            registrant_count: 1,
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
      raffle_by_intent = {}

      raffle_tickets.each do |ticket|
        price = ticket.price_cents.to_i
        next if price <= 0

        if platform_collected_raffle_ticket?(ticket)
          intent_key = ticket.stripe_payment_intent_id.to_s
          raffle_by_intent[intent_key] ||= []
          raffle_by_intent[intent_key] << ticket
        elsif ticket.payment_status == "paid"
          direct_raffle_totals[:count] += 1
          direct_raffle_totals[:gross_cents] += price
        end
      end

      raffle_by_intent.each do |intent_id, tickets|
        batch_gross = tickets.sum { |t| t.price_cents.to_i }
        batch_refund = tickets.sum { |t| t.payment_status == "refunded" ? t.price_cents.to_i : 0 }
        batch_fee = estimate_stripe_fee_cents(batch_gross)
        platform_raffle_charges << {
          id: intent_id,
          amount_cents: batch_gross,
          refund_cents: batch_refund,
          fee_cents: batch_fee,
          fee_source: "estimated"
        }
        line_items << {
          source_type: "raffle",
          source_id: tickets.first.id,
          label: tickets.size == 1 ? "Raffle #{tickets.first.display_number} (#{tickets.first.purchaser_display})" : "Raffle x#{tickets.size} (#{tickets.first.purchaser_display})",
          email: tickets.first.purchaser_email,
          payment_status: batch_refund == batch_gross ? "refunded" : "paid",
          payment_method: "stripe",
          stripe_account_origin: "platform_live",
          gross_cents: batch_gross,
          refund_cents: batch_refund,
          processing_fee_cents: batch_fee,
          fee_source: "estimated",
          paid_at: tickets.first.purchased_at&.iso8601,
          refunded_at: nil
        }
        tickets.each do |t|
          digest_rows << ["raffle_ticket", t.id, t.payment_status, t.price_cents.to_i, t.stripe_payment_intent_id]
        end
      end

      platform_sponsor_charges = []
      direct_sponsor_totals = { count: 0, gross_cents: 0, refund_cents: 0 }

      sponsors.each do |sponsor|
        amount = sponsor.payment_amount_cents.to_i
        refund = clamped_refund_cents(sponsor, amount)
        next if amount <= 0 && refund <= 0

        if platform_collected_record?(sponsor)
          fee_cents, fee_source = resolve_processing_fee(amount, sponsor.stripe_fee_cents)
          platform_sponsor_charges << {
            id: sponsor.id,
            amount_cents: amount,
            refund_cents: refund,
            fee_cents: fee_cents,
            fee_source: fee_source
          }
          line_items << {
            source_type: "sponsorship",
            source_id: sponsor.id,
            label: "#{sponsor.name} (#{sponsor.tier_display})",
            email: sponsor.login_email,
            payment_status: sponsor.payment_status,
            payment_method: sponsor.payment_method || "stripe",
            stripe_account_origin: sponsor.stripe_account_origin,
            gross_cents: amount,
            refund_cents: refund,
            processing_fee_cents: fee_cents,
            fee_source: fee_source,
            paid_at: sponsor.paid_at&.iso8601,
            refunded_at: sponsor.refunded_at&.iso8601
          }
          digest_rows << [
            "sponsor",
            sponsor.id,
            sponsor.payment_status,
            amount,
            refund,
            sponsor.stripe_fee_cents,
            sponsor.payment_method,
            sponsor.stripe_account_origin,
            sponsor.stripe_payment_intent_id
          ]
        elsif sponsor.payment_status.in?(%w[paid refunded])
          direct_sponsor_totals[:count] += 1
          direct_sponsor_totals[:gross_cents] += amount
          direct_sponsor_totals[:refund_cents] += refund
        end
      end

      platform_donation_charges = []
      direct_donation_totals = { count: 0, gross_cents: 0, refund_cents: 0 }

      donations.each do |donation|
        amount = donation.amount_cents.to_i
        refund = clamped_refund_cents(donation, amount)
        next if amount <= 0 && refund <= 0

        if platform_collected_record?(donation)
          fee_cents, fee_source = resolve_processing_fee(amount, donation.stripe_fee_cents)
          platform_donation_charges << {
            id: donation.id,
            amount_cents: amount,
            refund_cents: refund,
            fee_cents: fee_cents,
            fee_source: fee_source
          }
          line_items << {
            source_type: "donation",
            source_id: donation.id,
            label: "Donation — #{donation.donor_name}",
            email: donation.donor_email,
            payment_status: donation.payment_status,
            payment_method: donation.payment_method || "stripe",
            stripe_account_origin: donation.stripe_account_origin,
            gross_cents: amount,
            refund_cents: refund,
            processing_fee_cents: fee_cents,
            fee_source: fee_source,
            paid_at: donation.paid_at&.iso8601,
            refunded_at: donation.refunded_at&.iso8601
          }
          digest_rows << [
            "donation",
            donation.id,
            donation.payment_status,
            amount,
            refund,
            donation.stripe_fee_cents,
            donation.payment_method,
            donation.stripe_account_origin,
            donation.stripe_payment_intent_id
          ]
        elsif donation.payment_status.in?(%w[paid refunded])
          direct_donation_totals[:count] += 1
          direct_donation_totals[:gross_cents] += amount
          direct_donation_totals[:refund_cents] += refund
        end
      end

      reg_gross = platform_reg_charges.sum { |c| c[:amount_cents] }
      reg_refunds = platform_reg_charges.sum { |c| c[:refund_cents] }
      reg_fees = platform_reg_charges.sum { |c| c[:fee_cents] }
      raffle_gross = platform_raffle_charges.sum { |c| c[:amount_cents] }
      raffle_refunds = platform_raffle_charges.sum { |c| c[:refund_cents] }
      raffle_fees = platform_raffle_charges.sum { |c| c[:fee_cents] }
      sponsor_gross = platform_sponsor_charges.sum { |c| c[:amount_cents] }
      sponsor_refunds = platform_sponsor_charges.sum { |c| c[:refund_cents] }
      sponsor_fees = platform_sponsor_charges.sum { |c| c[:fee_cents] }
      donation_gross = platform_donation_charges.sum { |c| c[:amount_cents] }
      donation_refunds = platform_donation_charges.sum { |c| c[:refund_cents] }
      donation_fees = platform_donation_charges.sum { |c| c[:fee_cents] }

      gross_cents = reg_gross + raffle_gross + sponsor_gross + donation_gross
      refund_cents = reg_refunds + raffle_refunds + sponsor_refunds + donation_refunds
      processing_fee_cents = reg_fees + raffle_fees + sponsor_fees + donation_fees

      billable_registrant_count = platform_reg_charges.sum { |c| c[:active_paid] ? c.fetch(:registrant_count, 1) : 0 }
      platform_fee_cents = calculate_platform_fee_cents(
        gross_cents: gross_cents,
        billable_registrant_count: billable_registrant_count
      )

      net_cents = gross_cents - refund_cents
      organizer_proceeds_cents = net_cents - processing_fee_cents - platform_fee_cents + @adjustment_cents

      all_fee_tracked = platform_reg_charges + platform_sponsor_charges + platform_donation_charges
      actual_fee_count = all_fee_tracked.count { |c| c[:fee_source] == "actual" }
      estimated_fee_count = all_fee_tracked.count { |c| c[:fee_source] == "estimated" } + platform_raffle_charges.size

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
          "charge_count" => platform_sponsor_charges.size,
          "gross_cents" => sponsor_gross,
          "refund_cents" => sponsor_refunds,
          "processing_fee_cents" => sponsor_fees
        },
        "donations" => {
          "charge_count" => platform_donation_charges.size,
          "gross_cents" => donation_gross,
          "refund_cents" => donation_refunds,
          "processing_fee_cents" => donation_fees
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
          "raffle" => direct_raffle_totals.transform_keys(&:to_s),
          "sponsorships" => direct_sponsor_totals.transform_keys(&:to_s),
          "donations" => direct_donation_totals.transform_keys(&:to_s)
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
      platform_collected_record?(golfer)
    end

    def platform_collected_record?(record)
      return false unless record.payment_status.in?(%w[paid refunded])

      origin = record.stripe_account_origin.to_s
      return false if origin.start_with?("client_processor:") || origin.start_with?("legacy_")
      return true if origin.start_with?("platform_")

      # Never count admin-entered payment_method == "stripe" without proof of a Stripe charge.
      # Require a verified Stripe payment_intent_id when origin tag is absent on a platform_collect org.
      @payment_config.platform_collect? && record.stripe_payment_intent_id.present?
    end

    def platform_collected_raffle_ticket?(ticket)
      return false unless ticket.payment_status.in?(%w[paid refunded])

      @payment_config.platform_collect? && ticket.stripe_payment_intent_id.present?
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
