# AGENTS.md — HafaGolf

## Project Context

**HafaGolf** (`Shimizu-Technology/HafaGolf`) is Shimizu Technology's multi-client golf tournament management platform (companion to `HafaPass`).

- **Architecture & Migration Plan:** Read **[docs/PLATFORM_ARCHITECTURE_AND_MIGRATION.md](docs/PLATFORM_ARCHITECTURE_AND_MIGRATION.md)** first.
- **Admin host:** `golf.shimizu-technology.com` (one Clerk production app; client public domains never load Clerk).
- **Public client hosts:** Mapped via `organization_domains` on one Netlify site using free Domain Aliases (e.g. `fd-golf.shimizu-technology.com`, `golfforwishes.com`, `giaa-tournament.com`, future `<client>.shimizu-technology.com`; optional `hafagolf.com` later).

## Non-Negotiable Architecture Rules

1. **Zero client names in code logic:** Never branch on a client name, org slug, or hardcoded client domain in `api/app/` or `web/src/`. Use Brand Kit data, generic Theme Pack IDs, `Features.for(org, tournament)` (enforced in the API with `403`), and `organization_payment_configs`. Enforced in CI by `scripts/check-no-client-names.sh`.
2. **Strict tenant isolation:** Treat `X-Tenant-Host`/`Origin` as a routing hint, never a security boundary. Scope every query, token endpoint, webhook, and ActionCable stream to the resolved/authorized organization. Add cross-org tests for every new endpoint or channel.
3. **Database safety:** Local databases are `hafagolf_development` and `hafagolf_test`. Always confirm the target database identity before any `db:` command; never touch shared local databases or production data.
4. **Neon & Netlify hygiene:**
   - Render health check uses boot-only `/up` (never DB-dependent `/health`).
   - Do not use `solid_cable` (0.1s DB polling breaks Neon scale-to-zero). Single-process Puma uses `async` cable with `SOLID_QUEUE_IN_PUMA=false` parsed explicitly as a boolean.
   - Keep `scripts/netlify-ignore-build.sh` intact and `autoDeploy: false` in `api/render.yaml` until Leon authorizes staging/production activation.
5. **No emojis in UI:** Use Lucide icons (SVGs).
6. **Restrained motion:** Public landing pages get at most one signature moment per theme pack (`prefers-reduced-motion` respected, no animation libraries, no marquees/count-ups). Registration, check-in, scoring, raffle POS, and admin stay quiet.

## Gates (Ask Leon First)

- Paid services or hosting plan changes
- DNS, Clerk, Render, Netlify, Neon, Stripe, or Square changes
- Production data access or changes to live `make-a-wish-guam` / `giaa-tournament-*` deployments
- Client outreach or archiving legacy repositories

## Development Commands

```bash
# API tests (confirm DB is hafagolf_test)
cd api && bundle exec rails test

# API security checks
cd api && bundle exec brakeman --no-pager && bundle exec bundler-audit check

# Web checks
cd web && npm run typecheck && npm test && npm run build
```
