# frozen_string_literal: true

module HafagolfMigrations
  class UnsafeDatabaseError < StandardError; end

  # Enforces explicit database identity confirmation before any migration or seed
  # task executes, and unconditionally blocks running against local development DBs.
  module DatabaseGuard
    FORBIDDEN_DATABASES = %w[api_development hafagolf_development].freeze

    module_function

    def verify!(expected_db_name: ENV["EXPECTED_DB_NAME"], connection: ActiveRecord::Base.connection)
      actual = connection.current_database.to_s.strip
      expected = expected_db_name.to_s.strip

      if FORBIDDEN_DATABASES.include?(actual)
        raise UnsafeDatabaseError, "Refusing to run migration/seed against forbidden database '#{actual}'"
      end

      if expected.blank?
        raise UnsafeDatabaseError, "EXPECTED_DB_NAME must be set to '#{actual}' before running this task"
      end

      unless actual == expected
        raise UnsafeDatabaseError, "Database mismatch: EXPECTED_DB_NAME='#{expected}' does not match current_database='#{actual}'"
      end

      actual
    end

    def verify_source_distinct!(source_db_name:, connection: ActiveRecord::Base.connection)
      src = source_db_name.to_s.strip
      return if src.empty?

      actual = connection.current_database.to_s.strip
      if src == actual
        raise UnsafeDatabaseError, "SOURCE_DATABASE_URL points to the same database as target ('#{actual}')"
      end
    end
  end
end
