module Api
  module V1
    class SponsorSlotsController < BaseController
      include SponsorPortalSession

      MAX_BATCH_SLOTS = 100
      SLOT_FIELDS = %i[player_name player_email player_phone tshirt_size handicap].freeze

      skip_before_action :authenticate_user!
      skip_around_action :with_tenant_rls_context
      before_action :authenticate_sponsor!
      around_action :with_tenant_rls_context
      before_action -> { require_feature!(:sponsors, tournament: @sponsor.tournament) }
      before_action :reject_after_deadline!, only: [:update, :batch_update]

      # GET /api/v1/sponsor_slots
      def index
        slots = @sponsor.sponsor_slots.order(:slot_number)
        render json: {
          slots: slots.map(&:portal_json),
          waiver_enabled: @sponsor.tournament.waiver_enabled,
          tournament: portal_tournament_json(@sponsor.tournament)
        }
      end

      # PATCH /api/v1/sponsor_slots/:id
      def update
        slot = @sponsor.sponsor_slots.find(params[:id])

        slot.update!(slot_attributes(params).merge(confirmed_at: Time.current))

        begin
          SponsorSlotSyncer.new(@sponsor).sync_slot(slot)
        rescue ActiveRecord::RecordInvalid => e
          render json: { error: "Slot saved but player roster sync failed: #{e.message}" }, status: :unprocessable_entity
          return
        end

        render json: { slot: slot.portal_json }
      end

      # PATCH /api/v1/sponsor_slots/batch
      # Saves a whole team (or any set of this sponsor's slots) atomically: every slot
      # update and the Golfer / Registration + TeamMember roster sync either all
      # succeed or all roll back, so a sponsor never ends up with a half-saved team.
      def batch_update
        entries = Array(params[:slots])
        if entries.empty? || entries.length > MAX_BATCH_SLOTS || !entries.all? { |entry| entry.respond_to?(:key?) }
          render json: { error: "Send between 1 and #{MAX_BATCH_SLOTS} players to save." }, status: :unprocessable_entity
          return
        end

        ids = entries.map { |entry| entry[:id].to_i }
        if ids.uniq.length != ids.length
          render json: { error: "Each player can only be saved once per request." }, status: :unprocessable_entity
          return
        end

        slots_by_id = @sponsor.sponsor_slots.where(id: ids).index_by(&:id)
        unless slots_by_id.length == ids.length
          render json: { error: "One or more players could not be found for this sponsorship." }, status: :not_found
          return
        end

        now = Time.current
        entries.each { |entry| slots_by_id[entry[:id].to_i].assign_attributes(slot_attributes(entry).merge(confirmed_at: now)) }

        invalid = slots_by_id.values.reject(&:valid?)
        if invalid.any?
          render json: {
            error: "Please check the highlighted players and try again.",
            slot_errors: invalid.to_h { |slot| [slot.id, slot.errors.full_messages] }
          }, status: :unprocessable_entity
          return
        end

        # requires_new: the request already runs inside the tenant RLS transaction, so a
        # savepoint is what makes a failed roster sync roll back these slot writes.
        ActiveRecord::Base.transaction(requires_new: true) do
          slots_by_id.each_value(&:save!)
          SponsorSlotSyncer.new(@sponsor).sync_slots(slots_by_id.values)
        end

        all_slots = @sponsor.sponsor_slots.reload.order(:slot_number).to_a
        render json: {
          slots: slots_by_id.values.sort_by(&:slot_number).map(&:portal_json),
          filled_count: all_slots.count(&:filled?),
          slot_count: all_slots.length
        }
      rescue ActiveRecord::RecordInvalid => e
        render json: { error: "Nothing was saved because the player list could not be updated: #{e.record.errors.full_messages.to_sentence}" },
               status: :unprocessable_entity
      end

      private

      def reject_after_deadline!
        return unless sponsor_edit_deadline_passed?

        render json: { error: "The deadline for editing player slots has passed." }, status: :forbidden
      end

      # Name / email / phone keep the legacy "missing means cleared" behavior; the
      # optional shirt size and handicap are only touched when the client sends them
      # so older portal clients never wipe them.
      def slot_attributes(source)
        attrs = {
          player_name: source[:player_name],
          player_email: source[:player_email],
          player_phone: source[:player_phone]
        }
        attrs[:tshirt_size] = source[:tshirt_size] if source.key?(:tshirt_size)
        attrs[:handicap] = source[:handicap].presence if source.key?(:handicap)
        attrs
      end
    end
  end
end
