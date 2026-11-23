# frozen_string_literal: true

module Api
  module V1
    class PlatformInquiriesController < BaseController
      skip_before_action :authenticate_user!
      skip_around_action :with_tenant_rls_context

      ALLOWED_TYPES = %w[host_tournament join_tournament sponsorship general].freeze

      # POST /api/v1/platform/inquiries
      # Public contact / reach-out endpoint for committees, sponsors, and golfers.
      def create
        raw = params[:inquiry].is_a?(ActionController::Parameters) ? params[:inquiry] : params

        # Honeypot field for simple bot submissions
        if raw[:website].to_s.strip.present?
          return render json: { submitted: true, message: "Thanks — your message has been received." }, status: :ok
        end

        inquiry = {
          name: clean_single_line(raw[:name], max_length: 120),
          email: clean_single_line(raw[:email], max_length: 180).downcase,
          organization_name: clean_single_line(raw[:organization_name], max_length: 160),
          inquiry_type: normalize_inquiry_type(raw[:inquiry_type]),
          estimated_date: clean_single_line(raw[:estimated_date], max_length: 80),
          message: raw[:message].to_s.strip
        }

        errors = validate_inquiry(inquiry)
        if errors.any?
          return render json: { error: errors.first, errors: errors }, status: :unprocessable_entity
        end

        PlatformInquiryMailer.inquiry_received(inquiry).deliver_now
        render json: {
          submitted: true,
          message: "Thanks for reaching out. We received your note and will reply shortly."
        }, status: :created
      rescue StandardError => e
        Rails.logger.error("[PlatformInquiries] Delivery failed: #{e.class}: #{e.message}")
        render json: {
          error: "We could not send your message right now. Please email us directly instead."
        }, status: :service_unavailable
      end

      private

      def clean_single_line(value, max_length:)
        value.to_s.gsub(/[\r\n]+/, " ").strip.slice(0, max_length)
      end

      def normalize_inquiry_type(value)
        candidate = value.to_s.strip.downcase
        ALLOWED_TYPES.include?(candidate) ? candidate : "host_tournament"
      end

      def validate_inquiry(inquiry)
        errors = []
        errors << "Name is required" if inquiry[:name].blank?
        if inquiry[:email].blank? || !inquiry[:email].match?(URI::MailTo::EMAIL_REGEXP)
          errors << "Please enter a valid email address"
        end
        if inquiry[:message].blank? || inquiry[:message].length < 10
          errors << "Please share a few details (at least 10 characters)"
        elsif inquiry[:message].length > 2000
          errors << "Message must be 2,000 characters or fewer"
        end
        errors
      end
    end
  end
end
