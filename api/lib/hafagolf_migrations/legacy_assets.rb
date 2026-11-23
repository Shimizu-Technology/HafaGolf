# frozen_string_literal: true

require "base64"
require "digest/md5"
require "set"
require "uri"

module HafagolfMigrations
  class LegacyAssets
    attr_reader :migrated_count

    def initialize(source:, blob_dir: nil, brand_assets_dir: nil, asset_host: nil)
      @source = source
      @blob_dir = existing_directory(blob_dir)
      @brand_assets_dir = existing_directory(brand_assets_dir)
      @asset_host = asset_host.presence
      @asset_hostname = parse_url(@asset_host)&.host
      @migrated_count = 0
    end

    def import_attachments(sponsors:, prizes:)
      return unless @blob_dir

      blobs = legacy_blobs.index_by { |blob| blob["id"].to_s }
      @source.rows("active_storage_attachments").each do |row|
        case row.values_at("record_type", "name")
        when ["Sponsor", "logo"]
          record = sponsors[row["record_id"].to_s]
          attach_blob(record, :logo, :logo_url, blobs[row["blob_id"].to_s]) if record
        when ["RafflePrize", "image"]
          record = prizes[row["record_id"].to_s]
          attach_blob(record, :image, :image_url, blobs[row["blob_id"].to_s]) if record
        end
      end
    end

    def replace_blob_urls(records, fields)
      return unless @blob_dir

      rows_by_id = legacy_blobs.index_by { |row| row["id"].to_s }
      rows_by_filename = legacy_blobs.group_by { |row| row["filename"] }
      replaced_assets = Set.new
      records.each do |record|
        fields.each do |field|
          url = record.public_send(field)
          next unless stale_url?(url)

          parts = blob_url_parts(url)
          next unless parts

          signed_id, filename = parts
          row = rows_by_id[legacy_blob_id(signed_id)]
          matches = rows_by_filename[filename]
          row ||= matches.first if matches&.one?
          unless row
            Rails.logger.warn("[LegacyAssets] No unique source blob for #{record.class.name} #{record.id} #{field}")
            next
          end

          blob = upload_legacy_blob(row)
          next unless blob

          record.update!(field => blob_url(blob))
          replaced_assets.add(row["id"])
        end
      end
      @migrated_count += replaced_assets.size
    end

    # Each target is a record and an attribute. The caller may limit a fallback
    # to blank fields by omitting targets with populated URLs.
    def wire_brand_asset(filename, targets, match_filename: false)
      return unless @brand_assets_dir

      targets = targets.select do |record, field|
        url = record.public_send(field)
        url.blank? || stale_url?(url)
      end
      return if targets.empty?

      path = local_file(@brand_assets_dir, filename)
      return unless path

      blob = upload_blob(path, filename: filename, match_filename: match_filename)
      url = blob_url(blob)
      targets.each { |record, field| record.update!(field => url) }
      @migrated_count += 1
    end

    private

    def attach_blob(record, attachment_name, url_field, row)
      attachment = record.public_send(attachment_name)
      unless attachment.attached?
        blob = upload_legacy_blob(row)
        return unless blob

        # Attach the uploaded blob so Rails can save the attachment in the same
        # transaction without retaining a file handle until after commit.
        attachment.attach(blob) || raise(ActiveRecord::RecordInvalid, record)
        @migrated_count += 1
      end

      # Sponsor URL validation accepts image URLs, but the attachment takes over
      # once the stale direct URL is cleared.
      record.update_column(url_field, nil) if stale_url?(record.public_send(url_field))
    end

    def legacy_blobs
      @legacy_blobs ||= @source.rows("active_storage_blobs")
    end

    def upload_legacy_blob(row)
      path = local_file(@blob_dir, row&.fetch("key", nil))
      unless path && row["filename"].present?
        Rails.logger.warn("[LegacyAssets] Missing local file or metadata for source blob #{row&.fetch('id', nil)}")
        return
      end

      upload_blob(path, filename: row["filename"], content_type: row["content_type"])
    end

    def upload_blob(path, filename:, content_type: nil, match_filename: false)
      checksum = Digest::MD5.file(path).base64digest
      candidates = ActiveStorage::Blob.where(checksum: checksum, service_name: ActiveStorage::Blob.service.name)
      candidates = candidates.where(filename: filename) if match_filename
      existing = candidates.order(:id).detect { |blob| blob.service.exist?(blob.key) }
      return existing if existing

      File.open(path, "rb") do |file|
        blob = ActiveStorage::Blob.create_and_upload!(io: file, filename: filename, content_type: content_type)
        ActiveRecord::Base.current_transaction.after_rollback { blob.delete }
        blob
      end
    end

    def blob_url(blob)
      helpers = Rails.application.routes.url_helpers
      return helpers.rails_blob_url(blob, host: @asset_host) if @asset_host

      helpers.rails_service_blob_path(blob.signed_id, blob.filename)
    end

    def stale_url?(url)
      uri = parse_url(url)
      return false unless uri
      return false if uri.host.present? && uri.host == @asset_hostname

      parts = blob_url_parts(url)
      return false if parts && ActiveStorage::Blob.find_signed(parts.first)
      return true if uri.host.to_s.downcase.end_with?(".onrender.com")

      parts && (uri.host.nil? || snapshot_urls.include?(url))
    end

    def snapshot_urls
      @snapshot_urls ||= {
        "organizations" => %w[logo_url banner_url reversed_logo_url],
        "settings" => %w[logo_url banner_url reversed_logo_url commemorative_banner_url signature_image_url_override],
        "tournaments" => %w[banner_url_override logo_url_override signature_image_url_override commemorative_banner_url],
        "sponsors" => %w[logo_url],
        "raffle_prizes" => %w[image_url]
      }.flat_map { |table, fields| @source.rows(table).flat_map { |row| row.values_at(*fields).compact } }.to_set
    end

    def blob_url_parts(url)
      path = parse_url(url)&.path
      match = path&.match(%r{\A/rails/active_storage/blobs/(?:redirect/|proxy/)?([^/]+)/([^/]+)\z})
      return unless match

      [match[1], URI::DEFAULT_PARSER.unescape(match[2])]
    end

    # The source signature cannot be verified here. Use the encoded ID only
    # to match the supplied snapshot metadata, never to authorize access.
    def legacy_blob_id(signed_id)
      encoded = signed_id.split("--", 2).first
      envelope = JSON.parse(Base64.urlsafe_decode64(encoded)).fetch("_rails")
      id = envelope["data"] || JSON.parse(Base64.strict_decode64(envelope.fetch("message")))
      id.to_s if id.is_a?(Integer) || id.is_a?(String)
    rescue JSON::ParserError, ArgumentError, KeyError, TypeError, NoMethodError
      nil
    end

    def parse_url(value)
      URI.parse(value) if value.present?
    rescue URI::InvalidURIError
      nil
    end

    def existing_directory(path)
      File.realpath(path) if path.present? && File.directory?(path)
    end

    def local_file(directory, basename)
      return unless basename.present? && File.basename(basename) == basename

      path = File.realpath(File.join(directory, basename))
      path if File.dirname(path) == directory && File.file?(path)
    rescue Errno::ENOENT, Errno::ENOTDIR
      nil
    end
  end
end
