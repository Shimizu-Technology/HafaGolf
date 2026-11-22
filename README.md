# HafaGolf

Multi-client golf tournament management platform by **Shimizu Technology** (companion to [HafaPass](https://github.com/Shimizu-Technology/HafaPass)).

One codebase and one deployment serving multiple tournament clients — each with its own domain, three-layer look and feel (Brand Kit, Theme Presets, Theme Packs), typed per-client feature toggles enforced in the API, and per-client payment modes.

[![Rails](https://img.shields.io/badge/Rails-8.1-red.svg)](https://rubyonrails.org/)
[![React](https://img.shields.io/badge/React-18-blue.svg)](https://reactjs.org/)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.x-blue.svg)](https://www.typescriptlang.org/)

## Architecture & Roadmap

Read **[docs/PLATFORM_ARCHITECTURE_AND_MIGRATION.md](docs/PLATFORM_ARCHITECTURE_AND_MIGRATION.md)** first for the full multi-client design, data model, tenant isolation rules, payment modes, data migration plan, and parallel PR roadmap.

## Key Principles

- **One codebase, one deployment:** Tenant resolved from request host via `organization_domains`; platform & org admin consolidated on `golf.shimizu-technology.com` with one Clerk application.
- **No client names in code logic:** Client differences are expressed through Brand Kit data, generic Theme Pack IDs (`default-clean`, `charity-bright`, `memorial-formal`, `crest-classic`), typed features (`Features.for(org, tournament)`), and per-org payment modes (`external_link`, `platform_collect`, `client_processor`, `offline`).
- **Real teams:** `registrations` + `team_members` supporting sizes 1, 2, or 4 (and partial teams).
- **Staging-first deployments:** `autoDeploy` is disabled in `api/render.yaml`, and `scripts/netlify-ignore-build.sh` skips frontend builds on docs/API-only commits.

## Monorepo Structure

```text
HafaGolf/
├── api/       # Rails 8.1 API + ActionCable + PostgreSQL
├── web/       # React 18 + TypeScript + Vite + Tailwind CSS
├── docs/      # Platform architecture, migration plan, and starter-app guides
└── scripts/   # CI checks, Netlify ignore rule, and operational helpers
```

## Quick Start

### Prerequisites

- Ruby `3.3.4`
- Node.js `22+`
- PostgreSQL `16+`
- `pnpm` (or `npm` in `web/`)

### Local Setup

```bash
git clone https://github.com/Shimizu-Technology/HafaGolf.git
cd HafaGolf

# Backend
cd api
bundle install
cp .env.example .env
# Confirm database identity (hafagolf_development / hafagolf_test) before running db commands
bundle exec rails db:prepare
bundle exec rails test

# Frontend
cd ../web
npm install
npm run typecheck
npm test
npm run build
```

Default local servers: API on `http://localhost:3000`, Web on `http://localhost:5173`.

## Repository Origin & History Note

`Shimizu-Technology/HafaGolf` was seeded on **2026-11-22** from `Shimizu-Technology/make-a-wish-guam` `main` (original commit range `b09599a..ebf557c`, 192 commits), with `make-a-wish-guam` PR #28 (`codex/delivery-reliability-raffle-audit`, original head `7563843`) merged in PR-0a.

**History rewrite note:** Before the initial push to `Shimizu-Technology/HafaGolf`, git history was rewritten solely to replace two literal Stripe key placeholder examples (`sk_test_...` / `sk_live_...` dummy `x` strings) in `docs/starter-app/STRIPE_SETUP_GUIDE.md` so GitHub Push Protection accepted the full 192-commit history cleanly. No application code or commit messages were altered during that scrub. `Shimizu-Technology/make-a-wish-guam` was not modified and remains Make-A-Wish Guam's live deployment and fallback until cutover.

## License

Proprietary — Shimizu Technology LLC
