# HafaGolf — Multi-Client Golf Tournament Platform Architecture & Migration Plan

**Status:** Phase 1 Approved (Leon, 2026-11-22: platform named **HafaGolf**, Option B public repo `Shimizu-Technology/HafaGolf` created and seeded from `make-a-wish-guam` `main` `ebf557c`; cross-family Opus 5.5 review approved on Round 2; Phase 2 execution underway starting with PR-0a).
**Date:** 2026-11-22
**Owner:** Golf Platform Lead (for Leon Shimizu / Shimizu Technology)
**Repository:** `Shimizu-Technology/HafaGolf` (public; companion to `Shimizu-Technology/HafaPass`)

**Codebases verified (read-only on MAW, GIAA, HafaPass, and Payroll):**
- `Shimizu-Technology/make-a-wish-guam` — `origin/main` `ebf557c` (192 commits; 17 tables) + open PR #28 (`codex/delivery-reliability-raffle-audit`, `7563843`, mergeable; adds `message_deliveries` and delivery webhooks)
- `Shimizu-Technology/pacific-golf` — `origin/main` `62cb437` (86 commits; 15 tables) + open PRs #17–19 (PR #20 closed in favor of `HafaGolf`)
- `Shimizu-Technology/giaa-tournament-api` (`6dd20dc`, 7 tables) + `giaa-tournament-frontend` (`fc8ae73`)
- `Shimizu-Technology/HafaPass` (`df5deb6a`, `settlements` and `payouts` schema)
- `Shimizu-Technology/cornerstone-payroll` (`PRODUCT_ARCHITECTURE_DECISION_2026-11-19.md`, `PLATFORM_OFFERINGS_IMPLEMENTATION_SPEC_2026-11-17.md`)

---

## 0. Approved Phase 1 Decisions (Leon, Nov 22, 2026) & Standing Gates

| # | Decision | Outcome (Nov 22) | Notes |
|---|---|---|---|
| 1 | **Platform name & repository** (§1) | **Approved — Option B: `Shimizu-Technology/HafaGolf`** (public repo, capitalized like `HafaPass`, seeded from `make-a-wish-guam` `main` `ebf557c` with full history). | `make-a-wish-guam` stays untouched as MAW's live deployment and fallback until cutover. `pacific-golf` PR #20 closed; PRs #17–19 and local `pacific-golf` checkout left alone until PR #18 pieces are ported and Leon approves archiving `pacific-golf`. |
| 2 | **Admin & platform domains** (§2.1) | **Confirmed:** Admin lives at **`golf.shimizu-technology.com`** (one Clerk app). FD public site: **`fd-golf.shimizu-technology.com`**. Leon may buy `hafagolf.com` later (do not buy anything now). | Client public domains (`golfforwishes.com`, `giaa-tournament.com`, `fd-golf.shimizu-technology.com`) never load Clerk. |
| 3 | **Open PRs** (§1.3) | MAW PR #28 merged into `HafaGolf` in PR-0a; merging #28 into `make-a-wish-guam` `main` remains a **separate Leon-gated deploy** (because `make-a-wish-api` has `autoDeploy: true`). `pacific-golf` PR #18 pieces are selectively ported into Lanes 1–3; archiving `pacific-golf` waits for Leon's OK. | Avoids unapproved production deploys to MAW while giving HafaGolf delivery tracking from day one. |
| 4 | **Real-time updates vs Neon scale-to-zero** (§2.7) | Switch `config/cable.yml` production adapter from `solid_cable` (0.1s DB polling) to **`async`** (in-process on single Puma process `WEB_CONCURRENCY=0` with `SOLID_QUEUE_IN_PUMA=false`), with visibility-aware polling as a reconnect fallback. | Preserves sub-second ActionCable push for live banquet raffle draws and check-in with **zero Postgres polling**. Note: `async` cable only reaches subscribers in the same process — keep `SOLID_QUEUE_IN_PUMA=false` and no separate job worker until moving ActionCable to Redis. |
| 5 | **Cutover & staging-first rule** (§5) | Build properly, test locally and on staging; Leon activates production services only when accepted. **GIAA:** no rush for ~Jan 2027 — runs on its original app unless HafaGolf passes acceptance before GIAA opens registration (fallback verified mid-Dec in Lane F). **MAW:** target HafaGolf acceptance by **Feb 22 / Mar 1, 2027**, with current MAW app as fallback. **FD:** native launch on HafaGolf for **Mar 15, 2027** registration open. | No paid services, DNS/Clerk/Render/Netlify/Neon/Stripe/Square changes, production data access, or client messages without Leon's OK. |

---

## 1. Repository Strategy, Open PRs & Naming

### 1.1 Why Make-A-Wish's Code Is the Base

`make-a-wish-guam` was imported from `pacific-golf` in March 2026 (`b09599a`) and evolved through a live production tournament (May 2, 2026) plus post-event hardening. Inspecting both codebases confirms `make-a-wish-guam` is a strict functional and schema superset of `pacific-golf`:

| Dimension | `pacific-golf` (`62cb437`) | `make-a-wish-guam` (`ebf557c` + PR #28) | `giaa-tournament` (`6dd20dc`) |
|---|---|---|---|
| Commits on `main` | 86 | 192 | Separate Rails + Vite repos |
| DB tables | 15 (12 domain + 3 Active Storage) | 17 on `main` (+ `raffle_sale_batches`, `sponsor_slots`); 18 with PR #28 (+ `message_deliveries`) | 7 (`admins`, `employee_numbers`, `golfers`, `groups`, `settings`, `tournaments`, `activity_logs`) |
| Backend services | 3 (`ClerkAuth`, `GolferAuth`, `LeaderboardCalculator`) | 10 (+ `ClicksendClient`, `MessageDeliveryTracker`, `RaffleSmsService`, `SmsService`, `SponsorAccessEmailService`, `SponsorSlotSyncer`, `UserInviteEmailService`) | Inline in models/controllers |
| Production hardening | Demo state only | Ran May 2, 2026 live; has race-condition locks, single-query stats, sponsor portal, payment reconciliation, grouped payment reports, multi-course holes | Ran Jan 9, 2026 live (143 golfers, $1,725 Stripe payout); battle-tested check-in & employee pricing |
| CI workflow | None | None | `.github/workflows/ci.yml` |
| Repo visibility | Public | Public | Public |

The **only** things `pacific-golf` has that `make-a-wish-guam` lacks are:
1. Multi-org super-admin CRUD (`POST /api/v1/admin/organizations`, `SuperAdminDashboard`, `CreateOrganizationPage`, `EditOrganizationPage`).
2. Selective pieces in open **PR #18**: `resolveTournamentBranding` (`web/src/utils/tournamentBranding.ts`), `EmployeeNumber` restored from GIAA, `AccessRequest` onboarding, and `AdminInvitationMailer`. (Note: MAW already has PR #18's `tournaments` branding override columns in its schema, including `theme_preset`, `use_org_branding`, and `*_override`.)

### 1.2 Why Option B (`Shimizu-Technology/HafaGolf`) Was Chosen

**Hard constraints verified in code:**
1. MAW's live site deploys from `Shimizu-Technology/make-a-wish-guam` `main` (`make-a-wish-api` on Render `srv-d6gk5jrh46gs73dlf4h0` has `autoDeploy: true` + `rails db:migrate`; Netlify `69931fa2-398e-4cd0-8e6a-e34a400c051b`). We must not disrupt it before MAW cuts over.
2. `make-a-wish-guam` and `pacific-golf` share **no common git ancestor** (`git merge-base` is empty because MAW's first commit `b09599a` was a fresh import).
3. `pacific-golf/api/render.yaml` defines `pacific-golf-api` with `autoDeploy: true` + `rails db:migrate`, and the local `/Users/leonshimizu/Desktop/ShimizuTechnology/pacific-golf` checkout has uncommitted edits.

Creating the new public repo **`Shimizu-Technology/HafaGolf`** seeded from `make-a-wish-guam` `main` (`b09599a..ebf557c`, 192 commits; history rewritten solely to scrub two literal `sk_test_xxxxxxxx...` / `sk_live_xxxxxxxx...` placeholder strings from `docs/starter-app/STRIPE_SETUP_GUIDE.md` for GitHub Push Protection) gives us:
- Zero disruption to `make-a-wish-guam` `main` (MAW's live site and Mar 1 fallback stay untouched).
- Zero collision with `pacific-golf` history, open PRs, local uncommitted changes, or `pacific-golf-api` auto-deploy.
- Free GitHub Actions minutes on a public Shimizu-Technology repo.
- Clean companion naming (`HafaGolf` alongside `HafaPass`).

### 1.3 Disposition of Existing Open PRs

| Repo | PR | Branch & State | Verified Contents | Disposition |
|---|---|---|---|---|
| `pacific-golf` | **#20** | `agent/golf-platform-design` → `main` | Phase 1 architecture doc | **Closed** (Nov 22) pointing to `Shimizu-Technology/HafaGolf`. |
| `pacific-golf` | **#17** | `fix/date-formatting-and-demo-qa` → `main` (8 files, mergeable) | `formatEventDate()` helper + admin raffle toggle + permitted raffle params | **Leave alone for now**; port `formatEventDate()` if missing; close when archiving `pacific-golf` (with Leon's OK). |
| `pacific-golf` | **#18** | `feature/access-requests-and-public-discovery` → `main` (96 files, mergeable) | `resolveTournamentBranding` (`tournamentBranding.ts`, 4 presets), `EmployeeNumber` model/controller/tests, `AccessRequest` onboarding + mailer, `AdminInvitationMailer`, `SuperAdminDashboard` / org CRUD | **Leave open as read-only input**; port selectively into Lane 1 (org CRUD + invites), Lane 2 (`resolveTournamentBranding`), and Lane 3 (`EmployeeNumber`); archive `pacific-golf` only after Leon's OK. |
| `pacific-golf` | **#19** | `feature/pgf-maw-admin-manual-registration-polish` → `staging` (159 files, conflicting) | Stacked on old `staging` for pre-demo manual registration polish | **Leave alone**; superseded by MAW production flows; close when archiving `pacific-golf`. |
| `make-a-wish-guam` | **#28** | `codex/delivery-reliability-raffle-audit` → `main` (`7563843`, 28 files, mergeable) | `message_deliveries` table/model, `MessageDeliveryTracker`, Resend & ClickSend webhooks, `ClicksendClient` response normalization, draw audit columns (`draw_id`, `draw_eligible_ticket_count`, `draw_preview_ticket_numbers`). Verified: Greptile P1 in `raffle_mailer.rb:249` was fixed in `52d5570`, and merges cleanly with PR #29 (`OffseasonPage.tsx` preserved). | **Merged into `HafaGolf` in PR-0a.** Merging #28 into `make-a-wish-guam` `main` remains a **separate Leon-gated production deploy** (check Render live status + test on staging copy of MAW DB first). |
| `make-a-wish-guam` | **#3, #11, #12** | April 2026 polish branches (all `CONFLICTING`) | Superseded by later merges to `main` | **Leave untouched** until Leon approves MAW cleanup. |

---

## 2. Target Platform Architecture (Validated Against Code)

Modeled on the `cornerstone-payroll` / AIRE multi-client pattern: **one codebase, one deployment, tenant resolved from request host, typed feature catalog enforced in the API, zero client names in code logic**, adapted for golf's public brand differentiation, custom domains, and per-client payment modes.

```
Public client domains (Netlify Domain Aliases — ONE Netlify site)
  fd-golf.shimizu-technology.com   golfforwishes.com   giaa-tournament.com   <future>.shimizu-technology.com
            │                              │                     │
            └──────────────────────────────┴─────────────────────┘
                                           │ X-Tenant-Host / Origin (routing hint)
                                           ▼
                   ┌──────────────────────────────────────────────┐
                   │    HafaGolf API (Rails 8.1 — ONE deployment) │
                   │                                              │
                   │  TenantResolver (org_domains -> Current.org) │
                   │  Features.for(org, tournament)  [API-enforced]│
                   │  OrgUrlBuilder (public host vs admin host)   │
                   │  ActionCable (async, tournament+org scoped)  │
                   │  PaymentGateway (external_link |             │
                   │    platform_collect | client_processor |     │
                   │    offline) + Settlement/Payout ledger       │
                   │  Teams (registrations + team_members 1/2/4)  │
                   │  Raffle + MessageDelivery tracking           │
                   └──────────────────────┬───────────────────────┘
                                          ▲
                                          │ Clerk JWT (ONE Clerk app)
                        golf.shimizu-technology.com
                        HafaGolf Platform & Org Admin Console
                        (Super Admin · Org Admin · Tournament Admin · Volunteer)
```

### 2.1 Tenant Resolution, Domains, Channels & Auth Boundary

**Verified cross-tenant holes in current MAW code that must close before multi-tenant use:**
1. `web/src/App.tsx:41` hardcodes `const MAW_SLUG = 'make-a-wish-guam'`.
2. `Tournament.current` (`api/app/models/tournament.rb:181`) returns the global first open tournament across all organizations.
3. Unscoped `find(params[:id])` calls in `GolfersController`, `TournamentsController`, `GroupsController`, `RaffleController`, `ActivityLogsController`, `CheckoutController`, and `PaymentLinksController`; public `CheckoutController#create` (`:9`) and `#swipe_simple_redirect` (`:320`) load `Golfer.find(params[:golfer_id])` with no org/host check.
4. **ActionCable cross-tenant leaks:** `GroupsChannel` streams one global `"groups_channel"` to any authenticated admin of any org (Org A receives Org B's updates), and `RaffleChannel` accepts any public `tournament_id` without checking it against the resolved org host.
5. `api/config/initializers/cors.rb` uses a static origin list, and outbound links in `Golfer#magic_link_url`, `Golfer#payment_link_url`, `Tournament#full_url`, `CheckoutController`, and mailers hardcode `ENV["FRONTEND_URL"]`.
6. `users.email` has no unique index on `LOWER(email)` today, which invites duplicate user records during migration and invite binding.

**Target design:**
1. **`organization_domains` table** (`id`, `organization_id` FK, `host` unique lowercase, `is_primary` boolean, `verified_at`, `ssl_status`, `created_at`).
   - Maps `fd-golf.shimizu-technology.com`, `golfforwishes.com` (+ `www`), `giaa-tournament.com` (+ `www`), and future domains to their org.
2. **Host-based routing hint (`GET /api/v1/public/bootstrap`):**
   - Because the API has one shared host, the frontend sends `X-Tenant-Host` (and standard `Origin`). **Treat this header strictly as a routing hint, never a security boundary.**
   - Every public endpoint scopes queries strictly to `Current.organization` and rejects cross-org IDs with `404`.
   - Every token-authenticated public endpoint (`/pay/:token`, sponsor portal magic link, golfer scoring magic link) verifies that the token's owning organization matches `Current.organization` (and checks tournament visibility).
   - Remove `Tournament.current` global fallback completely.
   - Replace hardcoded `OffseasonPage.tsx` with a data-driven per-org/per-tournament off-season state (configured in org/tournament settings).
3. **Admin on one domain (`golf.shimizu-technology.com`) with ONE Clerk app:**
   - Only `golf.shimizu-technology.com` loads Clerk, **lazy-loaded via code-splitting (`React.lazy`)** so client domains never execute Clerk JS or require Clerk publishable keys or paid satellite domains ($0 Clerk cost).
   - Confirm during staging setup that Clerk's session cookies on `golf.shimizu-technology.com` are host-scoped and do not collide with HafaPass (`hafapass.shimizu-technology.com`) or Payroll (`payroll.shimizu-technology.com`).
   - Visiting `/admin*` on any client domain redirects immediately to `https://golf.shimizu-technology.com/admin/<orgSlug>/...`.
   - Keep `Authenticated` concern's allowlist-only model (rejects unknown emails with `401`, links `pending_` `clerk_id` on first sign-in), add a unique index on `LOWER(users.email)`, enforce `organization_id` scoping on every admin action, and port `super_admin` org CRUD + org switcher from `pacific-golf` PR #18.
4. **ActionCable scoping:**
   - Scope `GroupsChannel` to `tournament_#{tournament.id}_groups` and require `current_user.can_manage?(tournament)` on subscribe.
   - Scope `GolfersChannel` with `current_user.can_manage?(tournament)` or `volunteer_for?(tournament.organization)`.
   - Scope `RaffleChannel` by verifying `tournament.organization_id == resolved_org.id` AND `tournament.public_listed?` AND `Features.for(org, tournament).enabled?(:raffle)`.
5. **Dynamic CORS & `OrgUrlBuilder`:**
   - Rack::Cors validates `Origin` via a proc against cached `organization_domains.host` + `ADMIN_ORIGIN` (`https://golf.shimizu-technology.com`) + explicit dev localhost origins. Never use wildcard `*` with `credentials: true`.
   - `OrgUrlBuilder.public_url(org, path)` uses `org.primary_domain.host` for confirmation emails, Stripe `success_url`/`cancel_url`, payment links, golfer magic links, and sponsor portal links. `OrgUrlBuilder.admin_url(path)` uses `https://golf.shimizu-technology.com` for admin/volunteer invitations.
6. **Cross-tenant isolation & Postgres RLS:**
   - Mandatory CI isolation suite (`test/integration/tenant_isolation_test.rb`) covering REST controllers, public endpoints, token routes, webhooks, and ActionCable channels across two orgs.
   - Defense-in-depth Postgres RLS on `organization_payment_configs`, `tournament_settlements`, `tournament_payouts`, `registrations`, and `team_members`: requires a **non-table-owner** runtime database role plus `FORCE ROW LEVEL SECURITY`, setting `SET LOCAL app.current_organization_id` inside a per-request transaction (compatible with Neon's transaction pooler) and explicit org-context wrappers for webhooks, background jobs, and Rails console tasks.

### 2.2 Three-Layer Look & Feel (Zero Client Names in Code)

Verified debt in the MAW seed: `web/tailwind.config.js` hardcodes Make-A-Wish blue `#0057B8` as `brand-50..950`, `web/src/` contains ~650 `brand-*` / `#0057B8` matches, and ~9 `api/app/` files hardcode `"Make-A-Wish Guam & CNMI"`, `"MAWGuam"`, or `"make_a_wish_guam"`.

| Layer | Lives in | What it controls | How it works |
|---|---|---|---|
| **1. Brand Kit** | Database (`organizations.brand_kit` jsonb + `tournaments` overrides) | Logo, banner, signature/honoree mark, primary/secondary/accent hex colors, display & body font pair (curated list), tagline, email sender name, reply-to email, SMS sender ID (max 11 chars), footer text, "Built by Shimizu Technology" visibility | Port `resolveTournamentBranding` from `pacific-golf` PR #18. On bootstrap, frontend computes a 50–950 RGB shade scale + contrast-safe foreground tokens and sets `--brand-50..950` and `--accent-50..950` CSS variables on `:root`. `tailwind.config.js` maps `brand.*` and `accent.*` to `rgb(var(--brand-600) / <alpha-value>)`. Replace literal `#0057B8` / `#F5A800` hex classes with semantic tokens. |
| **2. Theme Presets** | Database (`theme_preset` column, already in schema) | Surface style, card border/elevation, button corner radius, header treatment (`classic`, `premium`, `minimal`, `event`) | Pure CSS/token modifiers via `data-theme-preset` on the public shell. |
| **3. Theme Packs** | Frontend code (presentation-only layout registry keyed by **generic theme pack ID**, never client name) | Structural hero composition, typography lockup, section order, and optional signature motion on public pages | Registered in `web/src/themes/registry.ts` by `theme_pack` stored on `organization` / `tournament`:<br>• `default-clean` — standard tournament landing<br>• `memorial-formal` — ceremonial crest/logo + annual edition subtitle + honoree silhouette + navy/gold lockup (serves GIAA and any memorial event)<br>• `charity-bright` — energetic charity hero, prominent tiered sponsor wall, raffle teaser (serves MAW and charity events)<br>• `crest-classic` — alumni/institutional crest hero, fundraising progress meter, sponsor tier showcase, donation CTA (serves FD Alumni Golf and school/association fundraisers) |

**No-client-names rule (enforced in CI):** `scripts/check-no-client-names.sh` fails CI if any client identifier (`giaa`, `make-a-wish`, `mawguam`, `golfforwishes`, `father-duenas`, `fd-golf`, `peter torres`, `muna`) appears in `api/app/` or `web/src/` outside test fixtures and seed/migration scripts. In **PR-0a**, the check runs in **diff-only mode** (blocking newly added client identifiers while legacy MAW seed strings remain); in **PR-2a**, once all legacy strings are stripped, it switches to **full-repo enforcement**.

**Motion rules (Plan §4.4 + `FRONTEND_DESIGN_GUIDE.md`):**
- Only main public landing pages get motion — **at most one signature moment per theme pack** (e.g., fundraising goal meter filling once from real data on `crest-classic`, or course hero reveal), plus a static-grid sponsor wall reveal.
- Copy `use-motion-ok.ts` and `reveal-on-scroll.tsx` (~10 KB, zero animation libraries). The still page is the real page; respect `prefers-reduced-motion`; no count-ups, no marquees, no scroll-jacking, no preloaders.
- Registration forms, checkout, check-in, group assignment, scoring, raffle POS, and all admin screens stay quiet.

### 2.3 Typed Features Catalog (`Features.for(org, tournament)`)

Modeled on `cornerstone-payroll`'s `OperatingProfileCatalog` and `CompanyFeatures.for(company)`:
- **Storage:** `organizations.feature_flags` (jsonb, validated against catalog) + `tournaments.feature_overrides` (jsonb, optional per-tournament overrides for allowed keys).
- **Catalog (`GolfFeaturesCatalog`):** Single Ruby source of truth declaring each key's `type`, `default`, `label`, `description`, `requires` dependencies, and `tournament_overridable` flag. Unknown keys fail validation on write; a unit test enforces every referenced key exists in the catalog.
- **API enforcement:** Every gated controller uses `before_action -> { require_feature!(:feature_key) }` returning `403 Forbidden` when disabled. UI reads resolved `features` from `/public/bootstrap` and `/auth/me` to hide disabled tabs/routes, never as the sole gate.

| Feature Key | Default | Dependencies | GIAA | MAW | FD Golf |
|---|---|---|---|---|---|
| `scoring` | `false` | — | Off (Callaway later) | Off (committee voted no) | Optional / Off initially |
| `live_leaderboard` | `false` | `scoring` | Off | Off | Off initially |
| `raffle` | `false` | — | Off (future interest) | **On** | Optional |
| `sponsor_portal` | `false` | — | Off | **On** | **On** |
| `sponsor_checkout` | `false` | — | Off | Off | **On** (priced sponsor tiers) |
| `donations` | `false` | — | Off | Optional (open-amount link) | **On** |
| `sms_notifications` | `false` | — | Off | **On** | Optional |
| `waitlist` | `true` | — | **On** | **On** | **On** |
| `employee_pricing` | `false` | — | **On** (`EmployeeNumber`) | Off | Off |
| `checkin_alpha_lanes` | `false` | — | **On** (A–J / K–Z) | Off | Optional |
| `multi_course` | `false` | — | Off | **On** (e.g. 36-hole setups) | Off |

### 2.4 Per-Org Payment Modes & Payout Tracking

**Legacy cleanup (executed in PR-4a, once per-org payments replace all 19 `Setting.instance` references):** Remove the singleton `settings` table (which currently stores GIAA defaults like `"GIAAEO"` / `"Peter Torres"` and **plaintext** Stripe keys). During PR-0b through PR-4a, Stripe/webhook code prefers ENV first so Stripe remains unbroken while `organization_payment_configs` is built.

**New `organization_payment_configs` table:**
- `organization_id` (unique FK)
- `payment_mode` (checked string): `external_link` | `platform_collect` | `client_processor` | `offline`
- `processor_provider` (`stripe` | `swipesimple` | `paypal` | `worldpay_cardpointe` | `none`)
- `webhook_endpoint_token` (unique opaque random token for `client_processor` webhook routing — never use predictable `:org_slug`)
- `encrypted_public_key`, `encrypted_secret_key`, `encrypted_webhook_secret` via Rails 8 `ActiveRecord::Encryption` (used **only** for `client_processor`; `platform_collect` reads Shimizu's Stripe keys exclusively from server ENV `PLATFORM_STRIPE_SECRET_KEY` / `PLATFORM_STRIPE_WEBHOOK_SECRET` and never copies platform secrets into tenant rows)
- `external_checkout_url`, `external_walkin_url`, `external_donation_url` (with per-tournament overrides on `tournaments`)
- `platform_fee_flat_cents`, `platform_fee_per_registrant_cents`, `platform_fee_cap_cents` (configurable per org; e.g., GIAA $300 + $3/registrant per `airport.md`, MAW $5/registrant per `make-a-wish/README.md`, FD $0 in-kind per Plan v5 §6 — exact terms confirmed per contract before finalizing statements)
- `payout_payee_name`, `payout_bank_name`, `payout_notes`
- Secondary offline flags remain per-tournament (`allow_cash`, `allow_check`, `allow_pay_on_day`, `checks_payable_to`).

**How each mode works:**
1. **`external_link` (MAW):** Registration saves as `payment_status: "pending"`, redirects to tournament/org SwipeSimple (or PayPal) link (including open-amount links); admin verifies via `verify_payment!`, transitioning `pending` → `confirmed` and triggering confirmation email/SMS + check-in visibility.
2. **`platform_collect` (FD Golf, GIAA):** Checkout creates a Stripe Checkout Session on Shimizu Technology's Stripe account with metadata `{ organization_id, tournament_id, registration_id, item_type }` (`registration` | `sponsorship` | `donation`). Webhook `/api/v1/webhooks/stripe` **requires signature verification in both staging and production** (never unsigned outside local dev/test), resolves the scoped record, marks paid idempotently under a row lock, records Stripe fee when available, and feeds the payout ledger.
3. **`client_processor` (future clients & BOG/Worldpay):** Uses the org's encrypted credentials via a `Payments::ProviderAdapter` interface (`StripeAdapter` ready now; `CardPointeWorldpayAdapter` plugs in once BOG/Worldpay completes). Client Stripe webhooks route via `/api/v1/webhooks/stripe/orgs/:webhook_endpoint_token` using that org's encrypted webhook secret.
4. **`offline`:** Cash/check/comp only; no online checkout UI shown.

**Historical refund safety:** Imported historical Stripe `payment_intent_id`s are tagged `stripe_account_origin` (e.g. `legacy_giaa` vs `platform_live`) and blocked from API refunds unless they belong to the currently configured Stripe account.

**Payout record (HafaPass-aligned field names for Fall 2027 consolidation):**
Verified against `HafaPass/hafapass_api/db/schema.rb` (`settlements` and `payouts`). HafaGolf stays separate from HafaPass in 2027, using two lightweight tables with matching column names:
- **`tournament_settlements`:** `organization_id`, `tournament_id`, `version`, `status` (`draft`/`finalized`), `currency` (`"usd"`), `gross_cents`, `refund_cents`, `processing_fee_cents`, `platform_fee_cents`, `adjustment_cents`, `net_cents`, `organizer_proceeds_cents`, `paid_cents`, `payable_cents`, `source_digest`, `calculated_at`, `finalized_at`.
- **`tournament_payouts`:** `organization_id`, `tournament_id`, `settlement_id`, `amount_cents`, `currency` (`"usd"`), `status` (`pending`/`paid`/`voided`), `provider` (`"check"`/`"manual"`/`"ach"`), `provider_payout_id` (check number or transfer reference), `payee_snapshot` (jsonb: legal payee, Bank of Guam account memo/address), `initiated_at`, `paid_at`, `notes`, `idempotency_key`.

**IRS quid-pro-quo receipts (FD Golf & charities):** Per-tournament config (`tax_receipt_enabled`, `tax_org_name`, `tax_org_ein`, `fmv_per_player_cents`, `tax_receipt_disclaimer`) prints FMV and deductible excess on confirmation receipts for payments over $75. Stays off until FDAA's treasurer/CPA approves exact wording.

### 2.5 Real Teams Model (`registrations` + `team_members`) & Domain Invariants

**Verified limitation in the MAW seed:** `golfers` stores Player 1 in primary columns and Player 2 in `partner_*` columns, which cannot represent 4-person FD foursomes, prevents per-player check-in for teams > 2, and forces `create_raffle_tickets!` (`golfer.rb:227-274`) to hardcode `captain_ticket` and `partner_ticket`.

**Target schema:**
- **`registrations`** (the booking, payment, and pairing unit):
  - `organization_id`, `tournament_id`, `group_id` (nullable), `sponsor_id` (nullable)
  - `team_name`, `team_category` (optional unless tournament enables categories; not hardcoded to `Male/Female/Co-Ed`), `registration_source` (`public`/`admin`/`sponsor`/`walk_in`)
  - `registration_status` (`confirmed`/`waitlist`/`pending`/`cancelled`)
  - Contact/billing snapshot (`contact_name`, `contact_email`, `contact_phone`, `company`)
  - Payment fields (`payment_type`, `payment_status`, `payment_method`, `payment_amount_cents`, `paid_at`, `payment_verified_at/by`, `payment_token`, `receipt_number`, `payment_notes`, `stripe_*`, `stripe_account_origin`, `refund_*`)
  - `legacy_source`, `legacy_id` (unique partial index on `(legacy_source, legacy_id) WHERE legacy_source IS NOT NULL`)
- **`team_members`** (one row per actual human golfer, 1 to `tournament.team_size` rows per registration):
  - `organization_id`, `tournament_id`, `registration_id`
  - `position` (1..4), `is_captain` (boolean)
  - `name`, `email`, `phone`, `mobile`, `company`, `address`, `tshirt_size`, `handicap`
  - `is_employee` (boolean), `employee_number_record_id` (FK to `employee_numbers`, nullable)
  - `waiver_accepted_at`, `checked_in_at`, `checked_in_by_id`, `checked_in_by_name`
  - `magic_link_token`, `magic_link_expires_at` (for mobile PWA scoring)
  - `legacy_source`, `legacy_id` (for MAW pairs, `legacy_id` is `"<golfer_id>:<position>"` so both Player 1 and Player 2 have unique idempotency keys)

**Explicit domain invariants (capacity, scores, sponsor slots, uniqueness):**
1. **Capacity unit (`tournaments.capacity_unit`):** Explicit checked string `'players'` or `'teams'` (default `'players'` for GIAA/FD partial-team tournaments; `'teams'` for MAW 2-person teams).
   - **Public capacity & waitlist:** When `capacity_unit == 'teams'`, `confirmed_count` counts active confirmed `registrations` and `sponsor_reserved` = `SUM(sponsors.slot_count) / team_size`. When `capacity_unit == 'players'`, `confirmed_count` counts active confirmed `team_members` (with partial teams counting their actual player count) and `sponsor_reserved` = `SUM(sponsors.slot_count)`.
   - **Group placement (`Group`):** Always enforced in **players** (`SUM(team_members)` across registrations in the group ≤ `tournament.players_per_start_position`), so four solo GIAA registrations, two MAW pairs, one FD foursome, or two FD 2-player partial teams can share one 4-player starting position cleanly.
2. **Scores (`scores` table):** Update `scores` to hold nullable `registration_id` (used when `score_type == 'team'` / scramble) and nullable `team_member_id` (used when `score_type == 'individual'` / stroke / best ball), with a DB check constraint enforcing the right FK for `score_type` alongside `group_id` and `tournament_id`.
3. **Sponsor slots (`sponsor_slots` & `sponsor_tiers`):**
   - `sponsor_tiers` (`tournament_id`, `key`, `label`, `price_cents`, `included_player_slots`, `max_quantity`, `benefits` jsonb, `online_checkout_enabled`, `sort_order`) defines priced tiers for FD (and optional online checkout).
   - Buying a sponsor tier (or creating a sponsor manually) creates `Sponsor` with `slot_count = included_player_slots` and pre-creates `slot_count` `SponsorSlot` rows (`slot_number` 1..N, `player_name/email/phone`).
   - When the sponsor fills and confirms slots in the Sponsor Portal, `SponsorSlotSyncer` groups filled slots into `registrations` (size `tournament.team_size`, `payment_type: 'sponsor'`) with one `team_member` per filled slot (1:1 `sponsor_slot_id` link on `team_members` so editing a player in the portal updates that `team_member` idempotently).
4. **Email uniqueness:** Replace `golfers`'s public `(tournament_id, email)` partial unique index with a partial unique index on `team_members(tournament_id, LOWER(email))` where `email IS NOT NULL` AND the parent registration is non-cancelled and non-admin-sourced (enforced via `registration_active_public` boolean maintained in a transaction, or application lock + tournament-scoped partial index on `registrations(tournament_id, LOWER(contact_email))` for captains plus duplicate-player validation on `team_members`).
5. **Donations (`donations` table):** `organization_id`, `tournament_id` (optional), `donor_name`, `donor_email`, `donor_phone`, `amount_cents`, `payment_type`, `payment_status`, `stripe_payment_intent_id`, `anonymous`, `message`, `paid_at`, `tax_receipt_sent_at`. Feeds `tournament_settlements` when collected via `platform_collect`.

### 2.6 Clone a Tournament (`Tournaments::CloneService`)

MAW's `Tournament#copy_for_next_year` (`tournament.rb:411-487`) copies ~55 fields within the same org but carries over stale `sponsor_edit_deadline` and `swipe_simple_url` and cannot clone across orgs.

Replace with **`Tournaments::CloneService`**:
1. **Next-year clone (Org Admin or Super Admin):** Clones within the same org; increments `year` and `edition`; clears all date/deadline fields (`event_date`, `registration_deadline`, `early_bird_deadline`, `sponsor_edit_deadline`, `raffle_draw_time`); resets `status: 'draft'`, `registration_open: false`, `walkin_registration_open: false`; preserves format, `capacity_unit`, course/hole pars, feature overrides, sponsor tier definitions, raffle bundles, and branding; flags external payment URLs for operator review; optionally copies sponsor directory shells (0 filled slots, no tokens). Never copies registrations, team members, groups, scores, raffle tickets, payments, or payouts.
2. **Template clone to another org (Super Admin):** Clones format, schedule structure, course config, sponsor tier templates, and feature defaults into a target org, stripping source-org branding overrides, contact info, checks-payable-to, and external payment URLs.

### 2.7 Runtime & Neon Hygiene (Verified Production Traps to Fix in Lane 0)

Inspecting MAW and `pacific-golf` uncovered four runtime traps against `PRODUCTION_RUNTIME_AND_COST_GUIDE.md`:
1. **`/health` queries Postgres** (`api/app/controllers/health_controller.rb:15` calls `ActiveRecord::Base.connection.active?`) and legacy `render.yaml` pointed `healthCheckPath` at `/health`. **Fix:** Point Render `healthCheckPath` at boot-only `/up` (zero DB queries — already done in PR-0a); keep `/health` for manual diagnostics only.
2. **`solid_cable` polls Postgres every 0.1s** (`api/config/cable.yml:15`), preventing Neon from ever scaling to zero. **Fix (PR-0b):** Because the API runs as a single Puma process (`WEB_CONCURRENCY=0`) and production already uses `queue_adapter = :async`, switch `config/cable.yml` production adapter to **`async`**. This keeps sub-second ActionCable push for live raffle draws and check-in with **zero DB polling**, while visibility-aware polling (paused when hidden) serves only as a reconnect fallback. **Important coupling:** `async` cable only reaches WebSocket subscribers inside the same process, so **`SOLID_QUEUE_IN_PUMA` must remain `false` (and no separate worker process should emit broadcasts) unless ActionCable is moved to Redis**.
3. **`SOLID_QUEUE_IN_PUMA` string truthiness bug** (`api/config/puma.rb:11`: `plugin :solid_queue if ENV["SOLID_QUEUE_IN_PUMA"]` treats `"false"` as truthy in Ruby). **Fix (PR-0b):** Parse booleans explicitly (`%w[1 true t yes y on].include?(...)`) and keep `SOLID_QUEUE_IN_PUMA=false`.
4. **Netlify credit protection:** Add `scripts/netlify-ignore-build.sh` (watching `web/` and shared lockfiles — done in PR-0a) and keep `skip_prs` enabled so docs-only and API-only merges never burn Netlify credits.

---

## 3. Feature Inventory Across All Three Codebases

| Capability | GIAA (`giaa-tournament`) | MAW (`make-a-wish-guam`) | `pacific-golf` (`62cb437` + PR #18) | HafaGolf Disposition |
|---|---|---|---|---|
| **Multi-org tenant model & org CRUD** | None (single-tenant) | Stripped (`MAW_SLUG` pinned) | `Organization`, `OrganizationMembership`, `SuperAdminDashboard`, org CRUD | **Port from PG** + add `organization_domains` host resolver |
| **Brand Kit + Theme Presets + Theme Packs** | Hardcoded GIAA navy/gold + honoree silhouette | Hardcoded `#0057B8` + `theme_preset` DB columns | PR #18 `resolveTournamentBranding` + 4 presets | **Port PR #18 resolver** + CSS variable refactor + 4 Theme Packs |
| **Employee-number pricing (`EmployeeNumber`)** | Full (table, validation endpoint, row-lock claim, bulk upload, toggle/bulk toggle) | Flag column only (`employee_discount_enabled`, no table) | Restored in PR #18 | **Port** behind `employee_pricing` feature flag |
| **Check-in A–J / K–Z lanes & Promote+Pay+Check-In** | Built in `CheckInPage.tsx` | Not in `OrgCheckInPage.tsx` | Not in `OrgCheckInPage.tsx` | **Port** behind `checkin_alpha_lanes` / `waitlist` flags |
| **Real teams (1, 2, or 4 players)** | Individual only (`team_size: 1`) | 2-person via `partner_*` columns | Individual only | **Rebuild cleanly** as `registrations` + `team_members` with `capacity_unit` |
| **Stripe Checkout + Webhooks + `/pay/:token` + Refunds** | Built (global plaintext key in `settings`) | Built (global plaintext key in `settings`) | Built (hardened refund races in PR #15) | **Keep & upgrade** to per-org `platform_collect` + `client_processor` (encrypted keys); **drop `settings` in PR-4a** |
| **External payment links (SwipeSimple) + Admin Verify** | None | Built (`swipe_simple_url`, `walkin_swipe_simple_url`, `verify_payment!`, `PaymentReconciliationPage`) | None | **Keep** as `external_link` payment mode |
| **Payout ledger (collected, fees, refunds, owed, check #)** | Manual spreadsheet ($1,725 paid by hand) | None | None | **Build new** (`tournament_settlements` + `tournament_payouts`, HafaPass-aligned) |
| **Split payment reports (registration vs raffle)** | Basic golfer report | Built (`PaymentReportsController`, grouped `raffle_sale_batches`) | Basic report | **Keep from MAW** + extend with sponsor checkout & donations |
| **Sponsor directory, hole sponsors & self-service portal** | None | Built (`sponsors`, `sponsor_slots`, magic-link `SponsorPortalPage`, edit deadline, multi-course holes) | Basic sponsor wall only | **Keep from MAW** behind `sponsor_portal` flag |
| **Online sponsorship checkout (priced tiers)** | None | None | None | **Build new** for FD (reusable) behind `sponsor_checkout` flag |
| **Standalone donations page + FMV tax receipts** | None | None (used external PayPal/SwipeSimple) | None | **Build new** for FD (reusable) behind `donations` flag |
| **Digital raffle + POS bundles + live draw board** | None | Built (`raffle_prizes`, `raffle_tickets`, `raffle_sale_batches`, `RaffleBoardPage`, `RaffleManagementPage`) | Basic raffle without batches/POS/SMS | **Keep from MAW** + complete §7 reliability & ticket-number uniqueness fixes |
| **SMS & Email delivery tracking + webhooks** | Email only (Resend) | Built in **PR #28** (`message_deliveries`, Resend + ClickSend webhooks) | None | **Merged in PR-0a** + add `organization_id`, Svix Resend signature verification, admin UI & pre-draw check |
| **Live mobile scoring (PWA) & leaderboard** | None (wants Callaway later) | Built (`ScorecardPage`, `LeaderboardPage`, `LeaderboardCalculator`, magic-link `GolferAuth`) | Built | **Keep from MAW** behind `scoring` & `live_leaderboard` flags (add Callaway later) |
| **Multi-course & drag-drop group/hole management** | Single-course drag-drop (`7A` labels) | Multi-course (`course_configs`, `teams_per_start_position`, `merge_into`, `place_golfer`) | Single-course | **Keep from MAW** |
| **Volunteer role (check-in + raffle POS only)** | None | Built (`volunteer` role + `AdminOnlyRoute`) | None | **Keep from MAW** |
| **Tournament cloning** | Basic `copy` | `copy_for_next_year` (same org) | Basic `copy` | **Upgrade** to `Tournaments::CloneService` (same-org + cross-org template) |
| **GIAA singleton `settings` row & hardcoded defaults** | Used | Leftover dead weight with plaintext Stripe keys | Leftover dead weight | **Drop in PR-4a** |
| **Hardcoded MAW off-season screen & `MAW_SLUG`** | N/A | Built in PR #29 (`OffseasonPage.tsx`) | N/A | **Replace in PR-1a/1c** with configurable per-org/per-tournament off-season state |
| **Gala (`event_type: 'gala'`)** | None | Partial `event_type` column | None | **Keep column dormant**, do not expand until a client commits |

---

## 4. Data Migration Plan (GIAA & Make-A-Wish Production Data)

**Standing gate:** Zero production database access without Leon's approval. All migration code is written, tested against synthetic fixtures, and rehearsed on **restored staging copies** of production dumps before any cutover.

### 4.1 Core Principles
1. **Never mutate source production DBs.** Export via read-only `pg_dump` (snapshot taken during a quiet off-season window with Leon's approval) and restore into an isolated local/staging source database.
2. **Idempotent, re-runnable imports.** Because GIAA and MAW both use autoincrement `bigint` IDs that collide (`tournaments.id = 1`, `golfers.id = 1..143`, etc.), imported tables carry `(legacy_source, legacy_id)` with a unique partial index (`WHERE legacy_source IS NOT NULL`). **Important:** For `team_members`, where one MAW `golfers` row produces two players, `legacy_id` uses the composite string `"<golfer_id>:<position>"` (e.g. `"42:1"` and `"42:2"`) so both players remain uniquely idempotent.
3. **Preserve financial & audit history verbatim.** Historical amounts (`payment_amount_cents`, `refund_amount_cents`, `stripe_payment_intent_id`, `stripe_refund_id`, `receipt_number`, `paid_at`, `checked_in_at`, `activity_logs`) copy verbatim with original timestamps. Historical Stripe payment intents are flagged with `stripe_account_origin` so HafaGolf never attempts cross-account Stripe refunds.
4. **Confirm database identity before any `db:` command.** Migration rake tasks refuse to run unless `EXPECTED_DB_NAME` matches `ActiveRecord::Base.connection.current_database` and never touch the shared local `api_development` DB.

### 4.2 Entity-by-Entity Mapping

| Source Data | GIAA Source (`giaa-tournament-api`) | MAW Source (`make-a-wish-guam`) | Target HafaGolf Tables |
|---|---|---|---|
| **Organization** | Synthesized from `settings` + branding spec (`slug: 'giaa'`, `theme_pack: 'memorial-formal'`, `payment_mode: 'platform_collect'`) | `organizations` row (`slug: 'make-a-wish-guam'`, `theme_pack: 'charity-bright'`, `payment_mode: 'external_link'`) | `organizations` + `organization_domains` + `organization_payment_configs` |
| **Users / Admins** | `admins` table | `users` + `organization_memberships` + `tournament_assignments` | Deduplicate `users` by `LOWER(email)` (backed by new unique index). Reset `clerk_id` to `pending_<sha256(email)>` (admin moves to the new `golf.shimizu-technology.com` Clerk app; first sign-in links automatically via `Authenticated`). Recreate `organization_memberships` with verified roles (`admin`/`volunteer`). |
| **Tournaments** | `tournaments` (e.g. Jan 9, 2026 — 5th Annual; `capacity_unit: 'players'`) | `tournaments` (e.g. May 2, 2026 Golf for Wishes; `capacity_unit: 'teams'`) | `tournaments` (with `feature_overrides`: GIAA `employee_pricing: true`, `checkin_alpha_lanes: true`; MAW `raffle: true`, `sponsor_portal: true`, `scoring: false`) |
| **Groups** | `groups` | `groups` (preserving `starting_course_key`) | `groups` mapped via `legacy_id` |
| **Registrations & Team Members** | 1 GIAA `golfer` → **1 `registration`** (`legacy_id: "<id>"`, `team_size: 1`) + **1 `team_member`** (`legacy_id: "<id>:1"`, `is_captain: true`, linking `employee_number_record_id`) | 1 MAW `golfer` → **1 `registration`** (`legacy_id: "<id>"`, `team_size: 2`) + **1 or 2 `team_members`** (`"<id>:1"` from primary columns; `"<id>:2"` from `partner_*` when `partner_name` present) | `registrations` + `team_members` |
| **Scores** | N/A | `scores` (if any test/live rows exist) | `scores` with `group_id` remapped, `registration_id` set for `team` scores, and `team_member_id` set for `individual` scores |
| **Employee Numbers** | `employee_numbers` | N/A | `employee_numbers` (`used_by_team_member_id` remapped via `"<used_by_golfer_id>:1"`) |
| **Sponsors & Slots** | N/A | `sponsors` + `sponsor_slots` (expire historical 2026 tokens; preserve only for active upcoming events) | `sponsors` + `sponsor_slots` (link `team_members.sponsor_slot_id` where matched) |
| **Raffle & Deliveries** | N/A | `raffle_sale_batches`, `raffle_tickets` (uniqueness scoped to `(tournament_id, ticket_number)`), `raffle_prizes`, `message_deliveries` (backfill `organization_id`) | Same tables, remapping `registration_id` / `team_member_id` / `sold_by_user_id` / `winning_ticket_id` |
| **Media / S3 Blobs** | Static frontend assets (`giaa-logo.png`, `pete-silhouette.png`) → upload via Active Storage to HafaGolf S3 | Active Storage S3 blobs (sponsor logos, raffle prize images, org logo/banner) → copy S3 objects to HafaGolf bucket and recreate `active_storage_blobs` + `attachments` with checksum verification (standard Active Storage keys, tenant-scoped signed URLs) | S3 + `active_storage_*` |
| **Activity Logs** | `activity_logs` | `activity_logs` | `activity_logs` with remapped `admin_id`, `tournament_id`, `target_id` (`target_type` `'Golfer'` → `'Registration'`) |
| **Legacy `settings`** | Read once to seed GIAA org/tournament metadata; **do not migrate plaintext Stripe keys** | Verify no unique config; **do not migrate** | Dropped in PR-4a |

### 4.3 Verification Counts, Checksums & Rehearsal
Every import run outputs a machine-readable JSON verification report comparing Source vs Target per organization and tournament, failing/rolling back on any mismatch:
- **Exact row counts:** tournaments, groups, registrations (confirmed / waitlist / pending / cancelled), `team_members` (GIAA = source `golfers`; MAW = source `golfers` + non-blank `partner_name` rows), scores, sponsors, sponsor slots, employee numbers (total / used / available), raffle sale batches, raffle tickets (paid / complimentary / voided / winner), raffle prizes (won / claimed), message deliveries, activity logs, and reachable S3 blobs (`HTTP 200` + checksum match).
- **Exact financial sums (in cents):** `SUM(payment_amount_cents)` for paid registrations, `SUM(refund_amount_cents)` for refunds, `SUM(price_cents)` for paid raffle tickets, count of Stripe `payment_intent_id`s and `refund_id`s.
- **Referential integrity:** zero orphaned `group_id`, `sponsor_id`, `employee_number_record_id`, `winning_ticket_id`, `registration_id`, `team_member_id`, or `active_storage_attachments`.
- **Rehearsal:** Full export → import → verify → UI spot-check on staging copies at least **2 weeks before each client's cutover**. Keep source DBs and apps read-only for 60 days post-cutover.

---

## 5. Cutover Plan Per Client, Fallback Readiness, DNS & Rollback

Per Leon's Nov 22 direction: **build HafaGolf properly; no deadline-driven shortcuts.** Each client moves onto HafaGolf only after passing staging acceptance; if a client needs its event before HafaGolf is ready, it runs on its original app.

### 5.1 Schedule & Go/No-Go Gates

| Client | Public Domain | Key Event Dates | Cutover Strategy | Hard Go/No-Go Gate | Fallback |
|---|---|---|---|---|---|
| **GIAA** | `giaa-tournament.com` | Assumed ~Jan 2027 (last event Jan 9, 2026; unconfirmed) | **No rush.** Runs 2027 on existing `giaa-tournament-*` apps unless HafaGolf passes full GIAA acceptance before registration opens (unlikely given ~Jan timing). Migrates right after the 2027 event for 2028. | 2 weeks before GIAA opens registration (or post-event Feb/Summer 2027) | Existing `giaa-tournament-api` + `giaa-tournament-frontend` — verified ready in **Lane F (mid-Dec)** |
| **Make-A-Wish** | `golfforwishes.com` (Square DNS) | 2027 unconfirmed (Sept 16 note said late April at CCP); **target ready by Mar 1, 2027** | **Primary target:** cut over to HafaGolf by **Mar 1, 2027** with full raffle reliability + rehearsed 2026 data import + Eric's team rehearsal. | **Feb 22, 2027** — full staging acceptance + Guam SMS rehearsal + Eric sign-off | Existing `make-a-wish-guam` app — receives early raffle & ticket-number fixes in **Lane F** if fallback is triggered |
| **FD Alumni Golf** | `fd-golf.shimizu-technology.com` (Cloudflare DNS) | Registration & sponsorships open **Mar 15, 2027**; event **Sat May 15 or 22, 2027** | **Native HafaGolf launch** (no legacy data). `crest-classic` theme pack, foursomes, priced sponsor tiers + online checkout, donations, `platform_collect` (Shimizu Stripe) + check payout to CO2017 Bank of Guam account. | **Mar 8, 2027** — CO2017 board walkthrough on staging + $1 live Stripe checkout/refund/payout check | Offline/check sponsorship recording & Stripe payment link fallback |
| **Platform Admin** | `golf.shimizu-technology.com` (Cloudflare DNS) | Before first production client cutover | Single Clerk production app; all org admins & volunteers sign in here. (Optional `hafagolf.com` later if Leon buys it.) | Before MAW/FD production activation | N/A |

### 5.2 DNS Cutover Steps (Requires Leon's Explicit Gate Before Execution)

1. **Cloudflare (`shimizu-technology.com`) — for `golf.` and `fd-golf.`:**
   - Add DNS-only `CNAME` `golf` → `<hafagolf-site>.netlify.app` and `CNAME` `fd-golf` → `<hafagolf-site>.netlify.app`.
   - Add the 5 Clerk production DNS `CNAME`s for `golf.shimizu-technology.com` (copying HafaPass's `clerk.hafapass.shimizu-technology.com` pattern).
   - Add both custom domains in Netlify and verify TLS certificates issue cleanly.
2. **Square DNS (`golfforwishes.com`) — for MAW cutover:**
   - **Pre-check:** Inspect Square DNS for existing **MX / TXT / SPF / DKIM** records (leave all email records untouched!) and check whether HSTS is set on `golfforwishes.com`.
   - 48 hours prior: lower TTL on `@` and `www` to 300s; confirm `golfforwishes.com` + `www.golfforwishes.com` are in `organization_domains`.
   - At cutover (off-peak Guam window, zero active registrations): freeze old MAW app (maintenance/read-only), take final DB snapshot, run idempotent import + verification counts, add domain aliases on the HafaGolf Netlify site, update Square DNS (`A` → Netlify load balancer `75.2.60.5`, `www` `CNAME` → `<hafagolf-site>.netlify.app`).
   - **TLS note:** Let's Encrypt on Netlify cannot issue the certificate for `golfforwishes.com` until DNS points to Netlify, so expect a brief (typically 2–15 min) HTTPS provisioning window — run cutover off-peak and verify HTTPS + public landing + sponsor portal + raffle board + admin login on `golf.shimizu-technology.com` before announcing live.
   - Update Resend (Svix) & ClickSend delivery webhooks to point to the HafaGolf API.
3. **GIAA DNS (`giaa-tournament.com`):** Same sequence (MX/HSTS check → lower TTL → freeze old app → final snapshot/import/verify → Netlify alias → DNS switch → verify HTTPS + employee-number validation + test Stripe checkout).

### 5.3 Rollback & Retiring Old Deployments
- **Pre-registration rollback (< 10 minutes):** Before any new live registrations arrive on HafaGolf:
  1. Revert DNS to the old Netlify site.
  2. Take the old app out of read-only/maintenance mode so writes work again.
  3. Restore Resend/ClickSend delivery webhooks to the old app's active endpoints (only if the old deployment actually serves those webhook endpoints — e.g. if PR #28 was deployed to MAW).
  4. Verify a test write and a test delivery callback succeed on the restored app before declaring rollback complete.
- **Post-registration rule:** Once live registrations/payments exist on HafaGolf, **never split writes across two databases** — fix forward on HafaGolf.
- **Retirement checklist (only after 30–60 days post-event and Leon's explicit OK):**
  1. Confirm old Netlify auto-builds remain stopped (`make-a-wish-guam` and `giaa-tournament` were set to `stop_builds: true` on Nov 13).
  2. Export final encrypted archive `pg_dump` + S3 backup of the old stack to cold storage.
  3. Suspend old Render web service and old Render/Neon Postgres instance.
  4. Archive old GitHub repos (`make-a-wish-guam`, `giaa-tournament-api`, `giaa-tournament-frontend`, `pacific-golf`) as read-only and delete redundant Netlify sites after the 60-day hold.

---

## 6. Hosting, Staging Posture & Cost Analysis

Per Leon's Nov 22 direction: **build and test locally and on staging first; do NOT activate production services now.** Leon will turn production services on when HafaGolf passes acceptance.

### 6.1 Required Services (Staging Now → Production When Ready)

| Layer | Service | Staging Setup (Phase 2) | Production Setup (When Accepted) | Estimated Monthly Cost (Prod) |
|---|---|---|---|---|
| **Web Frontend** | Netlify (existing Pro team plan, $20/mo already paid) | Branch deploy on the HafaGolf Netlify site (free; **no separate staging site** per Nov 13 Netlify cleanup plan) | **One** Netlify site with free Domain Aliases (`golf.`, `fd-golf.`, `golfforwishes.com`, `giaa-tournament.com`). `netlify-ignore-build.sh` + `skip_prs` required. | **$0 incremental** (within 3,000 included credits) |
| **Rails API** | Render (`hafagolf-api`) | Local dev first; 1 Render Starter staging API only when staging QA begins ($7/mo, suspendable when idle) | **One** Render Starter web service (`512 MB`, single Puma process `WEB_CONCURRENCY=0`, boot-only `/up` health check, `async` ActionCable, `SOLID_QUEUE_IN_PUMA=false`, region matched to Neon DB) | **$7/mo** |
| **PostgreSQL** | Neon | Neon staging branch (pooled `-pooler` URL, scale-to-zero) | **One** Neon Postgres project, same region as Render API, pooled connection, non-owner app role for RLS, scale-to-zero preserved | **$0–$5/mo** off-season; **~$5–$19/mo** active event months [Estimate] |
| **Admin Auth** | Clerk | Clerk Dev instance (local/staging) | **One** Clerk Production instance on `golf.shimizu-technology.com` (free tier, up to 10K MAUs; zero paid satellite domains) | **$0/mo** |
| **Object Storage** | AWS S3 | Dedicated staging bucket/prefix | Shared Shimizu S3 bucket, direct browser presigned uploads, standard Active Storage keys | **~$0–$1/mo** |
| **Email & SMS** | Resend + ClickSend | Resend test/sandbox + ClickSend test sends to Leon's Guam number | Shimizu Resend account + ClickSend usage-based SMS (Guam carrier rate verified before MAW launch) | Usage-based (~$5–$20 per raffle event) [Estimate] |
| **Total Platform** | | | **One deployment serving all clients** | **~$7–$15/mo** steady-state (~$12–$26/mo peak event months) [Estimate] |

### 6.2 Existing Footprint to Eventually Replace (Subject to Live Invoice Verification)

Savings remain **estimates** until verified against actual Render/Neon invoices:
- **Current MAW stack:** Render Starter API (`make-a-wish-api`, `$7/mo` when active) + Render Postgres (`$0–$7/mo`) + Netlify `make-a-wish-guam` (auto-builds stopped Nov 13) + separate Clerk instance.
- **Current GIAA stack:** Separate Render API (`$7/mo` when active) + separate Postgres (`$0–$7/mo`) + Netlify `giaa-tournament` (auto-builds stopped Nov 13) + separate Clerk instance.
- **Current Pacific Golf demo stack:** `pacific-golf-web` (stopped Nov 13) + `pacific-golf-api` (if active, `$7/mo`).
- **Consolidation effect:** Consolidating 3 separate API/DB stacks into 1 HafaGolf stack retires 2 redundant Render APIs + 2 redundant DBs once GIAA and MAW move off their legacy apps. Confirm actual monthly savings against Render/Neon invoices after retirement.

---

## 7. Raffle Reliability Plan (Make-A-Wish Mar 1 Gate & Platform Feature)

**Root causes from MAW's May 2, 2026 event + newly discovered 2027 bug (verified in code):**
1. **2027 Ticket-Number Collision Bug (P1 — breaks BOTH fallback and platform!):** `raffle_tickets.ticket_number` has a **global** unique index (`index_raffle_tickets_on_ticket_number`) and `uniqueness: true` validation, generated from org prefix (`"MAWG"`) + per-tournament sequence (`0001`). The first ticket of MAW's 2027 event (`MAWG-0001`) will fail on save while 2026 tickets remain in the DB, and two orgs with matching prefixes would collide.
2. **Texts not arriving silently:** ClickSend failures/carrier blocks were invisible to volunteers. *(Backend tracking + webhooks merged into HafaGolf in PR-0a; still needs `organization_id`, Resend Svix signature verification, admin UI, and Guam carrier testing.)*
3. **Buyers saved as `"Walk-up buyer"`:** *(Fixed on MAW `main` in `raffle_controller.rb:540-548` and `RaffleManagementPage.tsx:794` — buyer name is now required.)*
4. **Mistyped phone numbers:** Single-entry phone field (`+1671` prefilled) still has no confirmation input or server-side bare-prefix rejection.
5. **Winner names at the draw:** `RaffleBoardPage.tsx` (`origin/main:371`) renders `liveDraw.winnerName`, but auto-dismisses the reveal modal after 9 seconds and has no MC hold mode.

**Sequencing fix:** Land **all** raffle reliability fixes **early (Lane 5, Dec 2026 – early Jan 2027 — BEFORE PR-3b's `registrations` + `team_members` refactor!)** so the exact same patch set can also be applied cleanly to `make-a-wish-guam` (with Leon's deploy gate) if MAW triggers its fallback!

**Required fixes before MAW Mar 1, 2027 acceptance:**
1. **Fix `raffle_tickets` uniqueness collision:** Replace global unique index on `ticket_number` with a composite unique index on `(tournament_id, ticket_number)` AND include tournament year in the display prefix (e.g. `MAWG27-0001`) so tickets are both human-distinct across years and DB-safe across orgs.
2. **Harden delivery tracking & webhook security:** Add `organization_id` to `message_deliveries`, upgrade Resend webhook verification to Svix HMAC signatures, and parameterize `ClicksendClient` `from` (`org.sms_sender_id`) and `source` (`"hafagolf"`).
3. **Double-entry phone confirmation on `SellTicketsTab`:**
   - Volunteer enters phone (`671-XXX-XXXX`) + **Confirm phone number** input (blocks submit on mismatch) + large high-contrast read-back confirmation before saving.
   - Reject bare prefix `+1671` / `+1670` server-side as well as client-side.
   - Encourage email alongside phone for dual-channel fallback.
4. **Per-buyer delivery status UI & one-tap recovery:**
   - Expose latest `MessageDelivery` status per channel (SMS + Email: `Delivered`, `Sent/Pending`, `Failed`, `Bounced`, `No contact`) on the Raffle Tickets / Batches table.
   - Add a **"Needs Attention (Failed / Unconfirmed)"** filter tab and one-tap **Edit Contact & Resend** (updating buyer phone/email across the batch).
5. **Pre-draw "Everyone Got Their Numbers" readiness check:**
   - Modal/panel before `Draw` or `Draw All` showing: eligible paid ticket count, missing/placeholder buyer names, sale batches where **neither** SMS nor email has reached **`delivered`** (treating `accepted`-only batches as **unconfirmed / pending** rather than reached, since carrier delivery can still fail after acceptance; failed/bounced shown as Red, accepted-only/pending shown as Amber, both with one-click jump to fix & resend), and whether registration-included tickets are synced. Explicit admin acknowledgement logged in `ActivityLog` is required to override any remaining warnings.
6. **Banquet draw screen reliability:**
   - Guarantee `winner_name` (fallback `purchaser_display` + ticket #) is the largest focal element on both `RaffleBoardPage` and admin draw confirmation.
   - Add **"Hold Winner on Screen"** toggle (replacing the 9-second auto-dismiss during live MC announcing), powered by sub-second `async` ActionCable push + reconnect polling fallback.
7. **Guam carrier rehearsal (mid-Feb 2027):** Live ClickSend test texts to real IT&E, Docomo Pacific, and GTA phones (verifying delivery webhooks return `delivered` and checking alphanumeric vs numeric sender ID), followed by a rehearsed draw with Eric Tydingco's team.

---

## 8. Implementation Roadmap — Parallel PR-Sized Slices

Work is partitioned into non-overlapping vertical slices across parallel lanes, including **holiday slack (Dec 24 – Jan 3)** ahead of the **Feb 22 MAW Go/No-Go** and **Mar 8 FD Go/No-Go** gates. Every PR requires local affected checks + full CI suite + affected-flow QA per `shimizu-pr-workflow` and `application-qa`.

### Dependency Overview

```
Lane 0 (Seed, CI, Runtime Hygiene) ─┬─► Lane 5 (Raffle Fixes — EARLY, before teams refactor; portable to MAW fallback)
                                    ├─► Lane 1 (Domains, Isolation/Channels/RLS, Admin Split) ─┬─► Lane 4 (Payments, Payouts, Sponsor Checkout, Donations)
                                    ├─► Lane 2 (Brand Kit, CSS Vars, Theme Packs)              ├─► Lane 6 (Migrations, Rehearsals, Cutovers)
                                    └─► Lane 3 (Features Catalog, Real Teams, Clone, GIAA)     │
Lane F (GIAA & MAW Fallback Readiness — independent, Leon-gated before any prod deploy) ───────┘
```

### Detailed PR Plan

| Slice | Lane | Target Window | Scope | Depends On | Acceptance Gate |
|---|---|---|---|---|---|
| **PR-0a** | Lane 0: Seed & CI | Nov 22 – Nov 25 | Seed `Shimizu-Technology/HafaGolf` from MAW `main` (`ebf557c`) + merge PR #28; rewrite `api/render.yaml` (`autoDeploy: false`, `/up`), `netlify.toml`, `web/netlify.toml`, `scripts/check-prod-env.sh`, `scripts/smoke-prod.sh`, `package.json`, `web/index.html`, `database.yml`; add `docs/PLATFORM_ARCHITECTURE_AND_MIGRATION.md`, `.github/workflows/ci.yml` (Rails tests, Brakeman/bundler-audit, Vite typecheck/test/build, diff-only no-client-name check), and `scripts/netlify-ignore-build.sh`. | Approved (Nov 22) | CI green on PR; `netlify-ignore-build.sh` skip/build verified; zero references to `make-a-wish-api` or MAW Render/Netlify IDs in deploy configs. |
| **PR-0b** | Lane 0: Runtime Hygiene | Nov 25 – Dec 4 | Fix `SOLID_QUEUE_IN_PUMA` boolean parsing in `api/config/puma.rb`; switch `config/cable.yml` production adapter from `solid_cable` to `async` (with visibility-aware polling reconnect fallback); make Stripe/webhook code prefer ENV before `Setting.instance` (keep `settings` table until PR-4a so Stripe stays working). | PR-0a | `/up` succeeds with DB disconnected; zero `solid_cable` DB polling; ActionCable push works on single Puma process. |
| **PR-5a** | Lane 5: Raffle Foundation (Early) | Nov 26 – Dec 12 | Fix `raffle_tickets` global uniqueness bug (`(tournament_id, ticket_number)` + year prefix); add `organization_id` to `message_deliveries`; upgrade Resend webhook to Svix HMAC verification; parameterize ClickSend sender/source from org config. *(Built before PR-3b so cleanly backportable to MAW fallback!)* | PR-0a | 2027 tournament ticket creation succeeds alongside 2026 tickets; Svix webhook & ClickSend specs green. |
| **PR-5b** | Lane 5: Raffle POS & Delivery UI (Early) | Dec 12 – Dec 22 | Double-entry phone confirmation + server/client bare `+1671` rejection on `SellTicketsTab`; per-buyer delivery status badges (`Delivered`/`Pending`/`Failed`) + "Needs Attention" filter + one-tap edit contact & resend. | PR-5a | Volunteer cannot submit mismatched phone or bare `+1671`; failed SMS surfaces in filter and resends cleanly. |
| **PR-5c** | Lane 5: Pre-Draw Check & Draw Screen (Early) | Jan 4 – Jan 14 | Pre-draw readiness modal ("everyone got their numbers", missing-name & unconfirmed/failed-delivery warnings requiring `delivered`, audited override); prominent winner name + "Hold Winner on Screen" banquet mode (removing 9s auto-dismiss). | PR-0b, PR-5b | Pre-draw catches failed and accepted-only deliveries & missing names; projector draw holds winner cleanly over `async` ActionCable. |
| **PR-1a** | Lane 1: Tenant & Domains | Dec 4 – Dec 14 | `organization_domains` table + `TenantResolver` (`X-Tenant-Host`/`Origin` routing hint → `Current.organization`); replace `MAW_SLUG` and hardcoded `OffseasonPage.tsx` with configurable per-org off-season state; dynamic Rack::Cors; `OrgUrlBuilder`; port super-admin org CRUD (`SuperAdminDashboard`, `POST /admin/organizations`) from `pacific-golf` PR #18; add unique index on `LOWER(users.email)`. | PR-0b | Two orgs on distinct hosts resolve independently; outbound URLs use org primary host; CORS allows only registered hosts. |
| **PR-1b** | Lane 1: Isolation, Channels & RLS | Dec 14 – Dec 23 | Audit & org-scope every controller finder and token route (`/pay/:token`, sponsor/golfer magic links); remove `Tournament.current`; scope `GroupsChannel`, `GolfersChannel`, and `RaffleChannel` by tournament/org; configure `FORCE ROW LEVEL SECURITY` + non-owner app DB role + per-request transaction `SET LOCAL`; add cross-org REST + channel isolation suite in CI. | PR-1a | Cross-org suite proves Org A admin/volunteer/public/token/ActionCable cannot read or mutate Org B data. Cross-family security review. |
| **PR-1c** | Lane 1: Admin Split | Jan 4 – Jan 12 | Split public client domains (lazy-loaded Clerk never executed, `/admin*` redirects to `golf.shimizu-technology.com`) from admin host (`golf.shimizu-technology.com`, one Clerk app, org switcher, org-branded invite emails replacing hardcoded MAW invites); verify Clerk cookie isolation from HafaPass/Payroll. | PR-1a | Client domain bundle executes without Clerk keys; `/admin` redirects cleanly; invite emails use org brand. |
| **PR-2a** | Lane 2: Brand Kit & CSS Vars | Dec 8 – Dec 19 | Port `resolveTournamentBranding` from `pacific-golf` PR #18; convert Tailwind `brand`/`accent` to CSS variables with runtime palette generator; replace ~650 MAW `#0057B8`/`brand-*` hardcodes & ~9 API files' MAW strings; switch CI no-client-name check from diff-only to full-repo enforcement. | PR-0a | Switching org colors/logo updates full UI palette; full-repo CI no-client-name check passes 100%. |
| **PR-2b** | Lane 2: Theme Packs & Motion | Jan 4 – Jan 18 | Theme pack registry (`default-clean`, `charity-bright`, `memorial-formal`, `crest-classic`); lightweight motion primitives (`use-motion-ok`, `reveal-on-scroll`) with 1 signature moment per public landing page only, quiet operational screens. | PR-2a | Desktop + phone QA on all 4 packs; `prefers-reduced-motion` verified; zero animation library added. |
| **PR-3a** | Lane 3: Features Catalog | Dec 14 – Dec 23 | `GolfFeaturesCatalog` + `Features.for(org, tournament)` + API `require_feature!` enforcement (403 on disabled) + admin Features UI + catalog completeness spec. | PR-1a | Disabling `raffle`/`scoring`/`donations` blocks API with 403 and hides nav cleanly. |
| **PR-3b** | Lane 3: Real Teams (1/2/4) | Jan 5 – Jan 22 | `registrations` + `team_members` tables replacing `partner_*`; `capacity_unit` (`teams`/`players`); update `scores` (`registration_id`/`team_member_id`), `SponsorSlotSyncer`, registration form, check-in, groups, payment reports, and raffle ticket sync for sizes 1, 2, and 4 (plus partial teams). | PR-1b, PR-3a, PR-5a | E2E registration, capacity/waitlist, check-in, group assignment, sponsor slots, scores, and raffle sync pass for sizes 1, 2, and 4. |
| **PR-3c** | Lane 3: Tournament Clone | Jan 22 – Jan 28 | `Tournaments::CloneService` (same-org next-year clone + super-admin cross-org template clone) + admin Clone modal. | PR-3a, PR-3b | Cloned tournament starts in `draft`, clears past dates/deadlines, copies no registrations/tickets/scores, increments edition. |
| **PR-3d** | Lane 3: GIAA Feature Ports | Jan 25 – Feb 3 | Port `EmployeeNumber` (from GIAA / `pacific-golf` PR #18) behind `employee_pricing`; port A–J / K–Z check-in lanes behind `checkin_alpha_lanes`; port atomic "Promote + Pay + Check-In" flow. | PR-3b | Employee number race-lock test, bulk upload, A–J/K–Z filtering, and waitlist promote+pay+check-in pass QA. |
| **PR-4a** | Lane 4: Per-Org Payments & Drop `settings` | Jan 18 – Jan 30 | `organization_payment_configs` with Active Record encrypted keys; `external_link`, `platform_collect` (ENV), `client_processor` (opaque webhook token), `offline`; enforce Stripe webhook signatures on staging & prod; tag `stripe_account_origin`; **drop legacy `settings` table** & all 19 `Setting.instance` references. | PR-1b, PR-3b | Checkouts & signed webhooks pass for all 3 online modes with zero cross-org credential leakage; `settings` table removed. Cross-family review. |
| **PR-4b** | Lane 4: Payout Ledger | Jan 30 – Feb 7 | `tournament_settlements` + `tournament_payouts` (HafaPass-aligned columns); statement calculation (gross, refunds, Stripe fees, platform fee, net owed); record check payout + CSV export UI. | PR-4a | Statement reconciles to test charges + refunds to the cent; check payout records payee, check #, date, amount. Cross-family review. |
| **PR-4c** | Lane 4: Sponsor Checkout & Donations | Feb 5 – Feb 18 | Priced `sponsor_tiers` with online Stripe Checkout (auto-creates `Sponsor` + `SponsorSlot`s); standalone `donations` page (open amounts + optional IRS >$75 FMV quid-pro-quo receipt copy); FD `crest-classic` wiring. | PR-2b, PR-3a, PR-4a | Online sponsor purchase provisions portal slots; open-amount donation generates receipt and appears in settlement statement. |
| **PR-6a** | Lane 6: MAW Migration & Rehearsal | Feb 8 – Feb 22 | Idempotent MAW import rake task (composite `"<id>:<pos>"` keys for `team_members`) + S3 blob copy + verification counts/checksums; staging rehearsal on copy of MAW prod DB; live Guam SMS carrier test + rehearsed draw with Eric's team. | PR-1b, PR-1c, PR-2b, PR-3b, PR-4a, PR-5c | Verification script 100% match; **Feb 22 Go/No-Go** for MAW Mar 1 cutover (else trigger Lane F fallback). |
| **PR-6b** | Lane 6: FD Staging & Launch Prep | Feb 18 – Mar 8 | Seed FD Alumni Golf org (`fd-golf.shimizu-technology.com`), `crest-classic` maroon/gold brand kit, foursomes, sponsor tiers, donations, `platform_collect`; board staging walkthrough; $1 live Stripe checkout/refund/payout check once Leon turns on prod. | PR-1c, PR-2b, PR-4b, PR-4c | **Mar 8 Go/No-Go** for **Mar 15** registration & sponsorship open; totals reported to FD Alumni Hub 2027. |
| **PR-6c** | Lane 6: GIAA Migration & Rehearsal | Post-GIAA 2027 event (or when accepted) | Idempotent GIAA import rake task + asset upload + verification counts/checksums; staging rehearsal on copy of GIAA prod DB; `memorial-formal` QA against `AIRPORT_GIAA_BRANDING_SPEC.md`. | PR-1b, PR-1c, PR-2b, PR-3d, PR-4a | Verification script 100% match; zero regressions on employee pricing, A–J/K–Z check-in, and memorial branding. |
| **Lane F** | Fallback Readiness (Leon-gated) | GIAA: Dec 8 – Dec 18; MAW: Feb 1 – Feb 22 (if needed) | **GIAA fallback:** verify Render API/DB live, confirm Stripe/Clerk/Resend keys, temporarily re-enable Netlify builds if any fix is needed, create 2027 tournament + employee numbers, run smoke registration. **MAW fallback (if HafaGolf misses Feb 22 gate):** verify Render/DB/ClickSend/Resend/Clerk, apply PR #28 + Lane 5 raffle & ticket-number uniqueness fixes to `make-a-wish-guam` after staging DB test, re-enable Netlify build for release, test Guam SMS. | Leon's explicit gate per prod action | Both original apps verified operable with zero data loss if needed for 2027 events. |

*Holiday slack note:* Dec 24 – Jan 3 is intentionally unscheduled for new starts, leaving ~2 weeks of schedule buffer before the Feb 22 MAW gate and Mar 8 FD gate.

---

## 9. Risks & Open Questions

### Key Risks
| Risk | Impact | Mitigation |
|---|---|---|
| Guam carrier SMS filtering (IT&E, Docomo, GTA) blocks ClickSend alphanumeric sender IDs | Raffle ticket/winner texts fail silently on event day (repeat of May 2026) | Test live ClickSend delivery to all three Guam carriers in early Feb 2027; compare alphanumeric vs numeric sender ID; enforce email fallback + pre-draw delivery check. |
| `raffle_tickets.ticket_number` global uniqueness collision in 2027 | First 2027 MAW raffle ticket fails with duplicate key error | Fix early in PR-5a (scoped to `(tournament_id, ticket_number)` + year prefix) and include in Lane F MAW fallback. |
| Cross-tenant leak via unscoped IDs, token routes, or ActionCable | Client A sees Client B's golfers, revenue, or live group updates | Mandatory `Current.organization` scoping + token-org checks + scoped ActionCable streams + CI isolation suite + Postgres `FORCE ROW LEVEL SECURITY` + cross-family review on PR-1b and PR-4a. |
| `registrations` + `team_members` refactor breaks existing MAW flows | Delayed Mar 1 MAW readiness | Land raffle fixes (PR-5a–5c) *before* PR-3b so fallback gets them cleanly; keep `make-a-wish-guam` untouched until Feb 22 Go/No-Go. |
| Neon compute burned by polling or DB health checks | Unexpected Neon bill | Fix `/up` (PR-0a), switch cable to `async` & fix `SOLID_QUEUE_IN_PUMA` (PR-0b); verify Neon active/idle metrics over 48 hours on staging. |
| FD IRS quid-pro-quo receipt wording unapproved | Tax compliance issue for >$75 golf/sponsorship payments | Keep `tax_receipt_enabled: false` until FDAA's treasurer/CPA approves exact FMV and disclaimer text. |

### Open Questions
1. **For Leon (before Lane F GIAA check in mid-Dec):** Confirm whether GIAA's Render API/DB are currently active or suspended, and whether you want us to prep GIAA 2027 on its current app once GIAA sets its date.
2. **For Leon (before PR-5a/5c Guam SMS test):** Confirm ClickSend credentials/sender ID policy for Guam numbers (or whether Twilio is preferred alongside payroll's SMS evaluation).
3. **For Leon (later, after PR #18 pieces are ported):** OK to archive `pacific-golf` and close its remaining PRs #17–19, and close stale MAW PRs #3, #11, #12?
4. **For FD CO2017 Board (via hub/program lead, before PR-4c/6b):** Course, final May date (May 15 or 22), entry fee, foursome vs 2-person format, sponsor tier dollar amounts & benefits, and whether donations route through the class Bank of Guam account or FDAA 501(c)(3) for tax receipts.
5. **For Eric Tydingco / MAW (only when Leon authorizes outreach):** Confirm 2027 Golf for Wishes date (Thu Apr 29 vs Fri Apr 30), confirm 2027 SwipeSimple URLs (regular, walk-in, open-amount), and schedule Feb 2027 raffle rehearsal.
