module Api
  module V1
    class GolfersController < BaseController
      skip_before_action :authenticate_user!, only: [:create, :registration_status]
      skip_around_action :with_tenant_rls_context, only: [:create, :refund]
      before_action :authorize_collection_volunteer_access!, only: [:index]
      before_action :authorize_collection_stats_access!, only: [:stats]
      before_action :authorize_collection_finance_access!, only: [:bulk_send_payment_links]
      before_action :authorize_golfer_checkin_access!, only: [:check_in, :undo_check_in, :promote_and_checkin]
      before_action :authorize_golfer_door_payment_access!, only: [:verify_payment]
      before_action :authorize_golfer_finance_access!, only: [:payment_details, :refund, :mark_refunded, :send_payment_link, :update_payment_status, :mark_paid]
      before_action :authorize_golfer_manage_access!, only: [:show, :update, :destroy, :cancel, :promote, :demote]

      VALID_CHECKIN_PAYMENT_METHODS = %w[
        cash check credit card stripe swipe_simple swipe_simple_confirmed other
      ].freeze

      # GET /api/v1/golfers
      def index
        tournament = find_tournament
        return render_tournament_required unless tournament

        golfers = tournament.golfers.includes(:group, golfer_add_ons: :tournament_add_on)

        # Apply filters
        golfers = golfers.where(payment_status: params[:payment_status]) if params[:payment_status].present?
        golfers = golfers.where(payment_type: params[:payment_type]) if params[:payment_type].present?
        golfers = golfers.where(registration_status: params[:registration_status]) if params[:registration_status].present?

        if params[:checked_in].present?
          golfers = params[:checked_in] == "true" ? golfers.checked_in : golfers.not_checked_in
        end

        if params[:assigned].present?
          golfers = params[:assigned] == "true" ? golfers.assigned : golfers.unassigned
        end

        golfers = golfers.where(hole_number: params[:hole_number]) if params[:hole_number].present?
        golfers = golfers.joins(:group).where(groups: { group_number: params[:group_number] }) if params[:group_number].present?

        # Search
        if params[:search].present?
          search_term = "%#{params[:search]}%"
          golfers = golfers.where(
            "name ILIKE :search OR email ILIKE :search OR phone ILIKE :search OR mobile ILIKE :search",
            search: search_term
          )
        end

        # Sorting
        sort_by = params[:sort_by] || "created_at"
        sort_order = params[:sort_order] || "desc"
        allowed_sorts = %w[name email created_at payment_status registration_status checked_in_at]
        sort_by = "created_at" unless allowed_sorts.include?(sort_by)
        sort_order = "desc" unless %w[asc desc].include?(sort_order)

        golfers = golfers.order("#{sort_by} #{sort_order}")

        # Paginate
        golfers = paginate(golfers)

        render json: {
          golfers: ActiveModelSerializers::SerializableResource.new(golfers),
          meta: pagination_meta(golfers)
        }
      end

      # GET /api/v1/golfers/:id
      def show
        golfer = Golfer.includes(:group, golfer_add_ons: :tournament_add_on).find(params[:id])
        render json: golfer
      end

      # POST /api/v1/golfers
      # Public registration endpoint
      # Uses database locking to prevent race conditions
      def create
        org = resolve_public_organization
        result = nil
        error_response = nil
        tournament_missing = false

        raw_employee_number = params[:employee_number].presence || params.dig(:golfer, :employee_number).presence
        requested_employee = ActiveModel::Type::Boolean.new.cast(params[:is_employee]) ||
                             ActiveModel::Type::Boolean.new.cast(params.dig(:golfer, :is_employee)) ||
                             raw_employee_number.present?

        run_in_public_rls_context(org) do
          # Find specific tournament scoped to resolved tenant organization
          tournament = resolve_public_tournament(tournament_id: params[:tournament_id])

          unless tournament
            tournament_missing = true
            next
          end

          employee_pricing_enabled = Features.for(tournament.organization, tournament).enabled?(:employee_pricing)

          if requested_employee && !employee_pricing_enabled
            error_response = {
              error: "Feature 'employee_pricing' is disabled for this event",
              errors: ["Feature 'employee_pricing' is disabled for this event"],
              feature: "employee_pricing",
              status: :forbidden
            }
            next
          end

          if requested_employee && tournament.employee_entry_fee.blank?
            error_response = {
              error: "Employee pricing fee is not configured for this event.",
              errors: ["Employee pricing fee is not configured for this event."],
              status: :unprocessable_entity
            }
            next
          end

          # Wrap in transaction with row locking to prevent race conditions
          ActiveRecord::Base.transaction(requires_new: true) do
            # Lock the tournament row to prevent concurrent capacity checks
            tournament.lock!

            golfer = tournament.golfers.new(golfer_params)
            if tournament.waiver_enabled? && ActiveModel::Type::Boolean.new.cast(params[:waiver_accepted])
              golfer.waiver_accepted_at = Time.current
            end
            if tournament.waiver_enabled? && golfer.partner_name.present? && ActiveModel::Type::Boolean.new.cast(params[:partner_waiver_accepted])
              golfer.partner_waiver_accepted_at = Time.current
            else
              golfer.partner_waiver_accepted_at = nil
            end
            incoming_players = golfer.partner_name.present? ? 2 : 1

            # Re-check unified registration capacity (golfers + registrations/team_members) after acquiring lock
            unless tournament.can_accept_public_registration?(player_count: incoming_players)
              error_response = { errors: ["Registration is currently closed."], status: :unprocessable_entity }
              raise ActiveRecord::Rollback
            end

            if tournament.waiver_enabled? && golfer.waiver_accepted_at.blank?
              error_response = { errors: ["Waiver accepted at can't be blank"], status: :unprocessable_entity }
              raise ActiveRecord::Rollback
            end

            employee_record = nil
            if requested_employee
              if raw_employee_number.blank?
                error_response = { errors: ["Employee number is required for employee pricing."], status: :unprocessable_entity }
                raise ActiveRecord::Rollback
              end

              employee_record = EmployeeNumber.find_for_tournament(tournament, raw_employee_number)
              unless employee_record
                error_response = { errors: ["Invalid employee number."], status: :unprocessable_entity }
                raise ActiveRecord::Rollback
              end

              employee_record.lock!
              if employee_record.used?
                error_response = { errors: ["This employee number has already been used."], status: :unprocessable_entity }
                raise ActiveRecord::Rollback
              end
            end

            add_ons_result = AddOns::SelectionBuilder.resolve!(
              tournament: tournament,
              raw_add_ons: params[:add_ons].presence || params.dig(:golfer, :add_ons)
            )
            unless add_ons_result.ok?
              error_response = { errors: add_ons_result.errors, status: :unprocessable_entity }
              raise ActiveRecord::Rollback
            end

            if employee_record
              golfer.is_employee = true
              golfer.employee_number_record = employee_record
              golfer.payment_amount_cents = tournament.employee_entry_fee.to_i + add_ons_result.total_cents if tournament.employee_entry_fee.present?
            else
              golfer.is_employee = false
              golfer.employee_number_record = nil
              if add_ons_result.total_cents.positive?
                golfer.payment_amount_cents = golfer.expected_entry_fee_cents + add_ons_result.total_cents
              end
            end
            if golfer.save
              if add_ons_result.items.any?
                AddOns::SelectionBuilder.attach!(
                  items: add_ons_result.items,
                  tournament: tournament,
                  golfer: golfer
                )
              end

              if employee_record
                begin
                  employee_record.claim!(golfer)
                rescue EmployeeNumber::AlreadyClaimedError
                  error_response = { errors: ["This employee number has already been used."], status: :unprocessable_entity }
                  raise ActiveRecord::Rollback
                end
              end

              if %w[stripe swipe_simple walk_in].include?(golfer.payment_type)
                golfer.generate_payment_token!
              end

              result = {
                golfer: golfer,
                message: golfer.registration_status == "confirmed" ?
                  "Your spot is confirmed!" :
                  "You have been added to the waitlist."
              }
            else
              error_response = { errors: golfer.errors.full_messages, status: :unprocessable_entity }
              raise ActiveRecord::Rollback
            end
          end
        end

        if tournament_missing
          render json: { errors: ["No tournament is currently open for registration."] }, status: :unprocessable_entity
          return
        end

        # Handle response & broadcasts AFTER transaction commits
        if error_response
          payload = { errors: error_response[:errors] }
          payload[:error] = error_response[:error] if error_response[:error].present?
          payload[:feature] = error_response[:feature] if error_response[:feature].present?
          render json: payload, status: error_response[:status]
        elsif result
          # Serialize inside org RLS context so lazy associations work under non-owner RLS
          serialized_golfer = TenantContext.with_organization(result[:golfer].tournament.organization_id) do
            GolferSerializer.new(result[:golfer]).as_json
          end

          # Broadcast after transaction commits (non-critical)
          broadcast_golfer_update(result[:golfer])

          render json: {
            golfer: serialized_golfer,
            message: result[:message]
          }, status: :created
        end
      end

      # PATCH /api/v1/golfers/:id
      def update
        golfer = Golfer.find(params[:id])
        old_values = golfer.attributes.slice('group_id', 'payment_status', 'registration_status', 'name', 'email', 'phone', 'company', 'address', 'payment_notes')
        permitted = golfer_update_params

        if permitted[:group_id].present? && !golfer.tournament.groups.exists?(id: permitted[:group_id])
          render json: { errors: ["Group must belong to the same tournament"] }, status: :unprocessable_entity
          return
        end

        if permitted[:sponsor_id].present? && !golfer.tournament.sponsors.exists?(id: permitted[:sponsor_id])
          render json: { errors: ["Sponsor must belong to the same tournament"] }, status: :unprocessable_entity
          return
        end

        if permitted.key?(:is_employee)
          requested_is_employee = ActiveModel::Type::Boolean.new.cast(permitted[:is_employee])
          if requested_is_employee && golfer.employee_number_record_id.blank?
            render json: { errors: ["Cannot enable employee pricing without claiming a valid employee number"] }, status: :unprocessable_entity
            return
          end
        end

        updated = false
        ActiveRecord::Base.transaction(requires_new: true) do
          if golfer.update(permitted)
            if permitted.key?(:is_employee) && ActiveModel::Type::Boolean.new.cast(permitted[:is_employee]) == false
              golfer.release_employee_number!
            end
            updated = true
          else
            raise ActiveRecord::Rollback
          end
        end

        if updated
          # Log activity for meaningful changes
          log_golfer_update(golfer, old_values)
          broadcast_golfer_update(golfer)
          render json: golfer
        else
          render json: { errors: golfer.errors.full_messages }, status: :unprocessable_entity
        end
      end

      # DELETE /api/v1/golfers/:id
      # NOTE: Delete is intentionally not exposed in the UI.
      # Use cancel/refund instead to maintain audit trail.
      # This endpoint exists only for developer/console use if absolutely needed.
      def destroy
        golfer = Golfer.find(params[:id])
        golfer_name = golfer.name
        tournament = golfer.tournament
        golfer.destroy
        
        ActivityLog.log(
          admin: current_admin,
          action: 'golfer_deleted',
          target: nil,
          tournament: tournament,
          details: "Deleted golfer: #{golfer_name}",
          metadata: { golfer_name: golfer_name }
        )
        
        broadcast_golfer_update(golfer, action: "deleted")
        head :no_content
      end

      # POST /api/v1/golfers/:id/cancel
      # Cancel a golfer's registration (without refund)
      def cancel
        golfer = Golfer.find(params[:id])

        unless golfer.can_cancel?
          render json: { error: "Golfer is already cancelled" }, status: :unprocessable_entity
          return
        end

        # If they paid via Stripe, they should use refund instead
        if golfer.payment_status == "paid" && golfer.payment_type == "stripe"
          render json: { error: "This golfer paid via Stripe. Use refund instead to process their cancellation." }, status: :unprocessable_entity
          return
        end

        reason = params[:reason]
        old_group = golfer.group

        Golfer.transaction do
          # CRITICAL: Remove from group first (cancelled golfers shouldn't hold spots)
          golfer.clear_group_assignment! if old_group.present?

          # CRITICAL: Cancel the golfer
          golfer.cancel!(admin: current_admin, reason: reason)
        end

        # CRITICAL: Return success response FIRST before non-critical operations
        render json: golfer
        
        # NON-CRITICAL: Log group removal
        if old_group.present?
          begin
            ActivityLog.log(
              admin: current_admin,
              action: 'golfer_removed_from_group',
              target: golfer,
              details: "Removed #{golfer.name} from #{old_group.hole_position_label} (cancelled)"
            )
          rescue StandardError => e
            Rails.logger.error("Failed to log group removal: #{e.message}")
          end
        end

        # NON-CRITICAL: Send cancellation email (wrapped in rescue)
        begin
          GolferMailer.cancellation_email(golfer).deliver_later
        rescue StandardError => e
          Rails.logger.error("Failed to send cancellation email: #{e.message}")
        end

        # NON-CRITICAL: Log activity (wrapped in rescue)
        begin
          ActivityLog.log(
            admin: current_admin,
            action: 'golfer_cancelled',
            target: golfer,
            details: "Cancelled registration for #{golfer.name}",
            metadata: { reason: reason }
          )
        rescue StandardError => e
          Rails.logger.error("Failed to log cancellation activity: #{e.message}")
        end

        # NON-CRITICAL: Broadcast update (wrapped in rescue)
        broadcast_golfer_update(golfer)
      end

      # POST /api/v1/golfers/:id/refund
      # Process a refund through Stripe and cancel the registration.
      # Runs OUTSIDE any outer request transaction so Stripe::Refund.create never holds a DB transaction.
      def refund
        golfer = nil
        old_group = nil
        with_user_rls_context do
          golfer = Golfer.includes(:group, :tournament).find(params[:id])
          old_group = golfer.group
        end

        unless golfer.can_refund?
          if golfer.refunded?
            render json: { error: "This golfer has already been refunded" }, status: :unprocessable_entity
          elsif golfer.payment_type != "stripe"
            render json: { error: "This golfer did not pay via Stripe. Use cancel instead." }, status: :unprocessable_entity
          elsif golfer.payment_status != "paid"
            render json: { error: "This golfer has not paid yet. Use cancel instead." }, status: :unprocessable_entity
          else
            render json: { error: "Cannot process refund for this golfer" }, status: :unprocessable_entity
          end
          return
        end

        reason = params[:reason]

        begin
          # CRITICAL: Process the refund first (Stripe HTTP outside DB tx, then short org-scoped DB tx)
          stripe_refund = golfer.process_refund!(
            admin: current_admin,
            reason: reason,
            clear_group_assignment: old_group.present?
          )

          serialized_golfer = with_user_rls_context { GolferSerializer.new(golfer).as_json }

          # CRITICAL: Return success response FIRST before non-critical operations
          render json: {
            success: true,
            golfer: serialized_golfer,
            refund: {
              id: stripe_refund.id,
              amount: stripe_refund.amount,
              status: stripe_refund.status
            },
            message: "Refund processed successfully"
          }

          # NON-CRITICAL: Log group removal & refund inside short RLS context (wrapped in rescue)
          with_user_rls_context do
            if old_group.present?
              begin
                ActivityLog.log(
                  admin: current_admin,
                  action: 'golfer_removed_from_group',
                  target: golfer,
                  details: "Removed #{golfer.name} from #{old_group.hole_position_label} (refunded)"
                )
              rescue StandardError => e
                Rails.logger.error("Failed to log group removal: #{e.message}")
              end
            end

            begin
              ActivityLog.log(
                admin: current_admin,
                action: 'golfer_refunded',
                target: golfer,
                details: "Refunded #{golfer.name} - $#{'%.2f' % (stripe_refund.amount / 100.0)}",
                metadata: {
                  reason: reason,
                  refund_id: stripe_refund.id,
                  amount_cents: stripe_refund.amount
                }
              )
            rescue StandardError => e
              Rails.logger.error("Failed to log refund activity: #{e.message}")
            end
          end

          # NON-CRITICAL: Broadcast update AFTER commit (already wrapped in rescue in helper method)
          broadcast_golfer_update(golfer)

        rescue Stripe::StripeError => e
          # CRITICAL: Stripe refund failed - this is a real error
          Rails.logger.error("Stripe refund error: #{e.message}")
          render json: { error: "Stripe refund failed: #{e.message}" }, status: :unprocessable_entity
        rescue ActiveRecord::RecordInvalid => e
          # CRITICAL: Database update failed - this is a real error
          Rails.logger.error("Refund database error: #{e.message}")
          render json: { error: "Failed to update golfer record: #{e.message}" }, status: :unprocessable_entity
        end
      end

      # POST /api/v1/golfers/:id/mark_refunded
      # For non-Stripe payments (cash/check) where refund was processed manually
      def mark_refunded
        golfer = Golfer.find(params[:id])

        if golfer.refunded?
          render json: { error: "This golfer has already been refunded" }, status: :unprocessable_entity
          return
        end

        if golfer.payment_type == "stripe" && golfer.payment_status == "paid"
          render json: { error: "This golfer paid via Stripe. Use the refund action to process through Stripe." }, status: :unprocessable_entity
          return
        end

        reason = params[:reason]
        refund_amount = params[:refund_amount_cents] || golfer.payment_amount_cents || golfer.tournament&.entry_fee
        old_group = golfer.group

        Golfer.transaction do
          # CRITICAL: Remove from group first (refunded golfers shouldn't hold spots)
          golfer.clear_group_assignment! if old_group.present?
          golfer.release_employee_number!

          # CRITICAL: Update the golfer record
          golfer.update!(
            registration_status: "cancelled",
            payment_status: "refunded",
            refund_amount_cents: refund_amount,
            refund_reason: reason,
            refunded_at: Time.current,
            refunded_by: current_admin
          )
        end

        # CRITICAL: Return success response FIRST
        render json: golfer
        
        # NON-CRITICAL: Log group removal if applicable
        if old_group.present?
          begin
            ActivityLog.log(
              admin: current_admin,
              action: 'golfer_removed_from_group',
              target: golfer,
              details: "Removed #{golfer.name} from #{old_group.hole_position_label} (refunded)"
            )
          rescue StandardError => e
            Rails.logger.error("Failed to log group removal: #{e.message}")
          end
        end

        # NON-CRITICAL: Send refund notification email
        begin
          GolferMailer.refund_confirmation_email(golfer).deliver_later
        rescue StandardError => e
          Rails.logger.error("Failed to send refund email: #{e.message}")
        end

        # NON-CRITICAL: Log activity
        begin
          ActivityLog.log(
            admin: current_admin,
            action: 'golfer_refunded',
            target: golfer,
            details: "Marked #{golfer.name} as refunded (manual) - $#{'%.2f' % (refund_amount.to_i / 100.0)}",
            metadata: { reason: reason, amount_cents: refund_amount }
          )
        rescue StandardError => e
          Rails.logger.error("Failed to log manual refund activity: #{e.message}")
        end

        # NON-CRITICAL: Broadcast update
        broadcast_golfer_update(golfer)
      end

      # POST /api/v1/golfers/:id/check_in
      def check_in
        golfer = Golfer.find(params[:id])
        checked_in_now = false
        golfer.with_lock do
          checked_in_now = !golfer.checked_in?
          golfer.check_in!(admin: current_admin)
        end

        if checked_in_now
          ActivityLog.log(
            admin: current_admin,
            action: 'golfer_checked_in',
            target: golfer,
            details: "Checked in #{golfer.name}"
          )
        end

        broadcast_golfer_update(golfer)
        render json: golfer
      end

      # POST /api/v1/golfers/:id/verify_payment
      def verify_payment
        golfer = Golfer.find(params[:id])

        unless golfer.payment_status == 'paid'
          golfer.verify_payment!(
            admin: current_admin,
            method: params[:payment_method] || 'swipe_simple_confirmed',
            notes: params[:notes]
          )

          begin
            ActivityLog.log(
              admin: current_admin,
              action: 'payment_verified',
              target: golfer,
              details: "Verified payment for #{golfer.name} (#{params[:payment_method] || 'SwipeSimple'})"
            )
          rescue => e
            Rails.logger.warn("Failed to log payment_verified activity: #{e.message}")
          end

          if golfer.email.present?
            GolferMailer.payment_confirmation_email(golfer).deliver_later rescue nil
          end

          begin
            golfer.create_raffle_tickets!
            golfer.create_purchased_raffle_tickets!
          rescue => e
            Rails.logger.warn("Failed to create raffle tickets for #{golfer.name}: #{e.message}")
          end

          broadcast_golfer_update(golfer)
        end

        render json: golfer
      end

      # POST /api/v1/golfers/:id/mark_waiver_signed
      def mark_waiver_signed
        golfer = Golfer.find(params[:id])
        require_any_capability!(:check_in, :manage_golfers, tournament: golfer.tournament)
        return if performed?
        return unless verify_tenant_match!(golfer.tournament.organization_id, status: :forbidden)

        unless golfer.tournament.waiver_enabled?
          return render json: { error: "Waivers are disabled for this tournament" }, status: :unprocessable_entity
        end

        partner = ActiveModel::Type::Boolean.new.cast(params[:partner]) == true
        if partner && golfer.partner_name.blank?
          return render json: { error: "This registration has no partner" }, status: :unprocessable_entity
        end

        Waivers::RecordSignature.call(golfer, staff: current_user, partner: partner)
        render json: golfer
      end

      # POST /api/v1/golfers/:id/undo_check_in
      def undo_check_in
        golfer = Golfer.find(params[:id])

        unchecked_now = false
        golfer.with_lock do
          unchecked_now = golfer.checked_in?
          golfer.undo_check_in! if unchecked_now
        end

        unless unchecked_now
          render json: { error: 'Golfer is not checked in' }, status: :unprocessable_entity
          return
        end

        ActivityLog.log(
          admin: current_admin,
          action: 'golfer_unchecked',
          target: golfer,
          details: "Unchecked #{golfer.name}"
        )

        broadcast_golfer_update(golfer)
        render json: golfer
      end

      # POST /api/v1/golfers/:id/payment_details
      def payment_details
        golfer = Golfer.find(params[:id])
        old_status = golfer.payment_status
        
        # Calculate the payment amount
        payment_amount = golfer.expected_entry_fee_cents

        golfer.update!(
          golfer.paid_registration_attributes(
            payment_status: "paid",
            payment_method: params[:payment_method],
            receipt_number: params[:receipt_number],
            payment_notes: params[:payment_notes],
            payment_amount_cents: payment_amount,
            paid_at: Time.current
          )
        )

        ActivityLog.log(
          admin: current_admin,
          action: 'payment_marked',
          target: golfer,
          details: "Marked #{golfer.name} as paid (#{params[:payment_method]}) - $#{format('%.2f', payment_amount / 100.0)}",
          metadata: {
            payment_method: params[:payment_method],
            receipt_number: params[:receipt_number],
            previous_status: old_status,
            payment_amount_cents: payment_amount
          }
        )

        # Send payment confirmation email
        if golfer.email.present?
          GolferMailer.payment_confirmation_email(golfer).deliver_later
        end

        broadcast_golfer_update(golfer)
        render json: golfer
      end

      # POST /api/v1/golfers/:id/promote
      # Promote from waitlist to confirmed
      def promote
        golfer = Golfer.find(params[:id])

        unless golfer.registration_status == "waitlist"
          render json: { error: "Golfer is not on the waitlist" }, status: :unprocessable_entity
          return
        end

        golfer.assign_attributes(registration_status: "confirmed")
        golfer.save!(validate: false)

        GolferMailer.promotion_email(golfer).deliver_later rescue nil

        begin
          ActivityLog.log(
            admin: current_admin,
            action: 'golfer_promoted',
            target: golfer,
            details: "Promoted #{golfer.name} from waitlist to confirmed"
          )
        rescue => e
          Rails.logger.warn("Failed to log golfer_promoted activity: #{e.message}")
        end

        broadcast_golfer_update(golfer)
        render json: golfer
      end

      # POST /api/v1/golfers/:id/promote_and_checkin
      # Atomically promotes a waitlisted golfer, optionally records payment, and checks them in.
      def promote_and_checkin
        golfer = Golfer.includes(:tournament, :group, :employee_number_record).find(params[:id])
        error_response = nil
        newly_paid = false

        ActiveRecord::Base.transaction(requires_new: true) do
          golfer.lock!

          if golfer.cancelled?
            error_response = { error: "Cannot promote a cancelled golfer", status: :unprocessable_entity }
            raise ActiveRecord::Rollback
          end

          should_mark_paid = if params.key?(:mark_paid)
            ActiveModel::Type::Boolean.new.cast(params[:mark_paid])
          else
            params[:payment_method].present? ||
              params[:payment_amount_cents].present? ||
              params[:receipt_number].present?
          end

          now = Time.current
          admin_name = current_admin&.name || current_admin&.email
          previous_registration_status = golfer.registration_status
          previous_payment_status = golfer.payment_status

          attrs = {
            registration_status: "confirmed",
            checked_in_at: golfer.checked_in_at || now,
            checked_in_by_id: golfer.checked_in_by_id || current_admin&.id,
            checked_in_by_name: golfer.checked_in_by_name || admin_name
          }

          if should_mark_paid
            if golfer.payment_status == "paid"
              error_response = {
                error: "Golfer is already marked as paid; pass mark_paid: false to promote and check in without overwriting payment details",
                status: :unprocessable_entity
              }
              raise ActiveRecord::Rollback
            end

            payment_method = params[:payment_method].to_s.strip.presence
            if payment_method.blank?
              error_response = { error: "Payment method is required when recording payment", status: :unprocessable_entity }
              raise ActiveRecord::Rollback
            end

            unless VALID_CHECKIN_PAYMENT_METHODS.include?(payment_method)
              error_response = {
                error: "Invalid payment method '#{payment_method}'",
                status: :unprocessable_entity
              }
              raise ActiveRecord::Rollback
            end

            amount_cents = if params.key?(:payment_amount_cents) && params[:payment_amount_cents].present?
              raw_amount = params[:payment_amount_cents]
              unless raw_amount.is_a?(Integer) || raw_amount.to_s.match?(/\A\d+\z/)
                error_response = {
                  error: "Payment amount must be a non-negative integer (in cents)",
                  status: :unprocessable_entity
                }
                raise ActiveRecord::Rollback
              end
              raw_amount.to_i
            else
              golfer.payment_amount_cents.presence || golfer.expected_entry_fee_cents
            end

            if amount_cents.negative?
              error_response = {
                error: "Payment amount must be a non-negative integer (in cents)",
                status: :unprocessable_entity
              }
              raise ActiveRecord::Rollback
            end

            newly_paid = golfer.payment_status != "paid"
            attrs.merge!(
              payment_status: "paid",
              payment_method: payment_method,
              receipt_number: params[:receipt_number].presence || golfer.receipt_number,
              payment_notes: params[:payment_notes].presence || golfer.payment_notes,
              payment_amount_cents: amount_cents,
              paid_at: golfer.paid_at || now,
              payment_verified_by_id: current_admin&.id,
              payment_verified_by_name: admin_name,
              payment_verified_at: now
            )
          end

          golfer.assign_attributes(attrs)
          unless golfer.save
            error_response = {
              error: golfer.errors.full_messages.join(", "),
              errors: golfer.errors.full_messages,
              status: :unprocessable_entity
            }
            raise ActiveRecord::Rollback
          end

          details_parts = ["Promoted"]
          details_parts << "paid (#{attrs[:payment_method]})" if should_mark_paid
          details_parts << "checked in"
          ActivityLog.log(
            admin: current_admin,
            action: "golfer_promoted_and_checked_in",
            target: golfer,
            tournament: golfer.tournament,
            details: "#{details_parts.join(', ')} #{golfer.name}",
            metadata: {
              previous_registration_status: previous_registration_status,
              previous_payment_status: previous_payment_status,
              marked_paid: should_mark_paid,
              payment_method: attrs[:payment_method],
              receipt_number: attrs[:receipt_number],
              payment_amount_cents: attrs[:payment_amount_cents]
            }
          )
        end

        if error_response
          payload = { error: error_response[:error] }
          payload[:errors] = error_response[:errors] if error_response[:errors].present?
          render json: payload, status: error_response[:status]
          return
        end

        if newly_paid
          begin
            golfer.create_raffle_tickets!
            golfer.create_purchased_raffle_tickets!
          rescue StandardError => e
            Rails.logger.warn("Failed to create raffle tickets for #{golfer.name}: #{e.message}")
          end
        end

        broadcast_golfer_update(golfer)
        render json: golfer
      end

      # POST /api/v1/golfers/:id/demote
      # Move a golfer from confirmed to waitlist
      def demote
        golfer = Golfer.find(params[:id])

        unless golfer.registration_status == "confirmed"
          render json: { error: "Golfer is not confirmed" }, status: :unprocessable_entity
          return
        end

        old_group = golfer.group

        Golfer.transaction do
          golfer.clear_group_assignment! if old_group.present?
          golfer.assign_attributes(registration_status: "waitlist")
          golfer.save!(validate: false)
        end

        if old_group.present?
          begin
            ActivityLog.log(
              admin: current_admin,
              action: 'golfer_removed_from_group',
              target: golfer,
              details: "Removed #{golfer.name} from #{old_group.hole_position_label} (demoted to waitlist)"
            )
          rescue => e
            Rails.logger.warn("Failed to log activity: #{e.message}")
          end
        end

        begin
          ActivityLog.log(
            admin: current_admin,
            action: 'golfer_demoted',
            target: golfer,
            details: "Moved #{golfer.name} to waitlist",
            metadata: { previous_status: 'confirmed', new_status: 'waitlist' }
          )
        rescue => e
          Rails.logger.warn("Failed to log activity: #{e.message}")
        end

        broadcast_golfer_update(golfer)
        render json: golfer
      end

      # POST /api/v1/golfers/:id/send_payment_link
      # Generate and send payment link to golfer
      def send_payment_link
        golfer = Golfer.find(params[:id])

        unless golfer.can_send_payment_link?
          render json: { error: "Cannot send payment link to this golfer" }, status: :unprocessable_entity
          return
        end

        # Check if this is the first time sending payment link (for admin notification)
        first_time_sending = golfer.payment_token.blank?

        # Generate token if not already present
        golfer.generate_payment_token!

        # Send the payment link email to golfer
        GolferMailer.payment_link_email(golfer).deliver_later

        # Notify admin only if this is the first time sending (not a resend)
        if first_time_sending
          AdminMailer.notify_new_registration_pending_payment(golfer).deliver_later(wait: 2.seconds)
        end

        ActivityLog.log(
          admin: current_admin,
          action: 'payment_link_sent',
          target: golfer,
          details: "Sent payment link to #{golfer.name}",
          metadata: { email: golfer.email }
        )

        render json: {
          success: true,
          message: "Payment link sent to #{golfer.email}",
          payment_link: golfer.payment_link_url
        }
      end

      # PATCH /api/v1/golfers/:id/mark_paid
      def mark_paid
        golfer = Golfer.find(params[:id])

        admin_name = current_admin&.name || current_admin&.email
        golfer.update!(
          golfer.paid_registration_attributes(
            payment_status: "paid",
            paid_at: Time.current,
            payment_method: params[:payment_method],
            payment_notes: params[:payment_notes],
            receipt_number: params[:receipt_number],
            payment_amount_cents: params[:payment_amount_cents] || golfer.expected_entry_fee_cents(fallback: 0),
            payment_verified_by_id: current_admin&.id,
            payment_verified_by_name: admin_name,
            payment_verified_at: Time.current
          )
        )

        begin
          ActivityLog.log(
            admin: current_admin,
            action: 'payment_marked',
            target: golfer,
            details: "Marked #{golfer.name} as paid (#{params[:payment_method]})",
            metadata: {
              payment_method: params[:payment_method],
              receipt_number: params[:receipt_number]
            }
          )
        rescue => e
          Rails.logger.warn("Failed to log payment_marked activity: #{e.message}")
        end

        begin
          golfer.create_raffle_tickets!
          golfer.create_purchased_raffle_tickets!
        rescue => e
          Rails.logger.warn("Failed to create raffle tickets for #{golfer.name}: #{e.message}")
        end

        broadcast_golfer_update(golfer)
        render json: golfer
      end

      # POST /api/v1/golfers/:id/update_payment_status
      # Change payment status (paid/unpaid)
      def update_payment_status
        golfer = Golfer.find(params[:id])
        new_status = params[:payment_status]

        unless %w[paid unpaid].include?(new_status)
          render json: { error: "Invalid payment status. Must be 'paid' or 'unpaid'" }, status: :unprocessable_entity
          return
        end

        old_status = golfer.payment_status

        if new_status == 'unpaid'
          # Clear payment details when marking as unpaid (but keep payment_type)
          golfer.update!(
            payment_status: 'unpaid',
            payment_method: nil,
            receipt_number: nil,
            payment_notes: nil,
            paid_at: nil
          )
        else
          golfer.update!(
            golfer.paid_registration_attributes(
              payment_status: 'paid',
              paid_at: Time.current
            )
          )
          
          # Send payment confirmation email when marking as paid
          if golfer.email.present?
            GolferMailer.payment_confirmation_email(golfer).deliver_later
          end
        end

        ActivityLog.log(
          admin: current_admin,
          action: 'payment_updated',
          target: golfer,
          details: "Changed #{golfer.name} payment status from #{old_status} to #{new_status}",
          metadata: { previous_status: old_status, new_status: new_status }
        )

        broadcast_golfer_update(golfer)
        render json: golfer
      end

      # POST /api/v1/golfers/bulk_send_payment_links
      # Send payment links to multiple unpaid golfers
      def bulk_send_payment_links
        golfer_ids = params[:golfer_ids]

        unless golfer_ids.is_a?(Array) && golfer_ids.any?
          render json: { error: "golfer_ids must be a non-empty array" }, status: :unprocessable_entity
          return
        end

        # Find all golfers (scoped to tournament)
        tournament = find_tournament
        return render_tournament_required unless tournament

        golfers = tournament.golfers.where(id: golfer_ids)
        
        if golfers.empty?
          render json: { error: "No matching golfers found" }, status: :not_found
          return
        end

        sent_count = 0
        skipped_count = 0
        skipped_reasons = []
        sent_golfers = []

        golfers.find_each do |golfer|
          # Skip if can't send payment link (already paid, cancelled, etc.)
          unless golfer.can_send_payment_link?
            skipped_count += 1
            reason = if golfer.payment_status == "paid"
              "already paid"
            elsif golfer.payment_status == "refunded"
              "refunded"
            elsif golfer.registration_status == "cancelled"
              "cancelled"
            else
              "ineligible"
            end
            skipped_reasons << { name: golfer.name, reason: reason }
            next
          end

          # Check if this is the first time sending payment link (for admin notification)
          first_time_sending = golfer.payment_token.blank?

          # Generate token if not already present
          golfer.generate_payment_token!

          # Send the payment link email to golfer
          GolferMailer.payment_link_email(golfer).deliver_later

          # Notify admin only if this is the first time sending (not a resend)
          if first_time_sending
            AdminMailer.notify_new_registration_pending_payment(golfer).deliver_later(wait: 2.seconds)
          end

          # Log for each golfer individually (shows in their activity history)
          ActivityLog.log(
            admin: current_admin,
            action: 'payment_link_sent',
            target: golfer,
            details: "Sent payment link to #{golfer.name} (bulk action)",
            metadata: { 
              email: golfer.email,
              bulk_action: true,
              resend: !first_time_sending
            }
          )

          sent_golfers << golfer
          sent_count += 1
        end

        render json: {
          success: true,
          message: "Payment links sent to #{sent_count} golfer(s)",
          sent_count: sent_count,
          skipped_count: skipped_count,
          skipped_reasons: skipped_reasons
        }
      end

      # GET /api/v1/golfers/registration_status
      # Public endpoint to check registration capacity
      def registration_status
        tournament = resolve_public_tournament(tournament_id: params[:tournament_id])

        if tournament
          payment_config = tournament.organization.effective_payment_config
          payment_adapter = Payments::Resolver.for(tournament.organization)
          render json: {
            tournament_id: tournament.id,
            payment_mode: payment_config.payment_mode,
            processor_provider: payment_config.processor_provider,
            # Total capacity (for admin reference)
            max_capacity: tournament.max_capacity,
            confirmed_count: tournament.confirmed_count,
            waitlist_count: tournament.waitlist_count,
            capacity_remaining: tournament.capacity_remaining,
            at_capacity: tournament.at_capacity?,
            # Public-facing capacity (excludes reserved slots)
            reserved_slots: tournament.reserved_slots,
            public_capacity: tournament.public_capacity,
            public_capacity_remaining: tournament.public_capacity_remaining,
            public_at_capacity: tournament.public_at_capacity?,
            registration_open: tournament.can_register?,
            entry_fee_cents: tournament.entry_fee || 12500,
            entry_fee_dollars: tournament.entry_fee_dollars,
            employee_pricing_enabled: Features.for(tournament.organization, tournament).enabled?(:employee_pricing),
            employee_entry_fee_cents: tournament.employee_entry_fee,
            employee_entry_fee_dollars: tournament.employee_entry_fee_dollars,
            # Tournament configuration for landing page
            tournament_year: tournament.year,
            tournament_edition: tournament.edition,
            tournament_title: tournament.edition.presence || tournament.name,
            tournament_name: tournament.name,
            event_date: format_event_date(tournament.event_date),
            registration_time: tournament.registration_time,
            start_time: tournament.start_time,
            location_name: tournament.location_name,
            location_address: tournament.location_address,
            format_name: tournament.format_name,
            fee_includes: tournament.fee_includes,
            tournament_info: tournament.tournament_info,
            checks_payable_to: tournament.checks_payable_to,
            contact_name: tournament.contact_name,
            contact_phone: tournament.contact_phone,
            # Org payment settings (publishable key only; never secrets)
            stripe_configured: payment_adapter.configured?,
            stripe_public_key: payment_adapter.publishable_key
          }
        else
          render json: {
            registration_open: false,
            error: "No tournament is currently open"
          }
        end
      end

      # GET /api/v1/golfers/stats
      def stats
        tournament = find_tournament
        return render_tournament_required unless tournament

        # Exclude cancelled golfers from active counts
        active_golfers = tournament.golfers.where.not(registration_status: 'cancelled')
        
        render json: {
          tournament_id: tournament.id,
          tournament_name: tournament.name,
          total: active_golfers.count,
          confirmed: tournament.confirmed_count,
          waitlist: tournament.waitlist_count,
          cancelled: tournament.golfers.where(registration_status: 'cancelled').count,
          paid: active_golfers.where(payment_status: 'paid').count,
          unpaid: active_golfers.where.not(payment_status: 'paid').count,
          checked_in: active_golfers.where.not(checked_in_at: nil).count,
          not_checked_in: active_golfers.where(checked_in_at: nil).count,
          assigned_to_groups: active_golfers.where.not(group_id: nil).count,
          unassigned: active_golfers.where(group_id: nil).count,
          max_capacity: tournament.max_capacity,
          reserved_slots: tournament.reserved_slots,
          public_capacity: tournament.public_capacity,
          capacity_remaining: tournament.capacity_remaining,
          at_capacity: tournament.at_capacity?,
          entry_fee_cents: tournament.entry_fee || 12500,
          entry_fee_dollars: tournament.entry_fee_dollars
        }
      end

      private

      def authorize_collection_volunteer_access!
        tournament = find_tournament
        return render_tournament_required unless tournament

        require_any_capability!(:check_in, :manage_golfers, :view_reports, :raffle_sell, tournament: tournament)
      end

      def authorize_collection_stats_access!
        tournament = find_tournament
        return render_tournament_required unless tournament

        require_any_capability!(:manage_golfers, :view_reports, :check_in, tournament: tournament)
      end

      def authorize_collection_finance_access!
        tournament = find_tournament
        return render_tournament_required unless tournament

        require_capability!(:manage_finances, tournament: tournament)
      end

      def authorize_golfer_manage_access!
        golfer = Golfer.find(params[:id])
        require_capability!(:manage_golfers, tournament: golfer.tournament)
      end

      def authorize_golfer_payment_read_access!
        golfer = Golfer.find(params[:id])
        require_any_capability!(:view_reports, :manage_finances, tournament: golfer.tournament)
      end

      def authorize_golfer_finance_access!
        if action_name == "refund"
          with_user_rls_context do
            golfer = Golfer.includes(:tournament).find(params[:id])
            require_capability!(:manage_finances, tournament: golfer.tournament)
          end
        else
          golfer = Golfer.find(params[:id])
          require_capability!(:manage_finances, tournament: golfer.tournament)
        end
      end

      def authorize_golfer_checkin_access!
        golfer = Golfer.find(params[:id])
        require_capability!(:check_in, tournament: golfer.tournament)
      end

      def authorize_golfer_door_payment_access!
        golfer = Golfer.find(params[:id])
        require_capability!(:verify_door_payment, tournament: golfer.tournament)
      end

      def find_tournament
        if params[:tournament_id].present?
          Tournament.find(params[:tournament_id])
        else
          current_user&.accessible_tournaments&.recent&.first
        end
      end

      def render_tournament_required
        render json: { error: "Tournament not found or not specified" }, status: :not_found
      end

      def golfer_params
        params.require(:golfer).permit(
          :name, :company, :address, :phone, :mobile, :email,
          :payment_type, :payment_status, :notes, :is_team_captain,
          :partner_name, :partner_email, :partner_phone,
          :team_name, :team_category, :tshirt_size, :partner_tshirt_size,
          :raffle_tickets_requested, :raffle_bundle_label
        )
      end

      def golfer_update_params
        params.require(:golfer).permit(
          :name, :company, :address, :phone, :mobile, :email,
          :payment_type, :payment_status, :registration_status,
          :group_id, :hole_number, :position, :notes,
          :payment_method, :receipt_number, :payment_notes,
          :partner_name, :partner_email, :partner_phone,
          :team_category, :sponsor_id, :sponsor_name,
          :is_employee
        )
      end

      def broadcast_golfer_update(golfer, action: "updated")
        ActionCable.server.broadcast("golfers_channel_#{golfer.tournament_id}", {
          action: action,
          golfer: GolferSerializer.new(golfer).as_json
        })
      rescue StandardError => e
        Rails.logger.error("Failed to broadcast golfer update: #{e.message}")
      end

      def format_event_date(date)
        return nil if date.nil?
        return date if date.is_a?(String) # Already formatted string
        date.strftime("%B %-d, %Y") # Format Date/DateTime objects
      rescue
        date.to_s # Fallback to string conversion
      end

      def log_golfer_update(golfer, old_values)
        return unless current_admin

        # Check for group assignment changes
        if old_values['group_id'] != golfer.group_id
          if golfer.group_id.present? && old_values['group_id'].nil?
            ActivityLog.log(
              admin: current_admin,
              action: 'golfer_assigned_to_group',
              target: golfer,
              details: "Assigned #{golfer.name} to #{golfer.group&.hole_position_label}",
              metadata: { group_id: golfer.group_id, hole_label: golfer.group&.hole_position_label }
            )
          elsif golfer.group_id.nil? && old_values['group_id'].present?
            ActivityLog.log(
              admin: current_admin,
              action: 'golfer_removed_from_group',
              target: golfer,
              details: "Removed #{golfer.name} from group",
              metadata: { previous_group_id: old_values['group_id'] }
            )
          elsif golfer.group_id.present?
            ActivityLog.log(
              admin: current_admin,
              action: 'golfer_assigned_to_group',
              target: golfer,
              details: "Moved #{golfer.name} to #{golfer.group&.hole_position_label}",
              metadata: { 
                group_id: golfer.group_id, 
                hole_label: golfer.group&.hole_position_label,
                previous_group_id: old_values['group_id']
              }
            )
          end
        end

        # Check for payment status changes
        if old_values['payment_status'] != golfer.payment_status
          ActivityLog.log(
            admin: current_admin,
            action: 'payment_updated',
            target: golfer,
            details: "Changed #{golfer.name} payment status from #{old_values['payment_status']} to #{golfer.payment_status}",
            metadata: {
              previous_status: old_values['payment_status'],
              new_status: golfer.payment_status
            }
          )
        end

        # Check for payment notes changes
        if old_values['payment_notes'] != golfer.payment_notes
          old_notes = old_values['payment_notes'].presence || '(empty)'
          new_notes = golfer.payment_notes.presence || '(empty)'
          
          # Truncate for display in details (keep full in metadata)
          old_notes_display = old_notes.length > 50 ? "#{old_notes[0..47]}..." : old_notes
          new_notes_display = new_notes.length > 50 ? "#{new_notes[0..47]}..." : new_notes
          
          ActivityLog.log(
            admin: current_admin,
            action: 'payment_notes_updated',
            target: golfer,
            details: "Updated payment notes for #{golfer.name}",
            metadata: {
              previous_notes: old_values['payment_notes'],
              new_notes: golfer.payment_notes
            }
          )
        end

        # Check for contact info changes
        contact_fields = %w[name email phone company address]
        changed_fields = contact_fields.select { |field| old_values[field] != golfer.send(field) }
        
        if changed_fields.any?
          changes = changed_fields.map do |field|
            old_val = old_values[field].presence || '(empty)'
            new_val = golfer.send(field).presence || '(empty)'
            "#{field}: #{old_val} → #{new_val}"
          end
          
          ActivityLog.log(
            admin: current_admin,
            action: 'golfer_updated',
            target: golfer,
            details: "Updated #{golfer.name}'s details: #{changed_fields.join(', ')}",
            metadata: {
              changed_fields: changed_fields,
              changes: changed_fields.each_with_object({}) { |f, h| 
                h[f] = { from: old_values[f], to: golfer.send(f) } 
              }
            }
          )
        end
      end

      def run_in_public_rls_context(organization, &block)
        if organization.present?
          TenantContext.with_organization(organization, &block)
        else
          TenantContext.with_closed_access(&block)
        end
      end
    end
  end
end
