import { ClipboardCheck, Handshake, LayoutTemplate, Ticket } from 'lucide-react';

const CAPABILITIES = [
  {
    icon: LayoutTemplate,
    title: 'Branded tournament pages and online registration',
    body: 'Each tournament gets its own page with your logo, colors, and style. Teams and individual golfers register and pay online, and the committee watches the field fill in.',
  },
  {
    icon: Handshake,
    title: 'A self-service sponsor portal',
    body: 'Sponsors get a private, shareable link to name their own foursomes and update their details, so nobody chases player names by email the week of the event.',
  },
  {
    icon: ClipboardCheck,
    title: 'Morning check-in and digital waivers',
    body: 'Volunteers split the line A–J and K–Z on their phones, check each golfer in, and confirm the signed waiver on the same screen.',
  },
  {
    icon: Ticket,
    title: 'Raffle sales, the draw board, and the payout',
    body: 'Sell tickets from a tablet, run the draw on the banquet projector or TV, and finish with a payout statement that reconciles registrations, sponsors, and raffle sales.',
  },
];

export function Capabilities() {
  return (
    <section aria-labelledby="ph-capabilities-heading" className="border-t border-[var(--ph-line)] bg-white py-20 sm:py-24">
      <div className="mx-auto max-w-6xl px-4 sm:px-6 lg:px-8">
        <div className="max-w-2xl">
          <p className="ph-ui text-xs font-semibold uppercase tracking-[0.18em] text-[var(--ph-brass-text)]">What HafaGolf handles</p>
          <h2 id="ph-capabilities-heading" className="ph-display mt-3 text-3xl font-semibold leading-tight sm:text-4xl">
            Everything the committee juggles, in one place.
          </h2>
          <p className="mt-4 text-lg leading-relaxed text-[var(--ph-ink-muted)]">
            Spreadsheets, sign-up forms, paper waivers, and a cash box all become one tournament record your volunteers
            can share.
          </p>
        </div>
        <ul className="mt-12 grid gap-px overflow-hidden rounded-2xl border border-[var(--ph-line)] bg-[var(--ph-line)] sm:grid-cols-2">
          {CAPABILITIES.map(({ icon: Icon, title, body }, index) => (
            <li key={title} className="bg-white p-6 sm:p-8">
              <div className="flex items-center gap-3">
                <span className="ph-ui text-sm font-semibold tabular-nums text-[var(--ph-brass-text)]">0{index + 1}</span>
                <Icon aria-hidden="true" className="h-5 w-5 text-[var(--ph-fairway)]" />
              </div>
              <h3 className="ph-display mt-4 text-xl font-semibold leading-snug">{title}</h3>
              <p className="mt-3 text-base leading-relaxed text-[var(--ph-ink-muted)]">{body}</p>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}
