# frozen_string_literal: true

class MessageDeliveryTracker
  class << self
    def create!(provider:, channel:, purpose:, recipient:, organization: nil, tournament: nil, messageable: nil, request_payload: {}, metadata: {})
      resolved_organization = resolve_organization(
        organization: organization,
        tournament: tournament,
        messageable: messageable
      )

      if resolved_organization.present?
        TenantContext.with_organization(resolved_organization) do
          MessageDelivery.create!(
            provider: provider,
            channel: channel,
            purpose: purpose,
            recipient: recipient,
            organization: resolved_organization,
            tournament: tournament,
            messageable: messageable,
            request_payload: request_payload || {},
            metadata: metadata || {},
            status: "pending"
          )
        end
      else
        TenantContext.with_platform_access do
          MessageDelivery.create!(
            provider: provider,
            channel: channel,
            purpose: purpose,
            recipient: recipient,
            organization: resolved_organization,
            tournament: tournament,
            messageable: messageable,
            request_payload: request_payload || {},
            metadata: metadata || {},
            status: "pending"
          )
        end
      end
    rescue => e
      Rails.logger.error(
        "[MessageDeliveryTracker] failed to create delivery record " \
        "provider=#{provider} channel=#{channel} purpose=#{purpose} recipient=#{recipient}: #{e.message}"
      )
      nil
    end

    def track_result!(delivery, result)
      return result if delivery.blank?

      normalized = normalize_result(result)
      if delivery.organization_id.present?
        TenantContext.with_organization(delivery.organization_id) do
          delivery.mark_from_result!(normalized)
        end
      else
        TenantContext.with_platform_access do
          delivery.mark_from_result!(normalized)
        end
      end
      normalized
    rescue => e
      Rails.logger.error("[MessageDeliveryTracker] failed to update delivery #{delivery&.id}: #{e.message}")
      result
    end

    def normalize_result(result)
      return { success: false, skipped: true, status: "skipped", error: "Delivery service not configured" } if result.nil?

      normalized = result.to_h.with_indifferent_access
      status = normalized[:status].presence || (normalized[:success] ? "accepted" : "failed")
      normalized.merge(status: MessageDelivery.normalize_status(status))
    end

    private

    def resolve_organization(organization:, tournament:, messageable:)
      return organization if organization.present?
      return tournament.organization if tournament&.organization.present?
      return nil if messageable.blank?
      return messageable if messageable.is_a?(Organization)
      return messageable.organization if messageable.respond_to?(:organization) && messageable.organization.present?
      return messageable.tournament.organization if messageable.respond_to?(:tournament) && messageable.tournament&.organization.present?

      nil
    end
  end
end
