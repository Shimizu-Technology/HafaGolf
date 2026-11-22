# frozen_string_literal: true

# Custom ActionMailer delivery job so `deliver_later` emails run with an explicit
# PostgreSQL RLS context during both GlobalID deserialization and mailer execution.
class ApplicationMailDeliveryJob < ActionMailer::MailDeliveryJob
  around_perform do |_job, block|
    TenantContext.with_platform_access(&block)
  end

  private

  def deserialize_arguments(serialized_args)
    TenantContext.with_platform_access { super }
  end
end
