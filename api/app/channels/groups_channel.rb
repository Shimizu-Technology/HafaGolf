# frozen_string_literal: true

class GroupsChannel < ApplicationCable::Channel
  def subscribed
    return reject unless current_admin.is_a?(User)

    TenantContext.with_platform_access do
      if params[:tournament_id].present?
        tournament = Tournament.find_by(id: params[:tournament_id])
        return reject unless tournament && current_admin.can_manage?(tournament)

        stream_from "tournament_#{tournament.id}_groups"
        return
      end

      manageable_ids = current_admin.accessible_tournaments.select { |t| current_admin.can_manage?(t) }.map(&:id)
      return reject if manageable_ids.empty?

      manageable_ids.each do |tournament_id|
        stream_from "tournament_#{tournament_id}_groups"
      end
    end
  end

  def unsubscribed
    # Any cleanup needed when channel is unsubscribed
  end
end
