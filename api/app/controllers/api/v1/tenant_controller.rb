# frozen_string_literal: true

module Api
  module V1
    class TenantController < BaseController
      skip_before_action :authenticate_user!

      LOCAL_DEV_HOSTS = %w[localhost 127.0.0.1].freeze

      # GET /api/v1/tenant
      # Public host-based tenant resolution endpoint for custom domains and path fallbacks.
      def show
        host = Current.tenant_host
        organization = Current.organization
        resolved_by = "domain" if organization.present?

        if organization.blank? && params[:slug].present?
          organization = Organization.find_by("LOWER(slug) = ?", params[:slug].to_s.strip.downcase)
          resolved_by = "slug" if organization.present?
        end

        if organization.blank? && !Rails.env.production? && LOCAL_DEV_HOSTS.include?(host)
          organization = Organization.active.order(:created_at).first
          resolved_by = "local_default" if organization.present?
        end

        if organization.blank?
          return render json: { error: "Tenant organization not found for host", host: host }, status: :not_found
        end

        render json: {
          host: host,
          resolved_by: resolved_by,
          organization: serialize_public_organization(organization)
        }
      end

      private

      def serialize_public_organization(organization)
        payment_config = organization.effective_payment_config
        {
          id: organization.id,
          name: organization.name,
          slug: organization.slug,
          description: organization.description,
          logo_url: organization.logo_url,
          primary_color: organization.primary_color,
          banner_url: organization.banner_url,
          contact_email: organization.contact_email,
          contact_phone: organization.contact_phone,
          website_url: organization.website_url,
          primary_host: organization.primary_host,
          payment_mode: payment_config.payment_mode,
          processor_provider: payment_config.processor_provider,
          offseason_enabled: organization.offseason_enabled,
          offseason_title: organization.offseason_title,
          offseason_message: organization.offseason_message,
          offseason_cta_label: organization.offseason_cta_label,
          offseason_cta_url: organization.offseason_cta_url,
          settings: organization.settings || {},
          features: Features.for(organization).to_h,
          tournament_count: organization.tournament_count
        }
      end
    end
  end
end
