# frozen_string_literal: true

module Waivers
  class RecordSignature
    def self.call(player, staff:, partner: false)
      timestamp = partner ? :partner_waiver_accepted_at : :waiver_accepted_at

      player.with_lock do
        next if player[timestamp].present?

        player.update!(timestamp => Time.current)
        ActivityLog.log(
          admin: staff,
          action: "waiver_signed",
          target: player,
          details: "Recorded signed waiver for #{partner ? player.partner_name : player.name}",
          metadata: { partner: partner }
        )
      end
    end
  end
end
