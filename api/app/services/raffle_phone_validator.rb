# frozen_string_literal: true

class RafflePhoneValidator
  BARE_PREFIX_DIGITS = %w[1 671 1671 670 1670].freeze
  MIN_FULL_DIGITS = 10
  MAX_E164_DIGITS = 15
  NANP_FULL_DIGITS = 11

  class << self
    def bare_prefix?(raw)
      return false if raw.blank?

      digits = raw.to_s.gsub(/\D/, "")
      digits.empty? || BARE_PREFIX_DIGITS.include?(digits)
    end

    def validate(raw)
      trimmed = raw.to_s.strip
      return { valid: true, normalized: nil, error: nil } if trimmed.empty?

      digits = trimmed.gsub(/\D/, "")

      if digits.empty? || BARE_PREFIX_DIGITS.include?(digits)
        return {
          valid: false,
          normalized: nil,
          error: "Phone number is incomplete (cannot be just a country or area code prefix like #{trimmed}). Please enter a full 10-digit phone number."
        }
      end

      if digits.length > MAX_E164_DIGITS
        return {
          valid: false,
          normalized: nil,
          error: "Phone number is too long — please enter a valid phone number."
        }
      end

      if digits.start_with?("1")
        if digits.length < NANP_FULL_DIGITS
          return {
            valid: false,
            normalized: nil,
            error: "Phone number is incomplete — please enter a full 10-digit phone number with area code (e.g., +1-671-555-1234)."
          }
        end

        if digits.length > NANP_FULL_DIGITS
          return {
            valid: false,
            normalized: nil,
            error: "Phone number has too many digits for a +1 number — please enter 10 digits after +1 (e.g., +1-671-555-1234)."
          }
        end

        return { valid: true, normalized: "+#{digits}", error: nil }
      end

      if digits.length < MIN_FULL_DIGITS
        return {
          valid: false,
          normalized: nil,
          error: "Phone number must include an area code and at least 10 digits (e.g., 671-555-1234)."
        }
      end

      normalized =
        if digits.length == MIN_FULL_DIGITS && (!trimmed.start_with?("+") || nanp_ten_digit?(digits))
          "+1#{digits}"
        else
          "+#{digits}"
        end

      { valid: true, normalized: normalized, error: nil }
    end

    def nanp_ten_digit?(digits)
      digits.length == MIN_FULL_DIGITS && (
        digits.start_with?("671", "670") || digits.match?(/\A[2-9]\d{2}[2-9]\d{6}\z/)
      )
    end

    def normalize(raw)
      result = validate(raw)
      result[:valid] ? result[:normalized] : nil
    end
  end
end
