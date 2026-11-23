import { useEffect, useState } from 'react';
import type { FormEvent } from 'react';
import { CheckCircle2, Clock, Mail, MapPin, Send } from 'lucide-react';
import { PLATFORM_CONTACT_EMAIL, PlatformSubpageLayout } from '../components/platform/PlatformSubpageLayout';

type InquiryType = 'host_tournament' | 'join_tournament' | 'sponsorship' | 'general';

const INQUIRY_OPTIONS: Array<{ value: InquiryType; label: string }> = [
  { value: 'host_tournament', label: 'Run a tournament' },
  { value: 'join_tournament', label: 'Join an event' },
  { value: 'sponsorship', label: 'Sponsorship / demo' },
  { value: 'general', label: 'General question' },
];

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function ContactPage() {
  const [inquiryType, setInquiryType] = useState<InquiryType>('host_tournament');
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [organizationName, setOrganizationName] = useState('');
  const [estimatedDate, setEstimatedDate] = useState('');
  const [message, setMessage] = useState('');
  const [website, setWebsite] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [submitted, setSubmitted] = useState<{ name: string; email: string } | null>(null);
  const [showEmailFallback, setShowEmailFallback] = useState(false);

  useEffect(() => {
    document.title = 'Contact | HafaGolf';
  }, []);

  const mailtoHref = `mailto:${PLATFORM_CONTACT_EMAIL}?subject=${encodeURIComponent(
    `HafaGolf inquiry${organizationName.trim() ? ` — ${organizationName.trim()}` : ''}`
  )}&body=${encodeURIComponent(
    [
      name.trim() ? `Name: ${name.trim()}` : null,
      organizationName.trim() ? `Organization: ${organizationName.trim()}` : null,
      estimatedDate.trim() ? `Target date: ${estimatedDate.trim()}` : null,
      message.trim() ? `\n${message.trim()}` : null,
    ]
      .filter(Boolean)
      .join('\n')
  )}`;

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setShowEmailFallback(false);

    if (!name.trim()) {
      setError('Please enter your name.');
      return;
    }
    if (!email.trim() || !EMAIL_PATTERN.test(email.trim())) {
      setError('Please enter a valid email address.');
      return;
    }
    if (message.trim().length < 10) {
      setError('Please share a few details about your tournament or question (at least 10 characters).');
      return;
    }

    const apiUrl = import.meta.env.VITE_API_URL;
    if (!apiUrl) {
      setShowEmailFallback(true);
      setError('Direct form submission is currently offline. Use the email button below to send your note directly.');
      return;
    }

    const submittedName = name.trim();
    const submittedEmail = email.trim();

    setSubmitting(true);
    try {
      const res = await fetch(`${apiUrl}/api/v1/platform/inquiries`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({
          inquiry: {
            inquiry_type: inquiryType,
            name: submittedName,
            email: submittedEmail,
            organization_name: organizationName.trim(),
            estimated_date: estimatedDate.trim(),
            message: message.trim(),
            website,
          },
        }),
      });

      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        if (res.status >= 500) setShowEmailFallback(true);
        setError(body.error || 'Could not send your message right now. Please try emailing us directly.');
        return;
      }

      setSubmitted({ name: submittedName, email: submittedEmail });
    } catch {
      setShowEmailFallback(true);
      setError('Could not reach the server right now. You can send your note directly by email below.');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <PlatformSubpageLayout
      eyebrow="Reach out"
      title="Talk with the HafaGolf team."
      subtitle="Planning a charity, memorial, or alumni tournament—or have a question about an upcoming event? Send a note and we’ll reply directly."
    >
      <div className="grid gap-8 lg:grid-cols-[minmax(0,1.35fr)_minmax(0,0.85fr)] lg:items-start">
        <div className="rounded-2xl border border-[var(--ph-line)] bg-white p-6 shadow-sm sm:p-8">
          {submitted ? (
            <div className="py-6 text-center" role="status">
              <span className="mx-auto inline-flex h-12 w-12 items-center justify-center rounded-full bg-[#e6f4ee] text-[var(--ph-evergreen)]">
                <CheckCircle2 aria-hidden="true" className="h-6 w-6" />
              </span>
              <h2 className="ph-display mt-4 text-2xl font-semibold text-[var(--ph-ink)]">
                Message received
              </h2>
              <p className="mx-auto mt-2 max-w-md text-base text-[var(--ph-ink-muted)]">
                Thanks, {submitted.name}. We received your note and will get back to{' '}
                <strong className="font-medium text-[var(--ph-ink)]">{submitted.email}</strong> shortly.
              </p>
              <div className="mt-6 flex flex-wrap justify-center gap-3">
                <a
                  href="/"
                  className="ph-ui inline-flex min-h-[44px] items-center justify-center rounded-full bg-[var(--ph-evergreen)] px-6 text-sm font-semibold text-white hover:bg-[var(--ph-fairway)]"
                >
                  Back to HafaGolf
                </a>
                <button
                  type="button"
                  onClick={() => {
                    setSubmitted(null);
                    setMessage('');
                  }}
                  className="ph-ui inline-flex min-h-[44px] items-center justify-center rounded-full border border-[#d8cfbb] px-5 text-sm font-semibold text-[var(--ph-ink)] hover:border-[var(--ph-brass)]"
                >
                  Send another message
                </button>
              </div>
            </div>
          ) : (
            <form onSubmit={handleSubmit} noValidate>
              <fieldset disabled={submitting} className="space-y-5">
              <fieldset>
                <legend className="ph-ui text-sm font-semibold text-[var(--ph-ink)]">How can we help?</legend>
                <div className="mt-2.5 grid grid-cols-2 gap-2">
                  {INQUIRY_OPTIONS.map((option) => {
                    const selected = inquiryType === option.value;
                    return (
                      <button
                        key={option.value}
                        type="button"
                        aria-pressed={selected}
                        onClick={() => setInquiryType(option.value)}
                        className={`ph-ui min-h-[44px] rounded-xl border px-3 py-2 text-left text-sm font-semibold transition-colors duration-150 ${
                          selected
                            ? 'border-[var(--ph-evergreen)] bg-[var(--ph-evergreen)] text-white'
                            : 'border-[var(--ph-line)] bg-[var(--ph-paper)] text-[var(--ph-ink)] hover:border-[var(--ph-brass)]'
                        }`}
                      >
                        {option.label}
                      </button>
                    );
                  })}
                </div>
              </fieldset>

              <div className="grid gap-4 sm:grid-cols-2">
                <label className="block space-y-1.5">
                  <span className="ph-ui block text-sm font-semibold text-[var(--ph-ink)]">
                    Your name <span className="text-red-700">*</span>
                  </span>
                  <input
                    type="text"
                    required
                    maxLength={120}
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    placeholder="Alex Cruz"
                    className="block min-h-[46px] w-full rounded-xl border border-[#d8cfbb] bg-white px-3.5 py-2.5 text-base text-[var(--ph-ink)]"
                  />
                </label>

                <label className="block space-y-1.5">
                  <span className="ph-ui block text-sm font-semibold text-[var(--ph-ink)]">
                    Email address <span className="text-red-700">*</span>
                  </span>
                  <input
                    type="email"
                    required
                    maxLength={180}
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="you@organization.org"
                    className="block min-h-[46px] w-full rounded-xl border border-[#d8cfbb] bg-white px-3.5 py-2.5 text-base text-[var(--ph-ink)]"
                  />
                </label>
              </div>

              <div className="grid gap-4 sm:grid-cols-2">
                <label className="block space-y-1.5">
                  <span className="ph-ui block text-sm font-semibold text-[var(--ph-ink)]">
                    Organization or tournament
                  </span>
                  <input
                    type="text"
                    maxLength={160}
                    value={organizationName}
                    onChange={(e) => setOrganizationName(e.target.value)}
                    placeholder="Optional"
                    className="block min-h-[46px] w-full rounded-xl border border-[#d8cfbb] bg-white px-3.5 py-2.5 text-base text-[var(--ph-ink)]"
                  />
                </label>

                <label className="block space-y-1.5">
                  <span className="ph-ui block text-sm font-semibold text-[var(--ph-ink)]">
                    Target event date
                  </span>
                  <input
                    type="text"
                    maxLength={80}
                    value={estimatedDate}
                    onChange={(e) => setEstimatedDate(e.target.value)}
                    placeholder="e.g. Fall 2027"
                    className="block min-h-[46px] w-full rounded-xl border border-[#d8cfbb] bg-white px-3.5 py-2.5 text-base text-[var(--ph-ink)]"
                  />
                </label>
              </div>

              {/* Hidden honeypot field */}
              <div className="hidden" aria-hidden="true">
                <label>
                  Website
                  <input
                    type="text"
                    name="website"
                    tabIndex={-1}
                    autoComplete="off"
                    value={website}
                    onChange={(e) => setWebsite(e.target.value)}
                  />
                </label>
              </div>

              <label className="block space-y-1.5">
                <span className="ph-ui block text-sm font-semibold text-[var(--ph-ink)]">
                  How can we help? <span className="text-red-700">*</span>
                </span>
                <textarea
                  required
                  rows={5}
                  maxLength={2000}
                  value={message}
                  onChange={(e) => setMessage(e.target.value)}
                  placeholder="Tell us about your event size, format, sponsorship tiers, or what you’d like to see in a walkthrough."
                  className="block w-full rounded-xl border border-[#d8cfbb] bg-white px-3.5 py-2.5 text-base text-[var(--ph-ink)]"
                />
              </label>

              {error && (
                <div role="alert" className="rounded-xl border border-red-200 bg-red-50 p-3.5 text-sm text-red-800">
                  <p>{error}</p>
                  {showEmailFallback && (
                    <a
                      href={mailtoHref}
                      className="ph-ui mt-2 inline-flex items-center gap-1.5 font-semibold text-[var(--ph-evergreen)] underline"
                    >
                      <Mail aria-hidden="true" className="h-4 w-4" />
                      Open in your email app instead
                    </a>
                  )}
                </div>
              )}

              <div className="flex flex-col gap-3 pt-1 sm:flex-row sm:items-center sm:justify-between">
                <p className="text-xs text-[var(--ph-ink-muted)]">
                  By sending this note you agree to our{' '}
                  <a href="/privacy" className="underline hover:text-[var(--ph-ink)]">
                    Privacy Policy
                  </a>
                  .
                </p>
                <button
                  type="submit"
                  disabled={submitting}
                  className="ph-ui inline-flex min-h-[48px] items-center justify-center gap-2 rounded-full bg-[var(--ph-evergreen)] px-7 text-[15px] font-semibold text-white transition-colors duration-150 hover:bg-[var(--ph-fairway)] disabled:opacity-60"
                >
                  <Send aria-hidden="true" className="h-4 w-4" />
                  {submitting ? 'Sending…' : 'Send message'}
                </button>
              </div>
              </fieldset>
            </form>
          )}
        </div>

        <aside className="space-y-4">
          <div className="rounded-2xl border border-[var(--ph-line)] bg-white p-6 shadow-sm">
            <p className="ph-ui text-xs font-semibold uppercase tracking-[0.16em] text-[var(--ph-brass-text)]">
              Direct contact
            </p>
            <h2 className="ph-display mt-2 text-2xl font-semibold text-[var(--ph-ink)]">Shimizu Technology</h2>
            <ul className="mt-4 space-y-3 text-sm text-[var(--ph-ink-muted)]">
              <li className="flex items-start gap-2.5">
                <Mail aria-hidden="true" className="mt-0.5 h-4 w-4 shrink-0 text-[var(--ph-fairway)]" />
                <a href={`mailto:${PLATFORM_CONTACT_EMAIL}`} className="font-medium text-[var(--ph-ink)] underline">
                  {PLATFORM_CONTACT_EMAIL}
                </a>
              </li>
              <li className="flex items-start gap-2.5">
                <MapPin aria-hidden="true" className="mt-0.5 h-4 w-4 shrink-0 text-[var(--ph-fairway)]" />
                <span>Guam · Serving Guam, CNMI, and the Pacific</span>
              </li>
              <li className="flex items-start gap-2.5">
                <Clock aria-hidden="true" className="mt-0.5 h-4 w-4 shrink-0 text-[var(--ph-fairway)]" />
                <span>Usually replies within one business day (ChST)</span>
              </li>
            </ul>
          </div>

          <div className="rounded-2xl border border-[var(--ph-line)] bg-[#f4efe3] p-6 text-sm leading-relaxed text-[var(--ph-ink-muted)]">
            <h3 className="ph-display text-lg font-semibold text-[var(--ph-ink)]">What a walkthrough covers</h3>
            <ul className="mt-3 list-disc space-y-1.5 pl-5">
              <li>Setting up your branded tournament page and custom domain</li>
              <li>Online registration, Stripe or offline check/cash reconciliation</li>
              <li>Sponsor self-service links, morning check-in, and the live raffle board</li>
            </ul>
          </div>
        </aside>
      </div>
    </PlatformSubpageLayout>
  );
}

export default ContactPage;
