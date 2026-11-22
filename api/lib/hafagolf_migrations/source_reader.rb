# frozen_string_literal: true

require "erb"
require "uri"

module HafagolfMigrations
  class InvalidSourceError < StandardError; end

  # Abstraction over legacy source data:
  # - In tests/dry-runs, reads from an in-memory Hash of table rows (zero external DB access).
  # - In staging/cutover rehearsals (after Leon Gate B), opens a strictly READ-ONLY PG session
  #   against the restored staging snapshot database URL.
  class SourceReader
    def self.from_hash(data, database_name: nil)
      new(fixture_data: data, database_name: database_name)
    end

    def self.from_database_url(url)
      raise ArgumentError, "SOURCE_DATABASE_URL is required" if url.to_s.strip.empty?

      new(database_url: url)
    end

    def initialize(fixture_data: nil, database_url: nil, database_name: nil)
      @fixture_data = fixture_data
      @database_url = database_url
      @fixture_database_name = database_name
      @pg_conn = nil
    end

    def database_name
      return @fixture_database_name if @fixture_data

      pg_connection.exec("SELECT current_database()").getvalue(0, 0)
    end

    def table_exists?(table_name)
      key = table_name.to_s
      if @fixture_data
        return @fixture_data.key?(key) || @fixture_data.key?(key.to_sym)
      end

      pg_connection.exec_params(
        "SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = $1",
        [key]
      ).ntuples.positive?
    end

    def require_non_empty_tables!(*table_names)
      table_names.flatten.each do |name|
        unless table_exists?(name)
          raise InvalidSourceError, "Source database is missing required table '#{name}'"
        end

        if rows(name).empty?
          raise InvalidSourceError, "Source database table '#{name}' is empty; refusing silent 0 == 0 import"
        end
      end
    end

    def rows(table_name)
      key = table_name.to_s
      if @fixture_data
        return Array(@fixture_data[key] || @fixture_data[key.to_sym]).map { |r| stringify_row(r) }
      end

      return [] unless table_exists?(key)

      conn = pg_connection
      quoted = conn.quote_ident(key)
      conn.exec("SELECT * FROM #{quoted} ORDER BY id ASC").map { |r| stringify_row(r) }
    end

    def close
      @pg_conn&.close
      @pg_conn = nil
    end

    private

    def pg_connection
      return @pg_conn if @pg_conn

      require "pg"
      @pg_conn = PG.connect(readonly_connection_url(@database_url))
      # Belt-and-suspenders PostgreSQL read-only session enforcement
      @pg_conn.exec("SET SESSION CHARACTERISTICS AS TRANSACTION READ ONLY")
      @pg_conn
    end

    def readonly_connection_url(url)
      uri = URI.parse(url)
      params = URI.decode_www_form(uri.query.to_s)
      existing_opts = params.find { |k, _| k == "options" }
      if existing_opts
        unless existing_opts[1].include?("default_transaction_read_only=on")
          existing_opts[1] = "#{existing_opts[1]} -c default_transaction_read_only=on".strip
        end
      else
        params << ["options", "-c default_transaction_read_only=on"]
      end
      # libpq percent-decodes URI query params and treats literal '+' as '+' rather than space
      uri.query = params.map { |k, v| "#{ERB::Util.url_encode(k.to_s)}=#{ERB::Util.url_encode(v.to_s)}" }.join("&")
      uri.to_s
    rescue URI::InvalidURIError
      url
    end

    def stringify_row(row)
      row.each_with_object({}) { |(k, v), acc| acc[k.to_s] = v }
    end
  end
end
