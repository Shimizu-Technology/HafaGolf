# frozen_string_literal: true

require "base64"
require "openssl"

module Api
  module V1
    class DeliveryWebhooksController < BaseController
      SVIX_TOLERANCE_SECONDS = 300

      skip_before_action :authenticate_user!
      before_action :verify_delivery_webhook_auth!

      # POST /api/v1/webhooks/resend
      def resend
        payload = webhook_payload
        event_type = payload["type"].to_s
        data = webhook_data(payload)
        provider_message_id = data[:email_id].presence || data[:id].presence || data[:message_id].presence
        tagged_delivery_id = extract_delivery_id_tag(data)
        return missing_provider_message_id_response if provider_message_id.blank? && tagged_delivery_id.blank?

        delivery = find_resend_delivery(
          provider_message_id: provider_message_id,
          tagged_delivery_id: tagged_delivery_id
        )
        if delivery.blank?
          return render json: { message: "No matching delivery", provider_message_id: provider_message_id }, status: :accepted
        end

        matched = true
        delivery.with_lock do
          if delivery.provider_message_id.present? && provider_message_id.present? && delivery.provider_message_id != provider_message_id
            matched = false
            next
          end

          if delivery.provider_message_id.blank? && provider_message_id.present?
            delivery.provider_message_id = provider_message_id
          end

          delivery.apply_provider_event!(
            status: resend_status(event_type, current_status: delivery.status),
            provider_status_text: event_type,
            error_text: data[:error].presence || data[:reason].presence || (event_type == "email.suppressed" ? "Recipient suppressed" : nil),
            payload: payload,
            event_at: parse_event_time(payload["created_at"])
          )
        end

        unless matched
          return render json: { message: "No matching delivery", provider_message_id: provider_message_id }, status: :accepted
        end

        render json: { message: "Delivery updated", delivery_id: delivery.id, status: delivery.status }
      end

      # POST /api/v1/webhooks/clicksend
      def clicksend
        payload = webhook_payload
        provider_message_id = payload["message_id"].presence || payload["original_message_id"].presence
        return missing_provider_message_id_response if provider_message_id.blank?

        delivery = MessageDelivery.where(provider: "clicksend", provider_message_id: provider_message_id).recent.first
        return render json: { message: "No matching delivery", provider_message_id: provider_message_id }, status: :accepted if delivery.blank?

        status_text = payload["status_text"].presence || payload["status"].presence
        delivery.with_lock do
          delivery.apply_provider_event!(
            status: status_text.presence || payload["status_code"],
            provider_status_code: payload["status_code"],
            provider_status_text: status_text,
            error_code: payload["error_code"],
            error_text: payload["error_text"],
            payload: payload,
            event_at: parse_event_time(payload["timestamp"])
          )
        end

        render json: { message: "Delivery updated", delivery_id: delivery.id, status: delivery.status }
      end

      private

      def webhook_payload
        request.request_parameters.presence || JSON.parse(request.raw_post.presence || "{}")
      rescue JSON::ParserError
        {}
      end

      def verify_delivery_webhook_auth!
        if action_name == "resend" && ENV["RESEND_WEBHOOK_SECRET"].present?
          unless valid_svix_signature?(ENV["RESEND_WEBHOOK_SECRET"])
            render json: { error: "Invalid webhook signature" }, status: :unauthorized
          end
          return
        end

        verify_delivery_webhook_token!
      end

      def verify_delivery_webhook_token!
        provider_token =
          if action_name == "clicksend"
            ENV["CLICKSEND_WEBHOOK_TOKEN"].presence
          elsif action_name == "resend"
            ENV["RESEND_WEBHOOK_TOKEN"].presence
          end
        expected = provider_token || ENV["DELIVERY_WEBHOOK_TOKEN"].presence
        return render json: { error: "Invalid webhook token" }, status: :unauthorized if expected.blank?

        provided = params[:token].presence || request.headers["X-Webhook-Token"].presence
        valid = provided.present? &&
          provided.to_s.bytesize == expected.to_s.bytesize &&
          ActiveSupport::SecurityUtils.secure_compare(provided.to_s, expected.to_s)
        render json: { error: "Invalid webhook token" }, status: :unauthorized unless valid
      end

      def valid_svix_signature?(secret)
        svix_id = request.headers["svix-id"].to_s.strip
        svix_timestamp = request.headers["svix-timestamp"].to_s.strip
        svix_signature = request.headers["svix-signature"].to_s.strip
        return false if svix_id.blank? || svix_timestamp.blank? || svix_signature.blank?
        return false unless svix_timestamp.match?(/\A\d+\z/)

        timestamp = Integer(svix_timestamp, 10)
        return false if (Time.current.to_i - timestamp).abs > SVIX_TOLERANCE_SECONDS

        secret_bytes = decode_svix_secret(secret)
        return false if secret_bytes.blank?

        signed_content = "#{svix_id}.#{svix_timestamp}.#{request.raw_post}"
        expected_signature = Base64.strict_encode64(
          OpenSSL::HMAC.digest("SHA256", secret_bytes, signed_content)
        )

        svix_signature.split(/\s+/).any? do |token|
          version, signature = token.split(",", 2)
          next false unless version == "v1" && signature.present?
          next false unless signature.bytesize == expected_signature.bytesize

          ActiveSupport::SecurityUtils.secure_compare(signature, expected_signature)
        end
      end

      def decode_svix_secret(secret)
        raw_secret = secret.to_s.strip.delete_prefix("whsec_")
        return nil if raw_secret.blank?

        Base64.strict_decode64(raw_secret)
      rescue ArgumentError
        nil
      end

      def find_resend_delivery(provider_message_id:, tagged_delivery_id:)
        if provider_message_id.present?
          delivery = MessageDelivery.where(provider: "resend", provider_message_id: provider_message_id).recent.first
          return delivery if delivery.present?
        end

        return nil if tagged_delivery_id.blank?

        candidate = MessageDelivery.find_by(id: tagged_delivery_id, provider: "resend")
        return nil if candidate.blank?
        return nil if candidate.provider_message_id.present? && provider_message_id.present? && candidate.provider_message_id != provider_message_id

        candidate
      end

      def extract_delivery_id_tag(data)
        tags = data[:tags]
        raw_value =
          if tags.is_a?(Hash)
            tags[:delivery_id] || tags["delivery_id"]
          elsif tags.is_a?(Array)
            entry = tags.find do |item|
              item.is_a?(Hash) && (item["name"] || item[:name]).to_s == "delivery_id"
            end
            entry && (entry["value"] || entry[:value])
          end

        value = raw_value.to_s.strip
        return nil unless value.match?(/\A\d+\z/)

        value.to_i
      end

      def missing_provider_message_id_response
        render json: { message: "Missing provider message id" }, status: :accepted
      end

      def webhook_data(payload)
        data = payload["data"]
        data.is_a?(Hash) ? data.with_indifferent_access : {}.with_indifferent_access
      end

      def parse_event_time(value)
        return nil if value.blank?
        return Time.zone.at(value.to_i) if value.is_a?(Integer) || value.to_s.match?(/\A\d+\z/)

        Time.zone.parse(value.to_s)
      rescue ArgumentError, TypeError
        nil
      end

      def resend_status(event_type, current_status:)
        case event_type
        when "email.sent"
          "accepted"
        when "email.delivered"
          "delivered"
        when "email.bounced"
          "bounced"
        when "email.delivery_delayed"
          "delayed"
        when "email.complained"
          "complained"
        when "email.suppressed"
          "failed"
        else
          event_type.include?("failed") ? "failed" : current_status
        end
      end
    end
  end
end
