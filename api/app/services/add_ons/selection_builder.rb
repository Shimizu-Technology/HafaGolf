# frozen_string_literal: true

module AddOns
  # Validates and resolves requested registration add-ons under tournament/add-on row locks.
  # Never trusts client-submitted prices — always snapshots `unit_price_cents` from DB.
  class SelectionBuilder
    Result = Struct.new(:ok, :items, :total_cents, :errors, keyword_init: true) do
      def ok?
        ok == true
      end
    end

    def self.resolve!(tournament:, raw_add_ons:)
      new(tournament: tournament, raw_add_ons: raw_add_ons).resolve!
    end

    def initialize(tournament:, raw_add_ons:)
      @tournament = tournament
      @raw_add_ons = raw_add_ons
    end

    def resolve!
      entries = normalize_entries(@raw_add_ons)
      return Result.new(ok: false, items: [], total_cents: 0, errors: entries[:errors]) if entries[:errors].any?

      quantities_by_id = entries[:quantities_by_id]
      return Result.new(ok: true, items: [], total_cents: 0, errors: []) if quantities_by_id.empty?

      ids = quantities_by_id.keys.sort
      locked_add_ons = @tournament.tournament_add_ons.lock.where(id: ids).order(:id).index_by(&:id)
      sold_counts = TournamentAddOn.sold_quantities_by_add_on_id(ids)

      errors = []
      resolved_items = []

      ids.each do |add_on_id|
        qty = quantities_by_id[add_on_id]
        add_on = locked_add_ons[add_on_id]

        unless add_on
          errors << "Selected add-on is not available for this tournament."
          next
        end

        unless add_on.active?
          errors << "#{add_on.name} is no longer available."
          next
        end

        if qty > add_on.max_quantity_per_order
          errors << "#{add_on.name} is limited to #{add_on.max_quantity_per_order} per registration."
          next
        end

        remaining = add_on.remaining_quantity(precomputed_sold: sold_counts.fetch(add_on_id, 0))
        if !remaining.nil? && qty > remaining
          if remaining <= 0
            errors << "#{add_on.name} is sold out."
          else
            errors << "Only #{remaining} of #{add_on.name} remaining."
          end
          next
        end

        resolved_items << {
          add_on: add_on,
          quantity: qty,
          unit_price_cents: add_on.price_cents
        }
      end

      return Result.new(ok: false, items: [], total_cents: 0, errors: errors) if errors.any?

      total_cents = resolved_items.sum { |item| item[:quantity] * item[:unit_price_cents] }
      Result.new(ok: true, items: resolved_items, total_cents: total_cents, errors: [])
    end

    def self.attach!(items:, tournament:, golfer: nil, registration: nil)
      Array(items).map do |item|
        GolferAddOn.create!(
          organization_id: tournament.organization_id,
          tournament: tournament,
          golfer: golfer,
          registration: registration,
          tournament_add_on: item[:add_on],
          quantity: item[:quantity],
          unit_price_cents: item[:unit_price_cents]
        )
      end
    end

    private

    def normalize_entries(raw)
      return { quantities_by_id: {}, errors: [] } if raw.blank?

      unless raw.is_a?(Array)
        return { quantities_by_id: {}, errors: ["Add-ons selection must be a list."] }
      end

      quantities_by_id = Hash.new(0)
      errors = []

      raw.each do |entry|
        hash = if entry.is_a?(ActionController::Parameters)
                 entry.permit(:add_on_id, :tournament_add_on_id, :quantity).to_h
               elsif entry.is_a?(Hash)
                 entry.stringify_keys
               end

        unless hash
          errors << "Invalid add-on entry."
          next
        end

        raw_id = hash["add_on_id"].presence || hash["tournament_add_on_id"].presence
        raw_qty = hash["quantity"]

        add_on_id = parse_positive_int(raw_id)
        qty = parse_non_negative_int(raw_qty)

        if add_on_id.nil? || qty.nil?
          errors << "Each add-on must specify a valid add-on and quantity."
          next
        end

        next if qty.zero?

        quantities_by_id[add_on_id] += qty
      end

      { quantities_by_id: quantities_by_id, errors: errors }
    end

    def parse_positive_int(value)
      return nil if value.nil? || value == true || value == false
      parsed = Integer(value.to_s.strip, 10)
      parsed.positive? ? parsed : nil
    rescue ArgumentError, TypeError
      nil
    end

    def parse_non_negative_int(value)
      return nil if value.nil? || value == true || value == false
      parsed = Integer(value.to_s.strip, 10)
      parsed >= 0 ? parsed : nil
    rescue ArgumentError, TypeError
      nil
    end
  end
end
