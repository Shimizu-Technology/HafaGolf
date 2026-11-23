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

      tournaments = current_admin.accessible_tournaments.includes(:organization).select { |t| authorized_for_tournament?(t) }
      return reject if tournaments.empty?

      tournaments.each do |tournament|
        stream_from "golfers_channel_#{tournament.id}"
      end
    end
  end

  def unsubscribed
    # Any cleanup needed when channel is unsubscribed
  end

  private

  def authorized_for_tournament?(tournament)
    current_admin.can?(:check_in, organization: tournament.organization, tournament: tournament) ||
      current_admin.can?(:manage_golfers, organization: tournament.organization, tournament: tournament)
  end
end
