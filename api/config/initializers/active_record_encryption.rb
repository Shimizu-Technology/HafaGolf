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
    config.active_record.encryption.primary_key = ENV["ACTIVE_RECORD_ENCRYPTION_PRIMARY_KEY"]
    config.active_record.encryption.deterministic_key = ENV["ACTIVE_RECORD_ENCRYPTION_DETERMINISTIC_KEY"]
    config.active_record.encryption.key_derivation_salt = ENV["ACTIVE_RECORD_ENCRYPTION_KEY_DERIVATION_SALT"]
  end
end
