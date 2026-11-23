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
        slot.assign_attributes(slot_attributes(params).merge(confirmed_at: Time.current))

        unless slot.valid?
          render json: { error: slot.errors.full_messages.to_sentence }, status: :unprocessable_entity
          return
        end

        changed_fields = changed_optional_fields(slot)

        ActiveRecord::Base.transaction(requires_new: true) do
          slot.save!
          SponsorSlotSyncer.new(@sponsor).sync_slot(slot, changed_fields: changed_fields)
        end

        render json: { slot: slot.reload.portal_json }
      rescue ActiveRecord::RecordInvalid => e
        render json: { error: "Nothing was saved because the player list could not be updated: #{e.record.errors.full_messages.to_sentence}" },
               status: :unprocessable_entity
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

        ids = entries.map do |entry|
          raw_id = entry[:id]
          if raw_id.is_a?(Integer)
            raw_id
          elsif raw_id.is_a?(String)
            Integer(raw_id, 10, exception: false)
          end
        end
        if ids.any?(&:nil?) || ids.any? { |id| id <= 0 }
          render json: { error: "Each player entry must include a valid slot ID." }, status: :unprocessable_entity
          return
        end
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
        changed_fields_by_slot_id = {}
        entries.each do |entry|
          slot = slots_by_id[entry[:id].to_i]
          slot.assign_attributes(slot_attributes(entry).merge(confirmed_at: now))
        end

        invalid = slots_by_id.values.reject(&:valid?)
        if invalid.any?
          render json: {
            error: "Please check the highlighted players and try again.",
            slot_errors: invalid.to_h { |slot| [slot.id, slot.errors.full_messages] }
          }, status: :unprocessable_entity
          return
        end

        slots_by_id.each do |slot_id, slot|
          changed = changed_optional_fields(slot)
          changed_fields_by_slot_id[slot_id] = changed if changed.any?
        end

        # requires_new: the request already runs inside the tenant RLS transaction, so a
        # savepoint is what makes a failed roster sync roll back these slot writes.
        ActiveRecord::Base.transaction(requires_new: true) do
          slots_by_id.each_value(&:save!)
          SponsorSlotSyncer.new(@sponsor).sync_slots(
            slots_by_id.values,
            changed_fields_by_slot_id: changed_fields_by_slot_id
          )
        end

        all_slots = @sponsor.sponsor_slots.reload.order(:slot_number).to_a
        render json: {
          slots: all_slots.select { |slot| slots_by_id.key?(slot.id) }.map(&:portal_json),
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

      def changed_optional_fields(slot)
        changed = []
        changed << :tshirt_size if slot.will_save_change_to_tshirt_size?
        changed << :handicap if slot.will_save_change_to_handicap?
        changed
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
