# HafaGolf Production & Staging Environment (Required Variables)

Nothing auto-deploys from this repository until Leon explicitly enables staging or production services. Always supply explicit service IDs and URLs via environment variables when running operational scripts — no client-specific service IDs are hardcoded in this repository.

## Prerequisites
- `python3`
- `netlify` CLI
- `curl`
- `RENDER_API_KEY`, `RENDER_SERVICE_ID`, `NETLIFY_AUTH_TOKEN`, `NETLIFY_SITE_ID` exported in your shell

## Render (API — `hafagolf-api`)
Required:
- `DATABASE_URL` (Neon pooled `-pooler` connection string)
- `RAILS_MASTER_KEY`
- `SECRET_KEY_BASE`
- `FRONTEND_URL` (required by mailer links, ActionCable allowed origins, and checkout fallback URLs until PR-1a/PR-1c fully replace all reads with `OrgUrlBuilder` + `ADMIN_ORIGIN`)
- `ADMIN_ORIGIN=https://golf.shimizu-technology.com`
- `CLERK_JWKS_URL` (single Clerk app on `golf.shimizu-technology.com`)
- `CLERK_SECRET_KEY`
- `RESEND_API_KEY`
- `RESEND_WEBHOOK_SECRET` (Svix verification, Lane 5)
- `MAILER_FROM_EMAIL`
- `CLICKSEND_USERNAME` / `CLICKSEND_API_KEY` (when SMS enabled)
- `DELIVERY_WEBHOOK_TOKEN` (ClickSend delivery webhook auth)
- `PLATFORM_STRIPE_SECRET_KEY` / `PLATFORM_STRIPE_WEBHOOK_SECRET` (for `platform_collect` orgs)
- `AWS_ACCESS_KEY_ID` / `AWS_SECRET_ACCESS_KEY` / `AWS_REGION` / `AWS_BUCKET` (Active Storage S3)
- `WEB_CONCURRENCY=0`
- `SOLID_QUEUE_IN_PUMA=false`

Active Storage uses S3 in production. Do not use local disk for production uploads on Render.

## Netlify (Web — one site with Domain Aliases)
Required:
- `VITE_API_URL` (HafaGolf API base URL)
- `VITE_WS_URL` (HafaGolf ActionCable WebSocket URL)
- `VITE_ADMIN_HOST=golf.shimizu-technology.com`
- `VITE_CLERK_PUBLISHABLE_KEY` (loaded only on `golf.shimizu-technology.com`)
- `VITE_CLERK_JWT_TEMPLATE`
- `VITE_STRIPE_PUBLISHABLE_KEY` (platform Stripe publishable key for `platform_collect` orgs)

## One-Command Checks
```bash
export RENDER_API_KEY=...
export RENDER_SERVICE_ID=...
export NETLIFY_AUTH_TOKEN=...
export NETLIFY_SITE_ID=...
./scripts/check-prod-env.sh

export API_URL=https://...
export WEB_URL=https://...
export ORG_SLUG=...
export TOURNAMENT_SLUG=...
./scripts/smoke-prod.sh
```
