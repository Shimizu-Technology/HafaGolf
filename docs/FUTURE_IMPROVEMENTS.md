# Future Improvements

**Project:** Pacific Golf  
**Purpose:** Track planned near-term and long-term improvements after current launch readiness work.

---

## Near-Term (Next 30-60 Days)

## 1) Subdomain support for organizations

- Goal: support URLs like `rotary.pacific-golf.com` and `make-a-wish.pacific-golf.com`.
- Notes:
  - Keep current path-based routing (`/:orgSlug`) as fallback.
  - Add subdomain -> organization resolution in API/web middleware/router.
  - Update CORS and ActionCable origin handling for wildcard subdomains.

## 2) Public root/home experience & tournament directory roadmap

### Shipped (v1)
- Public opt-in tournament directory on `golf.shimizu-technology.com` (`GET /api/v1/directory/tournaments`) backed by `tournaments.directory_listed` (default `false`) with Active & Upcoming / Past views, offseason fallback, 5-minute public cache headers, and silent degradation when the backend is paused.
- Dedicated SaaS legal & reach-out pages (`/privacy`, `/terms`, `/contact`) backed by rate-limited `POST /api/v1/platform/inquiries` + `PlatformInquiryMailer`.

### Planned Directory Enhancements (v2+)
- **Search & multi-facet filters:** Filter directory tournaments by date range / month, course/venue, team format (2-person, 4-person scramble, individual), entry fee range, availability (`open` / `waitlist`), and cause/category (charity, memorial, alumni, corporate).
- **Course map & island view:** Interactive Guam / CNMI course map showing tournament pins by course with tee-time/date quick cards (e.g., Mangilao, LeoPalace, CCP, Starts, Windward Hills).
- **Calendar feeds & reminders:** One-click `.ics` download and subscribable HafaGolf Guam Tournament Calendar feed (Google Calendar / Apple Calendar) for upcoming opted-in events.
- **Golfer alerts ("Notify me"):** Optional email/SMS subscription for golfers who want a monthly digest of upcoming Guam tournaments or alerts when registration opens for a specific recurring annual tournament.
- **Featured / spotlight placement & org directory pages:** Ability to pin an upcoming flagship tournament above the grid, plus optional organization profile cards showing a club's annual tournament history.
- **Pre-cutover external URL override:** Optional `directory_url_override` on a tournament so an organization onboarding to HafaGolf can be showcased with its current website link before DNS cutover.
- **Self-serve organizer onboarding:** Extend `/contact` with an interactive setup estimator / guided trial onboarding flow for new tournament committees.

## 3) Unified signed-in dashboard shortcut across public pages

- Reuse signed-in top bar pattern on relevant org public routes (not just landing).
- Ensure dashboard link resolves correctly for user role:
  - super admin -> `/super-admin`
  - org admin -> `/:orgSlug/admin`

## 4) Production observability baseline

- Add error monitoring integration (Sentry or equivalent).
- Add uptime checks and alert routing.
- Add structured logging and key dashboard metrics.

## 5) Operational hardening completion

- Validate production backup/restore drill.
- Expand health endpoint checks (dependencies).
- Finalize runbook ownership and response SLAs.

---

## Mid-Term (60-120 Days)

## 6) Tenant domain management UI

- Let org admins configure custom domains (CNAME setup).
- Include DNS verification and SSL status in admin settings.

## 7) Advanced onboarding flow for new organizations

- Guided setup:
  - create org
  - set branding
  - create first tournament
  - publish registration link

## 8) Expanded test automation

- Add browser E2E smoke tests for:
  - registration/payment
  - check-in
  - scoring + leaderboard
- Use these as release gates for staging/prod.

## 9) Performance and bundle optimization

- Break large frontend bundle via code-splitting.
- Add cache strategy tuning and performance budgets.

---

## Long-Term (120+ Days)

## 10) Full custom-domain support per organization

- Bring your own domain per org (e.g., `golf.rotaryguam.org`).
- Self-serve domain onboarding workflow with SSL automation.

## 11) White-label theming controls

- Extended org-level theming:
  - typography,
  - component style variants,
  - email template themes.

## 12) Multi-region and scale readiness

- Evaluate regional hosting/data strategy.
- Add load-testing and scaling playbooks for tournament-day spikes.

## 13) Product analytics and business reporting

- Add org-level usage and revenue dashboards.
- Add conversion funnel reporting for registration/payment flows.

---

## Backlog Candidates (Needs Product Decision)

- Employee discount / employee-number workflow reintroduction (if client demand requires it).
- SMS notifications for confirmations/reminders.
- Tournament templates for recurring annual events.
- Expanded sponsor media management (assets, placements, rotation).

---

## Change Management

- Revisit this document after each release milestone.
- Promote completed items into release notes/handoffs.
- Link actionable items to tickets before implementation.



----------


DONE - registration closed now properly blocks registrations; waitlist is configurable in event settings (enable/disable + max size); at capacity with waitlist enabled allows waitlist registrations

DONE - payment confirmation emails now sent after verify_payment and payment_details actions; modern template matching confirmation email style with dynamic event data

DONE - sponsor portal session now uses localStorage with 7-day expiry; fixed React StrictMode double-mount clearing session on refresh

amount reserved or available should take into account sponsor reserved slots so that those are guranteed and won't go over the set max amount
----------

allow for adding multiple sponsor emails

implement full clerk logins for sponsors so they properly login

what if someone on the day of or before the day of needs to change their group - we need to allow for that

maybe make it so. at a certain time, no more regular registration is available and the only option is walk in only where people can sign up / register at the walk in rate?

setup websockets

raffle winners are texted that they won
- implement clicksend

auto-draw raffle at scheduled time
- raffle_draw_time and raffle_auto_draw fields already exist on tournaments table
- need a background job scheduler (Sidekiq, GoodJob, or cron) to trigger draw_all at the configured time
- for now, admin manually clicks "Draw All Remaining" at the event

CardPointe payment integration
- replace SwipeSimple redirect with CardPointe API after BOG meeting
- in-app payment flow instead of external redirect

fix all places where numbers are input to allow for deleting that first 0 or whatever?

add ability to send payment links for people to purchase raffle tickets?