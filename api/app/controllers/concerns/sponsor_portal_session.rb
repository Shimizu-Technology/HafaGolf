# frozen_string_literal: true

# Authenticates sponsor portal requests from the signed X-Sponsor-Session token
# minted by SponsorAccessController#confirm, and rejects sessions whose sponsor
# belongs to a different organization than the resolved tenant host.
module SponsorPortalSession
  extend ActiveSupport::Concern

  private

  def authenticate_sponsor!
    session_token = request.headers["X-Sponsor-Session"] || params[:session_token]
    @sponsor, @sponsor_session_expires_at = TenantContext.with_platform_access do
      Sponsor.includes(tournament: :organization).verify_portal_session_token(session_token)
    end

    unless @sponsor&.portal_eligible? && (Current.organization.blank? || @sponsor.tournament.organization_id == Current.organization.id)
      @sponsor = nil
      @sponsor_session_expires_at = nil
      render json: { error: "Invalid or expired sponsor session" }, status: :unauthorized
    end
  end

  def sponsor_edit_deadline_passed?(sponsor = @sponsor)
    deadline = sponsor.tournament.sponsor_edit_deadline
    deadline.present? && Time.current > deadline
  end

  def portal_tournament_json(tournament)
    {
      id: tournament.id,
      name: tournament.name,
      year: tournament.year,
      event_date: tournament.event_date,
      team_size: [tournament.team_size.to_i, 1].max,
      handicap_required: tournament.handicap_required?,
      waiver_enabled: tournament.waiver_enabled,
      sponsor_edit_deadline: tournament.sponsor_edit_deadline&.iso8601,
      edit_deadline_passed: tournament.sponsor_edit_deadline.present? && Time.current > tournament.sponsor_edit_deadline,
      contact_name: tournament.contact_name,
      contact_email: tournament.contact_email,
      contact_phone: tournament.contact_phone
    }
  end
end
