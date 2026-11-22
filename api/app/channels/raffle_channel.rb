# frozen_string_literal: true

class RaffleChannel < ApplicationCable::Channel
  def subscribed
    lookup = lambda do
      tournament = Tournament.find_by(id: params[:tournament_id])
      return reject unless tournament&.public_listed?
      return reject if tournament.draft? || tournament.archived?
      return reject unless Features.for(tournament.organization, tournament).enabled?(:raffle)

      if current_organization.present? && tournament.organization_id != current_organization.id
        return reject
      end

      stream_from "tournament_#{tournament.id}_raffle"
    end

    if current_organization.present?
      TenantContext.with_organization(current_organization, &lookup)
    else
      TenantContext.with_platform_access(&lookup)
    end
  end
end
