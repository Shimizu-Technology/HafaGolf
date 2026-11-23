import { useEffect } from 'react';
import { PLATFORM_CONTACT_EMAIL, PlatformSubpageLayout } from '../components/platform/PlatformSubpageLayout';

const EFFECTIVE_DATE = 'November 24, 2026';

export function PrivacyPolicyPage() {
  useEffect(() => {
    document.title = 'Privacy Policy | HafaGolf';
  }, []);

  return (
    <PlatformSubpageLayout
      eyebrow="Legal"
      title="Privacy Policy"
      subtitle={`Effective ${EFFECTIVE_DATE}. How HafaGolf and Shimizu Technology collect, use, and protect information for golfers, sponsors, and tournament organizers.`}
    >
      <article className="space-y-8 rounded-2xl border border-[var(--ph-line)] bg-white p-6 text-[15px] leading-relaxed text-[var(--ph-ink)] shadow-sm sm:p-10">
        <section className="space-y-3">
          <h2 className="ph-display text-2xl font-semibold">1. Who operates HafaGolf</h2>
          <p className="text-[var(--ph-ink-muted)]">
            HafaGolf is tournament management software built and operated by <strong>Shimizu Technology</strong> in Guam.
            When you register for a golf tournament, sponsor a team, or purchase raffle tickets through a host
            organization’s website powered by HafaGolf, that tournament organization is the event host and data controller
            for its event records, and Shimizu Technology processes that information on the host’s behalf.
          </p>
        </section>

        <section className="space-y-3">
          <h2 className="ph-display text-2xl font-semibold">2. Information we collect</h2>
          <ul className="list-disc space-y-2 pl-5 text-[var(--ph-ink-muted)]">
            <li>
              <strong>Golfers and participants:</strong> Name, email address, phone number, company or affiliation,
              teammate names, division or handicap details (when requested by the event), waiver acceptance timestamps,
              check-in status, and tournament scores.
            </li>
            <li>
              <strong>Sponsors and donors:</strong> Contact name, business name, email, phone number, sponsorship tier,
              logo uploads, and designated player names submitted through the sponsor portal.
            </li>
            <li>
              <strong>Tournament organizers and volunteers:</strong> Name, email address, role assignments, and
              authentication identifiers when signing in with email or Google OAuth through Clerk.
            </li>
            <li>
              <strong>Contact inquiries:</strong> Information you submit through our{' '}
              <a href="/contact" className="font-medium text-[var(--ph-evergreen)] underline">
                contact form
              </a>{' '}
              (name, email, organization, target date, and message).
            </li>
            <li>
              <strong>Technical logs:</strong> Standard request logs (IP address, browser type, timestamps) used to
              prevent abuse, enforce rate limits, and troubleshoot errors.
            </li>
          </ul>
        </section>

        <section className="space-y-3">
          <h2 className="ph-display text-2xl font-semibold">3. How we use information</h2>
          <ul className="list-disc space-y-2 pl-5 text-[var(--ph-ink-muted)]">
            <li>Process tournament registrations, sponsor sign-ups, check-ins, pairings, scoring, and raffle draws.</li>
            <li>Send transactional receipts, payment links, sponsor portal links, scoring links, and event updates via email or SMS.</li>
            <li>Provide organizers with rosters, check-in sheets, sponsor slot tracking, and financial reconciliation reports.</li>
            <li>Protect accounts, isolate each organization’s data, and maintain platform reliability.</li>
          </ul>
          <p className="text-[var(--ph-ink-muted)]">
            We do <strong>not</strong> sell personal information to third parties or share one tournament organization’s
            golfer or sponsor list with another organization.
          </p>
        </section>

        <section className="space-y-3">
          <h2 className="ph-display text-2xl font-semibold">4. Payments and service providers</h2>
          <p className="text-[var(--ph-ink-muted)]">
            Online card payments are processed directly by <strong>Stripe</strong> or the host organization’s designated
            payment processor. HafaGolf never receives or stores full credit card numbers or CVV codes. We rely on a
            focused set of infrastructure providers to run the service:
          </p>
          <ul className="list-disc space-y-2 pl-5 text-[var(--ph-ink-muted)]">
            <li><strong>Clerk & Google OAuth:</strong> Organizer authentication and account security.</li>
            <li><strong>Stripe:</strong> Payment processing and refund handling.</li>
            <li><strong>Resend & ClickSend:</strong> Transactional email and SMS notifications.</li>
            <li><strong>Amazon S3, Neon, Render, Netlify, and Cloudflare:</strong> Encrypted media storage, database hosting, application hosting, and DNS/TLS security.</li>
          </ul>
        </section>

        <section className="space-y-3">
          <h2 className="ph-display text-2xl font-semibold">5. Data isolation and security</h2>
          <p className="text-[var(--ph-ink-muted)]">
            HafaGolf enforces database-level multi-tenant Row Level Security (RLS), HTTPS encryption in transit,
            encrypted storage for sensitive integration credentials, and role-based access controls so volunteers and
            committee members only see the organizations and tools assigned to them.
          </p>
        </section>

        <section className="space-y-3">
          <h2 className="ph-display text-2xl font-semibold">6. Cookies and analytics</h2>
          <p className="text-[var(--ph-ink-muted)]">
            We use strictly necessary browser storage and cookies for organizer sign-in sessions, sponsor portal access,
            and golfer scoring sessions. Public tournament pages do not load third-party advertising trackers. If basic
            product analytics are enabled for the platform, they are used solely to improve reliability and usability.
          </p>
        </section>

        <section className="space-y-3">
          <h2 className="ph-display text-2xl font-semibold">7. Retention and your choices</h2>
          <p className="text-[var(--ph-ink-muted)]">
            Tournament records are retained for the host organization’s historical reporting, tax receipts, and year-over-year
            event operations unless deletion is requested. To update or delete registration information for a specific
            event, please contact that tournament’s organizer directly or reach out to us at{' '}
            <a href={`mailto:${PLATFORM_CONTACT_EMAIL}`} className="font-medium text-[var(--ph-evergreen)] underline">
              {PLATFORM_CONTACT_EMAIL}
            </a>
            . You may opt out of SMS updates at any time by replying STOP.
          </p>
        </section>

        <section className="space-y-3 border-t border-[var(--ph-line)] pt-6">
          <h2 className="ph-display text-2xl font-semibold">8. Contact us</h2>
          <p className="text-[var(--ph-ink-muted)]">
            Questions about this policy or how your data is handled? Email{' '}
            <a href={`mailto:${PLATFORM_CONTACT_EMAIL}`} className="font-medium text-[var(--ph-evergreen)] underline">
              {PLATFORM_CONTACT_EMAIL}
            </a>{' '}
            or use our{' '}
            <a href="/contact" className="font-medium text-[var(--ph-evergreen)] underline">
              contact page
            </a>
            .
          </p>
        </section>
      </article>
    </PlatformSubpageLayout>
  );
}

export default PrivacyPolicyPage;
