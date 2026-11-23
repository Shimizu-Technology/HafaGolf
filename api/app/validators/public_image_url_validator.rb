# frozen_string_literal: true

class PublicImageUrlValidator < ActiveModel::EachValidator
  def self.safe?(value)
    return false unless value.is_a?(String)
    return false if value.match?(/[[:space:][:cntrl:]\\]/)

    uri = URI.parse(value)
    if uri.scheme
      uri.is_a?(URI::HTTP) && uri.host.present? && uri.userinfo.nil?
    else
      return false unless uri.host.nil? && uri.path.to_s.match?(%r{\A/(?:images|rails/active_storage)/.+})

      decoded_path = URI::DEFAULT_PARSER.unescape(uri.path)
      decoded_path.valid_encoding? &&
        decoded_path.match?(%r{\A/(?:images|rails/active_storage)/.+}) &&
        !decoded_path.match?(/[[:cntrl:]\\]/) &&
        decoded_path.split("/").none? { |part| %w[. ..].include?(part) }
    end
  rescue URI::InvalidURIError
    false
  end

  def validate_each(record, attribute, value)
    return if self.class.safe?(value)

    record.errors.add(attribute, "must be an HTTP(S) or local image URL")
  end
end
