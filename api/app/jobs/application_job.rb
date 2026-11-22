# frozen_string_literal: true

class ApplicationJob < ActiveJob::Base
  # Automatically retry jobs that encountered a deadlock
  # retry_on ActiveRecord::Deadlocked

  # Most jobs are safe to ignore if the underlying records are no longer available
  # discard_on ActiveJob::DeserializationError

  # Ensure GlobalID deserialization AND job execution run inside an explicit RLS
  # context on non-owner database roles where FORCE ROW LEVEL SECURITY fails closed.
  around_perform do |_job, block|
    TenantContext.with_platform_access(&block)
  end

  private

  def deserialize_arguments(serialized_args)
    TenantContext.with_platform_access { super }
  end
end
