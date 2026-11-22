# frozen_string_literal: true

class ScopeRaffleTicketNumberUniquenessToTournament < ActiveRecord::Migration[8.1]
  def change
    remove_index :raffle_tickets, column: :ticket_number, name: "index_raffle_tickets_on_ticket_number", unique: true
    add_index :raffle_tickets, [ :tournament_id, :ticket_number ], unique: true, name: "index_raffle_tickets_on_tournament_id_and_ticket_number"
  end
end
