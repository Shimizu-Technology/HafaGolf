# frozen_string_literal: true

require "test_helper"

class EmployeeNumberTest < ActiveSupport::TestCase
  setup do
    @org = Organization.create!(
      name: "Test Golf Club",
      slug: "emp-model-club-#{SecureRandom.hex(3)}",
      settings: { "features" => { "employee_pricing" => true } }
    )
    @tournament = @org.tournaments.create!(
      name: "Annual Open",
      slug: "annual-open-#{SecureRandom.hex(3)}",
      year: 2027,
      status: "open",
      registration_open: true,
      entry_fee: 12500,
      employee_entry_fee: 5000
    )
    @other_tournament = @org.tournaments.create!(
      name: "Fall Classic",
      slug: "fall-classic-#{SecureRandom.hex(3)}",
      year: 2027,
      status: "open",
      registration_open: true,
      entry_fee: 12500,
      employee_entry_fee: 5000
    )
  end

  test "normalizes employee_number by stripping whitespace and upcasing" do
    record = @tournament.employee_numbers.create!(
      organization: @org,
      employee_number: "  emp-1042  ",
      employee_name: "  Alex Rivera  "
    )

    assert_equal "EMP-1042", record.employee_number
    assert_equal "Alex Rivera", record.employee_name
    assert record.available?
  end

  test "enforces case-insensitive uniqueness per tournament while allowing reuse across tournaments" do
    @tournament.employee_numbers.create!(organization: @org, employee_number: "EMP-100")

    duplicate = @tournament.employee_numbers.build(organization: @org, employee_number: "emp-100")
    assert_not duplicate.valid?
    assert_includes duplicate.errors[:employee_number], "already exists for this tournament"

    different_tournament = @other_tournament.employee_numbers.build(organization: @org, employee_number: "emp-100")
    assert different_tournament.valid?
    assert different_tournament.save
  end

  test "validates organization matches tournament organization" do
    other_org = Organization.create!(name: "Other Org", slug: "other-org-#{SecureRandom.hex(3)}")
    record = EmployeeNumber.new(
      organization: other_org,
      tournament: @tournament,
      employee_number: "EMP-999"
    )

    assert_not record.valid?
    assert_includes record.errors[:organization_id], "must match the tournament's organization"
  end

  test "claim! and release! atomically update employee number and golfer" do
    record = @tournament.employee_numbers.create!(organization: @org, employee_number: "EMP-200", employee_name: "Jordan Cruz")
    golfer_one = create_golfer(@tournament, name: "Jordan Cruz")
    golfer_two = create_golfer(@tournament, name: "Taylor Santos")

    record.claim!(golfer_one)
    record.reload
    golfer_one.reload

    assert record.used?
    assert_equal golfer_one.id, record.used_by_golfer_id
    assert_not_nil record.used_at
    assert golfer_one.is_employee?
    assert_equal record.id, golfer_one.employee_number_record_id
    assert_equal "EMP-200", golfer_one.employee_number
    assert_equal 5000, golfer_one.expected_entry_fee_cents

    # Second claim fails cleanly
    assert_raises(EmployeeNumber::AlreadyClaimedError) do
      record.claim!(golfer_two)
    end
    assert_equal golfer_one.id, record.reload.used_by_golfer_id

    # Release frees it for another golfer
    record.release!
    record.reload
    golfer_one.reload

    assert_not record.used?
    assert_nil record.used_by_golfer_id
    assert_nil record.used_at
    assert_not golfer_one.is_employee?
    assert_nil golfer_one.employee_number_record_id

    record.claim!(golfer_two)
    assert_equal golfer_two.id, record.reload.used_by_golfer_id
  end

  test "cancelling or destroying a golfer releases their claimed employee number" do
    record = @tournament.employee_numbers.create!(organization: @org, employee_number: "EMP-300")
    golfer = create_golfer(@tournament, name: "Morgan Reyes")
    record.claim!(golfer)
    assert record.reload.used?

    golfer.cancel!(reason: "Schedule conflict")
    assert_not record.reload.used?
    assert_nil record.used_by_golfer_id
    assert_nil record.used_at

    # Re-claim and destroy
    golfer_two = create_golfer(@tournament, name: "Casey Lim")
    record.claim!(golfer_two)
    assert record.reload.used?

    golfer_two.destroy!
    assert_not record.reload.used?
    assert_nil record.used_by_golfer_id
  end

  test "expected_entry_fee_cents preserves standard entry_fee for non-employee and sponsored golfers" do
    @tournament.update!(
      entry_fee: 15000,
      early_bird_fee: 10000,
      early_bird_deadline: 10.days.from_now,
      employee_entry_fee: 5000
    )

    regular = create_golfer(@tournament, name: "Regular Player")
    assert_equal 15000, regular.expected_entry_fee_cents

    sponsored = @tournament.golfers.create!(
      name: "Sponsored Player",
      email: "sponsored-#{SecureRandom.hex(3)}@example.com",
      payment_type: "sponsor",
      payment_status: "paid",
      registration_status: "confirmed"
    )
    assert_equal 15000, sponsored.expected_entry_fee_cents

    record = @tournament.employee_numbers.create!(organization: @org, employee_number: "EMP-FEE-1")
    record.claim!(regular)
    assert_equal 5000, regular.reload.expected_entry_fee_cents

    # Falls back to tournament.entry_fee when employee_pricing feature is disabled
    @org.update!(settings: { "features" => { "employee_pricing" => false } })
    assert_equal 15000, regular.reload.expected_entry_fee_cents
  end

  private

  def create_golfer(tournament, name:)
    tournament.golfers.create!(
      name: name,
      email: "#{name.parameterize}-#{SecureRandom.hex(3)}@example.com",
      phone: "+16715550100",
      team_category: "Co-Ed",
      payment_type: "pay_on_day",
      payment_status: "unpaid",
      registration_status: "confirmed",
      waiver_accepted_at: Time.current
    )
  end
end

class EmployeeNumberConcurrencyTest < ActiveSupport::TestCase
  self.use_transactional_tests = false

  setup do
    @org = Organization.create!(
      name: "Race Club",
      slug: "race-club-#{SecureRandom.hex(3)}",
      settings: { "features" => { "employee_pricing" => true } }
    )
    @tournament = @org.tournaments.create!(
      name: "Race Open",
      slug: "race-open-#{SecureRandom.hex(3)}",
      year: 2027,
      status: "open",
      registration_open: true,
      entry_fee: 12500,
      employee_entry_fee: 5000
    )
    @record = @tournament.employee_numbers.create!(organization: @org, employee_number: "RACE-001")
    @golfer_a = @tournament.golfers.create!(
      name: "Racer One",
      email: "racer-1-#{SecureRandom.hex(3)}@example.com",
      phone: "+16715550101",
      team_category: "Co-Ed",
      payment_type: "pay_on_day",
      payment_status: "unpaid",
      registration_status: "confirmed",
      waiver_accepted_at: Time.current
    )
    @golfer_b = @tournament.golfers.create!(
      name: "Racer Two",
      email: "racer-2-#{SecureRandom.hex(3)}@example.com",
      phone: "+16715550102",
      team_category: "Co-Ed",
      payment_type: "pay_on_day",
      payment_status: "unpaid",
      registration_status: "confirmed",
      waiver_accepted_at: Time.current
    )
  end

  teardown do
    if @tournament
      EmployeeNumber.where(tournament_id: @tournament.id).delete_all
      Golfer.where(tournament_id: @tournament.id).delete_all
      Tournament.where(id: @tournament.id).delete_all
    end
    Organization.where(id: @org.id).delete_all if @org
  end

  test "concurrent claim! calls allow only one golfer to claim the same employee number" do
    barrier = Queue.new
    go = Queue.new
    outcomes = Queue.new

    threads = [@golfer_a, @golfer_b].map do |golfer|
      Thread.new do
        ActiveRecord::Base.connection_pool.with_connection do
          rec = EmployeeNumber.find(@record.id)
          g = Golfer.find(golfer.id)
          barrier << :ready
          go.pop
          begin
            rec.claim!(g)
            outcomes << [:ok, g.id]
          rescue EmployeeNumber::AlreadyClaimedError
            outcomes << [:already_claimed, g.id]
          end
        end
      end
    end

    # Wait for both threads to be ready, then release simultaneously
    2.times { barrier.pop }
    2.times { go << :start }
    threads.each(&:join)

    results = 2.times.map { outcomes.pop }
    winners = results.select { |status, _| status == :ok }
    losers = results.select { |status, _| status == :already_claimed }

    assert_equal 1, winners.length, "Expected exactly 1 winner, got: #{results.inspect}"
    assert_equal 1, losers.length, "Expected exactly 1 AlreadyClaimedError, got: #{results.inspect}"

    @record.reload
    assert @record.used?
    assert_equal winners.first[1], @record.used_by_golfer_id
  end
end
