# frozen_string_literal: true

class ApplicationJob < ActiveJob::Base
  # Automatically retry jobs that encountered a deadlock
  # retry_on ActiveRecord::Deadlocked

  # Most jobs are safe to ignore if the underlying records are no longer available
  # discard_on ActiveJob::DeserializationError

  # Ensure background jobs run inside an explicit RLS context on non-superuser DB roles.
  around_perform do |_job, block|
    TenantContext.with_platform_access(&block)
  end
end
