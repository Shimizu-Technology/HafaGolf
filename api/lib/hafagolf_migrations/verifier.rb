# frozen_string_literal: true

module HafagolfMigrations
  class VerificationMismatchError < StandardError
    attr_reader :report

    def initialize(message, report:)
      super(message)
      @report = report
    end
  end

  # Compares source vs target row counts, cent-exact financial sums, and
  # referential integrity for a migrated organization, outputting a
  # machine-readable JSON-ready Hash and raising VerificationMismatchError on any mismatch.
  class Verifier
    def self.verify!(source_metrics:, target_metrics:, orphans: {})
      new(source_metrics: source_metrics, target_metrics: target_metrics, orphans: orphans).verify!
    end

    def initialize(source_metrics:, target_metrics:, orphans: {})
      @source = deep_stringify(source_metrics)
      @target = deep_stringify(target_metrics)
      @orphans = deep_stringify(orphans)
    end

    def verify!
      mismatches = []

      all_keys = (@source.keys | @target.keys).sort
      all_keys.each do |key|
        src_val = @source[key]
        tgt_val = @target[key]
        if src_val != tgt_val
          mismatches << {
            "metric" => key,
            "source" => src_val,
            "target" => tgt_val
          }
        end
      end

      @orphans.each do |relation, count|
        next if count.to_i.zero?

        mismatches << {
          "metric" => "orphan_#{relation}",
          "source" => 0,
          "target" => count.to_i
        }
      end

      report = {
        "verified_at" => Time.current.iso8601,
        "matched" => mismatches.empty?,
        "source" => @source,
        "target" => @target,
        "orphans" => @orphans,
        "mismatches" => mismatches
      }

      if mismatches.any?
        summary = mismatches.map { |m| "#{m['metric']} (source=#{m['source']} target=#{m['target']})" }.join(", ")
        raise VerificationMismatchError.new("Migration verification failed: #{summary}", report: report)
      end

      report
    end

    private

    def deep_stringify(obj)
      case obj
      when Hash
        obj.each_with_object({}) { |(k, v), out| out[k.to_s] = deep_stringify(v) }
      when Array
        obj.map { |v| deep_stringify(v) }
      else
        obj
      end
    end
  end
end
