# frozen_string_literal: true

module Api
  module V1
    class BroadcastsController < BaseController
      before_action :set_tournament
      before_action :authorize_broadcast_access!

      # GET /api/v1/tournaments/:tournament_id/broadcasts
      def index
        announcements = @tournament.broadcast_announcements.includes(:sender).recent.limit(50)
        groups = @tournament.groups.order(:hole_number, :group_number).map do |group|
          {
            id: group.id,
            group_number: group.group_number,
            hole_number: group.hole_number,
            hole_position_label: group.hole_position_label
          }
        end

        email_ok = Broadcasts::Dispatcher.email_configured?
        sms_ok = Broadcasts::Dispatcher.sms_configured?

        render json: {
          announcements: announcements.map(&:as_admin_json),
          groups: groups,
          config: {
            email_configured: email_ok,
            sms_configured: sms_ok,
            local_dry_run_mode: !email_ok && !sms_ok
          }
        }
      end

      # POST /api/v1/tournaments/:tournament_id/broadcasts/preview
      def preview
        audience, channel, target_group_ids, validation_error = parse_audience_and_channel
        if validation_error
          render json: { error: validation_error }, status: :unprocessable_entity
          return
        end

        plan = Broadcasts::Dispatcher.channel_plan(channel)
        resolved = Broadcasts::AudienceResolver.resolve(
          tournament: @tournament,
          audience: audience,
          channel: plan[:effective_channel],
          target_group_ids: target_group_ids
        )

        email_ok = Broadcasts::Dispatcher.email_configured?
        sms_ok = Broadcasts::Dispatcher.sms_configured?

        render json: {
          audience: audience,
          channel: channel,
          effective_channel: plan[:effective_channel],
          skipped_channel: plan[:skipped_channel],
          recipient_count: resolved.recipient_count,
          email_recipients: %w[email both].include?(plan[:effective_channel]) ? resolved.email_count : 0,
          sms_recipients: %w[sms both].include?(plan[:effective_channel]) ? resolved.sms_count : 0,
          dry_run: plan[:dry_run],
          email_configured: email_ok,
          sms_configured: sms_ok
        }
      end

      # POST /api/v1/tournaments/:tournament_id/broadcasts
      def create
        audience, channel, target_group_ids, validation_error = parse_audience_and_channel
        if validation_error
          render json: { error: validation_error }, status: :unprocessable_entity
          return
        end

        raw = broadcast_params
        subject = raw[:subject].to_s.strip.presence
        message = raw[:message].to_s.strip

        if message.blank?
          render json: { error: "Message is required." }, status: :unprocessable_entity
          return
        end

        if message.length > 2000
          render json: { error: "Message must be 2000 characters or fewer." }, status: :unprocessable_entity
          return
        end

        if %w[email both].include?(channel) && subject.blank?
          render json: { error: "Subject is required for email announcements." }, status: :unprocessable_entity
          return
        end

        if subject.present? && subject.length > 200
          render json: { error: "Subject must be 200 characters or fewer." }, status: :unprocessable_entity
          return
        end

        plan = Broadcasts::Dispatcher.channel_plan(channel)
        preview_result = Broadcasts::AudienceResolver.resolve(
          tournament: @tournament,
          audience: audience,
          channel: plan[:effective_channel],
          target_group_ids: target_group_ids
        )

        if preview_result.recipient_count.zero?
          render json: { error: "No reachable recipients found for the selected audience and channel." }, status: :unprocessable_entity
          return
        end

        announcement = Broadcasts::Dispatcher.call(
          tournament: @tournament,
          sender: current_user,
          audience: audience,
          target_group_ids: target_group_ids,
          channel: channel,
          subject: subject,
          message: message
        )

        skipped_note = plan[:skipped_channel].present? ? " (#{plan[:skipped_channel].upcase} skipped because it is not configured)" : ""

        render json: {
          announcement: announcement.as_admin_json,
          skipped_channel: plan[:skipped_channel],
          message: announcement.dry_run? ?
            "Dry run recorded for #{announcement.recipient_count} recipients (no outbound messages sent)." :
            "Broadcast sent via #{announcement.channel.upcase} to #{announcement.recipient_count} recipients#{skipped_note}."
        }, status: :created
      rescue ActiveRecord::RecordInvalid => e
        render json: { error: e.record.errors.full_messages.join(", ") }, status: :unprocessable_entity
      end

      private

      def set_tournament
        @tournament = Tournament.includes(:organization).find(params[:tournament_id])
      end

      def authorize_broadcast_access!
        return unless verify_tenant_match!(@tournament.organization_id, status: :not_found, message: "Tournament not found")

        require_capability!(:send_broadcasts, tournament: @tournament)
      end

      def broadcast_params
        raw = params[:broadcast].is_a?(ActionController::Parameters) ? params[:broadcast] : params
        raw.permit(:audience, :channel, :subject, :message, target_group_ids: [])
      end

      def parse_audience_and_channel
        raw = broadcast_params
        audience = raw[:audience].to_s.strip.downcase
        channel = raw[:channel].to_s.strip.downcase

        unless BroadcastAnnouncement::AUDIENCES.include?(audience)
          return [nil, nil, [], "Invalid audience."]
        end

        unless BroadcastAnnouncement::CHANNELS.include?(channel)
          return [nil, nil, [], "Invalid channel."]
        end

        target_group_ids = []
        if audience == "specific_groups"
          raw_ids = raw[:target_group_ids]
          if !raw_ids.is_a?(Array) || raw_ids.empty?
            return [nil, nil, [], "Please select at least one group."]
          end

          parsed_ids = raw_ids.map do |val|
            Integer(val.to_s.strip, 10)
          rescue ArgumentError, TypeError
            nil
          end

          if parsed_ids.any? { |id| id.nil? || id <= 0 }
            return [nil, nil, [], "Invalid group selection."]
          end

          target_group_ids = parsed_ids.uniq
          valid_ids = @tournament.groups.where(id: target_group_ids).pluck(:id)
          if valid_ids.size != target_group_ids.size
            return [nil, nil, [], "Selected groups must belong to this tournament."]
          end
        end

        [audience, channel, target_group_ids, nil]
      end
    end
  end
end
