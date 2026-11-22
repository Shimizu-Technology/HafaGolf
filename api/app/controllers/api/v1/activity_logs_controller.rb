# frozen_string_literal: true

module Api
  module V1
    class ActivityLogsController < BaseController
      # GET /api/v1/activity_logs
      def index
        accessible_tournaments = current_user.accessible_tournaments
        logs = ActivityLog.recent.includes(:user, :tournament)

        if params[:tournament_id].present?
          tournament = Tournament.find(params[:tournament_id])
          require_tournament_admin!(tournament)
          return if performed?

          logs = logs.for_tournament(tournament.id)
        elsif params[:all_tournaments] == 'true'
          logs = logs.where(tournament_id: accessible_tournaments.select(:id))
        else
          tournament = accessible_tournaments.recent.first
          logs = tournament ? logs.for_tournament(tournament.id) : ActivityLog.none
        end

        # Filter by admin
        if params[:admin_id].present?
          logs = logs.by_admin(params[:admin_id])
        end

        # Filter by action (exact match or prefix with LIKE)
        if params[:action_type].present?
          action_filter = params[:action_type]
          if action_filter.include?('%') || ActivityLog::ACTIONS.include?(action_filter)
            logs = logs.by_action(action_filter)
          else
            logs = logs.where("action LIKE ?", "#{action_filter}%")
          end
        end

        # Filter by target
        if params[:target_type].present? && params[:target_id].present?
          logs = logs.by_target(params[:target_type], params[:target_id])
        end

        # Filter by date range
        if params[:start_date].present?
          begin
            logs = logs.where('created_at >= ?', Date.parse(params[:start_date]).beginning_of_day)
          rescue Date::Error
            # ignore invalid date
          end
        end
        if params[:end_date].present?
          begin
            logs = logs.where('created_at <= ?', Date.parse(params[:end_date]).end_of_day)
          rescue Date::Error
            # ignore invalid date
          end
        end

        # Pagination
        page = (params[:page] || 1).to_i
        per_page = (params[:per_page] || 50).to_i.clamp(1, 100)

        total = logs.count
        logs = logs.offset((page - 1) * per_page).limit(per_page)

        render json: {
          activity_logs: ActiveModelSerializers::SerializableResource.new(logs),
          meta: {
            current_page: page,
            per_page: per_page,
            total_count: total,
            total_pages: (total.to_f / per_page).ceil
          }
        }
      end

      # GET /api/v1/activity_logs/golfer/:golfer_id
      # Get activity logs for a specific golfer
      def golfer_history
        golfer = Golfer.find(params[:golfer_id])
        require_tournament_admin!(golfer.tournament)
        return if performed?

        tournament_scope = ActivityLog.where(tournament_id: golfer.tournament_id)
        logs = ActivityLog
          .where(target_type: 'Golfer', target_id: golfer.id, tournament_id: [golfer.tournament_id, nil])
          .or(tournament_scope.where("metadata->>'golfer_name' = ?", golfer.name))

        if golfer.group_id.present?
          logs = logs.or(
            tournament_scope.where(
              target_type: 'Group',
              target_id: golfer.group_id,
              action: 'group_updated'
            )
          )
        end

        logs = logs
          .recent
          .includes(:user)
          .limit(20)

        render json: {
          activity_logs: ActiveModelSerializers::SerializableResource.new(logs),
          golfer_id: golfer.id,
          golfer_name: golfer.name
        }
      end

      # GET /api/v1/activity_logs/summary
      def summary
        tournament = if params[:tournament_id].present?
          found = Tournament.find(params[:tournament_id])
          require_tournament_admin!(found)
          return if performed?

          found
        else
          current_user.accessible_tournaments.recent.first
        end

        base_scope = tournament ? ActivityLog.for_tournament(tournament.id) : ActivityLog.none

        today_count = base_scope.today.count

        # Activity by action type
        by_action = base_scope.group(:action).count

        # Activity by admin (top 10)
        by_admin = base_scope
          .joins(:user)
          .group('users.name')
          .order('count_all DESC')
          .limit(10)
          .count

        # Recent activity (last 7 days by day)
        seven_days_ago = 7.days.ago.beginning_of_day
        daily_activity = base_scope
          .where('created_at >= ?', seven_days_ago)
          .group("DATE(created_at AT TIME ZONE 'UTC' AT TIME ZONE 'Pacific/Guam')")
          .count

        render json: {
          tournament_id: tournament&.id,
          tournament_name: tournament&.name,
          today_count: today_count,
          total_count: base_scope.count,
          by_action: by_action,
          by_admin: by_admin,
          daily_activity: daily_activity
        }
      end
    end
  end
end
