class SponsorSlot < ApplicationRecord
  attr_accessor :historical_import

  TSHIRT_SIZES = %w[S M L XL 2XL 3XL].freeze

  belongs_to :sponsor
  belongs_to :tournament
  has_one :team_member, dependent: :nullify

  validates :slot_number, presence: true,
            numericality: { only_integer: true, greater_than: 0 }
  validates :slot_number, uniqueness: { scope: :sponsor_id }
  validates :tshirt_size, inclusion: { in: TSHIRT_SIZES }, allow_blank: true
  validates :handicap, numericality: { greater_than_or_equal_to: -10, less_than_or_equal_to: 54 }, allow_nil: true
  validates :player_email, format: { with: URI::MailTo::EMAIL_REGEXP }, allow_blank: true
  validate :handicap_required_when_filled, unless: :historical_import

  before_validation :normalize_player_details

  def filled?
    player_name.to_s.strip.present?
  end

  def portal_json
    {
      id: id,
      slot_number: slot_number,
      player_name: player_name,
      player_email: player_email,
      player_phone: player_phone,
      tshirt_size: tshirt_size,
      handicap: handicap&.to_f,
      confirmed_at: confirmed_at
    }
  end

  private

  def normalize_player_details
    self.player_name = player_name.to_s.strip.presence
    self.player_email = player_email.to_s.strip.downcase.presence
    self.player_phone = player_phone.to_s.strip.presence
    self.tshirt_size = tshirt_size.to_s.strip.upcase.presence
  end

  def handicap_required_when_filled
    return unless filled? && tournament&.handicap_required? && handicap.nil?

    errors.add(:handicap, "is required for this event")
  end
end
