# frozen_string_literal: true

module Api
  module V1
    class TournamentAddOnsController < BaseController
      skip_before_action :authenticate_user!, only: [:index]
      skip_around_action :with_tenant_rls_context, only: [:index]
      before_action :authenticate_optional_user, only: [:index]
      before_action :set_tournament
      before_action :authorize_index_access!, only: [:index]
      before_action :authorize_manage_settings!, only: [:create, :update, :destroy]
      before_action :set_add_on, only: [:update, :destroy]

      # GET /api/v1/tournaments/:tournament_id/add_ons
      def index
        organization = @tournament.organization
        is_admin = admin_request?
        add_ons_json = []

        with_resolved_org_rls(organization) do
          scope = @tournament.tournament_add_ons.ordered
          scope = scope.active unless is_admin
          records = scope.to_a
          sold_counts = TournamentAddOn.sold_quantities_by_add_on_id(records.map(&:id))
          add_ons_json = records.map do |add_on|
            add_on.as_public_json(
              precomputed_sold: sold_counts.fetch(add_on.id, 0),
              include_admin_fields: is_admin
            )
          end
        end

        render json: { add_ons: add_ons_json }
      end

      # POST /api/v1/tournaments/:tournament_id/add_ons
      def create
        add_on = @tournament.tournament_add_ons.build(add_on_params)
        add_on.organization = @tournament.organization

        if add_on.save
          render json: {
            add_on: add_on.as_public_json(precomputed_sold: 0, include_admin_fields: true),
            message: "Add-on created"
          }, status: :created
        else
          render json: { error: add_on.errors.full_messages.join(", "), errors: add_on.errors.full_messages }, status: :unprocessable_entity
        end
      end

      # PATCH /api/v1/tournaments/:tournament_id/add_ons/:id
      def update
        if @add_on.update(add_on_params)
          render json: {
            add_on: @add_on.as_public_json(include_admin_fields: true),
            message: "Add-on updated"
          }
        else
          render json: { error: @add_on.errors.full_messages.join(", "), errors: @add_on.errors.full_messages }, status: :unprocessable_entity
        end
      end

      # DELETE /api/v1/tournaments/:tournament_id/add_ons/:id
      def destroy
        if @add_on.golfer_add_ons.exists?
          @add_on.update!(active: false)
          render json: {
            add_on: @add_on.as_public_json(include_admin_fields: true),
            deactivated: true,
            message: "Add-on has existing purchases and was deactivated instead of deleted."
          }
        else
          @add_on.destroy!
          render json: { deleted: true, message: "Add-on deleted." }
        end
      end

      private

      def authenticate_optional_user
        return if request.headers["Authorization"].blank?

        authenticate_user!
      end

      def admin_request?
        current_user.present? &&
          @tournament.present? &&
          current_user.can?(:manage_settings, organization: @tournament.organization, tournament: @tournament)
      end

      def set_tournament
        if action_name == "index"
          @tournament = if Current.organization.present?
                          TenantContext.with_organization(Current.organization) do
                            Tournament.includes(:organization).find(params[:tournament_id])
                          end
                        elsif current_user.present?
                          with_user_rls_context do
                            Tournament.includes(:organization).find(params[:tournament_id])
                          end
                        else
                          TenantContext.with_platform_access do
                            Tournament.includes(:organization).find(params[:tournament_id])
                          end
                        end
        else
          @tournament = Tournament.includes(:organization).find(params[:tournament_id])
        end
      end

      def set_add_on
        @add_on = @tournament.tournament_add_ons.find(params[:id])
      end

      def authorize_index_access!
        return if admin_request?

        return unless verify_tenant_match!(@tournament.organization_id, status: :not_found, message: "Tournament not found")

        unless @tournament.public_listed?
          render json: { error: "Tournament not found" }, status: :not_found
        end
      end

      def authorize_manage_settings!
        return unless verify_tenant_match!(@tournament.organization_id, status: :not_found, message: "Tournament not found")

        require_capability!(:manage_settings, tournament: @tournament)
      end

      def with_resolved_org_rls(organization, &block)
        if current_user.present?
          with_user_rls_context(&block)
        else
          TenantContext.with_organization(organization.id, &block)
        end
      end

      def add_on_params
        raw = params[:add_on].present? ? params.require(:add_on) : params
        raw.permit(
          :name,
          :description,
          :price_cents,
          :max_quantity_per_order,
          :max_total_quantity,
          :category,
          :active,
          :sort_order
        )
      end
    end
  end
end
