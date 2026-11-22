# frozen_string_literal: true

class AdminMailer < ApplicationMailer
  helper PhoneHelper

  # Notify org admins of new golfer registration (for Pay Later registrations)
  def notify_new_golfer(golfer)
    @golfer = golfer
    @tournament = golfer.tournament
    @organization = @tournament&.organization
    @entry_fee = calculate_entry_fee(golfer)
    admin_emails = resolve_admin_emails(@organization)

    return unless admin_emails.any?

    mail(to: admin_emails, subject: "New Golf Tournament Registration: #{golfer.name}")
  end

  # Notify org admins of payment received
  def notify_payment_received(golfer)
    @golfer = golfer
    @tournament = golfer.tournament
    @organization = @tournament&.organization
    @entry_fee = calculate_entry_fee(golfer)
    admin_emails = resolve_admin_emails(@organization)

    return unless admin_emails.any?

    mail(
      to: admin_emails,
      subject: "Payment Received: #{golfer.name}"
    )
  end

  # Combined notification for Stripe payments (registration + payment in one email)
  def notify_new_registration_with_payment(golfer)
    @golfer = golfer
    @tournament = golfer.tournament
    @organization = @tournament&.organization
    @entry_fee = (@golfer.payment_amount_cents || calculate_entry_fee_cents(golfer)).to_f / 100
    admin_emails = resolve_admin_emails(@organization)

    return unless admin_emails.any?

    mail(to: admin_emails, subject: "New Registration & Payment: #{golfer.name}")
  end

  # Notify org admins when a golfer is registered with a payment link pending
  def notify_new_registration_pending_payment(golfer)
    @golfer = golfer
    @tournament = golfer.tournament
    @organization = @tournament&.organization
    @entry_fee = calculate_entry_fee(golfer)
    @payment_link = golfer.payment_link_url
    admin_emails = resolve_admin_emails(@organization)

    return unless admin_emails.any?

    mail(to: admin_emails, subject: "New Registration - Awaiting Payment: #{golfer.name}")
  end

  private

  def resolve_admin_emails(organization)
    return organization.admin_notification_emails if organization.present?

    ENV["PLATFORM_ADMIN_EMAIL"].to_s.split(",").map(&:strip).reject(&:blank?)
  end

  def calculate_entry_fee(golfer)
    calculate_entry_fee_cents(golfer).to_f / 100
  end

  def calculate_entry_fee_cents(golfer)
    golfer.expected_entry_fee_cents
  end
end
