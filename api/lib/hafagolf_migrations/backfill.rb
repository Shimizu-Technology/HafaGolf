# frozen_string_literal: true

module HafagolfMigrations
  module Backfill
    ORGANIZATION_BRAND_FIELDS = %w[
      logo_url banner_url reversed_logo_url offseason_enabled offseason_title offseason_message
      offseason_cta_label offseason_cta_url
    ].freeze

    private

    def assign_backfill(record, attributes)
      attributes = attributes.select do |column, value|
        !missing_value?(value) && missing_value?(record.public_send(column))
      end unless record.new_record?

      record.assign_attributes(attributes)
    end

    def missing_value?(value)
      value.nil? || (value.is_a?(String) && value.blank?)
    end

    def save_backfill!(record, attributes)
      assign_backfill(record, attributes)
      record.save! if record.new_record? || record.changed?
    end

    def merge_missing_json(source, target)
      source.deep_merge(target) { |_key, _source_value, target_value| target_value }
    end

    def organization_brand_attributes(row)
      row.slice(*ORGANIZATION_BRAND_FIELDS).compact_blank.merge(row.slice("offseason_enabled").compact)
    end

    def bridge_registration(tournament, legacy_id)
      registration = Registration.find_or_initialize_by(legacy_source: self.class::LEGACY_SOURCE, legacy_id: legacy_id.to_s)
      if registration.persisted? && registration.tournament_id != tournament.id
        raise InvalidSourceError, "Legacy registration belongs to another tournament"
      end

      registration
    end

    def legacy_golfer(tournament, registration, legacy_tag)
      registration.golfer ||
        tournament.golfers.where("notes LIKE ?", "%#{legacy_tag}%").first ||
        tournament.golfers.new
    end

    def import_payment_token(golfer, registration, token)
      return if token.blank?
      return if Golfer.where.not(id: golfer.id).exists?(payment_token: token)
      return if Registration.where.not(id: registration.id).exists?(payment_token: token)

      token
    end

    def sync_members!(registration, member_attributes)
      if registration.new_record?
        member_attributes.each { |attributes| registration.team_members.build(attributes) }
        registration.save!
      else
        member_attributes.each do |attributes|
          member = registration.team_members.find_or_initialize_by(legacy_id: attributes[:legacy_id], legacy_source: attributes[:legacy_source])
          save_backfill!(member, attributes)
        end
        registration.save! if registration.changed?
      end
    end

    def truthy?(value)
      ActiveModel::Type::Boolean.new.cast(value) == true
    end

    # The import uses read-then-write lookups for legacy keys and blob checksums.
    # Serialize both importers on the destination across concurrent rake runs.
    def lock_destination!
      ActiveRecord::Base.connection.execute("SELECT pg_advisory_xact_lock(1118014062, 1)")
    end
  end
end
