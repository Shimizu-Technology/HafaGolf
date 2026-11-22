# frozen_string_literal: true

require "test_helper"

class RafflePhoneValidatorTest < ActiveSupport::TestCase
  test "allows blank values" do
    [ nil, "", "   " ].each do |value|
      result = RafflePhoneValidator.validate(value)
      assert result[:valid], "Expected #{value.inspect} to be valid"
      assert_nil result[:normalized]
      assert_nil result[:error]
    end
  end

  test "rejects bare prefixes" do
    %w[+1671 1671 671 +1670 1670 670 +1 1].each do |value|
      assert RafflePhoneValidator.bare_prefix?(value), "Expected #{value} to be flagged as bare prefix"
      result = RafflePhoneValidator.validate(value)
      assert_not result[:valid], "Expected #{value} to be invalid"
      assert_nil result[:normalized]
      assert_match(/incomplete/i, result[:error])
    end
  end

  test "rejects phones with fewer than 10 full digits or fewer than 7 local digits after +1 area code" do
    [ "555-1234", "671-555", "+1671555123", "1671555123", "abc" ].each do |value|
      result = RafflePhoneValidator.validate(value)
      assert_not result[:valid], "Expected #{value} to be invalid"
      assert_nil result[:normalized]
      assert result[:error].present?
    end
  end

  test "rejects over-length NANP or E164 numbers" do
    [ "+167155512345", "+1234567890123456" ].each do |value|
      result = RafflePhoneValidator.validate(value)
      assert_not result[:valid], "Expected #{value} to be invalid"
      assert result[:error].present?
    end
  end

  test "normalizes valid 10-digit, 11-digit NANP, and international phone numbers" do
    assert_equal "+16715551234", RafflePhoneValidator.normalize("671-555-1234")
    assert_equal "+16715551234", RafflePhoneValidator.normalize("(671) 555-1234")
    assert_equal "+16715551234", RafflePhoneValidator.normalize("6715551234")
    assert_equal "+16715551234", RafflePhoneValidator.normalize("16715551234")
    assert_equal "+16715551234", RafflePhoneValidator.normalize("+16715551234")
    assert_equal "+16705559876", RafflePhoneValidator.normalize("670.555.9876")
    assert_equal "+819012345678", RafflePhoneValidator.normalize("+81 90-1234-5678")
  end
end
