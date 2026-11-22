# frozen_string_literal: true

module HafagolfMigrations
  # Abstraction over legacy source data:
  # - In tests/dry-runs, reads from an in-memory Hash of table rows (zero external DB access).
  # - In staging/cutover rehearsals (after Leon Gate B), opens a strictly READ-ONLY PG session
  #   against the restored staging snapshot database URL.
  class SourceReader
    def self.from_hash(data)
      new(fixture_data: data)
    end

    def self.from_database_url(url)
      raise ArgumentError, "SOURCE_DATABASE_URL is required" if url.to_s.strip.empty?

      new(database_url: url)
    end

    def initialize(fixture_data: nil, database_url: nil)
      @fixture_data = fixture_data
      @database_url = database_url
      @pg_conn = nil
    end

    def rows(table_name)
      key = table_name.to_s
      if @fixture_data
        return Array(@fixture_data[key] || @fixture_data[key.to_sym]).map { |r| stringify_row(r) }
      end

      conn = pg_connection
      exists = conn.exec_params(
        "SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = $1",
        [key]
      ).ntuples.positive?
      return [] unless exists

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
      @pg_conn = PG.connect(@database_url)
      # Belt-and-suspenders PostgreSQL read-only session enforcement
      @pg_conn.exec("SET SESSION CHARACTERISTICS AS TRANSACTION READ ONLY")
      @pg_conn
    end

    def stringify_row(row)
      row.each_with_object({}) { |(k, v), acc| acc[k.to_s] = v }
    end
  end
end
