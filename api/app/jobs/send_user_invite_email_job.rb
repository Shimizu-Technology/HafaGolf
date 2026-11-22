# frozen_string_literal: true

class SendUserInviteEmailJob < ApplicationJob
  queue_as :default

  def perform(user_id, invited_by_user_id = nil, role = nil, organization_id = nil)
    user = User.find_by(id: user_id)
    return if user.blank? || user.email.blank?

    invited_by = invited_by_user_id.present? ? User.find_by(id: invited_by_user_id) : nil
    organization = organization_id.present? ? Organization.find_by(id: organization_id) : nil
    UserInviteEmailService.send_invite(user: user, invited_by: invited_by, role: role, organization: organization)
  end
end
