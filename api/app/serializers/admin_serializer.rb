# frozen_string_literal: true

class AdminSerializer < ActiveModel::Serializer
  attributes :id, :clerk_id, :name, :email, :role, :created_at, :updated_at,
             :is_super_admin, :org_role, :org_role_label, :capabilities,
             :scoped_tournament_ids, :station_mode

  def is_super_admin
    object.super_admin?
  end

  def org_role
    return "org_admin" if object.super_admin?

    membership&.role
  end

  def org_role_label
    return "Platform Super Admin" if object.super_admin?

    membership&.role_label
  end

  def capabilities
    return OrganizationMembership.all_capabilities_map(true) if object.super_admin?
    return OrganizationMembership.all_capabilities_map(false) unless membership

    membership.effective_capabilities
  end

  def scoped_tournament_ids
    return [] if object.super_admin? || membership.nil?

    membership.scoped_tournament_ids || []
  end

  def station_mode
    return nil if object.super_admin? || membership.nil?

    membership.station_mode
  end

  private

  def resolved_org
    return @resolved_org if defined?(@resolved_org)

    @resolved_org = @instance_options[:scope_organization] || Current.organization || object.organizations.first
  end

  def membership
    return @membership if defined?(@membership)

    @membership = resolved_org ? object.membership_for(resolved_org) : nil
  end
end
