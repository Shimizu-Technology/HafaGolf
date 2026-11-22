# frozen_string_literal: true

module Api
  module V1
    class SettlementsController < BaseController
      before_action :set_tournament
      before_action :authorize_org_admin!
      before_action :require_super_admin!, only: %i[calculate finalize create_payout mark_payout_paid void_payout]

      # GET /api/v1/tournaments/:tournament_id/settlement
      def show
        render json: build_settlement_payload
      end

      # GET /api/v1/tournaments/:tournament_id/settlement/export
      def export_csv
        latest = @tournament.tournament_settlements.latest_first.first
        calc = Settlements::Calculator.call(@tournament, adjustment_cents: latest&.adjustment_cents.to_i)

        settlement = latest || build_ephemeral_settlement(calc)
        payouts = @tournament.tournament_payouts.includes(:recorded_by).recent_first.to_a

        csv_data = Settlements::CsvExporter.call(
          settlement: settlement,
          line_items: calc.line_items,
          payouts: payouts
        )

        filename = "#{@tournament.slug.presence || "tournament-#{@tournament.id}"}-payout-statement-v#{settlement.version}.csv"
        send_data csv_data,
                  filename: filename,
                  type: "text/csv; charset=utf-8",
                  disposition: "attachment"
      end

      # POST /api/v1/tournaments/:tournament_id/settlement/calculate
      def calculate
        adjustment_cents = if params.key?(:adjustment_cents)
          Integer(params[:adjustment_cents])
        else
          latest_existing = @tournament.tournament_settlements.latest_first.first
          latest_existing&.draft? ? latest_existing.adjustment_cents : 0
        end
        adjustment_notes = params.key?(:adjustment_notes) ? params[:adjustment_notes].to_s.strip.presence : nil

        settlement = nil
        ActiveRecord::Base.transaction(requires_new: true) do
          @tournament.lock!
          latest = @tournament.tournament_settlements.latest_first.first
          calc = Settlements::Calculator.call(@tournament, adjustment_cents: adjustment_cents)
          paid_total = @tournament.tournament_payouts.where(status: "paid").sum(:amount_cents)

          attrs = {
            organization_id: @tournament.organization_id,
            currency: "usd",
            gross_cents: calc.gross_cents,
            refund_cents: calc.refund_cents,
            processing_fee_cents: calc.processing_fee_cents,
            platform_fee_cents: calc.platform_fee_cents,
            adjustment_cents: calc.adjustment_cents,
            adjustment_notes: params.key?(:adjustment_notes) ? adjustment_notes : (latest&.draft? ? latest.adjustment_notes : nil),
            net_cents: calc.net_cents,
            organizer_proceeds_cents: calc.organizer_proceeds_cents,
            paid_cents: paid_total,
            payable_cents: calc.organizer_proceeds_cents - paid_total,
            breakdown_json: calc.breakdown_json,
            source_digest: calc.source_digest,
            calculated_at: Time.current
          }

          if latest.present? && latest.draft?
            latest.update!(attrs)
            settlement = latest
          else
            next_version = (latest&.version || 0) + 1
            settlement = @tournament.tournament_settlements.create!(attrs.merge(version: next_version, status: "draft"))
          end

          log_activity(
            action: "settlement_calculated",
            target: settlement,
            details: "Calculated payout statement v#{settlement.version} (proceeds #{format_cents(settlement.organizer_proceeds_cents)}, payable #{format_cents(settlement.payable_cents)})"
          )
        end

        render json: build_settlement_payload, status: :ok
      rescue ArgumentError
        render json: { error: "adjustment_cents must be an integer" }, status: :unprocessable_entity
      end

      # POST /api/v1/tournaments/:tournament_id/settlement/finalize
      def finalize
        settlement = nil
        ActiveRecord::Base.transaction(requires_new: true) do
          @tournament.lock!
          settlement = @tournament.tournament_settlements.latest_first.first
          if settlement.nil?
            calc = Settlements::Calculator.call(@tournament)
            paid_total = @tournament.tournament_payouts.where(status: "paid").sum(:amount_cents)
            settlement = @tournament.tournament_settlements.create!(
              organization_id: @tournament.organization_id,
              version: 1,
              status: "draft",
              currency: "usd",
              gross_cents: calc.gross_cents,
              refund_cents: calc.refund_cents,
              processing_fee_cents: calc.processing_fee_cents,
              platform_fee_cents: calc.platform_fee_cents,
              adjustment_cents: 0,
              net_cents: calc.net_cents,
              organizer_proceeds_cents: calc.organizer_proceeds_cents,
              paid_cents: paid_total,
              payable_cents: calc.organizer_proceeds_cents - paid_total,
              breakdown_json: calc.breakdown_json,
              source_digest: calc.source_digest,
              calculated_at: Time.current
            )
          end

          if settlement.finalized?
            render json: { error: "Latest settlement v#{settlement.version} is already finalized" }, status: :unprocessable_entity
            raise ActiveRecord::Rollback
          end

          settlement.finalize!(user: current_user)
          log_activity(
            action: "settlement_finalized",
            target: settlement,
            details: "Finalized payout statement v#{settlement.version} (proceeds #{format_cents(settlement.organizer_proceeds_cents)})"
          )
        end

        return if performed?

        render json: build_settlement_payload, status: :ok
      end

      # POST /api/v1/tournaments/:tournament_id/settlement/payouts
      def create_payout
        amount_cents = Integer(params[:amount_cents])
        if amount_cents <= 0
          return render json: { error: "amount_cents must be greater than zero" }, status: :unprocessable_entity
        end

        provider = params[:provider].to_s.strip.downcase.presence || "check"
        unless TournamentPayout::PROVIDERS.include?(provider)
          return render json: { error: "Invalid payout provider" }, status: :unprocessable_entity
        end

        mark_paid = ActiveModel::Type::Boolean.new.cast(params[:mark_paid])
        idempotency_key = params[:idempotency_key].to_s.strip.presence
        provider_payout_id = params[:provider_payout_id].to_s.strip.presence
        notes = params[:notes].to_s.strip.presence

        payout = nil
        replayed = false

        ActiveRecord::Base.transaction(requires_new: true) do
          @tournament.lock!

          if idempotency_key.present?
            existing = @tournament.tournament_payouts.find_by(idempotency_key: idempotency_key)
            if existing.present?
              payout = existing
              replayed = true
              next
            end
          end

          settlement = @tournament.tournament_settlements.latest_first.first
          if settlement.nil?
            render json: { error: "Calculate a settlement statement before recording payouts" }, status: :unprocessable_entity
            raise ActiveRecord::Rollback
          end

          remaining = settlement.remaining_payout_capacity_cents
          if amount_cents > remaining
            render json: {
              error: "Payout amount (#{format_cents(amount_cents)}) exceeds remaining payable capacity (#{format_cents(remaining)})"
            }, status: :unprocessable_entity
            raise ActiveRecord::Rollback
          end

          payment_config = @tournament.organization.effective_payment_config
          payee_snapshot = {
            "payee_name" => params[:payee_name].to_s.strip.presence || payment_config.payout_payee_name || @tournament.organization.name,
            "bank_name" => params[:bank_name].to_s.strip.presence || payment_config.payout_bank_name,
            "payout_notes" => payment_config.payout_notes
          }.compact

          now = Time.current
          payout = settlement.tournament_payouts.create!(
            organization_id: @tournament.organization_id,
            tournament_id: @tournament.id,
            amount_cents: amount_cents,
            currency: settlement.currency,
            status: mark_paid ? "paid" : "pending",
            provider: provider,
            provider_payout_id: provider_payout_id,
            payee_snapshot: payee_snapshot,
            initiated_at: now,
            paid_at: mark_paid ? (parse_timestamp(params[:paid_at]) || now) : nil,
            recorded_by: current_user,
            notes: notes,
            idempotency_key: idempotency_key
          )

          settlement.recalculate_paid_totals!

          log_activity(
            action: mark_paid ? "payout_marked_paid" : "payout_recorded",
            target: payout,
            details: "Recorded #{provider} payout of #{format_cents(amount_cents)} (#{payout.status})#{provider_payout_id ? " ref #{provider_payout_id}" : ""}"
          )
        end

        return if performed?

        render json: build_settlement_payload.merge(payout: payout.as_payout_json, idempotent_replay: replayed),
               status: replayed ? :ok : :created
      rescue ArgumentError, TypeError
        render json: { error: "amount_cents must be a positive integer" }, status: :unprocessable_entity
      rescue ActiveRecord::RecordNotUnique
        existing = idempotency_key.present? ? @tournament.tournament_payouts.find_by(idempotency_key: idempotency_key) : nil
        if existing
          render json: build_settlement_payload.merge(payout: existing.as_payout_json, idempotent_replay: true), status: :ok
        else
          render json: { error: "Duplicate payout request" }, status: :conflict
        end
      end

      # POST /api/v1/tournaments/:tournament_id/settlement/payouts/:payout_id/mark_paid
      def mark_payout_paid
        payout = nil
        ActiveRecord::Base.transaction(requires_new: true) do
          @tournament.lock!
          payout = @tournament.tournament_payouts.find(params[:payout_id])

          if payout.voided?
            render json: { error: "Cannot mark a voided payout as paid" }, status: :unprocessable_entity
            raise ActiveRecord::Rollback
          end

          if payout.paid?
            render json: build_settlement_payload.merge(payout: payout.as_payout_json), status: :ok
            return
          end

          update_attrs = {
            status: "paid",
            paid_at: parse_timestamp(params[:paid_at]) || Time.current
          }
          if params[:provider_payout_id].present?
            update_attrs[:provider_payout_id] = params[:provider_payout_id].to_s.strip
          end
          if params[:notes].present?
            update_attrs[:notes] = params[:notes].to_s.strip
          end

          payout.update!(update_attrs)
          recalculate_latest_settlement_paid_totals!

          log_activity(
            action: "payout_marked_paid",
            target: payout,
            details: "Marked #{payout.provider} payout of #{format_cents(payout.amount_cents)} as paid#{payout.provider_payout_id ? " ref #{payout.provider_payout_id}" : ""}"
          )
        end

        return if performed?

        render json: build_settlement_payload.merge(payout: payout.as_payout_json), status: :ok
      end

      # POST /api/v1/tournaments/:tournament_id/settlement/payouts/:payout_id/void
      def void_payout
        reason = params[:void_reason].to_s.strip
        if reason.blank?
          return render json: { error: "void_reason is required to void a payout" }, status: :unprocessable_entity
        end

        payout = nil
        ActiveRecord::Base.transaction(requires_new: true) do
          @tournament.lock!
          payout = @tournament.tournament_payouts.find(params[:payout_id])

          if payout.voided?
            render json: { error: "Payout is already voided" }, status: :unprocessable_entity
            raise ActiveRecord::Rollback
          end

          payout.update!(
            status: "voided",
            voided_at: Time.current,
            void_reason: reason
          )
          recalculate_latest_settlement_paid_totals!

          log_activity(
            action: "payout_voided",
            target: payout,
            details: "Voided #{payout.provider} payout of #{format_cents(payout.amount_cents)}: #{reason}"
          )
        end

        return if performed?

        render json: build_settlement_payload.merge(payout: payout.as_payout_json), status: :ok
      end

      private

      def set_tournament
        @tournament = Tournament.includes(:organization).find(params[:tournament_id])
      end

      def authorize_org_admin!
        require_org_admin!(@tournament.organization)
      end

      def require_super_admin!
        return if current_user&.super_admin?

        render json: { error: "Super admin access required to manage settlements and payouts" }, status: :forbidden
      end

      def recalculate_latest_settlement_paid_totals!
        latest = @tournament.tournament_settlements.latest_first.first
        latest&.recalculate_paid_totals!
      end

      def build_settlement_payload
        settlements = @tournament.tournament_settlements.includes(:finalized_by).latest_first.to_a
        latest = settlements.first
        payouts = @tournament.tournament_payouts.includes(:recorded_by).recent_first.to_a
        calc = Settlements::Calculator.call(@tournament, adjustment_cents: latest&.adjustment_cents.to_i)
        payment_config = @tournament.organization.effective_payment_config
        paid_total = payouts.select(&:paid?).sum(&:amount_cents)
        pending_total = payouts.select(&:pending?).sum(&:amount_cents)

        {
          tournament: {
            id: @tournament.id,
            name: @tournament.name,
            slug: @tournament.slug,
            event_date: @tournament.event_date
          },
          payment_mode: payment_config.payment_mode,
          payee_defaults: {
            payee_name: payment_config.payout_payee_name || @tournament.organization.name,
            bank_name: payment_config.payout_bank_name,
            payout_notes: payment_config.payout_notes
          },
          can_manage_payouts: current_user&.super_admin? || false,
          settlement: latest&.as_statement_json(current_source_digest: calc.source_digest),
          live_preview: {
            gross_cents: calc.gross_cents,
            refund_cents: calc.refund_cents,
            processing_fee_cents: calc.processing_fee_cents,
            platform_fee_cents: calc.platform_fee_cents,
            adjustment_cents: calc.adjustment_cents,
            net_cents: calc.net_cents,
            organizer_proceeds_cents: calc.organizer_proceeds_cents,
            paid_cents: paid_total,
            pending_payout_cents: pending_total,
            payable_cents: calc.organizer_proceeds_cents - paid_total,
            breakdown: calc.breakdown_json,
            source_digest: calc.source_digest
          },
          line_items: calc.line_items,
          settlements: settlements.map { |s| s.as_statement_json(current_source_digest: calc.source_digest) },
          payouts: payouts.map(&:as_payout_json)
        }
      end

      def build_ephemeral_settlement(calc)
        paid_total = @tournament.tournament_payouts.where(status: "paid").sum(:amount_cents)
        TournamentSettlement.new(
          organization: @tournament.organization,
          tournament: @tournament,
          version: 0,
          status: "draft",
          currency: "usd",
          gross_cents: calc.gross_cents,
          refund_cents: calc.refund_cents,
          processing_fee_cents: calc.processing_fee_cents,
          platform_fee_cents: calc.platform_fee_cents,
          adjustment_cents: calc.adjustment_cents,
          net_cents: calc.net_cents,
          organizer_proceeds_cents: calc.organizer_proceeds_cents,
          paid_cents: paid_total,
          payable_cents: calc.organizer_proceeds_cents - paid_total,
          breakdown_json: calc.breakdown_json,
          source_digest: calc.source_digest,
          calculated_at: Time.current
        )
      end

      def parse_timestamp(raw)
        return nil if raw.blank?

        Time.zone.parse(raw.to_s)
      rescue ArgumentError
        nil
      end

      def format_cents(cents)
        format("$%.2f", cents.to_i / 100.0)
      end

      def log_activity(action:, target:, details:)
        ActivityLog.create!(
          organization_id: @tournament.organization_id,
          tournament_id: @tournament.id,
          admin_id: current_user&.id,
          action: action,
          target_type: target.class.name,
          target_id: nil,
          target_name: "#{@tournament.name} (v#{target.respond_to?(:version) ? target.version : target.provider_payout_id.presence || target.provider})",
          details: details
        )
      rescue StandardError => e
        Rails.logger.warn("Failed to write settlement ActivityLog: #{e.message}")
      end
    end
  end
end
