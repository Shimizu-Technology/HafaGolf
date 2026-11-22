# frozen_string_literal: true

class OrganizationDomain < ApplicationRecord
  HOSTNAME_FORMAT = /\A[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)*\z/

  belongs_to :organization

  before_validation :normalize_hostname
  before_save :clear_other_primaries, if: -> { is_primary? && (new_record? || will_save_change_to_is_primary?) }
  after_commit :invalidate_cors_cache

  validates :hostname, presence: true,
                       length: { maximum: 253 },
                       format: { with: HOSTNAME_FORMAT, message: "must be a valid hostname (no scheme, path, or port)" },
                       uniqueness: { case_sensitive: false }

  scope :verified, -> { where.not(verified_at: nil) }
  scope :primary_first, -> { order(is_primary: :desc, created_at: :asc) }

  def self.normalize_host(raw)
    return nil if raw.blank?

    value = raw.to_s.strip.downcase
    # Strip scheme if a full URL or Origin header was passed
    if value.include?("://")
      value = URI.parse(value).host.to_s.downcase
    else
      value = value.split("/").first.to_s
      value = value.split(":").first.to_s
    end
    value = value.sub(/\.\z/, "")
    value.presence
  rescue URI::InvalidURIError
    nil
  end

  def verified?
    verified_at.present?
  end

  private

  def normalize_hostname
    self.hostname = self.class.normalize_host(hostname)
  end

  def clear_other_primaries
    return unless organization_id.present?

    scope = OrganizationDomain.where(organization_id: organization_id, is_primary: true)
    scope = scope.where.not(id: id) if persisted?
    scope.update_all(is_primary: false)
  end

  def invalidate_cors_cache
    TenantCorsOrigins.invalidate!
  end
end
