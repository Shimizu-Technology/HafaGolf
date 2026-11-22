# HafaGolf Hosting, Staging & Production Activation Runbook

> **Standing Gate (Leon, Nov 22, 2026):** Do **not** provision paid services, activate production Render/Netlify/Neon/Clerk/Stripe/DNS services, touch original GIAA or Make-A-Wish deployments, or contact clients without Leon's explicit go-ahead on each gate below.

This runbook documents the exact infrastructure topology, environment variables, RLS database role setup, DNS cutover steps, and rollback procedure to move **HafaGolf** from local development → staging acceptance → production launch.

---

## 1. Platform Architecture & Cost Posture

HafaGolf runs **one shared multi-tenant deployment** serving every golf client via host-based tenant resolution (`organization_domains`) and one centralized admin host:

| Layer | Service | Staging Posture | Production Posture | Est. Monthly Cost |
|---|---|---|---|---|
| **Web Frontend** | Netlify (existing Shimizu Pro team plan) | Branch deploy on the HafaGolf Netlify site (free; **no separate staging site**) | **One** Netlify site with free Domain Aliases (`golf.shimizu-technology.com`, `fd-golf.shimizu-technology.com`, `golfforwishes.com`, `www.golfforwishes.com`, `giaa-tournament.com`). `scripts/netlify-ignore-build.sh` + `skip_prs` required. | **$0 incremental** |
| **Rails API** | Render (`hafagolf-api`) | Local dev first; 1 Render Starter staging API only when staging QA begins (suspend when idle) | **One** Render Starter web service (`512 MB`, `WEB_CONCURRENCY=0`, `SOLID_QUEUE_IN_PUMA=false`, boot-only `/up` health check, `async` ActionCable, `autoDeploy: false`) | **$7/mo** |
| **PostgreSQL** | Neon | Neon staging branch (`-pooler` URL, scale-to-zero) | **One** Neon Postgres project in the **same region as Render API**, pooled connection, non-owner `hafagolf_app` RLS role, scale-to-zero preserved | **$0–$5/mo** off-season; **$5–$19/mo** active months *(estimate)* |
| **Admin Auth** | Clerk (single **"HafaGolf"** app — Consumer type, Email+password & Google; no Clerk Organizations, HafaGolf's own allowlist controls access) | **Development** instance of the HafaGolf Clerk app (`ins_3MSVT8IRyt8ffofMiqywbA1i4TW`, `worthy-lioness-6657.clerk.accounts.dev`, used for local & staging — not a separate local app) | **Production** instance of the same HafaGolf Clerk app on `golf.shimizu-technology.com` (created later with Leon's OK when turning on production; requires DNS; free tier, 10K MAUs, zero satellite domains; Clerk JS is lazy-loaded and never bundled/executed on public client domains) | **$0/mo** |
| **Object Storage** | AWS S3 | Dedicated staging prefix | Shared Shimizu S3 bucket, presigned browser uploads, standard Active Storage keys | **~$0–$1/mo** |
| **Email & SMS** | Resend + ClickSend | Resend test/sandbox + ClickSend test to Leon's Guam phone | Shimizu Resend account (Svix HMAC-verified webhooks) + ClickSend SMS (Guam carrier-tested sender ID) | Usage-based (~$5–$20/raffle event) *(estimate)* |
| **Total** | | | **One stack for all clients** | **~$7–$15/mo** steady-state *(estimate)* |

---

## 2. Leon Approval Gates Before Activation

No step in Sections 3–6 below may be executed without Leon's explicit confirmation for that gate:

1. **Gate A — Staging Activation:** Create Neon staging branch, Render staging API (optional/suspendable), Netlify branch deploy, and wire the **HafaGolf** Clerk app's **Development** instance (`ins_3MSVT8IRyt8ffofMiqywbA1i4TW`, `worthy-lioness-6657.clerk.accounts.dev`) keys.
2. **Gate B — Read-Only DB Snapshots for Rehearsal:** Export read-only `pg_dump` snapshots of MAW (`make-a-wish-guam`) and/or GIAA (`giaa-tournament-api`) into isolated staging source databases (original production DBs are never mutated or queried by HafaGolf).
3. **Gate C — Production Hosting Provisioning:** Create Render `hafagolf-api`, Neon production database + `hafagolf_app` role, the **Production** instance of the existing **HafaGolf** Clerk app for `golf.shimizu-technology.com` (requires Cloudflare DNS verification; same Clerk app, not a separate app), Netlify production site + Domain Aliases, S3 credentials, Resend/ClickSend webhooks, and Stripe platform live webhook.
4. **Gate D — Per-Client DNS Cutover & Real Data Move:**
   - `golf.shimizu-technology.com` & `fd-golf.shimizu-technology.com` (Cloudflare DNS) — target Mar 8, 2027 Go/No-Go for Mar 15 FD launch.
   - `golfforwishes.com` & `www.golfforwishes.com` (Square DNS) — **MAW runs its 2027 event (date unconfirmed, likely Thu Apr 29 or Fri Apr 30, 2027) on HafaGolf** (Leon decision, Nov 22, 2026). Keep **Feb 22, 2027 hard Go/No-Go** for cutover ahead of the event (target Mar 1, 2027). Path: staging rehearsal with a copy of MAW data (Gate B) → raffle draw rehearsal with Mr. Eric's team → production switch (Gate C hosting + Gate D real data move & DNS switch). **Fallback if Go/No-Go fails:** paper raffle tickets at the event on MAW's current app (`make-a-wish-guam` stays untouched — do not modify or backport raffle code to it).
   - `giaa-tournament.com` — post-GIAA 2027 event (or only after full GIAA staging sign-off).
5. **Gate E — Legacy Retirement (60 days post-event):** Archive legacy DB dumps/S3 backups, suspend old Render API/DB instances, and archive legacy repos only after Leon's explicit OK.

---

## 3. Environment Variables Matrix

Validate the core Render + Netlify variables before any staging or production deploy using `bash scripts/check-prod-env.sh` from your operator shell with `RENDER_SERVICE_ID`, `NETLIFY_SITE_ID`, `RENDER_API_KEY`, and `NETLIFY_AUTH_TOKEN` exported. Note that `scripts/check-prod-env.sh` checks the core required variables (`DATABASE_URL`, `RAILS_MASTER_KEY`, `SECRET_KEY_BASE`, `FRONTEND_URL`, `CLERK_JWKS_URL`, `RESEND_API_KEY`, `AWS_*`, `VITE_API_URL`, `VITE_WS_URL`, `VITE_CLERK_PUBLISHABLE_KEY`); verify the additional multi-tenant, encryption, webhook, and RLS variables below against your Render/Netlify dashboards before cutover.

### 3.1 Rails API (`hafagolf-api` on Render)

| Variable | Required | Notes |
|---|---|---|
| `RAILS_ENV` | Yes | Always `production` for both staging and production (`api/config/database.yml` defines `development`, `test`, and `production` only; optionally set `APP_ENV=staging` on staging alongside the Neon staging DB URLs) |
| `RAILS_MASTER_KEY` / `SECRET_KEY_BASE` | Yes | Rails credentials / session signing |
| `DATABASE_URL` | Yes | **Direct (non-pooled)** owner Neon Postgres URL for migrations (`db:migrate`) and `db:rls:setup_app_role` (advisory locks & DDL require a non-pooled owner connection) |
| `DATABASE_APP_URL` | Prod/Staging RLS | Non-owner `hafagolf_app` role URL (pooled `-pooler` Neon endpoint for runtime traffic; enforces PostgreSQL `FORCE ROW LEVEL SECURITY` via transaction-local `SET LOCAL` inside `TenantContext` — see `docs/RLS_OPERATIONS.md`) |
| `WEB_CONCURRENCY` | Yes | `0` (single Puma process — required for `async` ActionCable!) |
| `SOLID_QUEUE_IN_PUMA` | Yes | `false` (prevents DB polling and preserves Neon scale-to-zero) |
| `ACTIVE_RECORD_ENCRYPTION_PRIMARY_KEY` | Yes | 32+ char key (`bin/rails db:encryption:init`) — encrypts `organization_payment_configs` |
| `ACTIVE_RECORD_ENCRYPTION_DETERMINISTIC_KEY` | Yes | 32+ char key |
| `ACTIVE_RECORD_ENCRYPTION_KEY_DERIVATION_SALT` | Yes | 32+ char salt |
| `ADMIN_ORIGIN` | Yes | `https://golf.shimizu-technology.com` |
| `API_URL` | Yes | `https://<hafagolf-api-host>` (used to construct `client_processor` webhook URLs) |
| `FRONTEND_URL` | Yes | `https://golf.shimizu-technology.com` (fallback base URL) |
| `CLERK_SECRET_KEY` / `CLERK_JWKS_URL` | Yes | From the single **HafaGolf** Clerk app (**Development** instance `ins_3MSVT8IRyt8ffofMiqywbA1i4TW` for local/staging; **Production** instance on `golf.shimizu-technology.com` once activated under Gate C). Consumer app (Email + Google); Clerk Organizations unused (HafaGolf allowlist controls access). |
| `PLATFORM_STRIPE_PUBLISHABLE_KEY` | Yes | Shimizu Technology platform Stripe account (for `platform_collect` orgs) |
| `PLATFORM_STRIPE_SECRET_KEY` | Yes | Never stored in DB or tenant rows |
| `PLATFORM_STRIPE_WEBHOOK_SECRET` | Yes | Mandatory in **both** staging and production (`POST /api/v1/webhooks/stripe`) |
| `RESEND_API_KEY` | Yes | Transactional email sending |
| `RESEND_WEBHOOK_SECRET` | Yes | Svix `whsec_...` signing secret (`POST /api/v1/webhooks/resend`) |
| `CLICKSEND_USERNAME` / `CLICKSEND_API_KEY` | Yes (SMS orgs) | SMS delivery (`POST /api/v1/webhooks/clicksend`) |
| `CLICKSEND_WEBHOOK_TOKEN` | Yes (SMS orgs) | Shared secret token for ClickSend delivery callbacks |
| `AWS_ACCESS_KEY_ID` / `AWS_SECRET_ACCESS_KEY` / `AWS_REGION` / `AWS_S3_BUCKET` (or `AWS_BUCKET`) | Yes | Active Storage direct uploads & logos (`check-prod-env.sh` accepts either `AWS_BUCKET` or `AWS_S3_BUCKET`) |

### 3.2 Web Frontend (`hafagolf-web` on Netlify)

| Variable | Required | Notes |
|---|---|---|
| `VITE_API_URL` | Yes | Render API base URL (`https://...`) |
| `VITE_WS_URL` | Yes | Render ActionCable WebSocket URL (`wss://<hafagolf-api-host>/cable`) |
| `VITE_ADMIN_ORIGIN` | Yes | `https://golf.shimizu-technology.com` (public domains redirect `/admin*` here) |
| `VITE_CLERK_PUBLISHABLE_KEY` | Yes | Loaded **only** inside the lazy-loaded `admin-clerk` chunk on the admin host |

---

## 4. Database, Migrations & PostgreSQL RLS Activation

1. **Same-region Neon + Render:** Provision the Neon project in the same cloud region as Render (`oregon` / `us-west-2` or matched region) to keep query latency <10ms.
2. **Run migrations as the table owner using the direct (non-pooled) `DATABASE_URL` (never with `DATABASE_APP_URL` set):**
   ```bash
   RAILS_ENV=production DATABASE_APP_URL="" bundle exec rails db:migrate
   ```
3. **Provision the non-owner runtime role (`hafagolf_app`):**
   ```bash
   RAILS_ENV=production DATABASE_APP_URL="" \
     DB_APP_ROLE="hafagolf_app" \
     DB_APP_ROLE_PASSWORD="<strong-random-password>" \
     bundle exec rails db:rls:setup_app_role
   ```
   *(If you need to re-apply RLS policies after adding tables manually, run `RAILS_ENV=production DATABASE_APP_URL="" bundle exec rails db:rls:apply`.)*
4. **Verify RLS enforcement before cutting over traffic (with `DATABASE_APP_URL` set):**
   ```bash
   RAILS_ENV=production bundle exec rails db:rls:status
   ```
   Confirm `enforced_for_current_role: true` (`rolsuper: false`, `rolbypassrls: false`) and `rls_enabled: true`, `rls_forced: true` on every multi-tenant table (full 20-table post-stack list once all Lane 3/4 migrations are applied: `tournaments`, `golfers`, `groups`, `registrations`, `team_members`, `scores`, `sponsors`, `sponsor_slots`, `sponsor_tiers`, `donations`, `employee_numbers`, `raffle_prizes`, `raffle_tickets`, `raffle_sale_batches`, `message_deliveries`, `organization_payment_configs`, `tournament_settlements`, `tournament_payouts`, `tournament_assignments`, `activity_logs`).
5. **Confirm Neon scale-to-zero hygiene:**
   - Render `healthCheckPath` MUST be `/up` (zero DB queries; verified by `RuntimeHygieneTest`).
   - Do **not** point external uptime monitors at `/health` (which queries Postgres).
   - Confirm `config/cable.yml` uses `async` and `SOLID_QUEUE_IN_PUMA=false`.
   - When using Neon PgBouncer transaction pooling on `DATABASE_APP_URL`, note that `api/config/database.yml` currently sets `prepared_statements: true`; switch it to `false` (via code/config update) if your pooler configuration rejects prepared statements, and rely on `TenantContext` transaction-local `SET LOCAL` GUCs.
   - Observe Neon compute metrics over a 48-hour idle staging window to confirm compute suspends cleanly.

---

## 5. Netlify, Clerk & DNS Cutover Steps

### 5.1 Netlify Site Configuration
1. Connect `Shimizu-Technology/HafaGolf` to **one** Netlify site using base directory `web` (`command = "npm run build"`). Note the repository keeps both root `netlify.toml` (`base = "web"`, `publish = "web/dist"`) and `web/netlify.toml` (`publish = "dist"`, effective once Netlify enters `base = "web"`) in sync.
2. Confirm `ignore = "bash ../scripts/netlify-ignore-build.sh"` is active and enable `skip_prs` in Netlify build settings so API-only or docs-only commits never spend build credits.
3. Verify the production build outputs **zero** Clerk references in `dist/assets/index-*.js` and `dist/sw.js` (automated in CI).

### 5.2 Cloudflare DNS (`shimizu-technology.com`) — Platform Admin & FD Alumni Golf
1. **Pre-check:** Verify existing `shimizu-technology.com` **MX / SPF / DKIM** records and Cloudflare HSTS / SSL mode remain untouched (only add dedicated `golf` and `fd-golf` subdomains).
2. Add DNS-only (grey cloud / unproxied during TLS verification) `CNAME` records:
   - `golf` → `<hafagolf-site>.netlify.app`
   - `fd-golf` → `<hafagolf-site>.netlify.app`
3. Add the 5 Clerk Production DNS `CNAME` records for `golf.shimizu-technology.com` (matching the `clerk.hafapass.shimizu-technology.com` pattern) and verify cookie isolation from HafaPass / Payroll.
4. Add `golf.shimizu-technology.com` and `fd-golf.shimizu-technology.com` as Domain Aliases on Netlify and confirm Let's Encrypt HTTPS certificates issue.
5. Seed the FD Alumni Golf tenant on production (idempotent; registers `fd-golf.shimizu-technology.com` as primary in `organization_domains`, applies `crest-classic`, configures `platform_collect` with $0 in-kind fee, and seeds `draft` 2027 tournament + priced sponsor tiers):
   ```bash
   RAILS_ENV=production DATABASE_APP_URL="" EXPECTED_DB_NAME="<prod_db_name>" bundle exec rails hafagolf:seed:fd_alumni
   ```

### 5.3 Square DNS (`golfforwishes.com`) — Make-A-Wish Cutover (Feb 22, 2027 Go/No-Go → Before Late-April 2027 Event)

> **Leon Decision (Nov 22, 2026):** MAW runs its 2027 event (date still unconfirmed, likely **Thu Apr 29 or Fri Apr 30, 2027**) on **HafaGolf**, not on `make-a-wish-guam`. All raffle fixes stay in **HafaGolf only** — do **not** modify `make-a-wish-guam`.
>
> **Required Pre-Cutover Path (every production step requires Leon's explicit OK at the time — list only, never run without approval):**
> 1. **Staging rehearsal with a copy of MAW data (Leon Gate B):** Read-only `pg_dump` → isolated staging source DB → idempotent `hafagolf:migrate:maw` + 100% count/financial verification + S3 media copy + 2026→2027 clone check (see `docs/MIGRATION_REHEARSAL_PLAN.md`).
> 2. **Raffle draw rehearsal with Mr. Eric's team (on HafaGolf staging):** Live Guam SMS carrier test (IT&E, Docomo Pacific, GTA) + full admin QA & walkthrough of POS sale, double-entry phone confirmation, delivery status + edit/resend, pre-draw readiness check, and projector draw screen showing the winner's name.
> 3. **Production switch (Leon Gate C hosting + Gate D real data move & DNS):** Provision HafaGolf production hosting (Section 3–5.2), execute the final data move below, and point `golfforwishes.com` (+ `www`) at HafaGolf before the event (target **Mar 1, 2027**, gated on **Feb 22, 2027 Go/No-Go**).
>
> **Fallback if Feb 22, 2027 Go/No-Go fails:** Run the 2027 event on MAW's existing `make-a-wish-guam` app using **paper raffle tickets at the event**. Do **not** build or backport raffle changes into `make-a-wish-guam`.

1. **Pre-check (before Gate D cutover):** Inspect Square DNS for all existing **MX / TXT / SPF / DKIM** records — **never alter or delete email records**. Check if HSTS is active on `golfforwishes.com`.
2. **T-48h (Leon Gate D approved):** Lower TTL on `@` and `www` to `300s`. Confirm `golfforwishes.com` and `www.golfforwishes.com` are registered in `organization_domains` (with `golfforwishes.com` primary).
3. **Production switch window (off-peak Guam time, zero active registrations, Leon Gate C + D approved):**
   - Put the legacy MAW deployment in maintenance/read-only mode.
   - Take the final read-only `pg_dump` snapshot (real data move — never mutate source).
   - Run the idempotent MAW importer + JSON verification report (100% row-count & cent-exact financial match required — see `docs/MIGRATION_REHEARSAL_PLAN.md`) and copy Active Storage S3 blobs.
   - **Read-only legacy Stripe check (Gate B/D):** Query the read-only MAW snapshot for any non-null `stripe_payment_intent_id` in `golfers` or `raffle_tickets` (the forked `make-a-wish-guam` schema retains Stripe columns alongside SwipeSimple defaults). If any historical Stripe charges exist, verify their Stripe account ID read-only against HafaGolf's production platform Stripe account; keep `legacy_maw` refund-blocked by default unless the account IDs are confirmed identical (with a regression test).
   - Add `golfforwishes.com` and `www.golfforwishes.com` as Domain Aliases on the HafaGolf Netlify site.
   - Update Square DNS: `@` `A` → `75.2.60.5` (Netlify load balancer), `www` `CNAME` → `<hafagolf-site>.netlify.app`.
   - Wait for Let's Encrypt TLS certificate issuance (typically 2–15 minutes).
   - Point Resend (Svix) and ClickSend webhooks to the HafaGolf API endpoints.
   - Run `scripts/smoke-prod.sh` + verify public landing, sponsor portal, raffle board, and admin login on `golf.shimizu-technology.com`.
4. **T+24h (after stability confirmed):** Restore `@` and `www` DNS TTLs from `300s` back to normal (`3600s` / provider default).

### 5.4 GIAA DNS (`giaa-tournament.com`) — Post-2027 Event Cutover
Follow the exact same sequence as Section 5.3 after GIAA's 2027 tournament completes (or if GIAA passes full staging acceptance before registration opens). Verify `employee_pricing`, `checkin_alpha_lanes`, and `memorial-formal` branding before declaring live.

- **GIAA Stripe & Gate D Refund Verification (Leon, Nov 22, 2026):** GIAA has **no Stripe account of its own** — its current app already charges through Shimizu Technology's Stripe, so `platform_collect` matches today with no open decision. Keep imported `stripe_account_origin: "legacy_giaa"` records blocked from automated refunds **by default**. At **Gate D cutover** (never before), perform a read-only check comparing the Stripe account ID behind GIAA's legacy charges with HafaGolf's production platform Stripe account; **only if they match**, enable refunds of `legacy_giaa` charges through the platform adapter with a regression test. Do not touch GIAA's production systems or keys before Gate B/D.

---

## 6. Rollback & Legacy Retirement

### 6.1 Pre-Registration Rollback (< 10 minutes)
Valid **only before** any live registration, sponsorship, donation, or payment is created on HafaGolf:
1. Freeze HafaGolf writes (put HafaGolf API/frontend into maintenance mode) and verify zero new records exist after the cutover timestamp. *(If any live write exists, **stop** — never split writes across two databases; fix forward on HafaGolf.)*
2. Revert DNS to the legacy Netlify site.
3. Lift maintenance/read-only mode on the legacy app.
4. Restore Resend/ClickSend webhooks to the legacy API (only if the legacy deployment serves those endpoints).
5. Verify a smoke read/write succeeds on the restored legacy stack.

### 6.2 Legacy Retirement (30–60 Days Post-Event, Requires Leon's Explicit Gate E)
1. Confirm legacy Netlify auto-builds remain stopped (`stop_builds: true`).
2. Archive encrypted final `pg_dump` + S3 backup of the legacy stack to cold storage.
3. Suspend legacy Render API and Render/Neon Postgres instances and confirm monthly billing delta on the next invoice.
4. Archive legacy GitHub repositories (`make-a-wish-guam`, `giaa-tournament-api`, `giaa-tournament-frontend`, `pacific-golf`) as read-only and delete redundant Netlify sites after the 60-day hold.
