# frozen_string_literal: true

class BroadcastAnnouncement < ApplicationRecord
  AUDIENCES = %w[all_confirmed checked_in unchecked_in sponsors specific_groups].freeze
  CHANNELS = %w[email sms both].freeze
  STATUSES = %w[completed dry_run failed].freeze

  belongs_to :organization
  belongs_to :tournament
  belongs_to :sender, class_name: "User", optional: true

  before_validation :assign_organization_from_tournament
  before_validation :normalize_fields

  validates :audience, presence: true, inclusion: { in: AUDIENCES }
  validates :channel, presence: true, inclusion: { in: CHANNELS }
  validates :status, presence: true, inclusion: { in: STATUSES }
  validates :message, presence: true, length: { maximum: 2000 }
  validates :subject, presence: true, length: { maximum: 200 }, if: :requires_subject?
  validates :recipient_count, :email_recipient_count, :sms_recipient_count,
            :sent_count, :failed_count,
            numericality: { only_integer: true, greater_than_or_equal_to: 0 }
  validate :organization_matches_tournament
  validate :target_groups_valid_for_specific_audience

  scope :recent, -> { order(created_at: :desc, id: :desc) }

  def requires_subject?
    channel == "email" || channel == "both"
  end

  def as_admin_json
    {
      id: id,
      organization_id: organization_id,
      tournament_id: tournament_id,
      sender_id: sender_id,
      sender_name: sender&.name.presence || sender&.email || "System",
      audience: audience,
      target_group_ids: Array(target_group_ids).map(&:to_i),
      channel: channel,
      subject: subject,
      message: message,
      recipient_count: recipient_count,
      email_recipient_count: email_recipient_count,
      sms_recipient_count: sms_recipient_count,
      sent_count: sent_count,
      failed_count: failed_count,
      dry_run: dry_run,
      status: status,
      sent_at: sent_at&.iso8601,
      created_at: created_at&.iso8601
    }
  end

  private

  def assign_organization_from_tournament
    self.organization_id ||= tournament&.organization_id
  end

  def normalize_fields
    self.audience = audience.to_s.strip.downcase
    self.channel = channel.to_s.strip.downcase
    self.subject = subject.to_s.strip.presence
    self.message = message.to_s.strip
    self.target_group_ids = Array(target_group_ids).filter_map do |val|
      parsed = Integer(val.to_s.strip, 10)
      parsed.positive? ? parsed : nil
    rescue ArgumentError, TypeError
      nil
    end.uniq
  end

  def organization_matches_tournament
    return if organization_id.blank? || tournament.blank?
    return if organization_id.to_s == tournament.organization_id.to_s

    errors.add(:organization_id, "must match the tournament's organization")
  end

  def target_groups_valid_for_specific_audience
    return unless audience == "specific_groups"

    if target_group_ids.empty?
      errors.add(:target_group_ids, "must select at least one group")
      return
    end

    return unless tournament.present?

    valid_ids = tournament.groups.where(id: target_group_ids).pluck(:id)
    if valid_ids.size != target_group_ids.size
      errors.add(:target_group_ids, "must all belong to this tournament")
    end
  end
end
