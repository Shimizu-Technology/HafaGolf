# frozen_string_literal: true

require_relative "../hafagolf_migrations/maw_importer"
require_relative "../hafagolf_migrations/giaa_importer"
require_relative "../hafagolf_seeds/fd_alumni_golf_seeder"

namespace :hafagolf do
  namespace :migrate do
    desc "Idempotently import Make-A-Wish snapshot from SOURCE_DATABASE_URL (requires EXPECTED_DB_NAME)"
    task maw: :environment do
      reader = HafagolfMigrations::SourceReader.from_database_url(ENV["SOURCE_DATABASE_URL"])
      begin
        report = HafagolfMigrations::MawImporter.new(source_reader: reader).run!
        puts JSON.pretty_generate(report)
      ensure
        reader.close
      end
    end

    desc "Idempotently import GIAA snapshot from SOURCE_DATABASE_URL (requires EXPECTED_DB_NAME)"
    task giaa: :environment do
      reader = HafagolfMigrations::SourceReader.from_database_url(ENV["SOURCE_DATABASE_URL"])
      begin
        report = HafagolfMigrations::GiaaImporter.new(source_reader: reader).run!
        puts JSON.pretty_generate(report)
      ensure
        reader.close
      end
    end
  end

  namespace :seed do
    desc "Idempotently seed native FD Alumni Golf 2027 tenant (requires EXPECTED_DB_NAME)"
    task fd_alumni: :environment do
      result = HafagolfSeeds::FdAlumniGolfSeeder.seed!
      puts JSON.pretty_generate(result)
    end
  end
end
