# frozen_string_literal: true

require "mini_magick"
require "tempfile"

module Api
  module V1
    class RaffleController < BaseController
      include ImageUploadValidation

      MAX_PRIZE_IMAGE_SIZE = 5.megabytes

      skip_before_action :authenticate_user!, only: [:prizes, :tickets, :board, :check_ticket]
      skip_around_action :with_tenant_rls_context, only: [:draw, :draw_all, :claim_prize, :resend_winner_notification]
      before_action :set_tournament
      before_action :authorize_public_tournament_access!, only: [:prizes, :tickets, :board, :check_ticket]
      before_action :authorize_raffle_prizes_admin!, only: [
        :create_prize, :update_prize, :destroy_prize,
        :mark_ticket_paid, :void_ticket, :destroy_ticket, :sync_tickets
      ]
      before_action :authorize_raffle_draw_access!, only: [
        :draw_readiness, :clear_spotlight,
        :draw, :draw_all, :reset_prize, :claim_prize, :resend_winner_notification
      ]
      before_action :authorize_raffle_sell_access!, only: [
        :admin_tickets, :create_tickets, :sell_tickets, :update_ticket_contact, :resend_ticket_confirmation
      ]
      before_action -> { require_feature!(:raffle) }

      # ===========================================
      # PUBLIC ENDPOINTS
      # ===========================================

      # GET /api/v1/tournaments/:tournament_id/raffle/prizes
      # Public - get all prizes for raffle board
      def prizes
        prizes = raffle_prizes_for_display

        render json: {
          tournament: {
            id: @tournament.id,
            name: @tournament.name,
            raffle_enabled: @tournament.raffle_enabled,
            raffle_ticket_price_cents: @tournament.raffle_ticket_price_cents,
            raffle_draw_time: @tournament.raffle_draw_time,
            raffle_hold_winner_on_screen: @tournament.raffle_hold_winner_on_screen?
          },
          prizes: prizes.map { |p| prize_response(p, include_winner: p.won?) }
        }
      end

      # GET /api/v1/tournaments/:tournament_id/raffle/board
      # Public - get raffle board display data
      def board
        prizes = raffle_prizes_for_display
        
        render json: {
          tournament: {
            id: @tournament.id,
            name: @tournament.name,
            raffle_enabled: @tournament.raffle_enabled,
            raffle_draw_time: @tournament.raffle_draw_time,
            raffle_description: @tournament.raffle_description,
            raffle_hold_winner_on_screen: @tournament.raffle_hold_winner_on_screen?
          },
          prizes: prizes.map { |p| prize_response(p, include_winner: p.won?) },
          stats: {
            total_prizes: prizes.count,
            prizes_won: prizes.won.count,
            prizes_remaining: prizes.available.count,
            total_tickets_sold: @tournament.raffle_tickets.paid.with_eligible_participant.count
          },
          last_updated: Time.current.iso8601
        }
      end

      # GET /api/v1/tournaments/:tournament_id/raffle/check_ticket
      def check_ticket
        response.set_header("Cache-Control", "no-store")
        input = params[:ticket_number]
        number = input.strip.downcase if input.is_a?(String)
        return render json: { error: 'Ticket number is required' }, status: :bad_request if number.blank?
        return render json: { error: 'Ticket number is too long' }, status: :bad_request if number.length > 64

        tickets = @tournament.raffle_tickets
        ticket = tickets.find_by("LOWER(ticket_number) = ?", number)
        eligible = ticket.present? && tickets.paid.with_eligible_participant.exists?(ticket.id)
        prize = @tournament.raffle_prizes.won.find_by(winning_ticket_id: ticket.id) if eligible
        status = if prize
          "winner"
        elsif eligible
          "entered"
        elsif ticket
          "ineligible"
        else
          "not_found"
        end

        render json: {
          found: ticket.present?,
          ticket_number: ticket&.ticket_number || number,
          eligible: eligible,
          status: status,
          prize: prize && {
            id: prize.id,
            name: prize.name,
            tier: prize.tier,
            tier_display: prize.tier_display,
            value_dollars: prize.value_dollars,
            sponsor_name: prize.sponsor_name,
            claimed: prize.claimed?,
            claimed_at: prize.claimed_at&.iso8601
          }
        }
      end

      # GET /api/v1/tournaments/:tournament_id/raffle/tickets
      # Public - look up tickets by email, phone, or ticket number
      def tickets
        query = params[:query].presence || params[:email].presence
        return render json: { error: 'Search query required' }, status: :bad_request unless query.present?

        q = query.strip
        base = @tournament.raffle_tickets.paid.with_eligible_participant

        tickets = base.where(purchaser_email: q.downcase)
                      .or(base.where(purchaser_phone: q))
                      .or(base.where("LOWER(ticket_number) = ?", q.downcase))

        if tickets.empty?
          phone_digits = q.gsub(/\D/, '')
          if phone_digits.length >= 7
            normalized = phone_digits.length == 10 ? "+1#{phone_digits}" : "+#{phone_digits}"
            tickets = base.where(purchaser_phone: normalized)
          end
        end

        render json: {
          query: q,
          ticket_count: tickets.count,
          tickets: tickets.map { |t| ticket_response(t) }
        }
      end

      # ===========================================
      # ADMIN ENDPOINTS - Prizes
      # ===========================================

      # POST /api/v1/tournaments/:tournament_id/raffle/prizes
      # Admin - create a prize
      def create_prize
        prize = @tournament.raffle_prizes.build(prize_attributes)
        prize.image_url = nil if remove_image_requested?
        saved = false

        RafflePrize.transaction(requires_new: true) do
          saved = prize.save
          raise ActiveRecord::Rollback unless saved

          saved = attach_uploaded_image(prize)
          raise ActiveRecord::Rollback unless saved
        end

        if saved
          ActivityLog.log(
            admin: current_user, action: 'raffle_prize_created', target: prize,
            details: "Created raffle prize #{prize.name}",
            metadata: {
              prize_id: prize.id,
              tier: prize.tier,
              value_cents: prize.value_cents,
              image_attached: prize.image.attached?
            },
            tournament: @tournament
          )
          render json: { prize: prize_response(prize), message: 'Prize created' }, status: :created
        else
          render json: { error: prize.errors.full_messages.join(', ') }, status: :unprocessable_entity
        end
      end

      # PATCH /api/v1/tournaments/:tournament_id/raffle/prizes/:id
      # Admin - update a prize
      def update_prize
        prize = @tournament.raffle_prizes.find(params[:id])
        remove_image = remove_image_requested?
        before_snapshot = prize_audit_snapshot(prize)
        image_action = prize_image_audit_action(prize, remove_image)
        blob_to_purge = remove_image && prize.image.attached? ? prize.image.blob : nil
        saved = false

        RafflePrize.transaction(requires_new: true) do
          prize.assign_attributes(prize_attributes)
          prize.image_url = nil if remove_image
          saved = prize.save
          raise ActiveRecord::Rollback unless saved

          prize.image.detach if remove_image && prize.image.attached?
          saved = remove_image ? true : attach_uploaded_image(prize)
          raise ActiveRecord::Rollback unless saved
        end

        if saved
          blob_to_purge&.purge_later
          prize.reload
          log_raffle_prize_updated(prize, before_snapshot: before_snapshot, image_action: image_action)
          render json: { prize: prize_response(prize), message: 'Prize updated' }
        else
          render json: { error: prize.errors.full_messages.join(', ') }, status: :unprocessable_entity
        end
      end

      # DELETE /api/v1/tournaments/:tournament_id/raffle/prizes/:id
      # Admin - delete a prize
      def destroy_prize
        prize = @tournament.raffle_prizes.find(params[:id])

        if prize.won?
          render json: { error: 'Cannot delete a prize that has been won' }, status: :unprocessable_entity
        else
          prize_snapshot = prize_audit_snapshot(prize)
          prize.destroy
          ActivityLog.log(
            admin: current_user, action: 'raffle_prize_deleted', target: prize,
            details: "Deleted raffle prize #{prize_snapshot[:name]}",
            metadata: prize_snapshot.merge(prize_id: prize.id),
            tournament: @tournament
          )
          render json: { message: 'Prize deleted' }
        end
      end

      # ===========================================
      # ADMIN ENDPOINTS - Drawing
      # ===========================================

      # GET /api/v1/tournaments/:tournament_id/raffle/draw_readiness
      # Admin - pre-draw readiness check ("Everyone got their numbers")
      def draw_readiness
        render json: RaffleDrawReadinessService.new(@tournament).report
      end

      # POST /api/v1/tournaments/:tournament_id/raffle/board/clear_spotlight
      # Admin - dismiss the held winner spotlight on the live projector board
      def clear_spotlight
        cleared_at = Time.current.iso8601
        ActionCable.server.broadcast(
          "tournament_#{@tournament.id}_raffle",
          {
            action: 'spotlight_cleared',
            tournament_id: @tournament.id,
            cleared_at: cleared_at
          }
        )

        render json: {
          message: 'Winner spotlight cleared on raffle board',
          cleared_at: cleared_at
        }
      end

      # POST /api/v1/tournaments/:tournament_id/raffle/prizes/:id/draw
      # Admin - draw a winner for a specific prize
      def draw
        prize = nil
        readiness_check = nil
        already_won = false

        with_user_rls_context do
          prize = @tournament.raffle_prizes.find(params[:id])
          if prize.won?
            already_won = true
            next
          end
          readiness_check = evaluate_draw_readiness
        end

        if already_won
          render json: { error: 'Prize already won' }, status: :unprocessable_entity
          return
        end
        return if readiness_check == :blocked

        # Runs OUTSIDE any outer request transaction: draw commits & releases row locks
        # BEFORE broadcasts and Resend/ClickSend winner notifications execute.
        if prize.draw_winner!
          payload = nil
          with_user_rls_context do
            if readiness_check[:override_readiness]
              log_draw_readiness_override!(
                readiness: readiness_check[:readiness],
                target: prize,
                draw_scope: 'single_prize',
                override_reason: readiness_check[:override_reason]
              )
            end

            ActivityLog.log(
              admin: current_user, action: 'raffle_prize_drawn', target: prize,
              details: "Drew winner #{prize.winner_name} (ticket #{prize.winning_ticket&.display_number}) for #{prize.name}",
              metadata: {
                winner_name: prize.winner_name,
                ticket_number: prize.winning_ticket&.ticket_number,
                draw_id: prize.draw_id,
                eligible_ticket_count: prize.draw_eligible_ticket_count,
                readiness_overridden: readiness_check[:override_readiness],
                notification_delivery: delivery_summary_for(prize)
              },
              tournament: @tournament
            )
            payload = {
              prize: prize_response(prize, include_winner: true),
              message: "#{prize.winner_name} won #{prize.name}!"
            }
          end
          render json: payload
        else
          render json: { error: 'No eligible tickets for drawing' }, status: :unprocessable_entity
        end
      end

      # POST /api/v1/tournaments/:tournament_id/raffle/draw_all
      # Admin - draw winners for all remaining prizes
      def draw_all
        available_prizes = nil
        readiness_check = nil

        with_user_rls_context do
          available_prizes = @tournament.raffle_prizes.available.ordered.to_a
          next if available_prizes.empty?

          readiness_check = evaluate_draw_readiness
        end

        if available_prizes.empty?
          render json: { error: 'No prizes remaining to draw' }, status: :unprocessable_entity
          return
        end
        return if readiness_check == :blocked

        # Each prize commits its own short transaction BEFORE broadcasting & notifying
        results = []
        available_prizes.each do |prize|
          if prize.draw_winner!
            results << { prize: prize.name, winner: prize.winner_name, success: true }
          else
            results << { prize: prize.name, winner: nil, success: false, error: 'No eligible tickets' }
          end
        end

        won_count = results.count { |r| r[:success] }
        with_user_rls_context do
          if won_count.positive? && readiness_check[:override_readiness]
            log_draw_readiness_override!(
              readiness: readiness_check[:readiness],
              target: @tournament,
              draw_scope: 'draw_all',
              override_reason: readiness_check[:override_reason]
            )
          end

          ActivityLog.log(
            admin: current_user, action: 'raffle_draw_all', target: @tournament,
            details: "Drew #{won_count} winners from #{results.size} remaining prizes",
            metadata: {
              results: results,
              readiness_overridden: readiness_check[:override_readiness]
            },
            tournament: @tournament
          )
        end

        render json: {
          results: results,
          message: "Drew #{won_count} winners"
        }
      end

      # POST /api/v1/tournaments/:tournament_id/raffle/prizes/:id/reset
      # Admin - reset a prize (undo draw)
      def reset_prize
        prize = @tournament.raffle_prizes.find(params[:id])
        previous_winner = prize.winner_name

        if prize.reset!
          ActivityLog.log(
            admin: current_user, action: 'raffle_prize_reset', target: prize,
            details: "Reset prize #{prize.name} (previous winner: #{previous_winner})",
            metadata: { previous_winner: previous_winner },
            tournament: @tournament
          )
          render json: { prize: prize_response(prize), message: 'Prize reset' }
        else
          render json: { error: 'Cannot reset prize' }, status: :unprocessable_entity
        end
      end

      # POST /api/v1/tournaments/:tournament_id/raffle/prizes/:id/claim
      # Admin - set or clear the claim on a won prize
      def claim_prize
        return unless verify_tenant_match!(@tournament.organization_id, status: :not_found, message: 'Tournament not found')

        claimed = params.fetch(:claimed, true)
        unless [true, false, "true", "false"].include?(claimed)
          return render json: { error: 'Claimed must be true or false' }, status: :bad_request
        end
        claimed = ActiveModel::Type::Boolean.new.cast(claimed)

        claimed_payload = with_user_rls_context do
          prize = @tournament.raffle_prizes.find(params[:id])

          prize.with_lock do
            next unless prize.won?

            if prize.claimed? != claimed
              if claimed
                prize.claim!
              else
                prize.update!(claimed: false, claimed_at: nil)
              end
              ActivityLog.log(
                admin: current_user,
                action: claimed ? 'raffle_prize_claimed' : 'raffle_prize_unclaimed',
                target: prize,
                details: claimed ? "Marked #{prize.name} as claimed" : "Marked #{prize.name} as unclaimed",
                tournament: @tournament
              )
            end

            {
              prize: prize_response(prize).merge(claimed_at: prize.claimed_at&.iso8601),
              message: claimed ? 'Prize marked as claimed' : 'Prize marked as unclaimed'
            }
          end
        end

        if claimed_payload
          render json: claimed_payload
        else
          render json: { error: 'Only won prizes can be marked as claimed or unclaimed' }, status: :unprocessable_entity
        end
      end

      # POST /api/v1/tournaments/:tournament_id/raffle/prizes/:id/resend_notification
      # Admin - resend winner notification email/SMS (external HTTP calls run OUTSIDE DB transaction)
      def resend_winner_notification
        prize = nil
        winner_phone = nil

        with_user_rls_context do
          prize = @tournament.raffle_prizes.includes(:winning_ticket, tournament: :organization).find(params[:id])
          winner_phone = prize.winner_phone.presence || prize.winning_ticket&.purchaser_phone
        end

        unless prize.won?
          return render json: { error: 'Prize has not been won yet' }, status: :unprocessable_entity
        end

        delivery = {
          email: skipped_delivery_result('No winner email available'),
          sms: skipped_delivery_result('No winner phone available')
        }

        if prize.winner_email.present?
          begin
            result = RaffleMailer.winner_email(prize)
            delivery[:email] = normalize_delivery_result(result)
            log_delivery_failure("Resend winner email failed: #{delivery[:email][:error]}", delivery[:email])
          rescue => e
            Rails.logger.error "Resend winner email failed: #{e.message}"
            delivery[:email] = failed_delivery_result(e.message)
          end
        end

        if winner_phone.present?
          begin
            result = RaffleSmsService.winner_notification(raffle_prize: prize)
            delivery[:sms] = normalize_delivery_result(result)
            log_delivery_failure("Resend winner SMS failed: #{delivery[:sms][:error]}", delivery[:sms])
          rescue => e
            Rails.logger.error "Resend winner SMS failed: #{e.message}"
            delivery[:sms] = failed_delivery_result(e.message)
          end
        end

        channels = delivery_success_channels(delivery)

        if channels.any?
          with_user_rls_context do
            ActivityLog.log(
              admin: current_user, action: 'raffle_winner_notification_resent', target: prize,
              details: "Resent winner notification for #{prize.name} to #{prize.winner_name} via #{channels.join(' and ')}",
              metadata: { channels: channels, winner_name: prize.winner_name, delivery: delivery },
              tournament: @tournament
            )
          end
          render json: { message: "Notification resent via #{channels.join(' and ')}", delivery: delivery }
        else
          render json: { error: 'No contact info available for this winner or delivery failed', delivery: delivery }, status: :unprocessable_entity
        end
      end

      # ===========================================
      # ADMIN ENDPOINTS - Tickets
      # ===========================================

      # GET /api/v1/tournaments/:tournament_id/raffle/admin/tickets
      # Admin - list all tickets with search, filter, pagination
      def admin_tickets
        tickets = @tournament.raffle_tickets.includes(:golfer, :raffle_prize, :sold_by_user).recent
        delivery_summary_service = RaffleDeliverySummaryService.new(@tournament)
        needs_attention_ids = delivery_summary_service.needs_attention_ticket_ids

        # Filter by payment status
        tickets = tickets.where(payment_status: params[:status]) if params[:status].present?

        # Filter by type: "purchased", "complimentary", "winners", "voided", "needs_attention"
        case params[:type]
        when 'purchased'
          tickets = tickets.where('price_cents > 0').where.not(payment_status: 'voided')
        when 'complimentary'
          tickets = tickets.where(price_cents: [0, nil]).where.not(payment_status: 'voided')
        when 'winners'
          tickets = tickets.where(is_winner: true)
        when 'voided'
          tickets = tickets.where(payment_status: 'voided')
        when 'needs_attention'
          tickets = tickets.where(id: needs_attention_ids)
        end

        # Search by ticket number, name, email, or phone
        if params[:search].present?
          q = "%#{params[:search].downcase}%"
          tickets = tickets.where(
            "LOWER(ticket_number) LIKE ? OR LOWER(purchaser_name) LIKE ? OR LOWER(purchaser_email) LIKE ? OR purchaser_phone LIKE ?",
            q, q, q, "%#{params[:search]}%"
          )
        end

        # Compute all stats in a single query instead of 8 separate COUNT queries
        stat_row = @tournament.raffle_tickets.pick(
          Arel.sql("COUNT(*) FILTER (WHERE payment_status != 'voided')"),
          Arel.sql("COUNT(*) FILTER (WHERE payment_status = 'paid')"),
          Arel.sql("COUNT(*) FILTER (WHERE payment_status = 'pending')"),
          Arel.sql("COUNT(*) FILTER (WHERE is_winner = true AND payment_status != 'voided')"),
          Arel.sql("COUNT(*) FILTER (WHERE payment_status = 'voided')"),
          Arel.sql("COUNT(*) FILTER (WHERE payment_status != 'voided' AND COALESCE(price_cents, 0) = 0)"),
          Arel.sql("COUNT(*) FILTER (WHERE payment_status = 'paid' AND price_cents > 0)"),
          Arel.sql("COALESCE(SUM(price_cents) FILTER (WHERE payment_status = 'paid' AND price_cents > 0), 0)")
        )

        total_filtered = tickets.count

        page = [params[:page].to_i, 1].max
        per_page = [[params[:per_page].to_i, 1].max, 200].min
        per_page = 50 if params[:per_page].blank?
        paginated = tickets.offset((page - 1) * per_page).limit(per_page)

        render json: {
          tickets: paginated.map { |t|
            ticket_response(t, admin: true, delivery_status: delivery_summary_service.summary_for_ticket(t))
          },
          pagination: {
            page: page,
            per_page: per_page,
            total: total_filtered,
            total_pages: (total_filtered.to_f / per_page).ceil
          },
          stats: {
            total: stat_row[0].to_i,
            paid: stat_row[1].to_i,
            pending: stat_row[2].to_i,
            winners: stat_row[3].to_i,
            voided: stat_row[4].to_i,
            complimentary: stat_row[5].to_i,
            purchased: stat_row[6].to_i,
            needs_attention: needs_attention_ids.size,
            additional_revenue_cents: stat_row[7].to_i
          }
        }
      end

      # POST /api/v1/tournaments/:tournament_id/raffle/tickets
      # Admin - create tickets (manual sale)
      def create_tickets
        quantity = (params[:quantity] || 1).to_i
        if quantity <= 0
          return render json: { error: 'Quantity must be positive' }, status: :unprocessable_entity
        end

        phone_validation = RafflePhoneValidator.validate(params[:purchaser_phone])
        unless phone_validation[:valid]
          return render json: { error: phone_validation[:error] }, status: :unprocessable_entity
        end

        normalized_phone = phone_validation[:normalized]
        tickets = []
        validation_error = nil

        ActiveRecord::Base.transaction(requires_new: true) do
          @tournament.lock!
          quantity.times do
            ticket = @tournament.raffle_tickets.build(
              purchaser_name: params[:purchaser_name]&.strip.presence,
              purchaser_email: params[:purchaser_email]&.strip&.downcase.presence,
              purchaser_phone: normalized_phone,
              golfer_id: params[:golfer_id],
              price_cents: @tournament.raffle_ticket_price_cents,
              payment_status: params[:mark_paid] ? 'paid' : 'pending',
              purchased_at: params[:mark_paid] ? Time.current : nil,
              sold_by_user_id: current_user.id,
              payment_method: params[:payment_method],
              receipt_number: params[:receipt_number],
              payment_notes: params[:payment_notes]
            )

            if ticket.save
              tickets << ticket
            else
              validation_error = ticket.errors.full_messages.join(', ')
              tickets.clear
              raise ActiveRecord::Rollback
            end
          end
        end

        if tickets.any?
          ActivityLog.log(
            admin: current_user, action: 'raffle_tickets_sold', target: @tournament,
            details: "Created #{tickets.count} ticket(s) for #{params[:purchaser_name]}",
            metadata: { quantity: tickets.count, purchaser_name: params[:purchaser_name] },
            tournament: @tournament
          )
          render json: {
            tickets: tickets.map { |t| ticket_response(t) },
            message: "#{tickets.count} ticket(s) created"
          }, status: :created
        else
          render json: { error: validation_error.presence || 'Failed to create tickets' }, status: :unprocessable_entity
        end
      end

      # POST /api/v1/tournaments/:tournament_id/raffle/tickets/:id/mark_paid
      # Admin - mark ticket as paid
      def mark_ticket_paid
        ticket = @tournament.raffle_tickets.find(params[:id])
        previous_status = ticket.payment_status
        ticket.mark_paid!(
          nil,
          method: params[:payment_method],
          receipt_number: params[:receipt_number],
          notes: params[:payment_notes]
        )
        ActivityLog.log(
          admin: current_user, action: 'raffle_ticket_marked_paid', target: ticket,
          details: "Marked raffle ticket #{ticket.display_number} paid (#{ticket.purchaser_display})",
          metadata: {
            ticket_number: ticket.ticket_number,
            purchaser_name: ticket.purchaser_display,
            previous_status: previous_status
          },
          tournament: @tournament
        )

        render json: { ticket: ticket_response(ticket), message: 'Ticket marked as paid' }
      end

      # DELETE /api/v1/tournaments/:tournament_id/raffle/tickets/:id
      # Admin - delete/refund ticket
      def destroy_ticket
        ticket = @tournament.raffle_tickets.find(params[:id])

        if ticket.is_winner?
          render json: { error: 'Cannot delete a winning ticket' }, status: :unprocessable_entity
        else
          ticket_number = ticket.ticket_number
          display_number = ticket.display_number
          purchaser_name = ticket.purchaser_display
          payment_status = ticket.payment_status
          ticket.destroy
          ActivityLog.log(
            admin: current_user, action: 'raffle_ticket_deleted', target: ticket,
            details: "Deleted raffle ticket #{display_number} (#{purchaser_name})",
            metadata: {
              ticket_number: ticket_number,
              purchaser_name: purchaser_name,
              payment_status: payment_status
            },
            tournament: @tournament
          )
          render json: { message: 'Ticket deleted' }
        end
      end

      # POST /api/v1/tournaments/:tournament_id/raffle/tickets/:id/void
      # Admin - void a ticket (keeps record but marks invalid)
      def void_ticket
        ticket = @tournament.raffle_tickets.find(params[:id])

        if ticket.is_winner?
          return render json: { error: 'Cannot void a winning ticket' }, status: :unprocessable_entity
        end

        if ticket.voided?
          return render json: { error: 'Ticket is already voided' }, status: :unprocessable_entity
        end

        ticket.void!(reason: params[:reason])
        ActivityLog.log(
          admin: current_user, action: 'raffle_ticket_voided', target: ticket,
          details: "Voided ticket #{ticket.display_number} (#{ticket.purchaser_display})#{params[:reason].present? ? " — #{params[:reason]}" : ''}",
          metadata: { ticket_number: ticket.ticket_number, reason: params[:reason] },
          tournament: @tournament
        )
        render json: { ticket: ticket_response(ticket, admin: true), message: "Ticket #{ticket.display_number} voided" }
      end

      # POST /api/v1/tournaments/:tournament_id/raffle/sell
      # Volunteer/Admin - quick-sell raffle tickets using bundles or custom qty
      def sell_tickets
        quantity = params[:quantity].to_i
        price_cents = params[:price_cents].to_i
        buyer_name = params[:buyer_name]&.strip.presence
        buyer_email = params[:buyer_email]&.strip&.downcase.presence
        raw_buyer_phone = params[:buyer_phone]&.strip.presence

        unless buyer_name.present?
          return render json: { error: 'Buyer name is required so raffle tickets can be identified during the drawing' }, status: :unprocessable_entity
        end

        phone_validation = RafflePhoneValidator.validate(raw_buyer_phone)
        unless phone_validation[:valid]
          return render json: { error: phone_validation[:error] }, status: :unprocessable_entity
        end
        buyer_phone = phone_validation[:normalized]

        unless buyer_email.present? || buyer_phone.present?
          return render json: { error: 'Email or phone number is required so the buyer can receive their ticket numbers' }, status: :unprocessable_entity
        end

        if quantity <= 0
          return render json: { error: 'Quantity must be positive' }, status: :unprocessable_entity
        end

        if price_cents <= 0
          return render json: { error: 'Price must be positive' }, status: :unprocessable_entity
        end

        base_cents = price_cents / quantity
        remainder = price_cents % quantity

        tickets = []
        sale_time = Time.current
        ActiveRecord::Base.transaction(requires_new: true) do
          @tournament.lock!
          sale_batch = @tournament.raffle_sale_batches.create!(
            buyer_name: buyer_name,
            buyer_email: buyer_email,
            buyer_phone: buyer_phone,
            quantity: quantity,
            total_cents: price_cents,
            payment_method: params[:payment_method].presence || 'swipe_simple',
            receipt_number: params[:receipt_number],
            payment_notes: params[:payment_notes],
            purchased_at: sale_time,
            sold_by_user_id: current_user.id
          )

          quantity.times do |i|
            ticket_price = base_cents + (i == quantity - 1 ? remainder : 0)
            tickets << @tournament.raffle_tickets.create!(
              raffle_sale_batch: sale_batch,
              purchaser_name: buyer_name,
              purchaser_email: buyer_email,
              purchaser_phone: buyer_phone,
              price_cents: ticket_price,
              payment_status: 'paid',
              purchased_at: sale_time,
              sold_by_user_id: current_user.id,
              payment_method: sale_batch.payment_method,
              receipt_number: sale_batch.receipt_number,
              payment_notes: sale_batch.payment_notes
            )
          end
        end

        delivery = send_purchase_notifications(tickets: tickets, buyer_email: buyer_email, buyer_phone: buyer_phone, buyer_name: buyer_name)

        ticket_numbers = tickets.map(&:ticket_number)
        ActivityLog.log(
          admin: current_user, action: 'raffle_tickets_sold', target: @tournament,
          details: "Sold #{tickets.size} ticket(s) for $#{(price_cents / 100.0).round(2)} to #{buyer_name}",
          metadata: { quantity: tickets.size, total_cents: price_cents, buyer_name: buyer_name,
                      buyer_email: buyer_email, buyer_phone: buyer_phone, ticket_numbers: ticket_numbers,
                      delivery: delivery },
          tournament: @tournament
        )

        render json: {
          tickets: tickets.map { |t| ticket_response(t) },
          sale_summary: {
            quantity: tickets.size,
            total_cents: price_cents,
            buyer_name: buyer_name,
            sold_by: current_user.name || current_user.email
          },
          delivery: delivery
        }, status: :created
      rescue ActiveRecord::RecordInvalid => e
        render json: { error: e.message }, status: :unprocessable_entity
      end

      # PATCH /api/v1/tournaments/:tournament_id/raffle/tickets/:id/contact
      # Volunteer/Admin - update buyer contact across the sale batch and optionally resend confirmation
      def update_ticket_contact
        ticket = @tournament.raffle_tickets.find(params[:id])

        if ticket.voided?
          return render json: { error: 'Cannot update contact for a voided ticket' }, status: :unprocessable_entity
        end

        if params.key?(:buyer_name)
          next_name = params[:buyer_name]&.strip.presence
          unless next_name.present?
            return render json: { error: 'Buyer name is required' }, status: :unprocessable_entity
          end
        else
          next_name = ticket.purchaser_display
        end

        next_email = params.key?(:buyer_email) ? params[:buyer_email]&.strip&.downcase.presence : ticket.purchaser_email

        if params.key?(:buyer_phone)
          raw_phone = params[:buyer_phone]&.strip.presence
          phone_validation = RafflePhoneValidator.validate(raw_phone)
          unless phone_validation[:valid]
            return render json: { error: phone_validation[:error] }, status: :unprocessable_entity
          end
          next_phone = phone_validation[:normalized]
        else
          next_phone = ticket.purchaser_phone
        end

        unless next_email.present? || next_phone.present?
          return render json: { error: 'Email or phone number is required so the buyer can receive their ticket numbers' }, status: :unprocessable_entity
        end

        tickets = ticket_batch_siblings(ticket)
        if tickets.empty?
          return render json: { error: 'No active tickets were found for this buyer batch' }, status: :unprocessable_entity
        end

        before_contact = {
          name: ticket.purchaser_display,
          email: ticket.purchaser_email,
          phone: ticket.purchaser_phone
        }

        ActiveRecord::Base.transaction do
          now = Time.current
          ticket_updates = {
            purchaser_name: next_name,
            purchaser_email: next_email,
            updated_at: now
          }
          ticket_updates[:purchaser_phone] = next_phone if params.key?(:buyer_phone)
          RaffleTicket.where(id: tickets.map(&:id)).update_all(ticket_updates)

          if ticket.raffle_sale_batch.present?
            batch_attrs = {
              buyer_name: next_name,
              buyer_email: next_email
            }
            batch_attrs[:buyer_phone] = next_phone if params.key?(:buyer_phone)
            ticket.raffle_sale_batch.update!(batch_attrs)
          end
        end

        tickets.each do |sibling|
          sibling.purchaser_name = next_name
          sibling.purchaser_email = next_email
          sibling.purchaser_phone = next_phone if params.key?(:buyer_phone)
        end

        resend_requested = ActiveModel::Type::Boolean.new.cast(params[:resend])
        delivery = nil
        resent = false
        if resend_requested
          paid_tickets = tickets.select { |t| t.payment_status == 'paid' }
          if paid_tickets.any?
            sms_phone = next_phone.present? ? RafflePhoneValidator.normalize(next_phone) : nil
            delivery = send_purchase_notifications(
              tickets: paid_tickets,
              buyer_email: next_email,
              buyer_phone: sms_phone,
              buyer_name: next_name
            )
            resent = true
          end
        end

        ticket_numbers = tickets.map(&:display_number)
        detail_suffix =
          if resend_requested && resent
            ' and resent confirmation'
          elsif resend_requested
            ' (no paid tickets to resend)'
          else
            ''
          end

        ActivityLog.log(
          admin: current_user,
          action: 'raffle_ticket_contact_updated',
          target: ticket,
          details: "Updated contact for #{tickets.size} raffle ticket#{'s' unless tickets.size == 1} (#{next_name})#{detail_suffix}",
          metadata: {
            source_ticket_id: ticket.id,
            raffle_sale_batch_id: ticket.raffle_sale_batch_id,
            ticket_count: tickets.size,
            ticket_numbers: ticket_numbers,
            before: before_contact,
            after: { name: next_name, email: next_email, phone: next_phone },
            resend_requested: resend_requested,
            resent: resent,
            delivery: delivery
          }.compact,
          tournament: @tournament
        )

        response_message =
          if resend_requested && resent
            "Contact updated across #{tickets.size} ticket#{'s' unless tickets.size == 1} and confirmation sent"
          elsif resend_requested
            "Contact updated across #{tickets.size} ticket#{'s' unless tickets.size == 1} (no paid tickets to resend)"
          else
            "Contact updated across #{tickets.size} ticket#{'s' unless tickets.size == 1}"
          end

        delivery_summary_service = RaffleDeliverySummaryService.new(@tournament)
        render json: {
          message: response_message,
          resent: resent,
          ticket_count: tickets.size,
          ticket_numbers: ticket_numbers,
          buyer: {
            name: next_name,
            email: next_email,
            phone: next_phone
          },
          delivery: delivery,
          tickets: tickets.map { |t|
            ticket_response(t, admin: true, delivery_status: delivery_summary_service.summary_for_ticket(t))
          }
        }
      rescue ActiveRecord::RecordInvalid => e
        render json: { error: e.message }, status: :unprocessable_entity
      end

      # POST /api/v1/tournaments/:tournament_id/raffle/tickets/:id/resend_confirmation
      # Volunteer/Admin - resend the full original sale's ticket numbers to the buyer
      def resend_ticket_confirmation
        ticket = @tournament.raffle_tickets.find(params[:id])

        if ticket.voided?
          return render json: { error: 'Cannot resend confirmation for a voided ticket' }, status: :unprocessable_entity
        end

        buyer_email = params.key?(:buyer_email) ? params[:buyer_email]&.strip&.downcase.presence : ticket.purchaser_email
        raw_buyer_phone = params.key?(:buyer_phone) ? params[:buyer_phone]&.strip.presence : ticket.purchaser_phone
        buyer_name = params.key?(:buyer_name) ? params[:buyer_name]&.strip.presence || ticket.purchaser_display : ticket.purchaser_display

        if raw_buyer_phone.present?
          phone_validation = RafflePhoneValidator.validate(raw_buyer_phone)
          if phone_validation[:valid]
            buyer_phone = phone_validation[:normalized]
          elsif params.key?(:buyer_phone) || buyer_email.blank?
            return render json: { error: phone_validation[:error] }, status: :unprocessable_entity
          else
            buyer_phone = nil
          end
        else
          buyer_phone = nil
        end

        unless buyer_email.present? || buyer_phone.present?
          return render json: { error: 'This ticket has no email or phone number to resend to' }, status: :unprocessable_entity
        end

        tickets = ticket_confirmation_group(ticket)
        if tickets.empty?
          return render json: { error: 'No active paid tickets were found for this buyer group' }, status: :unprocessable_entity
        end

        delivery = send_purchase_notifications(
          tickets: tickets,
          buyer_email: buyer_email,
          buyer_phone: buyer_phone,
          buyer_name: buyer_name
        )

        unless delivery_success?(delivery[:email]) || delivery_success?(delivery[:sms])
          return render json: {
            error: 'Ticket confirmation could not be resent',
            delivery: delivery
          }, status: :bad_gateway
        end

        apply_ticket_contact_updates(
          tickets,
          buyer_name: buyer_name,
          buyer_email: buyer_email,
          buyer_phone: buyer_phone
        )

        ticket_numbers = tickets.map(&:display_number)
        ActivityLog.log(
          admin: current_user,
          action: 'raffle_ticket_confirmation_resent',
          target: ticket,
          details: "Resent #{tickets.size} raffle ticket number#{'s' unless tickets.size == 1} for #{buyer_name}",
          metadata: {
            buyer_name: buyer_name,
            buyer_email: buyer_email,
            buyer_phone: buyer_phone,
            ticket_numbers: ticket_numbers,
            source_ticket_id: ticket.id,
            delivery: delivery
          },
          tournament: @tournament
        )

        render json: {
          message: "Resent #{tickets.size} ticket number#{'s' unless tickets.size == 1}",
          ticket_count: tickets.size,
          ticket_numbers: ticket_numbers,
          buyer: {
            name: buyer_name,
            email: buyer_email,
            phone: buyer_phone
          },
          delivery: delivery,
          tickets: tickets.map { |t| ticket_response(t, admin: true) }
        }
      end

      # POST /api/v1/tournaments/:tournament_id/raffle/sync_tickets
      # Admin - create missing complimentary raffle tickets for active registered golfers
      def sync_tickets
        eligible_golfers = @tournament.golfers
          .active
          .where(registration_status: %w[confirmed pending])

        before_count = @tournament.raffle_tickets.count
        voided_count = 0
        errors = []

        @tournament.raffle_tickets
          .joins(:golfer)
          .where(golfers: { registration_status: %w[cancelled waitlist] }, price_cents: [0, nil])
          .where.not(payment_status: "voided")
          .find_each do |ticket|
            ticket.void!(reason: "Registration not raffle eligible")
            voided_count += 1
          end

        eligible_golfers.find_each do |golfer|
          begin
            golfer.create_raffle_tickets!
          rescue => e
            errors << "#{golfer.name}: #{e.message}"
            Rails.logger.warn("sync_tickets: failed for golfer #{golfer.id}: #{e.message}")
          end
        end

        after_count = @tournament.raffle_tickets.count
        created_count = [after_count - before_count, 0].max

        ActivityLog.log(
          admin: current_user, action: 'raffle_tickets_synced', target: @tournament,
          details: "Synced registration tickets: #{created_count} created, #{voided_count} voided (#{after_count} total for #{eligible_golfers.count} teams)",
          metadata: { created: created_count, voided: voided_count, total: after_count, teams: eligible_golfers.count },
          tournament: @tournament
        )

        render json: {
          message: "Synced: #{created_count} ticket#{'s' unless created_count == 1} created, #{voided_count} voided (#{after_count} total for #{eligible_golfers.count} teams)",
          created: created_count,
          voided: voided_count,
          total_tickets: after_count,
          total_teams: eligible_golfers.count,
          errors: errors.presence
        }
      end

      private

      def set_tournament
        if %w[draw draw_all claim_prize resend_winner_notification].include?(action_name)
          @tournament = with_user_rls_context { Tournament.includes(:organization).find(params[:tournament_id]) }
        else
          @tournament = Tournament.find(params[:tournament_id])
        end
      end

      def authorize_raffle_prizes_admin!
        require_capability!(:manage_raffle_prizes, tournament: @tournament)
      end

      def authorize_raffle_draw_access!
        if %w[draw draw_all claim_prize resend_winner_notification].include?(action_name)
          with_user_rls_context { require_capability!(:raffle_draw, tournament: @tournament) }
        else
          require_capability!(:raffle_draw, tournament: @tournament)
        end
      end

      def authorize_raffle_sell_access!
        require_capability!(:raffle_sell, tournament: @tournament)
      end

      def evaluate_draw_readiness
        enforce_readiness = ActiveModel::Type::Boolean.new.cast(params[:enforce_readiness])
        override_readiness = ActiveModel::Type::Boolean.new.cast(params[:override_readiness])
        override_reason = params[:override_reason].to_s.strip.presence

        unless enforce_readiness || override_readiness
          return { readiness: nil, override_readiness: false, override_reason: nil }
        end

        readiness = RaffleDrawReadinessService.new(@tournament).report

        if enforce_readiness && !readiness[:ready] && !override_readiness
          render json: {
            error: "Pre-draw readiness checks have unresolved warnings",
            readiness: readiness
          }, status: :unprocessable_entity
          return :blocked
        end

        {
          readiness: readiness,
          override_readiness: override_readiness == true,
          override_reason: override_reason
        }
      end

      def log_draw_readiness_override!(readiness:, target:, draw_scope:, override_reason:)
        warning_counts = {
          eligible_ticket_count: readiness[:eligible_ticket_count],
          paid_buyer_batch_count: readiness[:paid_buyer_batch_count],
          confirmed_delivered_count: readiness[:confirmed_delivered_count],
          unconfirmed_delivery_count: readiness[:unconfirmed_delivery_count],
          failed_delivery_count: readiness[:failed_delivery_count],
          missing_name_count: readiness[:missing_name_count]
        }

        summary_parts = []
        summary_parts << "#{readiness[:failed_delivery_count]} failed" if readiness[:failed_delivery_count].to_i.positive?
        summary_parts << "#{readiness[:unconfirmed_delivery_count]} unconfirmed" if readiness[:unconfirmed_delivery_count].to_i.positive?
        summary_parts << "#{readiness[:missing_name_count]} missing name" if readiness[:missing_name_count].to_i.positive?
        summary_text = summary_parts.any? ? summary_parts.join(", ") : "no warnings"
        reason_suffix = override_reason.present? ? " — Reason: #{override_reason}" : ""

        ActivityLog.log(
          admin: current_user,
          action: 'raffle_draw_readiness_overridden',
          target: target,
          details: "Overrode pre-draw readiness check (#{summary_text})#{reason_suffix}",
          metadata: {
            draw_scope: draw_scope,
            prize_id: target.is_a?(RafflePrize) ? target.id : nil,
            prize_name: target.is_a?(RafflePrize) ? target.name : nil,
            override_reason: override_reason,
            ready: readiness[:ready],
            warning_counts: warning_counts
          }.merge(warning_counts).compact,
          tournament: @tournament
        )
      end

      def send_purchase_notifications(tickets:, buyer_email:, buyer_phone:, buyer_name:)
        delivery = {
          email: skipped_delivery_result('No email provided'),
          sms: skipped_delivery_result('No phone number provided')
        }

        if buyer_email.present?
          begin
            result = RaffleMailer.purchase_confirmation_email(
              tickets: tickets, buyer_email: buyer_email,
              buyer_name: buyer_name, tournament: @tournament
            )
            delivery[:email] = normalize_delivery_result(result)
            log_delivery_failure("Raffle purchase email failed: #{delivery[:email][:error]}", delivery[:email])
          rescue => e
            Rails.logger.warn("Raffle purchase email failed: #{e.message}")
            delivery[:email] = failed_delivery_result(e.message)
          end
        end

        if buyer_phone.present?
          begin
            result = RaffleSmsService.purchase_confirmation(
              tickets: tickets, buyer_phone: buyer_phone,
              buyer_name: buyer_name, tournament: @tournament
            )
            delivery[:sms] = normalize_delivery_result(result)
            log_delivery_failure("Raffle purchase SMS failed: #{delivery[:sms][:error]}", delivery[:sms])
          rescue => e
            Rails.logger.warn("Raffle purchase SMS failed: #{e.message}")
            delivery[:sms] = failed_delivery_result(e.message)
          end
        end

        delivery
      end

      def ticket_confirmation_group(ticket)
        scope = @tournament.raffle_tickets.active.paid
        return [] unless scope.exists?(id: ticket.id)

        if ticket.raffle_sale_batch_id.present?
          return scope.where(raffle_sale_batch_id: ticket.raffle_sale_batch_id).order(:sequence_number).to_a
        end

        ticket_numbers = sale_ticket_numbers_for(ticket)
        if ticket_numbers.present?
          return scope.where(ticket_number: ticket_numbers).order(:sequence_number).to_a
        end

        if ticket.golfer_id.present? && ticket.price_cents.to_i.zero?
          return scope.where(golfer_id: ticket.golfer_id, price_cents: [0, nil]).order(:sequence_number).to_a
        end

        if ticket.purchaser_name.blank? && ticket.purchaser_email.blank? && ticket.purchaser_phone.blank?
          return []
        end

        return [ticket] if ticket.purchased_at.blank?

        fallback = scope.where(
          purchaser_name: ticket.purchaser_name,
          purchaser_email: ticket.purchaser_email,
          purchaser_phone: ticket.purchaser_phone
        )

        fallback = fallback.where(purchased_at: (ticket.purchased_at - 2.minutes)..(ticket.purchased_at + 2.minutes))

        fallback.order(:sequence_number).to_a
      end

      def ticket_batch_siblings(ticket)
        return [] if ticket.voided?

        if ticket.raffle_sale_batch_id.present?
          return @tournament.raffle_tickets.active.where(raffle_sale_batch_id: ticket.raffle_sale_batch_id).order(:sequence_number).to_a
        end

        group = ticket_confirmation_group(ticket)
        group.any? ? group : [ ticket ]
      end

      def sale_ticket_numbers_for(ticket)
        ActivityLog
          .where(tournament: @tournament, action: 'raffle_tickets_sold')
          .where("metadata -> 'ticket_numbers' ? :ticket_number", ticket_number: ticket.ticket_number)
          .order(created_at: :desc)
          .each
          .lazy
          .map { |log| Array(log.metadata&.fetch('ticket_numbers', nil)) }
          .find { |numbers| numbers.include?(ticket.ticket_number) }
      end

      def apply_ticket_contact_updates(tickets, buyer_name:, buyer_email:, buyer_phone:)
        updates = {}
        updates[:purchaser_name] = buyer_name if params.key?(:buyer_name) && buyer_name.present?
        updates[:purchaser_email] = buyer_email if params.key?(:buyer_email) && buyer_email.present?
        updates[:purchaser_phone] = buyer_phone if params.key?(:buyer_phone) && buyer_phone.present?
        return if updates.empty?

        now = Time.current
        updates[:updated_at] = now
        RaffleTicket.where(id: tickets.map(&:id)).update_all(updates)

        batch_ids = tickets.map(&:raffle_sale_batch_id).compact.uniq
        if batch_ids.any?
          batch_updates = {}
          batch_updates[:buyer_name] = buyer_name if updates.key?(:purchaser_name)
          batch_updates[:buyer_email] = buyer_email if updates.key?(:purchaser_email)
          batch_updates[:buyer_phone] = buyer_phone if updates.key?(:purchaser_phone)
          batch_updates[:updated_at] = now
          RaffleSaleBatch.where(id: batch_ids).update_all(batch_updates)
        end

        updates.except(:updated_at).each do |attribute, value|
          tickets.each { |ticket| ticket.public_send("#{attribute}=", value) }
        end
      end

      def normalize_delivery_result(result)
        return skipped_delivery_result('Delivery service not configured') if result.nil?
        return failed_delivery_result('No delivery result returned') if result.blank?

        normalized = result.with_indifferent_access
        {
          success: normalized[:success] == true,
          skipped: false,
          status: normalized[:status],
          message_id: normalized[:message_id],
          provider_status_code: normalized[:provider_status_code],
          provider_status_text: normalized[:provider_status_text],
          data: normalized[:data],
          error: normalized[:error]
        }.compact
      end

      def skipped_delivery_result(reason)
        { success: false, skipped: true, error: reason }
      end

      def failed_delivery_result(error)
        { success: false, skipped: false, error: error.presence || 'Delivery failed' }
      end

      def authorize_public_tournament_access!
        return unless verify_tenant_match!(@tournament.organization_id, status: :not_found, message: 'Tournament not found')

        unless @tournament.public_listed? && !@tournament.draft? && !@tournament.archived?
          render json: { error: 'Tournament not found' }, status: :not_found
        end
      end

      def delivery_success?(result)
        result.present? && result[:success] == true
      end

      def log_delivery_failure(message, result)
        return if result.blank? || delivery_success?(result) || result[:skipped] == true

        Rails.logger.error message
      end

      def delivery_success_channels(delivery)
        channels = []
        channels << 'email' if delivery_success?(delivery[:email])
        channels << 'SMS' if delivery_success?(delivery[:sms])
        channels
      end

      def prize_params
        params.require(:prize).permit(
          :name, :description, :value_cents, :tier, :image_url,
          :sponsor_name, :sponsor_logo_url, :position, :image, :remove_image
        )
      end

      def prize_attributes
        prize_params.except(:image, :remove_image)
      end

      def remove_image_requested?
        ActiveModel::Type::Boolean.new.cast(params.dig(:prize, :remove_image))
      end

      def raffle_prizes_for_display
        @tournament.raffle_prizes.with_attached_image.ordered
      end

      def prize_audit_snapshot(prize)
        {
          name: prize.name,
          description: prize.description,
          value_cents: prize.value_cents,
          tier: prize.tier,
          image_url: prize.image_url,
          sponsor_name: prize.sponsor_name,
          sponsor_logo_url: prize.sponsor_logo_url,
          position: prize.position,
          image_attached: prize.image.attached?
        }
      end

      def prize_image_audit_action(prize, remove_image)
        return "removed" if remove_image && prize.image.attached?

        upload = params.dig(:prize, :image)
        return nil unless upload.present? && upload.respond_to?(:tempfile)

        prize.image.attached? ? "replaced" : "added"
      end

      def log_raffle_prize_updated(prize, before_snapshot:, image_action:)
        after_snapshot = prize_audit_snapshot(prize)
        changed_fields = after_snapshot.keys.select { |field| before_snapshot[field] != after_snapshot[field] }
        changed_fields << :image if image_action.present? && !changed_fields.include?(:image)
        changed_fields = changed_fields.map(&:to_s)

        details = if changed_fields.any?
          "Updated raffle prize #{prize.name}: #{changed_fields.join(', ')}"
        else
          "Updated raffle prize #{prize.name}"
        end

        ActivityLog.log(
          admin: current_user, action: 'raffle_prize_updated', target: prize,
          details: details,
          metadata: {
            prize_id: prize.id,
            changed_fields: changed_fields,
            image_action: image_action,
            before: before_snapshot,
            after: after_snapshot
          },
          tournament: @tournament
        )
      end

      def attach_uploaded_image(prize)
        upload = params.dig(:prize, :image)
        return true unless upload.present? && upload.respond_to?(:tempfile)

        if upload.size > MAX_PRIZE_IMAGE_SIZE
          prize.errors.add(:image, "must be smaller than 5MB")
          return false
        end

        content_type = verified_image_content_type(upload)
        unless content_type
          prize.errors.add(:image, "must be a valid JPEG, PNG, GIF, WebP, or AVIF image")
          return false
        end

        upload_io, filename, content_type = prepared_prize_image(upload, content_type)

        prize.image.attach(io: upload_io, filename: filename, content_type: content_type)
        prize.update!(image_url: image_url_for(prize))
        true
      rescue => e
        Rails.logger.error("Failed to attach image to prize #{prize.id}: #{e.message}")
        prize.errors.add(:image, "could not be uploaded")
        false
      ensure
        upload_io&.close! if upload_io.is_a?(Tempfile)
      end

      def prepared_prize_image(upload, content_type)
        return [ upload, upload.original_filename, content_type ] unless content_type == "image/avif"

        normalized_file = Tempfile.new([ File.basename(upload.original_filename, ".*"), ".webp" ])
        normalized_file.binmode

        begin
          image = MiniMagick::Image.open(upload.tempfile.path)
          image.auto_orient
          image.format("webp")
          image.write(normalized_file.path)
          normalized_file.rewind
        rescue MiniMagick::Error, MiniMagick::Invalid
          normalized_file.close!
          raise
        end

        [ normalized_file, "#{File.basename(upload.original_filename, ".*")}.webp", "image/webp" ]
      end

      def image_url_for(prize)
        return prize.image_url unless prize.image.attached?

        Rails.application.routes.url_helpers.rails_blob_url(
          prize.image,
          host: request.base_url
        )
      end

      def prize_response(prize, include_winner: false)
        response = {
          id: prize.id,
          name: prize.name,
          description: prize.description,
          value_cents: prize.value_cents,
          value_dollars: prize.value_dollars,
          tier: prize.tier,
          tier_display: prize.tier_display,
          image_url: image_url_for(prize),
          sponsor_name: prize.sponsor_name,
          sponsor_logo_url: prize.sponsor_logo_url,
          position: prize.position,
          won: prize.won,
          claimed: prize.claimed
        }

        if include_winner && prize.won?
          response[:winner] = {
            name: prize.winner_name.presence || prize.winning_ticket&.purchaser_display,
            won_at: prize.won_at&.iso8601,
            ticket_number: prize.winning_ticket&.display_number
          }
          response[:draw_audit] = {
            draw_id: prize.draw_id,
            eligible_ticket_count: prize.draw_eligible_ticket_count,
            preview_ticket_sample_count: Array(prize.draw_preview_ticket_numbers).length,
            preview_ticket_sample_is_sample: Array(prize.draw_preview_ticket_numbers).length < prize.draw_eligible_ticket_count.to_i
          }
        end

        response
      end

      def delivery_summary_for(prize)
        prize.message_deliveries.recent.limit(5).map do |delivery|
          {
            id: delivery.id,
            channel: delivery.channel,
            provider: delivery.provider,
            purpose: delivery.purpose,
            status: delivery.status,
            recipient: mask_delivery_recipient(delivery.recipient),
            message_id: delivery.provider_message_id,
            error: delivery.error_text,
            created_at: delivery.created_at&.iso8601
          }
        end
      end

      def mask_delivery_recipient(recipient)
        value = recipient.to_s
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

      def ticket_response(ticket, admin: false, delivery_status: nil)
        response = {
          id: ticket.id,
          ticket_number: ticket.display_number,
          purchaser_name: ticket.purchaser_display,
          payment_status: ticket.payment_status,
          is_winner: ticket.is_winner,
          purchased_at: ticket.purchased_at&.iso8601
        }

        if admin
          response[:purchaser_email] = ticket.purchaser_email
          response[:purchaser_phone] = ticket.purchaser_phone
          response[:raffle_sale_batch_id] = ticket.raffle_sale_batch_id
          response[:golfer_id] = ticket.golfer_id
          response[:golfer_name] = ticket.golfer&.name
          response[:price_cents] = ticket.price_cents
          response[:payment_method] = ticket.payment_method
          response[:receipt_number] = ticket.receipt_number
          response[:payment_notes] = ticket.payment_notes
          response[:stripe_payment_intent_id] = ticket.stripe_payment_intent_id
          response[:prize_won] = ticket.raffle_prize&.name if ticket.is_winner?
          response[:voided_at] = ticket.voided_at&.iso8601
          response[:void_reason] = ticket.void_reason
          response[:sold_by] = ticket.sold_by_user&.name
          response[:created_at] = ticket.created_at&.iso8601
          response[:delivery_status] = delivery_status if delivery_status.present?
        end

        response
      end
    end
  end
end
