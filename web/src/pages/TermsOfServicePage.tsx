import { useEffect } from 'react';
import { PLATFORM_CONTACT_EMAIL, PlatformSubpageLayout } from '../components/platform/PlatformSubpageLayout';

const EFFECTIVE_DATE = 'November 24, 2026';

export function TermsOfServicePage() {
  useEffect(() => {
    document.title = 'Terms of Service | HafaGolf';
  }, []);

  return (
    <PlatformSubpageLayout
      eyebrow="Legal"
      title="Terms of Service"
      subtitle={`Effective ${EFFECTIVE_DATE}. Clear ground rules for tournament organizers, sponsors, and golfers using HafaGolf.`}
    >
      <article className="space-y-8 rounded-2xl border border-[var(--ph-line)] bg-white p-6 text-[15px] leading-relaxed text-[var(--ph-ink)] shadow-sm sm:p-10">
        <section className="space-y-3">
          <h2 className="ph-display text-2xl font-semibold">1. Platform role</h2>
          <p className="text-[var(--ph-ink-muted)]">
            HafaGolf is a software platform operated by <strong>Shimizu Technology</strong> that helps charitable,
            memorial, civic, and alumni committees manage golf tournaments. Shimizu Technology is not the host,
            promoter, or operator of any individual tournament listed or hosted on HafaGolf. Each host organization is
            solely responsible for its event schedule, course rules, waivers, pricing, sponsorships, refunds, tax
            receipts, and local regulatory compliance (including any raffle or fundraising permits).
          </p>
        </section>

        <section className="space-y-3">
          <h2 className="ph-display text-2xl font-semibold">2. Organizer accounts and responsibilities</h2>
          <ul className="list-disc space-y-2 pl-5 text-[var(--ph-ink-muted)]">
            <li>Organizers must keep their login credentials secure and only grant volunteer or admin access to authorized committee members.</li>
            <li>Organizers are responsible for the accuracy of event details, entry fees, sponsorship deliverables, waiver language, and communications sent to participants.</li>
            <li>Listing a tournament on the HafaGolf public directory is optional; organizers may enable or disable directory visibility in event settings at any time.</li>
          </ul>
        </section>

        <section className="space-y-3">
          <h2 className="ph-display text-2xl font-semibold">3. Registrations, sponsorships, and payments</h2>
          <p className="text-[var(--ph-ink-muted)]">
            When you register for a tournament, purchase a sponsorship, or make a donation through a host organization’s
            site, your transaction is with that host organization. Refund, transfer, rain-check, and cancellation
            policies are set by the host organization. Online payments are processed by Stripe or the payment processor
            designated by the host organization, subject to that processor’s terms.
          </p>
        </section>

        <section className="space-y-3">
          <h2 className="ph-display text-2xl font-semibold">4. Acceptable use</h2>
          <p className="text-[var(--ph-ink-muted)]">
            You agree not to misuse the platform, attempt to access another organization’s data, bypass rate limits or
            authentication controls, submit fraudulent registrations, or send unsolicited spam through event messaging
            tools. We may suspend access that threatens platform security or violates applicable law.
          </p>
        </section>

        <section className="space-y-3">
          <h2 className="ph-display text-2xl font-semibold">5. Content and intellectual property</h2>
          <p className="text-[var(--ph-ink-muted)]">
            Each organization retains ownership of its logos, photos, sponsor assets, and participant data. By uploading
            content to HafaGolf, the organization grants Shimizu Technology permission to host and display that content
            as needed to operate the tournament site (and, if opted in, the HafaGolf public directory). The HafaGolf
            software, branding, and design remain the property of Shimizu Technology.
          </p>
        </section>

        <section className="space-y-3">
          <h2 className="ph-display text-2xl font-semibold">6. Availability and limitation of liability</h2>
          <p className="text-[var(--ph-ink-muted)]">
            We work hard to keep HafaGolf reliable, especially on tournament day, but the service is provided “as is”
            without warranties of uninterrupted availability. To the fullest extent permitted by law, Shimizu Technology
            is not liable for indirect, incidental, or consequential damages arising from event cancellations,
            third-party payment or messaging outages, or disputes between participants and tournament hosts.
          </p>
        </section>

        <section className="space-y-3 border-t border-[var(--ph-line)] pt-6">
          <h2 className="ph-display text-2xl font-semibold">7. Governing law and contact</h2>
          <p className="text-[var(--ph-ink-muted)]">
            These terms are governed by the laws of Guam. Questions? Email{' '}
            <a href={`mailto:${PLATFORM_CONTACT_EMAIL}`} className="font-medium text-[var(--ph-evergreen)] underline">
              {PLATFORM_CONTACT_EMAIL}
            </a>{' '}
            or visit our{' '}
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

export default TermsOfServicePage;
