# HafaGolf PostgreSQL Row Level Security (RLS) Operations Runbook

## Overview

HafaGolf enforces multi-tenant isolation at **two** layers:
1. **Application layer:** `Current.organization`, `current_user.accessible_tournaments`, signed/opaque tokens (`payment_token`, `magic_link_token`, `X-Sponsor-Session`), and tournament-scoped ActionCable streams.
2. **Database engine layer:** PostgreSQL `ENABLE ROW LEVEL SECURITY` + `FORCE ROW LEVEL SECURITY` on all 12 tenant-data tables (`tournaments`, `message_deliveries`, `golfers`, `groups`, `sponsors`, `sponsor_slots`, `raffle_prizes`, `raffle_tickets`, `raffle_sale_batches`, `scores`, `tournament_assignments`, `activity_logs`).

All RLS session variables are transaction-local (`set_config(..., is_local => true)`), making them safe under Neon / PgBouncer transaction pooling.

## Non-Owner Runtime Role Setup (Staging & Production)

PostgreSQL superusers and roles with `BYPASSRLS` bypass RLS policies. `FORCE ROW LEVEL SECURITY` applies to table owners *only* when the owner does not have `BYPASSRLS`, and best practice is to run the Rails runtime on a dedicated non-owner `hafagolf_app` role (`NOSUPERUSER NOBYPASSRLS`) while reserving the owner role (`DATABASE_URL`) for migrations.

### 1. Provision `hafagolf_app` (run as DB owner role)

```bash
DB_APP_ROLE=hafagolf_app \
DB_APP_ROLE_PASSWORD="<strong-random-password>" \
bundle exec rails db:rls:setup_app_role
```

### 2. Configure Runtime Connection (`DATABASE_APP_URL`)

`api/config/database.yml` connects `production` (and `cable`) to `ENV["DATABASE_APP_URL"]` when set, falling back to `ENV["DATABASE_URL"]`.
- Keep `DATABASE_URL` pointing to the migration/owner role.
- Set `DATABASE_APP_URL` on Render to the Neon pooled `-pooler` URL using the `hafagolf_app` credentials.
- **Migrations MUST clear `DATABASE_APP_URL`** so DDL runs as the owner role (`DATABASE_URL`), not `hafagolf_app`:
  ```bash
  DATABASE_APP_URL="" bundle exec rails db:migrate
  ```
  (`api/render.yaml` sets `buildCommand: bundle install && DATABASE_APP_URL="" bundle exec rails db:migrate` automatically.)

> **Authorization scope note:** Tournament-assigned admins receive an org-level UUID allowlist (`app.accessible_organization_ids`) at the database RLS layer, while controller-level `require_tournament_admin!` enforces per-tournament assignment boundaries.

### 3. Verify Enforcement

Run via `rails`:

```bash
bundle exec rails db:rls:status
```

Or directly in `psql` as the runtime role:

```sql
SELECT current_user, rolsuper, rolbypassrls
FROM pg_roles
WHERE rolname = current_user;
-- Expected: rolsuper = f, rolbypassrls = f

SELECT relname, relrowsecurity, relforcerowsecurity
FROM pg_class
WHERE relname IN (
  'tournaments', 'message_deliveries', 'golfers', 'groups',
  'sponsors', 'sponsor_slots', 'raffle_prizes', 'raffle_tickets',
  'raffle_sale_batches', 'scores', 'tournament_assignments', 'activity_logs'
)
ORDER BY relname;
-- Expected: relrowsecurity = t, relforcerowsecurity = t for all 12 tables
```

## Console, Runner & Maintenance Tasks

When running `rails console`, `rails runner`, or rake tasks on a non-owner role, queries against RLS tables fail closed (`0` rows) unless wrapped in an explicit `TenantContext`:

```ruby
# Scope to one organization (preferred)
TenantContext.with_organization(Organization.find_by!(slug: "example-org")) do
  Tournament.count
end

# Explicit platform-wide maintenance access (logged)
TenantContext.with_console_access(reason: "audit raffle count") do
  Tournament.count
end
```

Background jobs (`ApplicationJob`) and `deliver_later` mailers (`ApplicationMailDeliveryJob`) automatically establish `TenantContext.with_platform_access` during both GlobalID argument deserialization and job execution.
