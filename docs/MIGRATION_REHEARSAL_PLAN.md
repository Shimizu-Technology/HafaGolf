# HafaGolf Data Migration & Launch Rehearsal Plan

> **Standing Gate (Leon, Nov 22, 2026):** Original GIAA (`giaa-tournament-*`) and Make-A-Wish (`make-a-wish-guam`) production databases and deployments remain **strictly read-only**. Zero production database connections or exports may run until Leon approves **Gate B** (staging snapshot export) or **Gate D** (cutover).

This document defines the exact, repeatable rehearsal workflow for:
1. **Make-A-Wish Guam & CNMI** (`golfforwishes.com`) — **Feb 22, 2027 Go/No-Go** for **Mar 1, 2027** cutover
2. **FD Alumni Golf** (`fd-golf.shimizu-technology.com`) — **Mar 8, 2027 Go/No-Go** for **Mar 15, 2027** native launch
3. **GIAA Memorial Golf** (`giaa-tournament.com`) — Post-2027 event (or upon full staging acceptance)

---

## 1. Non-Negotiable Safety Invariants

1. **Read-only source snapshots only:** Export via `pg_dump --no-owner --no-privileges` during an off-peak Guam window and restore into a **separate isolated staging source database** (never query production directly from migration tasks).
2. **`EXPECTED_DB_NAME` guard:** Every HafaGolf migration/seed rake task refuses to execute unless `ENV["EXPECTED_DB_NAME"]` matches `ActiveRecord::Base.connection.current_database`, unconditionally blocks local development DBs (`api_development`, `hafagolf_development`), and refuses if `SOURCE_DATABASE_URL` points to the same database as the target.
3. **Idempotent, non-destructive imports:** Imported records are keyed by `(legacy_source, legacy_id)` (or natural keys / legacy markers). Re-running an import or seeder twice on the same snapshot MUST produce **identical row counts**, **zero duplicate records**, and **never overwrite live admin edits** on already-created organizations, tournaments, payment configs, or memberships. *(Note: pre-cutover snapshot re-syncs intentionally refresh historical child rows like golfers, groups, sponsors, raffle rows, and message deliveries — never re-run the legacy importer after live post-cutover writes begin on HafaGolf.)*
   - For `team_members` derived from legacy 2-person `golfers` rows, `legacy_id` uses the composite key `"<golfer_id>:<position>"` (`"42:1"` for Player 1, `"42:2"` for Player 2).
4. **Zero cross-account Stripe refund risk:** Every imported historical Stripe `payment_intent_id` is tagged with `stripe_account_origin` (`legacy_giaa` or `legacy_maw`) so `Golfer#process_refund!` refuses automated API refunds against a mismatched Stripe account.
5. **No plaintext legacy secrets migrated & no `super_admin` escalation:** Legacy `settings` rows are read once only for non-secret metadata if needed; plaintext Stripe keys are **never** copied into `organization_payment_configs`, and imported users are capped at `org_admin` / `tournament_admin` (never `super_admin`).
6. **Admin Clerk relinking:** Deduplicate `users` by `LOWER(email)` and assign `clerk_id = "pending_<sha256(email)[0,32]>"` (32-char lowercase hex prefix) so each admin automatically links to the centralized `golf.shimizu-technology.com` Clerk app on first sign-in.

---

## 2. Rehearsal 1 — Make-A-Wish Guam & CNMI (`golfforwishes.com`)

**Target Rehearsal Window:** Early–Mid February 2027 (**Hard Go/No-Go: Feb 22, 2027**)

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
6. **Functional & Guam Carrier QA:**
   - **Clone 2026 → 2027 Draft:** Run `Tournaments::CloneService` on the imported 2026 tournament; confirm 2027 starts in `draft`, clears stale deadlines/SwipeSimple URLs, and issues year-prefixed raffle tickets (`MAWG27-0001`) with zero collision against 2026 tickets.
   - **Guam SMS Carrier Rehearsal:** Send live ClickSend test messages to real **IT&E**, **Docomo Pacific**, and **GTA** numbers; compare alphanumeric vs numeric sender ID; verify ClickSend delivery webhooks transition `message_deliveries.status` to `delivered`.
   - **Raffle Reliability Walkthrough with Eric Tydingco's Team:** Test POS double-entry phone confirmation, bare `+1671` rejection, "Needs Attention" failed-SMS filter + one-tap edit/resend, Pre-Draw Readiness modal (requiring `delivered` status or audited override), and live projector **Hold Winner on Screen** draw over `async` ActionCable.
   - **Fallback Trigger:** If any P1 item fails on Feb 22, trigger **Lane F fallback** on `make-a-wish-guam` (Leon-gated) rather than rushing cutover.

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
   - Tags historical Stripe charges with `stripe_account_origin: "legacy_giaa"` so cross-account refunds are blocked.
   - Uploads static brand assets via Active Storage to HafaGolf S3.
   - Outputs 100%-matching JSON verification report (row counts, financial sums in cents, zero orphans).
3. **Functional QA:**
   - Verify `employee_pricing` (public validation, race-lock claim, bulk upload, release on cancel).
   - Verify `checkin_alpha_lanes` (A–J / K–Z tabs with live counts) and atomic **Promote + Pay + Check-In** on waitlisted golfers.
   - Verify `memorial-formal` visual QA against `docs/client-specs/AIRPORT_GIAA_BRANDING_SPEC.md`.

---

## 5. Cross-Tenant Security Verification (Required Before Any Production Cutover)

Before opening staging to any second tenant or cutting over production:
1. Run the full CI cross-org isolation suite (`TenantIsolationTest`, `TenantRlsTest`, `PerOrgPaymentsTest`, `SettlementsAndPayoutsTest`).
2. Run the automated non-owner Postgres RLS end-to-end request smoke test (`RlsNonOwnerE2eTest` under `hafagolf_rls_test_role`: public registration → admin list + cross-org block → raffle draw readiness → raffle draw) plus manual staging QA for checkout, refund, and settlement read under `DATABASE_APP_URL`, confirming zero `PG::InsufficientPrivilege` errors and zero cross-org data leakage.
3. Verify `RAILS_ENV=production bundle exec rails db:rls:status` reports `enforced_for_current_role: true`.
