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
                              .includes(organization: :organization_domains)
                              .to_a
                              .select { |tournament| tournament.organization&.primary_host.present? }

          upcoming_records = records.select { |t| UPCOMING_STATUSES.include?(t.status) }
                                    .sort_by { |t| [upcoming_sort_rank(t), parsed_event_date(t, fallback: Date.new(9999, 12, 31)), t.name.to_s.downcase] }

          past_records = records.select(&:completed?)
                                .sort_by { |t| [parsed_event_date(t, fallback: Date.new(1900, 1, 1)), t.year.to_i] }
                                .reverse
                                .first(MAX_PAST_TOURNAMENTS)

          # Only preload sponsors for open upcoming cards that actually need capacity calculation.
          open_for_reg = upcoming_records.select { |t| t.open? && t.registration_open? && !t.registration_deadline_passed? }
          if open_for_reg.any?
            ActiveRecord::Associations::Preloader.new(records: open_for_reg, associations: :sponsors).call
          end

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
        availability, can_register = resolve_registration_availability(tournament)

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
          availability: availability,
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

      def resolve_registration_availability(tournament)
        return ["in_progress", false] if tournament.in_progress?
        return ["completed", false] if tournament.completed?
        return ["closed", false] unless tournament.open? && tournament.registration_open? && !tournament.registration_deadline_passed?

        # Compute capacity_summary at most once per open tournament card.
        summary = tournament.capacity_summary
        has_public_space = summary[:max_capacity].nil? ||
                           (summary[:public_remaining].to_i >= 1 && summary[:remaining].to_i >= 1)
        return ["open", true] if has_public_space

        if tournament.waitlist_enabled?
          waitlist_full = tournament.waitlist_max.present? &&
                          tournament.waitlist_max.to_i.positive? &&
                          (summary[:waitlist_units].to_i + 1) > tournament.waitlist_max.to_i
          return ["waitlist", true] unless waitlist_full
        end

        ["full", false]
      end
    end
  end
end
