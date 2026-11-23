# frozen_string_literal: true

module Api
  module V1
    class DirectoryController < BaseController
      skip_before_action :authenticate_user!
      skip_around_action :with_tenant_rls_context

      MAX_PAST_TOURNAMENTS = 12
      UPCOMING_STATUSES = %w[open in_progress closed].freeze

      # GET /api/v1/directory/tournaments
      # Public platform directory listing explicitly opted-in tournaments across active organizations.
      # Runs a tightly scoped read-only query returning only non-sensitive public card metadata.
      def tournaments
        payload = TenantContext.with_platform_access do
          records = Tournament.directory_eligible
                              .joins(:organization)
                              .where(organizations: { subscription_status: "active" })
                              .includes(:sponsors, organization: :organization_domains)
                              .to_a
                              .select { |tournament| tournament.organization&.primary_host.present? }

          upcoming_records = records.select { |t| UPCOMING_STATUSES.include?(t.status) }
                                    .sort_by { |t| [upcoming_sort_rank(t), parsed_event_date(t, fallback: Date.new(9999, 12, 31)), t.name.to_s.downcase] }

          past_records = records.select(&:completed?)
                                .sort_by { |t| [parsed_event_date(t, fallback: Date.new(1900, 1, 1)), t.year.to_i] }
                                .reverse
                                .first(MAX_PAST_TOURNAMENTS)

          {
            upcoming: upcoming_records.map { |t| serialize_directory_tournament(t) },
            past: past_records.map { |t| serialize_directory_tournament(t) },
            updated_at: Time.current.iso8601
          }
        end

        response.set_header("Cache-Control", "public, max-age=300, stale-while-revalidate=600")
        render json: payload
      end

      private

      def upcoming_sort_rank(tournament)
        return 0 if tournament.in_progress?
        return 1 if tournament.open? && tournament.registration_open?
        return 2 if tournament.open?

        3
      end

      def parsed_event_date(tournament, fallback:)
        raw = tournament.event_date.to_s.strip
        return Date.new(tournament.year.to_i, 12, 31) if raw.blank? && tournament.year.present?
        return fallback if raw.blank?

        Date.parse(raw)
      rescue ArgumentError, Date::Error
        tournament.year.present? ? Date.new(tournament.year.to_i, 12, 31) : fallback
      end

      def serialize_directory_tournament(tournament)
        org = tournament.organization
        public_url = OrgUrlBuilder.public_url(org, "/#{tournament.slug}")
        features = Features.for(org, tournament)
        can_register = tournament.can_register?

        {
          slug: tournament.slug,
          name: tournament.name,
          edition: tournament.edition.presence,
          year: tournament.year,
          status: tournament.status,
          event_date: tournament.event_date.presence,
          location_name: tournament.location_name.presence,
          format_name: tournament.format_name.presence,
          tournament_format: tournament.tournament_format.presence,
          team_size: tournament.team_size,
          entry_fee_display: tournament.formatted_entry_fee_display,
          registration_open: tournament.registration_open,
          can_register: can_register,
          availability: availability_label(tournament, can_register: can_register),
          public_url: public_url,
          register_url: can_register ? OrgUrlBuilder.public_url(org, "/#{tournament.slug}/register") : nil,
          leaderboard_url: features.enabled?(:live_scoring) ? OrgUrlBuilder.public_url(org, "/#{tournament.slug}/leaderboard") : nil,
          organization: {
            name: org.name,
            slug: org.slug,
            primary_color: org.primary_color.presence,
            logo_url: org.logo_url.presence,
            primary_host: org.primary_host
          }
        }
      end

      def availability_label(tournament, can_register:)
        return "in_progress" if tournament.in_progress?
        return "completed" if tournament.completed?
        return "closed" unless tournament.open? && tournament.registration_open?

        if can_register
          tournament.public_at_capacity? ? "waitlist" : "open"
        elsif tournament.at_capacity? || tournament.public_at_capacity?
          "full"
        else
          "closed"
        end
      end
    end
  end
end
