# frozen_string_literal: true

class MessageDelivery < ApplicationRecord
  PROVIDERS = %w[resend clicksend action_mailer].freeze
  CHANNELS = %w[email sms].freeze
  STATUSES = %w[pending accepted delivered failed bounced delayed complained skipped].freeze
  STATUS_PRECEDENCE = {
    "pending" => 0,
    "accepted" => 1,
    "delayed" => 2,
    "delivered" => 3,
    "failed" => 3,
    "bounced" => 3,
    "complained" => 3,
    "skipped" => 3
  }.freeze

  belongs_to :organization, optional: true
  belongs_to :tournament, optional: true
  belongs_to :messageable, polymorphic: true, optional: true

  validates :provider, presence: true, inclusion: { in: PROVIDERS }
  validates :channel, presence: true, inclusion: { in: CHANNELS }
  validates :purpose, presence: true
  validates :recipient, presence: true
  validates :status, presence: true, inclusion: { in: STATUSES }

  scope :recent, -> { order(created_at: :desc) }
  scope :failed, -> { where(status: %w[failed bounced complained]) }
  scope :open, -> { where(status: %w[pending accepted delayed]) }

  def mark_from_result!(result)
    normalized = result.to_h.with_indifferent_access
    payload = normalized[:data].presence || normalized[:raw_response].presence
    incoming_status = self.class.normalize_status(
      normalized[:status].presence || (normalized[:success] ? "accepted" : "failed")
    )

    with_lock do
      regresses_status = STATUS_PRECEDENCE.fetch(incoming_status, 0) < STATUS_PRECEDENCE.fetch(self.status, 0)
      next_status = regresses_status ? self.status : incoming_status
      merged_payload =
        if payload.present?
          self.class.normalize_response_payload(payload).merge(
            response_payload.slice("events", "latest_event", "latest_provider_event_at")
          )
        else
          response_payload
        end
      now = Time.current

      update!(
        status: next_status,
        provider_message_id: normalized[:message_id].presence || provider_message_id,
        provider_status_code: normalized[:provider_status_code].presence || normalized[:status_code].presence || provider_status_code,
        provider_status_text: normalized[:provider_status_text].presence || normalized[:status_text].presence || provider_status_text,
        error_code: normalized[:error_code].presence || error_code,
        error_text: normalized[:error].presence || normalized[:error_text].presence || error_text,
        response_payload: merged_payload,
        last_event_at: [ last_event_at, now ].compact.max,
        delivered_at: delivered_status?(next_status) ? (delivered_at || now) : delivered_at,
        failed_at: (!regresses_status && (failed_status?(incoming_status) || normalized[:success] == false)) ? (failed_at || now) : failed_at
      )
    end
  end

  def mark_skipped!(reason)
    update!(
      status: "skipped",
      error_text: reason,
      last_event_at: Time.current,
      failed_at: Time.current
    )
  end

  def apply_provider_event!(status:, provider_status_code: nil, provider_status_text: nil, error_code: nil, error_text: nil, payload: {}, event_at: nil)
    normalized_status = self.class.normalize_status(status)
    event_time = event_at || Time.current
    event_payload = {
      "status" => normalized_status,
      "provider_status_code" => provider_status_code,
      "provider_status_text" => provider_status_text,
      "error_code" => error_code,
      "error_text" => error_text,
      "payload" => payload,
      "event_at" => event_at&.iso8601,
      "received_at" => Time.current.iso8601
    }.compact
    events = Array(response_payload["events"])
    updated_response_payload = response_payload.merge("events" => events + [ event_payload ])

    stale_by_time = event_at.present? && latest_provider_event_at.present? && event_at < latest_provider_event_at
    regresses_status = STATUS_PRECEDENCE.fetch(normalized_status, 0) < STATUS_PRECEDENCE.fetch(self.status, 0)

    if stale_by_time || regresses_status
      update!(response_payload: updated_response_payload)
      return
    end

    updated_response_payload["latest_event"] = payload
    updated_response_payload["latest_provider_event_at"] = event_at.iso8601 if event_at.present?

    update!(
      status: normalized_status,
      provider_status_code: provider_status_code.presence || self.provider_status_code,
      provider_status_text: provider_status_text.presence || self.provider_status_text,
      error_code: error_code.presence || self.error_code,
      error_text: error_text.presence || self.error_text,
      response_payload: updated_response_payload,
      last_event_at: [ last_event_at, event_time ].compact.max,
      delivered_at: normalized_status == "delivered" ? (delivered_at || event_time) : delivered_at,
      failed_at: failed_status?(normalized_status) ? (failed_at || event_time) : failed_at
    )
  end

  def self.normalize_status(status)
    value = status.to_s.downcase
    return "accepted" if value.match?(/\A20\d\z/)

    case
    when value.match?(/\Abounce\z|\Abounced\z|hard_bounce|soft_bounce/)
      "bounced"
    when value.match?(/complain|spam/)
      "complained"
    when value == "skipped"
      "skipped"
    when value.match?(/delay|defer/)
      "delayed"
    when failure_status_text?(value)
      "failed"
    when value.match?(/delivered|received on handset/)
      "delivered"
    when value.match?(/queued|sent|accepted|scheduled|success/)
      "accepted"
    else
      STATUSES.include?(value) ? value : "failed"
    end
  end

  def self.failure_status_text?(text)
    text.to_s.match?(/fail|invalid|reject|bounce|undeliver|not[[:space:]_-]+delivered|suppressed|throttl|expired|blocked|unsubscribed|spam|insufficient|credit|balance|unauthori[sz]ed|forbidden|quota|limit|opt.?out|stopped|cancel/i)
  end

  def self.normalize_response_payload(payload)
    return payload if payload.is_a?(Hash)

    { "raw_response" => payload }
  end

  private

  def latest_provider_event_at
    raw = response_payload["latest_provider_event_at"]
    return nil if raw.blank?

    Time.zone.parse(raw.to_s)
  rescue ArgumentError, TypeError
    nil
  end

  def delivered_status?(status)
    self.class.normalize_status(status) == "delivered"
  end

  def failed_status?(status)
    %w[failed bounced complained].include?(self.class.normalize_status(status))
  end
end
