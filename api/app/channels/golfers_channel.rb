# frozen_string_literal: true

class GolfersChannel < ApplicationCable::Channel
  def subscribed
    return reject unless current_admin.is_a?(User)

    TenantContext.with_platform_access do
      if params[:tournament_id].present?
        tournament = Tournament.find_by(id: params[:tournament_id])
        return reject unless tournament && authorized_for_tournament?(tournament)

        stream_from "golfers_channel_#{tournament.id}"
        return
      end

      tournament_ids = current_admin.accessible_tournaments.pluck(:id)
      return reject if tournament_ids.empty?

      tournament_ids.each do |tournament_id|
        stream_from "golfers_channel_#{tournament_id}"
      end
    end
  end

  def unsubscribed
    # Any cleanup needed when channel is unsubscribed
  end

  private

  def authorized_for_tournament?(tournament)
    current_admin.can_manage?(tournament) || current_admin.volunteer_for?(tournament.organization)
  end
end
