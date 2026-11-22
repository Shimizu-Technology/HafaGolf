# frozen_string_literal: true

module Api
  module V1
    class TeamMembersController < BaseController
      before_action :set_team_member
      before_action :authorize_team_member_access!

      # POST /api/v1/team_members/:id/check_in
      def check_in
        checked_in_now = false
        blocked_status = nil

        ActiveRecord::Base.transaction(requires_new: true) do
          @team_member.registration.lock!
          @team_member.lock!

          status = @team_member.registration.registration_status
          unless status == "confirmed"
            blocked_status = status
            raise ActiveRecord::Rollback
          end

          checked_in_now = !@team_member.checked_in?
          @team_member.check_in!(admin: current_user) if checked_in_now
        end

        if blocked_status.present?
          render json: { error: "Cannot check in a player whose registration is #{blocked_status}" },
                 status: :unprocessable_entity
          return
        end

        if checked_in_now
          ActivityLog.log(
            admin: current_user,
            action: "team_member_checked_in",
            target: @team_member,
            tournament: @team_member.tournament,
            details: "Checked in #{@team_member.name} (Team: #{@team_member.registration.display_team_name})"
          )
        end

        registration = @team_member.registration.reload
        render json: {
          team_member: TeamMemberSerializer.new(@team_member.reload).as_json,
          registration: RegistrationSerializer.new(registration).as_json
        }
      end

      # POST /api/v1/team_members/:id/undo_check_in
      def undo_check_in
        unchecked_now = false

        @team_member.with_lock do
          unchecked_now = @team_member.checked_in?
          @team_member.undo_check_in! if unchecked_now
        end

        unless unchecked_now
          render json: { error: "Player is not checked in" }, status: :unprocessable_entity
          return
        end

        ActivityLog.log(
          admin: current_user,
          action: "team_member_unchecked",
          target: @team_member,
          tournament: @team_member.tournament,
          details: "Undid check-in for #{@team_member.name} (Team: #{@team_member.registration.display_team_name})"
        )

        registration = @team_member.registration.reload
        render json: {
          team_member: TeamMemberSerializer.new(@team_member.reload).as_json,
          registration: RegistrationSerializer.new(registration).as_json
        }
      end

      private

      def set_team_member
        @team_member = TeamMember.includes(registration: [:tournament, :group, :team_members]).find(params[:id])
      end

      def authorize_team_member_access!
        tournament = @team_member.tournament
        unless current_user&.can_manage?(tournament) || current_user&.volunteer_for?(tournament.organization)
          render json: { error: "Forbidden: You do not have access to this tournament" }, status: :forbidden
          return
        end

        verify_tenant_match!(@team_member.organization_id, status: :forbidden, message: "Forbidden: Cross-organization access denied")
      end
    end
  end
end
