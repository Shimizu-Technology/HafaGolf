# frozen_string_literal: true

# Configure Rails 8 Active Record Encryption for per-organization payment credentials.
# Production and staging MUST supply all three keys via environment variables.
# Local development and test use ENV when present, falling back to deterministic
# local-only values so test runs work without committing real secrets.
Rails.application.configure do
  if Rails.env.local?
    config.active_record.encryption.primary_key =
      ENV["ACTIVE_RECORD_ENCRYPTION_PRIMARY_KEY"].presence ||
      "hafagolf_local_dev_test_primary_key_32b"
    config.active_record.encryption.deterministic_key =
      ENV["ACTIVE_RECORD_ENCRYPTION_DETERMINISTIC_KEY"].presence ||
      "hafagolf_local_dev_test_determ_key_32b"
    config.active_record.encryption.key_derivation_salt =
      ENV["ACTIVE_RECORD_ENCRYPTION_KEY_DERIVATION_SALT"].presence ||
      "hafagolf_local_dev_test_salt_value_32b"
  else
    primary = ENV["ACTIVE_RECORD_ENCRYPTION_PRIMARY_KEY"].presence
    deterministic = ENV["ACTIVE_RECORD_ENCRYPTION_DETERMINISTIC_KEY"].presence
    salt = ENV["ACTIVE_RECORD_ENCRYPTION_KEY_DERIVATION_SALT"].presence

    if ENV["SECRET_KEY_BASE_DUMMY"].blank? && (primary.nil? || deterministic.nil? || salt.nil?)
      raise "Missing required ACTIVE_RECORD_ENCRYPTION_* environment variables in #{Rails.env}"
    end

    config.active_record.encryption.primary_key = primary
    config.active_record.encryption.deterministic_key = deterministic
    config.active_record.encryption.key_derivation_salt = salt
  end
end
