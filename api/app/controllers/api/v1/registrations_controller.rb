# frozen_string_literal: true

module Api
  module V1
    class RegistrationsController < BaseController
      PUBLIC_PAYMENT_TYPES = %w[stripe pay_on_day swipe_simple walk_in offline].freeze

      skip_before_action :authenticate_user!, only: [:create]
      skip_around_action :with_tenant_rls_context, only: [:create]

      before_action :set_tournament_for_index, only: [:index]
      before_action :authorize_tournament_volunteer_or_admin!, only: [:index]

      before_action :set_registration, only: [:show, :update, :verify_payment, :assign_group, :sync_raffle_tickets]
      before_action :authorize_registration_volunteer_or_admin!, only: [:show, :verify_payment]
      before_action :authorize_registration_admin!, only: [:update, :assign_group, :sync_raffle_tickets]

      # GET /api/v1/tournaments/:tournament_id/registrations
      def index
        registrations = @tournament.registrations.includes(:team_members, :group, :sponsor)

        status_filter = params[:registration_status].presence || params[:status].presence
        registrations = registrations.where(registration_status: status_filter) if status_filter.present?
        registrations = registrations.where(payment_status: params[:payment_status]) if params[:payment_status].present?
        registrations = registrations.where(payment_type: params[:payment_type]) if params[:payment_type].present?

        if params[:search].present?
          term = "%#{params[:search].strip}%"
          registrations = registrations
            .left_outer_joins(:team_members)
            .where(
              "registrations.team_name ILIKE :q OR registrations.contact_name ILIKE :q " \
              "OR registrations.contact_email ILIKE :q OR registrations.contact_phone ILIKE :q " \
              "OR registrations.company ILIKE :q OR team_members.name ILIKE :q " \
              "OR team_members.email ILIKE :q OR team_members.phone ILIKE :q",
              q: term
            )
            .distinct
        end

        registrations = registrations.order(created_at: :desc)
        paginated = paginate(registrations)

        render json: {
          registrations: paginated.map { |reg| RegistrationSerializer.new(reg).as_json },
          capacity_summary: @tournament.capacity_summary,
          meta: pagination_meta(paginated)
        }
      end

      # POST /api/v1/tournaments/:tournament_id/registrations
      # Public registration supporting 1, 2, or 4 players (+ partial teams when allowed)
      def create
        org = resolve_public_organization
        result = nil
        error_response = nil
        tournament_missing = false

        run_public_create(org) do |tournament|
          if tournament.nil?
            tournament_missing = true
            next
          end

          ActiveRecord::Base.transaction(requires_new: true) do
            tournament.lock!

            members_attrs = extract_public_team_members_attributes
            incoming_player_count = [members_attrs.size, 1].max

            unless tournament.can_accept_public_registration?(player_count: incoming_player_count)
              message = if !tournament.open? || !tournament.registration_open? || tournament.registration_deadline_passed?
                          "Registration is currently closed."
                        else
                          "Tournament is at capacity."
                        end
              error_response = { errors: [message], status: :unprocessable_entity }
              raise ActiveRecord::Rollback
            end

            attrs = public_registration_attributes
            attrs[:team_members_attributes] = members_attrs
            attrs[:organization_id] = tournament.organization_id
            attrs[:registration_source] = "public"

            registration = tournament.registrations.new(attrs)

            if registration.save
              registration.generate_payment_token!
              result = {
                registration: registration,
                organization_id: tournament.organization_id,
                capacity_summary: tournament.capacity_summary,
                message: registration.registration_status == "confirmed" ?
                  "Your spot is confirmed!" :
                  "You have been added to the waitlist."
              }
            else
              error_response = { errors: registration.errors.full_messages, status: :unprocessable_entity }
              raise ActiveRecord::Rollback
            end
          end
        end

        if tournament_missing
          render json: { error: "Tournament not found" }, status: :not_found
          return
        end

        if error_response
          render json: { errors: error_response[:errors] }, status: error_response[:status]
        elsif result
          serialized = TenantContext.with_organization(result[:organization_id]) do
            RegistrationSerializer.new(result[:registration].reload).as_json
          end

          render json: {
            registration: serialized,
            capacity_summary: result[:capacity_summary],
            message: result[:message]
          }, status: :created
        end
      end

      # GET /api/v1/registrations/:id
      def show
        render json: {
          registration: RegistrationSerializer.new(@registration).as_json
        }
      end

      # PATCH /api/v1/registrations/:id
      def update
        permitted = admin_update_params
        target_group = nil

        if permitted[:group_id].present?
          target_group = @registration.tournament.groups.find_by(id: permitted[:group_id])
          unless target_group
            render json: { errors: ["Group must belong to the same tournament"] }, status: :unprocessable_entity
            return
          end
        elsif @registration.group_id.present? && permitted[:team_members_attributes].present?
          target_group = @registration.group
        end

        updated = false
        ActiveRecord::Base.transaction(requires_new: true) do
          target_group.lock! if target_group
          @registration.lock!
          updated = @registration.update(permitted)
          raise ActiveRecord::Rollback unless updated
        end

        if updated
          ActivityLog.log(
            admin: current_user,
            action: "registration_updated",
            target: @registration,
            tournament: @registration.tournament,
            details: "Updated registration #{@registration.display_team_name}"
          )
          render json: {
            registration: RegistrationSerializer.new(@registration.reload).as_json
          }
        else
          render json: { errors: @registration.errors.full_messages }, status: :unprocessable_entity
        end
      end

      # POST /api/v1/registrations/:id/verify_payment
      def verify_payment
        amount_cents = nil
        if params.key?(:payment_amount_cents) && params[:payment_amount_cents].present?
          raw_amount = params[:payment_amount_cents]
          parsed = begin
            Integer(raw_amount.to_s.strip, 10)
          rescue ArgumentError, TypeError
            nil
          end

          if parsed.nil? || parsed.negative?
            render json: { errors: ["payment_amount_cents must be a non-negative integer"] }, status: :unprocessable_entity
            return
          end
          amount_cents = parsed
        end

        verified_now = false

        ActiveRecord::Base.transaction(requires_new: true) do
          @registration.lock!
          next if @registration.payment_status == "paid"

          @registration.verify_payment!(
            admin: current_user,
            method: params[:payment_method].presence || "swipe_simple_confirmed",
            notes: params[:notes],
            amount_cents: amount_cents
          )
          verified_now = true
        end

        if verified_now
          ActivityLog.log(
            admin: current_user,
            action: "payment_verified",
            target: @registration,
            tournament: @registration.tournament,
            details: "Verified payment for #{@registration.display_team_name} (#{params[:payment_method].presence || 'swipe_simple_confirmed'})"
          )

          begin
            @registration.create_raffle_tickets!
          rescue => e
            Rails.logger.warn("Failed to create raffle tickets for registration ##{@registration.id}: #{e.message}")
          end
        end

        render json: {
          registration: RegistrationSerializer.new(@registration.reload).as_json
        }
      end

      # POST /api/v1/registrations/:id/assign_group
      def assign_group
        group_id = params[:group_id]

        if group_id.blank?
          previous_group_id = @registration.group_id
          @registration.update!(group_id: nil)

          if previous_group_id.present?
            ActivityLog.log(
              admin: current_user,
              action: "registration_removed_from_group",
              target: @registration,
              tournament: @registration.tournament,
              details: "Removed #{@registration.display_team_name} from group",
              metadata: { previous_group_id: previous_group_id }
            )
          end

          render json: {
            registration: RegistrationSerializer.new(@registration.reload).as_json
          }
          return
        end

        group = @registration.tournament.groups.find_by(id: group_id)
        unless group
          render json: { errors: ["Group must belong to the same tournament"] }, status: :unprocessable_entity
          return
        end

        assigned = false
        error_message = nil

        ActiveRecord::Base.transaction(requires_new: true) do
          group.lock!
          if group.can_add_registration?(@registration)
            @registration.update!(group: group)
            assigned = true
          else
            error_message = "Cannot assign team of #{@registration.player_count} #{'player'.pluralize(@registration.player_count)}: " \
                            "group already has #{group.player_count}/#{group.max_golfers} players"
            raise ActiveRecord::Rollback
          end
        end

        unless assigned
          render json: { errors: [error_message] }, status: :unprocessable_entity
          return
        end

        ActivityLog.log(
          admin: current_user,
          action: "registration_assigned_to_group",
          target: @registration,
          tournament: @registration.tournament,
          details: "Assigned #{@registration.display_team_name} to #{group.starting_position_label}",
          metadata: { group_id: group.id, player_count: @registration.player_count }
        )

        render json: {
          registration: RegistrationSerializer.new(@registration.reload).as_json,
          group: {
            id: group.id,
            group_number: group.group_number,
            player_count: group.player_count,
            max_golfers: group.max_golfers,
            starting_position_label: group.starting_position_label
          }
        }
      end

      # POST /api/v1/registrations/:id/sync_raffle_tickets
      def sync_raffle_tickets
        return unless require_feature!(:raffle, tournament: @registration.tournament)

        tickets = @registration.create_raffle_tickets!

        ActivityLog.log(
          admin: current_user,
          action: "raffle_tickets_synced",
          target: @registration,
          tournament: @registration.tournament,
          details: "Synced #{tickets.size} complimentary raffle ticket(s) for #{@registration.display_team_name}",
          metadata: { ticket_count: tickets.size }
        )

        render json: {
          registration: RegistrationSerializer.new(@registration.reload).as_json,
          raffle_tickets: tickets.map do |t|
            {
              id: t.id,
              ticket_number: t.ticket_number,
              registration_id: t.registration_id,
              team_member_id: t.team_member_id,
              purchaser_name: t.purchaser_name,
              purchaser_email: t.purchaser_email,
              purchaser_phone: t.purchaser_phone,
              price_cents: t.price_cents,
              payment_status: t.payment_status
            }
          end
        }
      end

      private

      def set_tournament_for_index
        @tournament = Tournament.includes(:organization, :sponsors).find(params[:tournament_id])
      end

      def set_registration
        @registration = Registration.includes(:tournament, :group, :sponsor, :team_members).find(params[:id])
      end

      def authorize_tournament_volunteer_or_admin!
        authorize_volunteer_or_tournament_admin!(@tournament)
        return if performed?

        verify_tenant_match!(@tournament.organization_id, status: :forbidden, message: "Forbidden: Cross-organization access denied")
      end

      def authorize_registration_volunteer_or_admin!
        authorize_volunteer_or_tournament_admin!(@registration.tournament)
        return if performed?

        verify_tenant_match!(@registration.organization_id, status: :forbidden, message: "Forbidden: Cross-organization access denied")
      end

      def authorize_registration_admin!
        require_tournament_admin!(@registration.tournament)
        return if performed?

        verify_tenant_match!(@registration.organization_id, status: :forbidden, message: "Forbidden: Cross-organization access denied")
      end

      def authorize_volunteer_or_tournament_admin!(tournament)
        return if current_user&.can_manage?(tournament)
        return if current_user&.volunteer_for?(tournament.organization)

        render json: { error: "Forbidden: You do not have access to this tournament" }, status: :forbidden
      end

      def run_public_create(org)
        if org.present?
          TenantContext.with_organization(org) do
            tournament = org.tournaments.find_by(id: params[:tournament_id])
            yield tournament
          end
        else
          tournament = TenantContext.with_closed_access do
            resolve_public_tournament(tournament_id: params[:tournament_id])
          end
          if tournament.present?
            TenantContext.with_organization(tournament.organization) do
              yield tournament
            end
          else
            yield nil
          end
        end
      end

      def public_registration_attributes
        raw = params[:registration].is_a?(ActionController::Parameters) ? params[:registration] : params
        permitted = raw.permit(
          :team_name, :team_category,
          :contact_name, :contact_email, :contact_phone, :company, :notes,
          :payment_type, :raffle_tickets_requested, :raffle_bundle_label
        ).to_h.symbolize_keys

        # Sanitize payment_type for public callers (never allow sponsor/comp override from public endpoint)
        if permitted[:payment_type].present?
          unless PUBLIC_PAYMENT_TYPES.include?(permitted[:payment_type].to_s)
            permitted[:payment_type] = "swipe_simple"
          end
        else
          permitted[:payment_type] = "swipe_simple"
        end

        permitted
      end

      def extract_public_team_members_attributes
        reg_params = params[:registration].is_a?(ActionController::Parameters) ? params[:registration] : params
        raw_members = reg_params[:team_members] || reg_params[:team_members_attributes] || params[:team_members] || []
        global_waiver = ActiveModel::Type::Boolean.new.cast(params[:waiver_accepted])

        Array(raw_members).each_with_index.filter_map do |entry, idx|
          next unless entry.is_a?(ActionController::Parameters) || entry.is_a?(Hash)

          h = entry.is_a?(ActionController::Parameters) ?
            entry.permit(:name, :email, :phone, :mobile, :company, :address, :tshirt_size, :handicap, :position, :is_captain, :waiver_accepted, :waiver_accepted_at).to_h :
            entry.stringify_keys.slice("name", "email", "phone", "mobile", "company", "address", "tshirt_size", "handicap", "position", "is_captain", "waiver_accepted", "waiver_accepted_at")

          waiver_flag = ActiveModel::Type::Boolean.new.cast(h.delete("waiver_accepted"))
          if h["waiver_accepted_at"].blank? && (waiver_flag || global_waiver)
            h["waiver_accepted_at"] = Time.current
          end

          h["position"] = (h["position"].presence || idx + 1).to_i
          h["is_captain"] = idx.zero? if h["is_captain"].nil?
          h
        end
      end

      def admin_update_params
        params.require(:registration).permit(
          :team_name, :team_category,
          :contact_name, :contact_email, :contact_phone, :company, :notes,
          :registration_status, :payment_type, :payment_status, :payment_method,
          :payment_amount_cents, :receipt_number, :payment_notes, :group_id,
          :raffle_tickets_requested, :raffle_bundle_label,
          team_members_attributes: [
            :id, :position, :is_captain, :name, :email, :phone, :mobile,
            :company, :address, :tshirt_size, :handicap, :waiver_accepted_at, :_destroy
          ]
        )
      end
    end
  end
end
