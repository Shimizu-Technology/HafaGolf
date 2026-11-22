# HafaGolf Data Migration & Launch Rehearsal Plan

> **Standing Gate (Leon, Nov 22, 2026):** Original GIAA (`giaa-tournament-*`) and Make-A-Wish (`make-a-wish-guam`) production databases and deployments remain **strictly read-only**. Zero production database connections or exports may run until Leon approves **Gate B** (staging snapshot export) or **Gate D** (cutover).

This document defines the exact, repeatable rehearsal workflow for:
1. **Make-A-Wish Guam & CNMI** (`golfforwishes.com`) — **MAW runs its 2027 event (date unconfirmed, likely Thu Apr 29 or Fri Apr 30, 2027) on HafaGolf** (Leon decision, Nov 22, 2026); **Feb 22, 2027 Hard Go/No-Go** for cutover ahead of the event (target **Mar 1, 2027**). All raffle fixes live in HafaGolf only (`make-a-wish-guam` stays untouched).
2. **FD Alumni Golf** (`fd-golf.shimizu-technology.com`) — **Mar 8, 2027 Go/No-Go** for **Mar 15, 2027** native launch
3. **GIAA Memorial Golf** (`giaa-tournament.com`) — Post-2027 event (or upon full staging acceptance)

---

## 1. Non-Negotiable Safety Invariants

1. **Read-only source snapshots only:** Export via `pg_dump --no-owner --no-privileges` during an off-peak Guam window and restore into a **separate isolated staging source database** (never query production directly from migration tasks).
2. **`EXPECTED_DB_NAME` guard:** Every HafaGolf migration/seed rake task refuses to execute unless `ENV["EXPECTED_DB_NAME"]` matches `ActiveRecord::Base.connection.current_database`, unconditionally blocks local development DBs (`api_development`, `hafagolf_development`), and refuses if `SOURCE_DATABASE_URL` points to the same database as the target.
3. **Idempotent, non-destructive imports:** Imported records are keyed by `(legacy_source, legacy_id)` (or natural keys / legacy markers). Re-running an import or seeder twice on the same snapshot MUST produce **identical row counts**, **zero duplicate records**, and **never overwrite live admin edits** on already-created organizations, tournaments, payment configs, or memberships. *(Note: pre-cutover snapshot re-syncs intentionally refresh historical child rows like golfers, groups, sponsors, raffle rows, and message deliveries — never re-run the legacy importer after live post-cutover writes begin on HafaGolf.)*
   - For `team_members` derived from legacy 2-person `golfers` rows, `legacy_id` uses the composite key `"<golfer_id>:<position>"` (`"42:1"` for Player 1, `"42:2"` for Player 2).
4. **Zero cross-account Stripe refund risk (default-blocked until Gate D account verification):** Every imported historical Stripe `payment_intent_id` is tagged with `stripe_account_origin` (`legacy_giaa` or `legacy_maw`) and blocked from automated API refunds by default.
   - **GIAA fact (Leon, Nov 22, 2026):** GIAA has **no Stripe account of its own** — its current app already charges through Shimizu Technology's Stripe (so `platform_collect` matches today with no open decision). Keep `legacy_giaa` blocked by default; at **Gate D cutover**, perform a read-only check comparing the Stripe account ID behind GIAA's legacy charges with HafaGolf's production platform Stripe account. **Only if they match**, enable refunds of `legacy_giaa` charges through the platform adapter with a regression test. Do not touch GIAA's production systems or keys before Gate B/D.
   - **MAW codebase audit (Nov 22, 2026, read-only):** Although MAW uses SwipeSimple for registration and defaults raffle POS to `swipe_simple`, `make-a-wish-guam` was forked from the GIAA codebase and retains Stripe columns (`golfers.stripe_payment_intent_id`, `raffle_tickets.stripe_payment_intent_id`, `settings.stripe_*`) and Stripe checkout endpoints. Never assume zero MAW Stripe charges: at **Gate B** (staging snapshot) and **Gate D** (cutover), run a read-only SQL check for any non-null `stripe_payment_intent_id` across `golfers` and `raffle_tickets` (and whether `settings.stripe_secret_key` was ever populated), and if any Stripe charges exist, run the same read-only Stripe account ID check before deciding whether `legacy_maw` remains blocked.
5. **No plaintext legacy secrets migrated & no `super_admin` escalation:** Legacy `settings` rows are read once only for non-secret metadata if needed; plaintext Stripe keys are **never** copied into `organization_payment_configs`, and imported users are capped at `org_admin` / `tournament_admin` (never `super_admin`).
6. **Admin Clerk relinking:** Deduplicate `users` by `LOWER(email)` and assign `clerk_id = "pending_<sha256(email)[0,32]>"` (32-char lowercase hex prefix) so each admin automatically links to the centralized `golf.shimizu-technology.com` Clerk app on first sign-in.

---

## 2. Rehearsal 1 — Make-A-Wish Guam & CNMI (`golfforwishes.com`)

**2027 Event Window:** Date still unconfirmed (likely **Thu Apr 29 or Fri Apr 30, 2027**) — MAW runs its 2027 event on **HafaGolf**, not on `make-a-wish-guam` (Leon decision, Nov 22, 2026). All raffle fixes stay in **HafaGolf only** (`make-a-wish-guam` stays untouched).  
**Target Rehearsal Window:** Early–Mid February 2027 (**Hard Go/No-Go: Feb 22, 2027**; target cutover **Mar 1, 2027**, cleanly ahead of the event)  
**Cutover Sequence (each production step requires Leon's explicit OK at the time):**
1. **Staging rehearsal with a copy of MAW data** (Steps 1–5 below — Leon Gate B)
2. **Raffle draw rehearsal with Mr. Eric's team** (Step 6 + MAW Raffle QA Gate below — on HafaGolf staging)
3. **Production switch** (Leon Gate C hosting provisioning + Leon Gate D final data move & pointing `golfforwishes.com` at HafaGolf — see `docs/HOSTING_AND_ACTIVATION.md` §5.3)

### Step-by-Step Rehearsal Checklist
1. **Snapshot & Restore (Leon Gate B required):**
   ```bash
   # Export from MAW read-only replica/snapshot (NEVER mutate source)
   pg_dump --format=custom --no-owner --no-privileges "$MAW_READONLY_SNAPSHOT_URL" -f maw_staging_snapshot.dump
   # Restore into isolated staging source DB
   pg_restore --clean --if-exists --no-owner --no-privileges -d "$STAGING_MAW_SOURCE_DB_URL" maw_staging_snapshot.dump
   ```
2. **Dry-Run & Import on Staging HafaGolf DB (`RAILS_ENV=production` against staging DB):**
   ```bash
   RAILS_ENV=production \
   DATABASE_APP_URL="" \
   EXPECTED_DB_NAME="hafagolf_staging" \
   SOURCE_DATABASE_URL="$STAGING_MAW_SOURCE_DB_URL" \
   bundle exec rails hafagolf:migrate:maw
   ```
3. **Idempotency Re-Run Check:**
   Run the exact same command a **second time** and verify zero duplicates and identical JSON verification output.
4. **S3 Media Copy & Checksum Verification (Operator Media Step):**
   Copy Active Storage blobs (org logo, banner, sponsor logos, raffle prize images) to the HafaGolf staging bucket, recreate `active_storage_blobs` / `active_storage_attachments`, and verify every blob returns `HTTP 200` with matching MD5/ETag checksum and zero orphaned `active_storage_attachments`.
5. **Automated Verification Report (100% Match Required):**
   The importer emits a machine-readable JSON report (printing the mismatch report to stderr and exiting non-zero on any drift, and refusing empty/missing core source tables):
   - **Row counts:** tournaments, groups (preserving `starting_course_key`), golfers (confirmed / waitlist / cancelled), `team_members` (`source_golfers + non-blank partner_name`, when Real Teams tables are migrated), sponsors, sponsor slots, raffle sale batches, raffle prizes, raffle tickets, message deliveries (with `organization_id` backfilled), activity logs.
   - **Cent-exact financial sums:** `SUM(payment_amount_cents)` for paid/refunded golfers, `SUM(refund_amount_cents)` for refunds, `SUM(price_cents)` for paid raffle tickets, count of Stripe `payment_intent_id`s and `refund_id`s.
   - **Referential integrity:** zero orphaned `golfer.group_id`, `golfer.sponsor_id`, or `raffle_prize.winning_ticket_id` references (plus operator check on `active_storage_attachments` in Step 4).
6. **Functional, Guam Carrier & Raffle Draw Rehearsal (with Mr. Eric's Team):**
   - **Clone 2026 → 2027 Draft:** Run `Tournaments::CloneService` on the imported 2026 tournament; confirm 2027 starts in `draft`, clears stale deadlines/SwipeSimple URLs, and issues year-prefixed raffle tickets (`MAWG27-0001`) with zero collision against 2026 tickets.
   - **Guam SMS Carrier Rehearsal:** Send live ClickSend test messages to real **IT&E**, **Docomo Pacific**, and **GTA** numbers; compare alphanumeric vs numeric sender ID; verify ClickSend delivery webhooks transition `message_deliveries.status` to `delivered`.
   - **Raffle Draw Rehearsal with Mr. Eric's Team:** Walk through the full event-day raffle workflow on HafaGolf staging (POS ticket sale, double-entry phone check, delivery tracking + resend, pre-draw readiness modal, and live projector draw showing the winner's name over `async` ActionCable).
   - **Production Switch (only after Feb 22 Go + Leon Gate C & D OK):** Provision production hosting, run the final read-only MAW data move + verification, and point `golfforwishes.com` (+ `www`) at HafaGolf per `docs/HOSTING_AND_ACTIVATION.md` §5.3.
   - **Fallback Trigger (if Feb 22, 2027 Go/No-Go fails):** Run the 2027 event on MAW's existing `make-a-wish-guam` app with **paper raffle tickets at the event**. Do **not** build or backport raffle code into `make-a-wish-guam`.

### MAW Raffle QA Gate Checklist (Required in HafaGolf Once Admin Sign-In Works)

All 5 flows below MUST pass end-to-end browser QA (phone `390×844` + desktop `1280×800`) on HafaGolf once local/staging Clerk admin sign-in is enabled, and again during staging rehearsal with Mr. Eric's team:

- [ ] **1. POS Sale:** Sell quick-bundle and custom-quantity raffle tickets in `RaffleManagementPage`; verify buyer name is required, `RaffleSaleBatch` + year-prefixed `RaffleTicket`s (`MAWG27-0001`, …) persist in Postgres, and ticket count/revenue totals update immediately.
- [ ] **2. Double-Entry Phone Confirmation:** Enter buyer phone + confirm phone field on `SellTicketsTab`; verify mismatched numbers block submission, bare `+1671` / `+1670` prefixes are rejected both client-side and server-side, and the high-contrast read-back confirmation prompt displays the formatted number before saving.
- [ ] **3. Delivery Status + Resend:** Verify per-buyer SMS & email delivery badges (`Delivered`, `Pending`/`Sent`, `Failed`, `Bounced`, `No contact`) render on the Tickets/Batches view; confirm `"Needs Attention"` filters failed/unconfirmed batches; exercise one-tap **Edit Contact & Resend** (`RaffleEditContactModal`) to fix a contact across the batch and re-trigger delivery.
- [ ] **4. Pre-Draw Readiness Check:** Click `Draw` / `Draw All` to open `RafflePreDrawModal` (`GET /raffle/draw_readiness`); verify eligible paid ticket count, missing-name alerts, failed (red) and accepted-only/unconfirmed (amber) delivery warnings (requiring `delivered` status, not merely `accepted`), one-click jump to `"Needs Attention"`, and explicit audited override (`ActivityLog` entry) when proceeding with warnings.
- [ ] **5. Draw Screen Showing Winner's Name:** Run a live draw with `RaffleBoardPage` open alongside admin; confirm `draw_started` → `prize_won` streams over `async` ActionCable, the **winner's name** (plus ticket number) is the largest focal element on the draw screen, banquet **"Hold Winner on Screen"** keeps the winner displayed until explicitly cleared (no 9-second auto-dismiss), and **Resend** winner notification works from the Prizes view.

---

## 3. Rehearsal 2 — FD Alumni Golf (`fd-golf.shimizu-technology.com`)

**Target Rehearsal Window:** Late February – Early March 2027 (**Hard Go/No-Go: Mar 8, 2027** for **Mar 15** launch)

### Step-by-Step Staging Walkthrough Checklist
1. **Seed FD Tenant on Staging:**
   ```bash
   RAILS_ENV=production DATABASE_APP_URL="" EXPECTED_DB_NAME="hafagolf_staging" bundle exec rails hafagolf:seed:fd_alumni
   ```
   Verifies:
   - Organization `fd-alumni-golf` + primary domain `fd-golf.shimizu-technology.com`
   - Brand Kit (`crest-classic` maroon `#6B1D2F` / gold `#C5A059`)
   - Payment config: `platform_collect` (Shimizu Stripe), $0 in-kind platform fee, payee snapshot for Class of 2017 Bank of Guam account
   - Features enabled: `sponsor_portal`, `sponsor_checkout`, `donations`, `waitlist` (`tax_receipt_enabled: false` until FDAA treasurer/CPA approves exact >$75 FMV wording!)
   - Tournament format: 4-player foursomes (`team_size: 4`, `capacity_unit: "players"`, partial teams supported)
   - Priced `sponsor_tiers` (Title / Gold / Silver / Hole) with online Stripe Checkout
2. **End-to-End Test Walkthrough (CO2017 Board Review):**
   - Public landing page on desktop & mobile (`crest-classic` theme pack, `prefers-reduced-motion` verified, zero Clerk JS in public bundle).
   - Register a 4-player foursome and a 2-player partial team; verify capacity calculation & group placement (4 players/start position).
   - Purchase a priced sponsor tier via Stripe test mode; verify signed webhook auto-provisions `SponsorSlot`s and Sponsor Portal magic link updates `team_members` idempotently.
   - Submit an open-amount donation (both public and anonymous); verify donor wall and receipt copy (`tax_receipt_enabled: false` suppresses IRS FMV language until approved).
   - Open **Reports → Payout Statement**: verify registrations + sponsorships + donations reconcile to the cent, calculate & finalize statement, record a test check payout, and export CSV for class treasurer sign-off.
3. **Production $1 Live Verification (only after Leon Gate C & D):**
   Execute one $1 live Stripe test checkout, verify webhook confirmation + settlement appearance, issue $1 refund, and verify net proceeds = $0 before announcing Mar 15 open.

---

## 4. Rehearsal 3 — GIAA Memorial Golf (`giaa-tournament.com`)

**Target Window:** Post-GIAA 2027 event (or only if GIAA passes full staging acceptance before opening registration)

### Step-by-Step Rehearsal Checklist
1. **Snapshot & Restore (Leon Gate B required):** Export read-only `pg_dump` of `giaa-tournament-api` into isolated staging source DB.
2. **Run Idempotent GIAA Importer + Second-Run Check:**
   ```bash
   RAILS_ENV=production \
   DATABASE_APP_URL="" \
   EXPECTED_DB_NAME="hafagolf_staging" \
   SOURCE_DATABASE_URL="$STAGING_GIAA_SOURCE_DB_URL" \
   bundle exec rails hafagolf:migrate:giaa
   ```
   Verify:
   - Synthesizes `giaa` organization (`memorial-formal` theme pack, `platform_collect` payment mode — zero legacy plaintext Stripe keys migrated!).
   - Maps each GIAA `golfer` → 1 `registration` (`legacy_id: "<id>"`, `team_size: 1`) + 1 `team_member` (`legacy_id: "<id>:1"`, `is_captain: true`).
   - Maps `employee_numbers` (`used_by_golfer_id` / `used_by_team_member_id` remapped via `"<id>:1"`).
   - Tags historical Stripe charges with `stripe_account_origin: "legacy_giaa"` so automated refunds remain blocked by default.
   - Uploads static brand assets via Active Storage to HafaGolf S3.
   - Outputs 100%-matching JSON verification report (row counts, financial sums in cents, zero orphans).
3. **Functional QA:**
   - Verify `employee_pricing` (public validation, race-lock claim, bulk upload, release on cancel).
   - Verify `checkin_alpha_lanes` (A–J / K–Z tabs with live counts) and atomic **Promote + Pay + Check-In** on waitlisted golfers.
   - Verify `memorial-formal` visual QA against `docs/client-specs/AIRPORT_GIAA_BRANDING_SPEC.md`.
4. **Gate D Cutover Step — Read-Only Legacy Stripe Account Verification:**
   - GIAA has no Stripe account of its own (its current app already charges through Shimizu Technology's Stripe, so `platform_collect` matches today).
   - Keep `stripe_account_origin: "legacy_giaa"` blocked from automated refunds **by default**.
   - Only at **Gate D cutover** (do not touch GIAA's production systems or keys beforehand), compare read-only the Stripe account ID behind GIAA's legacy charges against HafaGolf's production platform Stripe account. **Only if they match**, allow refunds of `legacy_giaa` charges through the platform adapter, backed by a regression test.

---

## 5. Cross-Tenant Security Verification (Required Before Any Production Cutover)

Before opening staging to any second tenant or cutting over production:
1. Run the full CI cross-org isolation suite (`TenantIsolationTest`, `TenantRlsTest`, `PerOrgPaymentsTest`, `SettlementsAndPayoutsTest`).
2. Run the automated non-owner Postgres RLS end-to-end request smoke test (`RlsNonOwnerE2eTest` under `hafagolf_rls_test_role`: public registration → admin list + cross-org block → raffle draw readiness → raffle draw) plus manual staging QA for checkout, refund, and settlement read under `DATABASE_APP_URL`, confirming zero `PG::InsufficientPrivilege` errors and zero cross-org data leakage.
3. Verify `RAILS_ENV=production bundle exec rails db:rls:status` reports `enforced_for_current_role: true`.
