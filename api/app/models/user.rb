# frozen_string_literal: true

class User < ApplicationRecord
  # Associations
  has_many :activity_logs, foreign_key: :admin_id, dependent: :nullify, inverse_of: :user
  has_many :organization_memberships, dependent: :destroy
  has_many :organizations, through: :organization_memberships
  has_many :tournament_assignments, dependent: :destroy
  has_many :assigned_tournaments, through: :tournament_assignments, source: :tournament

  # Validations
  validates :clerk_id, uniqueness: true, allow_nil: true
  validates :email, presence: true, uniqueness: { case_sensitive: false }
  validates :role, inclusion: { in: %w[super_admin org_admin tournament_admin] }

  # Callbacks
  before_validation :normalize_email
  before_validation :set_default_role, on: :create

  # Scopes
  scope :super_admins, -> { where(role: 'super_admin') }
  scope :org_admins, -> { where(role: 'org_admin') }
  scope :tournament_admins, -> { where(role: 'tournament_admin') }

  # Role constants
  ROLES = %w[super_admin org_admin tournament_admin].freeze

  # Find user by clerk_id or email
  def self.find_by_clerk_or_email(clerk_id:, email:)
    user = find_by(clerk_id: clerk_id) if clerk_id.present?
    return user if user

    find_by('LOWER(email) = ?', email&.downcase) if email.present?
  end

  # Role checks
  def super_admin?
    role == 'super_admin'
  end

  def org_admin?
    role == 'org_admin' || super_admin?
  end

  def tournament_admin?
    role == 'tournament_admin' || org_admin?
  end

  # Organization access checks
  def membership_for(organization)
    return nil unless organization

    organization_memberships.find_by(organization: organization)
  end

  def org_admin_for?(organization)
    return true if super_admin?
    return false unless organization

    organization_memberships.exists?(organization: organization, role: OrganizationMembership::ADMIN_ROLES)
  end

  def member_of?(organization)
    return true if super_admin?
    return false unless organization

    organization_memberships.exists?(organization: organization)
  end

  def volunteer_for?(organization)
    return false unless organization

    organization_memberships.exists?(organization: organization, role: %w[volunteer checkin_volunteer raffle_volunteer scoring_marshal coordinator])
  end

  def org_role_for(organization)
    return 'org_admin' if super_admin?
    membership_for(organization)&.role
  end

  def can?(capability, organization:, tournament: nil)
    return true if super_admin?
    return false unless organization

    membership = membership_for(organization)
    return membership.can?(capability, tournament: tournament) == true if membership

    # Legacy fallback: users with explicit tournament_assignments but no org membership
    return false unless tournament

    tournament_assignments.exists?(tournament: tournament)
  end

  def capabilities_for(organization)
    return OrganizationMembership.all_capabilities_map(true) if super_admin?
    return OrganizationMembership.all_capabilities_map(false) unless organization

    membership_for(organization)&.effective_capabilities || OrganizationMembership.all_capabilities_map(false)
  end

  # Tournament access checks (explicit org_admin or legacy tournament_assignment only — never widened by manage_golfers)
  def can_manage?(tournament)
    return true if super_admin?
    return false unless tournament
    return true if org_admin_for?(tournament.organization)

    return false if membership_for(tournament.organization).present?

    tournament_assignments.exists?(tournament: tournament)
  end

  def accessible_organizations
    return Organization.all if super_admin?
    organizations
  end

  def accessible_organization_ids
    return Organization.pluck(:id) if super_admin?

    membership_org_ids = organization_memberships.where(role: OrganizationMembership::STAFF_ROLES).pluck(:organization_id)
    assigned_org_ids = TenantContext.with_platform_access do
      Tournament.joins(:tournament_assignments)
                .where(tournament_assignments: { user_id: id })
                .distinct
                .pluck(:organization_id)
    end
    (membership_org_ids + assigned_org_ids).compact.uniq
  end

  def accessible_tournaments
    return Tournament.all if super_admin?

    memberships = organization_memberships.where(role: OrganizationMembership::STAFF_ROLES).to_a
    all_member_org_ids = organization_memberships.pluck(:organization_id)
    unscoped_org_ids = memberships.select { |m| m.admin? || m.scoped_tournament_ids.blank? }.map(&:organization_id)
    scoped_ids = memberships.reject { |m| m.admin? || m.scoped_tournament_ids.blank? }.flat_map(&:scoped_tournament_ids)

    # Legacy tournament_assignments only apply when no explicit org membership governs that org
    legacy_assigned_ids = Tournament.joins(:tournament_assignments)
                                    .where(tournament_assignments: { user_id: id })
                                    .where.not(organization_id: all_member_org_ids)
                                    .pluck(:id)
    explicit_ids = (scoped_ids + legacy_assigned_ids).uniq

    Tournament.where(organization_id: unscoped_org_ids).or(Tournament.where(id: explicit_ids))
  end

  private

  def normalize_email
    self.email = email&.downcase&.strip
  end

  def set_default_role
    self.role ||= 'org_admin'
  end
end
