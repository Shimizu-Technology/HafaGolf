# frozen_string_literal: true

require "test_helper"

class Api::V1::PromoteAndCheckinTest < ActionDispatch::IntegrationTest
  include ActionCable::TestHelper

  setup do
    @org_a = Organization.create!(
      name: "Checkin Club A",
      slug: "checkin-a-#{SecureRandom.hex(3)}",
      settings: { "features" => { "employee_pricing" => true, "checkin_alpha_lanes" => true } }
    )
    @tournament_a = @org_a.tournaments.create!(
      name: "Spring Classic",
      slug: "spring-classic-#{SecureRandom.hex(3)}",
      year: 2027,
      status: "open",
      registration_open: true,
      max_capacity: 100,
      entry_fee: 12500,
      employee_entry_fee: 5000
    )

    @org_b = Organization.create!(
      name: "Checkin Club B",
      slug: "checkin-b-#{SecureRandom.hex(3)}"
    )
    @tournament_b = @org_b.tournaments.create!(
      name: "Other Classic",
      slug: "other-classic-#{SecureRandom.hex(3)}",
      year: 2027,
      status: "open",
      entry_fee: 15000
    )

    @admin_a = User.create!(
      email: "checkin-admin-a-#{SecureRandom.hex(4)}@example.com",
      name: "Checkin Admin A",
      clerk_id: "clerk_chk_a_#{SecureRandom.hex(4)}",
      role: "org_admin"
    )
    @org_a.add_admin(@admin_a)
    @admin_a_headers = { "Authorization" => "Bearer test_token_#{@admin_a.id}" }

    @volunteer_a = User.create!(
      email: "checkin-vol-a-#{SecureRandom.hex(4)}@example.com",
      name: "Checkin Volunteer A",
      clerk_id: "clerk_chk_vol_a_#{SecureRandom.hex(4)}",
      role: "org_admin"
    )
    @org_a.add_member(@volunteer_a, role: "volunteer")
    @volunteer_a_headers = { "Authorization" => "Bearer test_token_#{@volunteer_a.id}" }

    @admin_b = User.create!(
      email: "checkin-admin-b-#{SecureRandom.hex(4)}@example.com",
      name: "Checkin Admin B",
      clerk_id: "clerk_chk_b_#{SecureRandom.hex(4)}",
      role: "org_admin"
    )
    @org_b.add_admin(@admin_b)
    @admin_b_headers = { "Authorization" => "Bearer test_token_#{@admin_b.id}" }

    @waitlisted_golfer = @tournament_a.golfers.create!(
      name: "Maria Cruz",
      email: "maria-#{SecureRandom.hex(3)}@example.com",
      phone: "+16715552001",
      team_category: "Female",
      payment_type: "pay_on_day",
      payment_status: "unpaid",
      registration_status: "waitlist",
      waiver_accepted_at: Time.current
    )

    @cancelled_golfer = @tournament_a.golfers.create!(
      name: "Cancelled Player",
      email: "cancelled-#{SecureRandom.hex(3)}@example.com",
      phone: "+16715552002",
      team_category: "Male",
      payment_type: "pay_on_day",
      payment_status: "unpaid",
      registration_status: "cancelled",
      waiver_accepted_at: Time.current
    )
  end

  test "atomically promotes, records payment, checks in, logs activity, and broadcasts on scoped channel" do
    assert_broadcasts("golfers_channel_#{@tournament_a.id}", 1) do
      assert_difference -> { ActivityLog.where(action: "golfer_promoted_and_checked_in").count }, 1 do
        post "/api/v1/golfers/#{@waitlisted_golfer.id}/promote_and_checkin",
             params: {
               mark_paid: true,
               payment_method: "cash",
               receipt_number: "RCPT-42",
               payment_amount_cents: 12500,
               payment_notes: "Paid at registration desk"
             },
             headers: @admin_a_headers,
             as: :json
      end
    end

    assert_response :success
    @waitlisted_golfer.reload

    assert_equal "confirmed", @waitlisted_golfer.registration_status
    assert_equal "paid", @waitlisted_golfer.payment_status
    assert_equal "cash", @waitlisted_golfer.payment_method
    assert_equal "RCPT-42", @waitlisted_golfer.receipt_number
    assert_equal 12500, @waitlisted_golfer.payment_amount_cents
    assert_equal "Paid at registration desk", @waitlisted_golfer.payment_notes
    assert_not_nil @waitlisted_golfer.paid_at
    assert_not_nil @waitlisted_golfer.payment_verified_at
    assert_equal @admin_a.id, @waitlisted_golfer.payment_verified_by_id
    assert_not_nil @waitlisted_golfer.checked_in_at
    assert_equal @admin_a.id, @waitlisted_golfer.checked_in_by_id
  end

  test "volunteer with org check-in access can promote and check in without payment" do
    post "/api/v1/golfers/#{@waitlisted_golfer.id}/promote_and_checkin",
         params: { mark_paid: false },
         headers: @volunteer_a_headers,
         as: :json

    assert_response :success
    @waitlisted_golfer.reload

    assert_equal "confirmed", @waitlisted_golfer.registration_status
    assert_equal "unpaid", @waitlisted_golfer.payment_status
    assert_not_nil @waitlisted_golfer.checked_in_at
    assert_equal @volunteer_a.id, @waitlisted_golfer.checked_in_by_id
  end

  test "rolls back completely on invalid payment params leaving golfer waitlisted, unpaid, and unchecked in" do
    assert_no_difference -> { ActivityLog.count } do
      post "/api/v1/golfers/#{@waitlisted_golfer.id}/promote_and_checkin",
           params: {
             mark_paid: true,
             payment_method: "cryptocurrency",
             payment_amount_cents: 12500
           },
           headers: @admin_a_headers,
           as: :json
    end

    assert_response :unprocessable_entity
    @waitlisted_golfer.reload
    assert_equal "waitlist", @waitlisted_golfer.registration_status
    assert_equal "unpaid", @waitlisted_golfer.payment_status
    assert_nil @waitlisted_golfer.checked_in_at

    # Negative amount also rolls back cleanly
    assert_no_difference -> { ActivityLog.count } do
      post "/api/v1/golfers/#{@waitlisted_golfer.id}/promote_and_checkin",
           params: {
             mark_paid: true,
             payment_method: "cash",
             payment_amount_cents: -100
           },
           headers: @admin_a_headers,
           as: :json
    end

    assert_response :unprocessable_entity
    @waitlisted_golfer.reload
    assert_equal "waitlist", @waitlisted_golfer.registration_status
    assert_equal "unpaid", @waitlisted_golfer.payment_status
    assert_nil @waitlisted_golfer.checked_in_at
  end

  test "rejects cancelled golfer with 422" do
    post "/api/v1/golfers/#{@cancelled_golfer.id}/promote_and_checkin",
         params: { mark_paid: true, payment_method: "cash" },
         headers: @admin_a_headers,
         as: :json

    assert_response :unprocessable_entity
    @cancelled_golfer.reload
    assert_equal "cancelled", @cancelled_golfer.registration_status
    assert_nil @cancelled_golfer.checked_in_at
  end

  test "rejects mark_paid true on an already-paid golfer without overwriting payment details and allows mark_paid false" do
    paid_waitlisted = @tournament_a.golfers.create!(
      name: "Prepaid Waitlist",
      email: "prepaid-#{SecureRandom.hex(3)}@example.com",
      phone: "+16715552099",
      team_category: "Co-Ed",
      payment_type: "stripe",
      payment_status: "paid",
      payment_method: "stripe",
      receipt_number: "ORIG-RCPT-1",
      payment_amount_cents: 12500,
      paid_at: 1.day.ago,
      payment_verified_by_id: @admin_a.id,
      payment_verified_by_name: @admin_a.name,
      payment_verified_at: 1.day.ago,
      registration_status: "waitlist",
      waiver_accepted_at: Time.current
    )

    # Attempt with mark_paid: true must fail with 422 and leave payment + status untouched
    post "/api/v1/golfers/#{paid_waitlisted.id}/promote_and_checkin",
         params: {
           mark_paid: true,
           payment_method: "cash",
           receipt_number: "OVERWRITE-99",
           payment_amount_cents: 100
         },
         headers: @volunteer_a_headers,
         as: :json

    assert_response :unprocessable_entity
    paid_waitlisted.reload
    assert_equal "waitlist", paid_waitlisted.registration_status
    assert_nil paid_waitlisted.checked_in_at
    assert_equal "stripe", paid_waitlisted.payment_method
    assert_equal "ORIG-RCPT-1", paid_waitlisted.receipt_number
    assert_equal 12500, paid_waitlisted.payment_amount_cents
    assert_equal @admin_a.id, paid_waitlisted.payment_verified_by_id

    # Promoting with mark_paid: false succeeds and preserves original payment details
    post "/api/v1/golfers/#{paid_waitlisted.id}/promote_and_checkin",
         params: { mark_paid: false },
         headers: @volunteer_a_headers,
         as: :json

    assert_response :success
    paid_waitlisted.reload
    assert_equal "confirmed", paid_waitlisted.registration_status
    assert_not_nil paid_waitlisted.checked_in_at
    assert_equal "stripe", paid_waitlisted.payment_method
    assert_equal "ORIG-RCPT-1", paid_waitlisted.receipt_number
    assert_equal 12500, paid_waitlisted.payment_amount_cents
    assert_equal @admin_a.id, paid_waitlisted.payment_verified_by_id
  end

  test "rejects cross-org admin with 403" do
    post "/api/v1/golfers/#{@waitlisted_golfer.id}/promote_and_checkin",
         params: { mark_paid: true, payment_method: "cash" },
         headers: @admin_b_headers,
         as: :json

    assert_response :forbidden
    @waitlisted_golfer.reload
    assert_equal "waitlist", @waitlisted_golfer.registration_status
    assert_nil @waitlisted_golfer.checked_in_at
  end
end
