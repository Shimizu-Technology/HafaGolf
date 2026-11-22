# frozen_string_literal: true

# Computes IRS quid-pro-quo charitable receipt figures (IRC Section 6115, >$75 threshold)
# and returns receipt copy ONLY when `tournament.tax_receipt_enabled?` is explicitly true.
#
# - Registrations & sponsorships: quid-pro-quo disclosure applies when `amount_cents > 7500` ($75.00).
#   `fmv_cents = tournament.fmv_per_player_cents * player_count`
#   `deductible_cents = [amount_cents - fmv_cents, 0].max`
# - Pure charitable donations: FMV is $0, so `deductible_cents = amount_cents` for any positive amount.
class TaxReceiptCalculator
  QUID_PRO_QUO_THRESHOLD_CENTS = 7_500

  Result = Data.define(
    :enabled,
    :applicable,
    :item_type,
    :amount_cents,
    :player_count,
    :fmv_per_player_cents,
    :fmv_cents,
    :deductible_cents,
    :tax_org_name,
    :tax_org_ein,
    :disclaimer,
    :receipt_copy
  ) do
    def enabled?
      enabled
    end

    def applicable?
      applicable
    end

    def as_json(_options = nil)
      {
        enabled: enabled,
        applicable: applicable,
        item_type: item_type,
        amount_cents: amount_cents,
        player_count: player_count,
        fmv_per_player_cents: fmv_per_player_cents,
        fmv_cents: fmv_cents,
        deductible_cents: deductible_cents,
        tax_org_name: tax_org_name,
        tax_org_ein: tax_org_ein,
        disclaimer: disclaimer,
        receipt_copy: receipt_copy
      }
    end
  end

  def self.for_registration(tournament:, amount_cents:, player_count: nil)
    slots = player_count.nil? ? (tournament&.team_size.presence || 1) : player_count.to_i
    calculate(tournament: tournament, item_type: "registration", amount_cents: amount_cents, player_count: slots)
  end

  def self.for_sponsorship(tournament:, amount_cents:, included_player_slots: 0)
    calculate(
      tournament: tournament,
      item_type: "sponsorship",
      amount_cents: amount_cents,
      player_count: included_player_slots.to_i
    )
  end

  def self.for_donation(tournament:, amount_cents:)
    calculate(tournament: tournament, item_type: "donation", amount_cents: amount_cents, player_count: 0)
  end

  def self.calculate(tournament:, item_type:, amount_cents:, player_count: 0)
    new(
      tournament: tournament,
      item_type: item_type,
      amount_cents: amount_cents,
      player_count: player_count
    ).call
  end

  def initialize(tournament:, item_type:, amount_cents:, player_count: 0)
    @tournament = tournament
    @item_type = item_type.to_s
    @amount_cents = [amount_cents.to_i, 0].max
    @player_count = [player_count.to_i, 0].max
  end

  def call
    enabled = @tournament&.tax_receipt_enabled? == true
    fmv_per_player = @tournament&.fmv_per_player_cents.to_i
    fmv_cents = @item_type == "donation" ? 0 : (fmv_per_player * @player_count)
    deductible_cents = [@amount_cents - fmv_cents, 0].max
    applicable = enabled && eligible_amount?

    org_name = @tournament&.tax_org_name.presence || @tournament&.organization&.name
    ein = @tournament&.tax_org_ein.presence
    disclaimer = @tournament&.tax_receipt_disclaimer.presence

    copy = if applicable
             build_receipt_copy(
               org_name: org_name,
               ein: ein,
               fmv_per_player: fmv_per_player,
               fmv_cents: fmv_cents,
               deductible_cents: deductible_cents,
               disclaimer: disclaimer
             )
           end

    Result.new(
      enabled: enabled,
      applicable: applicable,
      item_type: @item_type,
      amount_cents: @amount_cents,
      player_count: @player_count,
      fmv_per_player_cents: fmv_per_player,
      fmv_cents: fmv_cents,
      deductible_cents: deductible_cents,
      tax_org_name: enabled ? org_name : nil,
      tax_org_ein: enabled ? ein : nil,
      disclaimer: enabled ? disclaimer : nil,
      receipt_copy: copy
    )
  end

  private

  def eligible_amount?
    return @amount_cents.positive? if @item_type == "donation"

    @amount_cents > QUID_PRO_QUO_THRESHOLD_CENTS
  end

  def build_receipt_copy(org_name:, ein:, fmv_per_player:, fmv_cents:, deductible_cents:, disclaimer:)
    entity = [org_name.presence || "the host organization", (ein.present? ? "(EIN: #{ein})" : nil)].compact.join(" ")

    parts = if @item_type == "donation"
              [
                "Thank you for your charitable contribution of #{format_usd(@amount_cents)} to #{entity}.",
                "No goods or services were provided in exchange for this contribution.",
                "Estimated tax-deductible amount: #{format_usd(deductible_cents)}."
              ]
            else
              goods_phrase = if @player_count.positive? && fmv_per_player.positive?
                               "(#{@player_count} player #{'slot'.pluralize(@player_count)} at #{format_usd(fmv_per_player)} each)"
                             else
                               "provided in exchange for your payment"
                             end
              [
                "Thank you for your payment of #{format_usd(@amount_cents)} to #{entity}.",
                "The estimated fair market value (FMV) of goods and services #{goods_phrase} is #{format_usd(fmv_cents)}.",
                "For federal income tax purposes, your charitable deduction is limited to the excess of your payment over the FMV: #{format_usd(deductible_cents)}."
              ]
            end

    parts << disclaimer if disclaimer.present?
    parts.join(" ")
  end

  def format_usd(cents)
    format("$%.2f", cents.to_i / 100.0)
  end
end
