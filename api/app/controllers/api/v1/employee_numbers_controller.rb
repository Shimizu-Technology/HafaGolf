# frozen_string_literal: true

module Api
  module V1
    class EmployeeNumbersController < BaseController
      skip_before_action :authenticate_user!, only: [:validate]
      skip_around_action :with_tenant_rls_context, only: [:validate]

      before_action :set_collection_tournament, only: [:index, :create, :bulk_create]
      before_action :authorize_collection_access!, only: [:index, :create, :bulk_create]
      before_action :require_collection_feature!, only: [:index, :create, :bulk_create]

      before_action :set_employee_number, only: [:update, :destroy]
      before_action :authorize_member_access!, only: [:update, :destroy]
      before_action :require_member_feature!, only: [:update, :destroy]

      # POST /api/v1/employee_numbers/validate
      # Public rate-limited endpoint scoped to resolved org + tournament.
      def validate
        org = resolve_public_organization
        raw_number = params[:employee_number].to_s
        normalized = EmployeeNumber.normalize_number(raw_number)

        outcome = nil

        run_in_public_rls_context(org) do
          tournament = resolve_scoped_public_tournament(org)

          unless tournament
            outcome = {
              status: :not_found,
              body: { valid: false, available: false, error: "Tournament not found" }
            }
            next
          end

          unless Features.for(tournament.organization, tournament).enabled?(:employee_pricing)
            outcome = {
              status: :forbidden,
              body: {
                error: "Feature 'employee_pricing' is disabled for this event",
                feature: "employee_pricing"
              }
            }
            next
          end

          if tournament.employee_entry_fee.blank?
            outcome = {
              status: :unprocessable_entity,
              body: {
                valid: false,
                available: false,
                error: "Employee pricing fee is not configured for this event"
              }
            }
            next
          end

          if normalized.blank?
            outcome = {
              status: :unprocessable_entity,
              body: { valid: false, available: false, error: "Employee number is required" }
            }
            next
          end

          record = EmployeeNumber.find_for_tournament(tournament, normalized)

          if record.nil?
            outcome = {
              status: :ok,
              body: {
                valid: false,
                available: false,
                message: "Invalid employee number"
              }
            }
          elsif record.used?
            outcome = {
              status: :ok,
              body: {
                valid: true,
                available: false,
                message: "This employee number has already been used"
              }
            }
          else
            outcome = {
              status: :ok,
              body: {
                valid: true,
                available: true,
                employee_number: record.employee_number,
                employee_entry_fee_cents: tournament.employee_entry_fee
              }
            }
          end
        end

        render json: outcome[:body], status: outcome[:status]
      end

      # GET /api/v1/employee_numbers
      def index
        records = @tournament.employee_numbers.includes(:used_by_golfer, :used_by_registration)

        case params[:status].to_s
        when "available"
          records = records.available
        when "used"
          records = records.used_numbers
        end

        records = records.search(params[:search]) if params[:search].present?
        records = records.order(Arel.sql("LOWER(employee_number) ASC"))

        render json: {
          employee_numbers: records.map { |record| serialize_employee_number(record) },
          stats: stats_for(@tournament)
        }
      end

      # POST /api/v1/employee_numbers
      def create
        attrs = extract_employee_number_params
        record = @tournament.employee_numbers.build(
          organization: @tournament.organization,
          employee_number: attrs[:employee_number],
          employee_name: attrs[:employee_name]
        )

        if record.save
          render json: {
            employee_number: serialize_employee_number(record),
            stats: stats_for(@tournament)
          }, status: :created
        else
          render json: { errors: record.errors.full_messages }, status: :unprocessable_entity
        end
      rescue ActiveRecord::RecordNotUnique
        render json: { errors: ["Employee number already exists for this tournament"] }, status: :unprocessable_entity
      end

      # POST /api/v1/employee_numbers/bulk_create
      def bulk_create
        entries = parse_bulk_entries
        if entries.nil?
          render json: { errors: ["Provide employee_numbers array or raw_text/csv_text"] }, status: :unprocessable_entity
          return
        end

        created_records = []
        skipped_count = 0
        errors = []

        existing_set = @tournament.employee_numbers
                                  .pluck(Arel.sql("LOWER(employee_number)"))
                                  .each_with_object({}) { |num, h| h[num] = true }
        seen_in_batch = {}

        entries.each_with_index do |entry, idx|
          normalized = EmployeeNumber.normalize_number(entry[:employee_number])
          if normalized.blank?
            errors << "Row #{idx + 1}: employee number is blank"
            next
          end

          downcased = normalized.downcase
          if existing_set[downcased] || seen_in_batch[downcased]
            skipped_count += 1
            next
          end

          seen_in_batch[downcased] = true

          record = @tournament.employee_numbers.build(
            organization: @tournament.organization,
            employee_number: normalized,
            employee_name: entry[:employee_name]
          )

          begin
            saved = false
            ActiveRecord::Base.transaction(requires_new: true) do
              saved = record.save
            end

            if saved
              created_records << record
              existing_set[downcased] = true
            else
              errors << "#{normalized}: #{record.errors.full_messages.join(', ')}"
            end
          rescue ActiveRecord::RecordNotUnique
            skipped_count += 1
            existing_set[downcased] = true
          end
        end

        render json: {
          created: created_records.length,
          skipped: skipped_count,
          errors: errors,
          employee_numbers: created_records.map { |record| serialize_employee_number(record) },
          stats: stats_for(@tournament)
        }, status: created_records.any? ? :created : :ok
      end

      # PATCH /api/v1/employee_numbers/:id
      def update
        attrs = extract_employee_number_params
        should_release = ActiveModel::Type::Boolean.new.cast(params[:release]) ||
                         (attrs.key?(:used) && ActiveModel::Type::Boolean.new.cast(attrs[:used]) == false)

        update_fields = {}
        update_fields[:employee_number] = attrs[:employee_number] if attrs.key?(:employee_number) && attrs[:employee_number].present?
        update_fields[:employee_name] = attrs[:employee_name] if attrs.key?(:employee_name)

        validation_errors = nil

        ActiveRecord::Base.transaction(requires_new: true) do
          @employee_number.lock!

          if should_release
            @employee_number.release!
          elsif attrs.key?(:used) && ActiveModel::Type::Boolean.new.cast(attrs[:used]) == true && !@employee_number.used?
            @employee_number.update!(used: true, used_at: Time.current)
          end

          if update_fields.any? && !@employee_number.update(update_fields)
            validation_errors = @employee_number.errors.full_messages
            raise ActiveRecord::Rollback
          end
        end

        if validation_errors
          render json: { errors: validation_errors }, status: :unprocessable_entity
          return
        end

        @employee_number.reload
        render json: {
          employee_number: serialize_employee_number(@employee_number),
          stats: stats_for(@employee_number.tournament)
        }
      rescue ActiveRecord::RecordNotUnique
        render json: { errors: ["Employee number already exists for this tournament"] }, status: :unprocessable_entity
      end

      # DELETE /api/v1/employee_numbers/:id
      def destroy
        allow_release = ActiveModel::Type::Boolean.new.cast(params[:release]) ||
                        ActiveModel::Type::Boolean.new.cast(params[:force])

        blocked = false
        ActiveRecord::Base.transaction(requires_new: true) do
          @employee_number.lock!

          if @employee_number.used?
            unless allow_release
              blocked = true
              raise ActiveRecord::Rollback
            end

            @employee_number.release!
          end

          @employee_number.destroy!
        end

        if blocked
          render json: {
            error: "Cannot delete a used employee number. Release it first or pass release=true."
          }, status: :unprocessable_entity
          return
        end

        head :no_content
      end

      private

      def set_collection_tournament
        @tournament = if params[:tournament_id].present?
          Tournament.find(params[:tournament_id])
        else
          current_user&.accessible_tournaments&.recent&.first
        end

        return if @tournament

        render json: { error: "Tournament not found or not specified" }, status: :not_found
      end

      def authorize_collection_access!
        return if performed?

        require_tournament_admin!(@tournament)
      end

      def require_collection_feature!
        return if performed?

        require_feature!(:employee_pricing, organization: @tournament.organization, tournament: @tournament)
      end

      def set_employee_number
        @employee_number = EmployeeNumber.includes(:tournament, :organization, :used_by_golfer, :used_by_registration).find(params[:id])
      end

      def authorize_member_access!
        return if performed?

        require_tournament_admin!(@employee_number.tournament)
      end

      def require_member_feature!
        return if performed?

        require_feature!(:employee_pricing, organization: @employee_number.organization, tournament: @employee_number.tournament)
      end

      def resolve_scoped_public_tournament(org)
        scope = if org.present?
          org.tournaments
        elsif Current.organization.present?
          Current.organization.tournaments
        else
          Tournament.all
        end

        if params[:tournament_id].present?
          scope.find_by(id: params[:tournament_id])
        elsif org.present?
          Tournament.current_for(org)
        else
          nil
        end
      end

      def run_in_public_rls_context(organization, &block)
        if organization.present?
          TenantContext.with_organization(organization, &block)
        else
          TenantContext.with_closed_access(&block)
        end
      end

      def extract_employee_number_params
        nested = params[:employee_number]
        if nested.is_a?(ActionController::Parameters) || nested.is_a?(Hash)
          nested_params = nested.is_a?(ActionController::Parameters) ? nested : ActionController::Parameters.new(nested)
          nested_params.permit(:employee_number, :employee_name, :used).to_h.symbolize_keys
        else
          permitted = params.permit(:employee_number, :employee_name, :used).to_h.symbolize_keys
          permitted
        end
      end

      def parse_bulk_entries
        if params[:employee_numbers].is_a?(Array)
          return params[:employee_numbers].map do |item|
            if item.is_a?(ActionController::Parameters) || item.is_a?(Hash)
              h = item.respond_to?(:to_unsafe_h) ? item.to_unsafe_h : item
              {
                employee_number: h["employee_number"] || h[:employee_number] || h["number"] || h[:number],
                employee_name: h["employee_name"] || h[:employee_name] || h["name"] || h[:name]
              }
            else
              { employee_number: item.to_s, employee_name: nil }
            end
          end
        end

        raw_text = params[:raw_text].presence || params[:csv_text].presence
        return nil if raw_text.nil?

        lines = raw_text.to_s.split(/\r?\n/).map(&:strip).reject(&:blank?)
        entries = []
        lines.each_with_index do |line, idx|
          parts = line.split(/[,\t]/, 2).map(&:strip)
          first = parts[0].to_s.gsub(/\A["']|["']\z/, "")
          second = parts[1]&.gsub(/\A["']|["']\z/, "")&.presence

          # Skip common header row on first line
          if idx == 0 && first.downcase.in?(%w[employee_number emp_number number id employee_id])
            next
          end

          entries << { employee_number: first, employee_name: second }
        end
        entries
      end

      def stats_for(tournament)
        total, used = tournament.employee_numbers.pick(
          Arel.sql("COUNT(*)"),
          Arel.sql("COUNT(*) FILTER (WHERE used = true)")
        )
        total = total.to_i
        used = used.to_i
        {
          total: total,
          used: used,
          available: total - used
        }
      end

      def serialize_employee_number(record)
        {
          id: record.id,
          organization_id: record.organization_id,
          tournament_id: record.tournament_id,
          employee_number: record.employee_number,
          employee_name: record.employee_name,
          used: record.used,
          used_by_golfer_id: record.used_by_golfer_id,
          used_by_registration_id: record.used_by_registration_id,
          used_by_golfer_name: record.used_by_golfer&.name || record.used_by_registration&.display_team_name,
          used_at: record.used_at&.iso8601,
          created_at: record.created_at&.iso8601,
          updated_at: record.updated_at&.iso8601
        }
      end
    end
  end
end
