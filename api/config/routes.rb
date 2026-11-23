# frozen_string_literal: true

Rails.application.routes.draw do
  # Health check
  get 'health' => 'health#show'
  get 'up' => 'rails/health#show', as: :rails_health_check

  # ActionCable WebSocket
  mount ActionCable.server => '/cable'

  # API routes
  namespace :api do
    namespace :v1 do
      # ===========================================
      # PUBLIC ENDPOINTS (no auth required)
      # ===========================================

      # Tenant resolution (public - resolves custom domain / host to organization)
      get 'tenant' => 'tenant#show'

      # Public platform directory & reach-out inquiries
      get 'directory/tournaments' => 'directory#tournaments'
      post 'platform/inquiries' => 'platform_inquiries#create'

      # Organizations (public)
      get 'organizations/:slug' => 'organizations#show'
      get 'organizations/:slug/tournaments' => 'organizations#tournaments'
      get 'organizations/:slug/tournaments/:tournament_slug' => 'organizations#tournament'

      # Current tournament (legacy, for backwards compatibility)
      get 'tournaments/current' => 'tournaments#current'

      # Registration (public)
      get 'golfers/registration_status' => 'golfers#registration_status'
      post 'golfers' => 'golfers#create'

      # Employee Numbers (public validation; admin CRUD below)
      post 'employee_numbers/validate' => 'employee_numbers#validate'

      # Payment Links (public endpoints)
      get 'payment_links/:token' => 'payment_links#show'
      post 'payment_links/:token/checkout' => 'payment_links#create_checkout'

      # Checkout (public)
      post 'checkout' => 'checkout#create'
      post 'checkout/embedded' => 'checkout#create_embedded'
      post 'checkout/confirm' => 'checkout#confirm'
      post 'checkout/swipe_simple' => 'checkout#swipe_simple_redirect'
      get 'checkout/session/:session_id' => 'checkout#session_status'

      # Webhooks (public, authenticated via signature)
      post 'webhooks/stripe' => 'webhooks#stripe'
      post 'webhooks/stripe/orgs/:webhook_endpoint_token' => 'webhooks#stripe_org'
      post 'webhooks/resend' => 'delivery_webhooks#resend'
      post 'webhooks/clicksend' => 'delivery_webhooks#clicksend'

      # Golfer Auth (public - for scoring access)
      post 'golfer_auth/request_link' => 'golfer_auth#request_link'
      get 'golfer_auth/verify' => 'golfer_auth#verify'
      get 'golfer_auth/me' => 'golfer_auth#me'
      post 'golfer_auth/refresh' => 'golfer_auth#refresh'

      # Sponsor Portal (public, token-authenticated)
      post 'sponsor_access/request_link' => 'sponsor_access#request_link'
      get 'sponsor_access/verify' => 'sponsor_access#verify'
      post 'sponsor_access/confirm' => 'sponsor_access#confirm'
      get 'sponsor_access/sponsorships' => 'sponsor_access#sponsorships'
      post 'sponsor_access/switch' => 'sponsor_access#switch'
      resources :sponsor_slots, only: [:index, :update] do
        collection do
          patch :batch, action: :batch_update
        end
      end

      # ===========================================
      # ADMIN ENDPOINTS (auth required)
      # ===========================================

      # Admin uploads
      post 'admin/uploads' => 'admin/uploads#create'
      post 'admin/uploads/presigned' => 'admin/uploads#presigned'

      # Super Admin platform console
      get 'admin/platform/overview' => 'platform#overview'
      post 'admin/platform/organizations' => 'platform#create_organization'
      patch 'admin/platform/organizations/:slug' => 'platform#update_organization'

      # Admin organizations
      get 'admin/organizations' => 'organizations#index'
      post 'admin/organizations' => 'organizations#create'
      patch 'admin/organizations/:slug' => 'organizations#update'
      delete 'admin/organizations/:slug' => 'organizations#destroy'
      get 'admin/organizations/:slug/domains' => 'organizations#domains'
      post 'admin/organizations/:slug/domains' => 'organizations#create_domain'
      patch 'admin/organizations/:slug/domains/:domain_id' => 'organizations#update_domain'
      delete 'admin/organizations/:slug/domains/:domain_id' => 'organizations#destroy_domain'
      get 'admin/organizations/:slug/features' => 'organizations#features'
      patch 'admin/organizations/:slug/features' => 'organizations#update_features'
      get 'admin/organizations/:slug/payment_config' => 'organizations#payment_config'
      patch 'admin/organizations/:slug/payment_config' => 'organizations#update_payment_config'
      post 'admin/organizations/:slug/payment_config/rotate_webhook_token' => 'organizations#rotate_webhook_token'
      get 'admin/organizations/:slug/members' => 'organizations#members'
      post 'admin/organizations/:slug/members' => 'organizations#add_member'
      patch 'admin/organizations/:slug/members/:member_id' => 'organizations#update_member'
      delete 'admin/organizations/:slug/members/:member_id' => 'organizations#remove_member'
      post 'admin/organizations/:slug/members/:member_id/resend_invite' => 'organizations#resend_invite'
      get 'admin/organizations/:slug/tournaments' => 'organizations#admin_tournaments'
      post 'admin/organizations/:slug/tournaments' => 'organizations#create_tournament'
      get 'admin/organizations/:slug/tournaments/:tournament_slug' => 'organizations#admin_tournament'
      get 'admin/organizations/:slug/tournaments/:tournament_slug/broadcasts' => 'broadcasts#index'
      post 'admin/organizations/:slug/tournaments/:tournament_slug/golfers' => 'organizations#create_golfer'
      patch 'admin/organizations/:slug/tournaments/:tournament_slug/golfers/:golfer_id' => 'organizations#update_golfer'
      post 'admin/organizations/:slug/tournaments/:tournament_slug/golfers/:golfer_id/cancel' => 'organizations#cancel_golfer'
      post 'admin/organizations/:slug/tournaments/:tournament_slug/golfers/:golfer_id/refund' => 'organizations#refund_golfer'

      # Tournaments (admin)
      resources :tournaments, except: [:create] do
        member do
          post :archive
          post :clone
          post :copy
          post :open
          post :close
          post :complete
        end
      end
      post 'admin/tournaments' => 'tournaments#create'

      # Golfers (admin)
      resources :golfers, except: [:create] do
        member do
          post :check_in
          post :undo_check_in
          post :mark_waiver_signed
          post :verify_payment
          post :payment_details
          post :promote
          post :promote_and_checkin
          post :demote
          post :update_payment_status
          post :cancel
          post :refund
          post :mark_refunded
          patch :mark_paid
          post :send_payment_link
        end
        collection do
          get :stats
          post :bulk_send_payment_links
        end
      end

      # Employee Numbers (admin, feature-gated by :employee_pricing)
      resources :employee_numbers, only: [:index, :create, :update, :destroy] do
        collection do
          post :bulk_create
        end
      end

      # Registrations & Team Members (real teams 1/2/4)
      resources :registrations, only: [:show, :update] do
        member do
          post :verify_payment
          post :assign_group
          post :sync_raffle_tickets
        end
      end

      resources :team_members, only: [] do
        member do
          post :check_in
          post :undo_check_in
          post :mark_waiver_signed
        end
      end

      # Scores & Leaderboard
      scope 'tournaments/:tournament_id' do
        resources :registrations, only: [:index, :create]
        resources :scores, only: [:index, :create, :update, :destroy] do
          member do
            post :verify
          end
          collection do
            get :leaderboard
            get :scorecard
            post :batch
          end
        end

        # Raffle (public)
        get 'raffle/prizes' => 'raffle#prizes'
        get 'raffle/board' => 'raffle#board'
        get 'raffle/check_ticket' => 'raffle#check_ticket'
        get 'raffle/tickets' => 'raffle#tickets'

        # Raffle (admin)
        get 'raffle/draw_readiness' => 'raffle#draw_readiness'
        post 'raffle/board/clear_spotlight' => 'raffle#clear_spotlight'
        post 'raffle/prizes' => 'raffle#create_prize'
        patch 'raffle/prizes/:id' => 'raffle#update_prize'
        delete 'raffle/prizes/:id' => 'raffle#destroy_prize'
        post 'raffle/prizes/:id/draw' => 'raffle#draw'
        post 'raffle/prizes/:id/reset' => 'raffle#reset_prize'
        post 'raffle/prizes/:id/claim' => 'raffle#claim_prize'
        post 'raffle/prizes/:id/resend_notification' => 'raffle#resend_winner_notification'
        post 'raffle/draw_all' => 'raffle#draw_all'
        get 'raffle/admin/tickets' => 'raffle#admin_tickets'
        post 'raffle/tickets' => 'raffle#create_tickets'
        post 'raffle/tickets/:id/mark_paid' => 'raffle#mark_ticket_paid'
        patch 'raffle/tickets/:id/contact' => 'raffle#update_ticket_contact'
        post 'raffle/tickets/:id/resend_confirmation' => 'raffle#resend_ticket_confirmation'
        delete 'raffle/tickets/:id' => 'raffle#destroy_ticket'
        post 'raffle/tickets/:id/void' => 'raffle#void_ticket'
        post 'raffle/sync_tickets' => 'raffle#sync_tickets'
        post 'raffle/sell' => 'raffle#sell_tickets'
        get 'payment_report' => 'payment_reports#show'

        # Payout Settlements & Disbursements
        get 'settlement' => 'settlements#show'
        get 'settlement/export' => 'settlements#export_csv'
        post 'settlement/calculate' => 'settlements#calculate'
        post 'settlement/finalize' => 'settlements#finalize'
        post 'settlement/payouts' => 'settlements#create_payout'
        post 'settlement/payouts/:payout_id/mark_paid' => 'settlements#mark_payout_paid'
        post 'settlement/payouts/:payout_id/void' => 'settlements#void_payout'

        # Sponsors
        resources :sponsors, only: [:index, :show, :create, :update, :destroy] do
          collection do
            get :by_hole
            get :manage
            post :reorder
          end
          member do
            post :portal_link
            post :send_portal_invite
            post :mark_check_paid
            get :slots
            patch 'slots/:slot_id', action: :update_slot, as: :update_slot
          end
        end

        # Priced Sponsor Tiers & Online Sponsor Checkout
        resources :sponsor_tiers, only: [:index, :create, :update, :destroy] do
          member do
            post :checkout
            post :reserve_check
          end
        end

        # Registration Add-Ons (Super Tickets, Mulligans, Contests)
        resources :add_ons, controller: 'tournament_add_ons', only: [:index, :create, :update, :destroy]

        # Day-Of Broadcast Announcements (SMS / Email)
        resources :broadcasts, only: [:index, :create] do
          collection do
            post :preview
          end
        end

        # Standalone Donations
        get 'donations/summary' => 'donations#summary'
        post 'donations/checkout' => 'donations#checkout'
        resources :donations, only: [:index, :create]
      end

      # Groups
      resources :groups do
        member do
          post :set_hole
          post :add_golfer
          post :merge_into
          post :remove_golfer
        end
        collection do
          post :place_golfer
          post :update_positions
          post :batch_create
          post :auto_assign
        end
      end

      # Users/Admins (legacy endpoint name for backwards compatibility)
      resources :admins do
        collection do
          get :me
        end
      end

      # Activity Logs
      resources :activity_logs, only: [:index] do
        collection do
          get :summary
          get 'golfer/:golfer_id', action: :golfer_history, as: :golfer_history
        end
      end
    end
  end
end
