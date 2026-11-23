import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useParams } from 'react-router-dom';
import {
  Award,
  Car,
  ClipboardCheck,
  Flag,
  Loader2,
  Printer,
  RefreshCw,
} from 'lucide-react';
import { useOrganization } from '../components/OrganizationProvider';
import { useAuthToken } from '../hooks/useAuthToken';
import {
  buildCartSigns,
  chunkCartSigns,
  getGroupHoleLabel,
  groupSponsorsForSignage,
  sortGolfersAlphabetically,
  sortGroupsForShotgun,
  type PrintableGolfer,
  type PrintableGroup,
  type PrintableSponsor,
} from '../utils/printables';
import { formatShortDate } from '../utils/dates';

type SheetId = 'cart_signs' | 'shotgun_sheet' | 'alpha_checkin' | 'sponsor_signage';

interface TournamentSummaryMeta {
  id: number;
  name: string;
  slug: string;
  event_date?: string | null;
  location_name?: string | null;
  shotgun_time?: string | null;
  logo_url?: string | null;
}

const SHEET_TABS: Array<{
  id: SheetId;
  label: string;
  subtitle: string;
  orientation: 'landscape' | 'portrait';
  icon: React.ComponentType<{ className?: string }>;
}> = [
  {
    id: 'cart_signs',
    label: 'Cart Signs',
    subtitle: '2 per landscape page with giant Hole #, players & sponsor',
    orientation: 'landscape',
    icon: Car,
  },
  {
    id: 'shotgun_sheet',
    label: 'Pro Shop Shotgun Sheet',
    subtitle: 'Sorted by Course & Hole 1A–18B with payment/waiver status',
    orientation: 'portrait',
    icon: Flag,
  },
  {
    id: 'alpha_checkin',
    label: 'Check-In Backup Sheet',
    subtitle: 'A–Z by last name with Hole #, Paid, Waiver, Add-Ons & sign box',
    orientation: 'portrait',
    icon: ClipboardCheck,
  },
  {
    id: 'sponsor_signage',
    label: 'Sponsor Signage Checklist',
    subtitle: 'Grouped by tier & hole with logo thumbnail and placement box',
    orientation: 'portrait',
    icon: Award,
  },
];

export const PrintablesPage: React.FC = () => {
  const { tournamentSlug } = useParams<{ tournamentSlug: string }>();
  const { organization } = useOrganization();
  const { getToken } = useAuthToken();

  const [activeSheet, setActiveSheet] = useState<SheetId>('cart_signs');
  const [includeUnassigned, setIncludeUnassigned] = useState(false);
  const [showPhones, setShowPhones] = useState(false);

  const [tournament, setTournament] = useState<TournamentSummaryMeta | null>(null);
  const [golfers, setGolfers] = useState<PrintableGolfer[]>([]);
  const [groups, setGroups] = useState<PrintableGroup[]>([]);
  const [sponsors, setSponsors] = useState<PrintableSponsor[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const getTokenRef = useRef(getToken);
  getTokenRef.current = getToken;

  const loadData = useCallback(async () => {
    if (!organization?.slug || !tournamentSlug) return;
    setLoading(true);
    setError(null);
    try {
      const token = await getTokenRef.current();
      const apiBase = import.meta.env.VITE_API_URL || '';
      const headers: HeadersInit = token ? { Authorization: `Bearer ${token}` } : {};

      const tourneyRes = await fetch(
        `${apiBase}/api/v1/admin/organizations/${organization.slug}/tournaments/${tournamentSlug}`,
        { headers }
      );
      if (!tourneyRes.ok) {
        const body = await tourneyRes.json().catch(() => ({}));
        throw new Error(body.error || 'Could not load tournament data for printables');
      }
      const tourneyPayload = await tourneyRes.json();
      const tMeta: TournamentSummaryMeta = tourneyPayload.tournament;
      setTournament(tMeta);
      setGolfers(Array.isArray(tourneyPayload.golfers) ? tourneyPayload.golfers : []);

      const [groupsRes, sponsorsRes] = await Promise.all([
        fetch(`${apiBase}/api/v1/groups?tournament_id=${tMeta.id}`, { headers }),
        fetch(`${apiBase}/api/v1/organizations/${organization.slug}/tournaments/${tournamentSlug}/sponsors`).catch(() => null),
      ]);

      if (groupsRes.ok) {
        const gData = await groupsRes.json();
        setGroups(Array.isArray(gData) ? gData : gData.groups || []);
      } else {
        setGroups([]);
      }

      if (sponsorsRes && sponsorsRes.ok) {
        const sData = await sponsorsRes.json();
        setSponsors(Array.isArray(sData) ? sData : sData.sponsors || []);
      } else {
        setSponsors([]);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load printables data');
    } finally {
      setLoading(false);
    }
  }, [organization?.slug, tournamentSlug]);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  const currentTabMeta = SHEET_TABS.find((t) => t.id === activeSheet) ?? SHEET_TABS[0];

  const cartSignCards = useMemo(
    () => buildCartSigns(groups, sponsors, includeUnassigned),
    [groups, includeUnassigned, sponsors]
  );
  const cartSignPages = useMemo(() => chunkCartSigns(cartSignCards, 2), [cartSignCards]);
  const shotgunGroups = useMemo(
    () => sortGroupsForShotgun(groups, includeUnassigned),
    [groups, includeUnassigned]
  );
  const alphaGolfers = useMemo(() => sortGolfersAlphabetically(golfers), [golfers]);
  const sponsorGroups = useMemo(() => groupSponsorsForSignage(sponsors), [sponsors]);

  const eventLogoUrl = tournament?.logo_url || organization?.logo_url || null;
  const formattedDate = tournament?.event_date ? formatShortDate(tournament.event_date) : '';

  return (
    <div className="space-y-6">
      {/* Dynamic @page orientation for Chrome/Safari printing */}
      <style>{`@media print { @page { size: ${currentTabMeta.orientation}; margin: 0.35in; } }`}</style>

      {/* Controls header — hidden when printing */}
      <div className="print:hidden space-y-4">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <div className="inline-flex items-center gap-1.5 rounded-full bg-brand-50 px-3 py-1 text-xs font-semibold text-brand-700">
              <Printer className="h-3.5 w-3.5" />
              Day-Of Printables Pack
            </div>
            <h1 className="mt-1.5 text-2xl font-bold text-slate-900">
              {tournament?.name || 'Tournament Printables'}
            </h1>
            <p className="mt-0.5 text-sm text-slate-600">
              Print-ready cart signs, pro shop tee sheets, offline check-in backup sheets, and sponsor signage checklists generated live.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => void loadData()}
              disabled={loading}
              className="inline-flex min-h-[44px] items-center gap-2 rounded-xl border border-slate-300 bg-white px-4 text-sm font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-50"
            >
              <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
              Refresh
            </button>
            <button
              type="button"
              onClick={() => window.print()}
              disabled={loading || Boolean(error)}
              className="inline-flex min-h-[44px] items-center gap-2 rounded-xl bg-brand-700 px-5 text-sm font-semibold text-white shadow-xs transition hover:bg-brand-800 disabled:opacity-50"
            >
              <Printer className="h-4 w-4" />
              Print / Save as PDF
            </button>
          </div>
        </div>

        {/* Sheet selector tabs */}
        <div className="grid gap-2.5 sm:grid-cols-2 lg:grid-cols-4" role="tablist" aria-label="Printable sheets">
          {SHEET_TABS.map((tab) => {
            const Icon = tab.icon;
            const active = activeSheet === tab.id;
            return (
              <button
                key={tab.id}
                type="button"
                role="tab"
                aria-selected={active}
                onClick={() => setActiveSheet(tab.id)}
                className={`flex flex-col items-start gap-1 rounded-2xl border p-3.5 text-left transition ${
                  active
                    ? 'border-brand-600 bg-brand-50/70 text-brand-950 shadow-xs'
                    : 'border-slate-200 bg-white text-slate-700 hover:border-slate-300 hover:bg-slate-50'
                }`}
              >
                <div className="flex w-full items-center justify-between gap-2">
                  <span className="flex items-center gap-2 text-sm font-semibold">
                    <Icon className={`h-4 w-4 ${active ? 'text-brand-700' : 'text-slate-400'}`} />
                    {tab.label}
                  </span>
                  <span className="rounded-full bg-white/80 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-slate-500 ring-1 ring-slate-200">
                    {tab.orientation}
                  </span>
                </div>
                <p className="text-xs text-slate-500">{tab.subtitle}</p>
              </button>
            );
          })}
        </div>

        {/* Options bar */}
        <div className="flex flex-wrap items-center gap-4 rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-xs text-slate-700">
          {(activeSheet === 'cart_signs' || activeSheet === 'shotgun_sheet') && (
            <label className="inline-flex cursor-pointer items-center gap-2 font-medium">
              <input
                type="checkbox"
                checked={includeUnassigned}
                onChange={(e) => setIncludeUnassigned(e.target.checked)}
                className="h-4 w-4 rounded border-slate-300 text-brand-700"
              />
              Include unassigned groups
            </label>
          )}
          {activeSheet === 'alpha_checkin' && (
            <label className="inline-flex cursor-pointer items-center gap-2 font-medium">
              <input
                type="checkbox"
                checked={showPhones}
                onChange={(e) => setShowPhones(e.target.checked)}
                className="h-4 w-4 rounded border-slate-300 text-brand-700"
              />
              Include phone numbers on backup sheet
            </label>
          )}
          <span className="ml-auto text-slate-500">
            {activeSheet === 'cart_signs' && `${cartSignCards.length} cart signs (${cartSignPages.length} landscape page${cartSignPages.length === 1 ? '' : 's'})`}
            {activeSheet === 'shotgun_sheet' && `${shotgunGroups.length} groups`}
            {activeSheet === 'alpha_checkin' && `${alphaGolfers.length} active players`}
            {activeSheet === 'sponsor_signage' && `${sponsors.filter((s) => s.active !== false).length} active sponsors`}
          </span>
        </div>
      </div>

      {/* Loading / Error */}
      {loading ? (
        <div className="flex min-h-[240px] items-center justify-center rounded-2xl border border-slate-200 bg-white print:hidden">
          <Loader2 className="h-7 w-7 animate-spin text-brand-600" />
        </div>
      ) : error ? (
        <div className="rounded-2xl border border-red-200 bg-red-50 p-6 text-sm text-red-800 print:hidden">
          {error}
        </div>
      ) : (
        <div data-testid="printable-preview-area" className="space-y-6">
          {/* 1. CART SIGNS (2 per landscape page) */}
          {activeSheet === 'cart_signs' && (
            <div data-testid="sheet-cart-signs" className="space-y-6 print:space-y-0">
              {cartSignPages.length === 0 ? (
                <EmptyPrintable message="No hole-assigned groups yet. Assign holes in Hole Assignment or toggle 'Include unassigned groups'." />
              ) : (
                cartSignPages.map((pair, pageIdx) => (
                  <div
                    key={pageIdx}
                    className={`grid gap-6 md:grid-cols-2 print:grid-cols-2 print:gap-4 ${
                      pageIdx < cartSignPages.length - 1 ? 'print-break-after' : ''
                    }`}
                  >
                    {pair.map((card) => (
                      <article
                        key={card.groupId}
                        className="print-avoid-break flex min-h-[420px] flex-col justify-between rounded-2xl border-2 border-slate-900 bg-white p-6 shadow-xs print:min-h-[6.8in] print:rounded-lg print:shadow-none"
                      >
                        {/* Header: Event & Org Logo */}
                        <div className="flex items-center justify-between gap-3 border-b border-slate-200 pb-4">
                          <div className="min-w-0">
                            <p className="text-[11px] font-bold uppercase tracking-[0.18em] text-slate-500">
                              {organization?.name || 'Tournament'}
                            </p>
                            <h2 className="truncate text-base font-bold text-slate-900">
                              {tournament?.name}
                            </h2>
                          </div>
                          {eventLogoUrl && (
                            <img
                              src={eventLogoUrl}
                              alt={tournament?.name || 'Event logo'}
                              className="h-12 max-w-[110px] shrink-0 object-contain"
                            />
                          )}
                        </div>

                        {/* Giant Hole Heading */}
                        <div className="my-5 text-center">
                          <p className="text-xs font-bold uppercase tracking-[0.25em] text-slate-500">
                            Starting Assignment
                          </p>
                          <p className="mt-1 text-5xl font-black tracking-tight text-slate-950 print:text-6xl">
                            {card.holeLabel === 'Unassigned' ? `GROUP ${card.groupNumber}` : `HOLE ${card.holeLabel}`}
                          </p>
                          {card.courseDescription && (
                            <p className="mt-1 text-sm font-medium text-slate-600">{card.courseDescription}</p>
                          )}
                        </div>

                        {/* Players & Team */}
                        <div className="flex-1 rounded-xl border border-slate-200 bg-slate-50/70 p-4 print:bg-slate-50">
                          {card.teamName && (
                            <p className="mb-2 text-center text-xs font-bold uppercase tracking-wider text-brand-700">
                              {card.teamName}
                            </p>
                          )}
                          {card.players.length > 0 ? (
                            <ul className="space-y-1.5 text-center">
                              {card.players.map((playerName, idx) => (
                                <li key={idx} className="text-xl font-bold text-slate-900">
                                  {playerName}
                                </li>
                              ))}
                            </ul>
                          ) : (
                            <p className="text-center text-sm italic text-slate-400">Open Cart / TBD</p>
                          )}
                        </div>

                        {/* Optional Sponsor + Clean Footer */}
                        <div className="mt-5 border-t border-slate-200 pt-3">
                          {card.sponsorName && (
                            <div className="mb-2 flex items-center justify-center gap-2.5">
                              {card.sponsorLogoUrl && (
                                <img
                                  src={card.sponsorLogoUrl}
                                  alt={card.sponsorName}
                                  className="h-8 max-w-[90px] object-contain"
                                />
                              )}
                              <p className="text-xs font-semibold text-slate-700">
                                Sponsored by <span className="font-bold text-slate-900">{card.sponsorName}</span>
                              </p>
                            </div>
                          )}
                          <div className="flex items-center justify-between text-[11px] font-medium text-slate-500">
                            <span>{formattedDate || 'Tournament Day'}</span>
                            <span>{tournament?.location_name || `Group #${card.groupNumber}`}</span>
                          </div>
                        </div>
                      </article>
                    ))}
                  </div>
                ))
              )}
            </div>
          )}

          {/* 2. PRO SHOP SHOTGUN / TEE SHEET */}
          {activeSheet === 'shotgun_sheet' && (
            <section
              data-testid="sheet-shotgun"
              className="rounded-2xl border border-slate-200 bg-white p-6 shadow-xs print:rounded-none print:border-0 print:p-0 print:shadow-none"
            >
              <PrintSheetHeader
                orgName={organization?.name}
                tournamentName={tournament?.name}
                sheetTitle="Pro Shop Shotgun / Tee Sheet"
                meta={[
                  formattedDate,
                  tournament?.location_name,
                  tournament?.shotgun_time ? `Shotgun: ${tournament.shotgun_time}` : null,
                  `${shotgunGroups.length} Groups`,
                ]}
                logoUrl={eventLogoUrl}
              />

              {shotgunGroups.length === 0 ? (
                <EmptyPrintable message="No groups available for the shotgun sheet." />
              ) : (
                <table className="mt-4 w-full border-collapse text-left text-xs">
                  <thead>
                    <tr className="border-b-2 border-slate-900 bg-slate-50 text-[11px] font-bold uppercase tracking-wider text-slate-700">
                      <th className="px-2.5 py-2">Hole</th>
                      <th className="px-2.5 py-2">Grp</th>
                      <th className="px-2.5 py-2">Players</th>
                      <th className="px-2.5 py-2">Team / Sponsor</th>
                      <th className="px-2.5 py-2 text-center">Paid</th>
                      <th className="px-2.5 py-2 text-center">Waiver</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-200">
                    {shotgunGroups.map((group) => {
                      const players = (group.golfers || []).filter((g) => g.registration_status !== 'cancelled');
                      const teamLabel =
                        players.find((g) => g.team_name)?.team_name ||
                        players.find((g) => g.sponsor_display_name)?.sponsor_display_name ||
                        '—';
                      const paidCount = players.filter(
                        (g) => g.payment_status === 'paid' || g.payment_type === 'sponsor'
                      ).length;
                      const waiverCount = players.filter((g) => g.waiver_signed || g.waiver_accepted_at).length;

                      return (
                        <tr key={group.id} className="print-avoid-break">
                          <td className="px-2.5 py-2 font-bold text-slate-900 whitespace-nowrap">
                            {getGroupHoleLabel(group)}
                          </td>
                          <td className="px-2.5 py-2 text-slate-600">#{group.group_number}</td>
                          <td className="px-2.5 py-2 font-medium text-slate-900">
                            {players.length > 0
                              ? players
                                  .map((g) => (g.partner_name ? `${g.name} / ${g.partner_name}` : g.name))
                                  .join(', ')
                              : 'Unassigned'}
                          </td>
                          <td className="px-2.5 py-2 text-slate-700">{teamLabel}</td>
                          <td className="px-2.5 py-2 text-center font-semibold">
                            {players.length > 0 ? `${paidCount}/${players.length}` : '—'}
                          </td>
                          <td className="px-2.5 py-2 text-center">
                            {players.length > 0 ? `${waiverCount}/${players.length}` : '—'}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              )}
            </section>
          )}

          {/* 3. ALPHABETICAL CHECK-IN BACKUP SHEET */}
          {activeSheet === 'alpha_checkin' && (
            <section
              data-testid="sheet-alpha-checkin"
              className="rounded-2xl border border-slate-200 bg-white p-6 shadow-xs print:rounded-none print:border-0 print:p-0 print:shadow-none"
            >
              <PrintSheetHeader
                orgName={organization?.name}
                tournamentName={tournament?.name}
                sheetTitle="Alphabetical Check-In Backup Sheet (A–Z)"
                meta={[
                  formattedDate,
                  tournament?.location_name,
                  `${alphaGolfers.length} Active Registrations`,
                ]}
                logoUrl={eventLogoUrl}
              />

              {alphaGolfers.length === 0 ? (
                <EmptyPrintable message="No active golfers registered yet." />
              ) : (
                <table className="mt-4 w-full border-collapse text-left text-xs">
                  <thead>
                    <tr className="border-b-2 border-slate-900 bg-slate-50 text-[11px] font-bold uppercase tracking-wider text-slate-700">
                      <th className="px-2 py-2">Player (A–Z)</th>
                      {showPhones && <th className="px-2 py-2">Phone</th>}
                      <th className="px-2 py-2">Hole</th>
                      <th className="px-2 py-2 text-center">Paid</th>
                      <th className="px-2 py-2 text-center">Waiver</th>
                      <th className="px-2 py-2">Add-Ons / Swag</th>
                      <th className="px-2 py-2 w-28 text-center">Check-In / Init.</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-200">
                    {alphaGolfers.map((g) => {
                      const isPaid = g.payment_status === 'paid' || g.payment_type === 'sponsor';
                      const waiverOk = Boolean(g.waiver_signed || g.waiver_accepted_at);
                      const addOns =
                        g.add_ons_summary ||
                        (g.raffle_tickets_requested && g.raffle_tickets_requested > 0
                          ? `${g.raffle_tickets_requested}× Raffle`
                          : '—');

                      return (
                        <tr key={g.id} className="print-avoid-break">
                          <td className="px-2 py-2">
                            <p className="font-semibold text-slate-900">{g.name}</p>
                            {(g.partner_name || g.team_name) && (
                              <p className="text-[11px] text-slate-500">
                                {[g.partner_name ? `Partner: ${g.partner_name}` : null, g.team_name].filter(Boolean).join(' · ')}
                              </p>
                            )}
                          </td>
                          {showPhones && <td className="px-2 py-2 text-slate-600">{g.phone || '—'}</td>}
                          <td className="px-2 py-2 font-bold text-slate-900 whitespace-nowrap">
                            {g.hole_position_label || 'TBD'}
                          </td>
                          <td className="px-2 py-2 text-center font-semibold">
                            {isPaid ? 'PAID' : 'DUE'}
                          </td>
                          <td className="px-2 py-2 text-center">
                            {waiverOk ? 'YES' : 'NEEDED'}
                          </td>
                          <td className="px-2 py-2 text-slate-700">{addOns}</td>
                          <td className="px-2 py-2 text-center">
                            <span className="inline-block h-5 w-20 rounded border border-slate-400" aria-label="Check-in box" />
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              )}
            </section>
          )}

          {/* 4. SPONSOR HOLE SIGNAGE CHECKLIST */}
          {activeSheet === 'sponsor_signage' && (
            <section
              data-testid="sheet-sponsor-signage"
              className="rounded-2xl border border-slate-200 bg-white p-6 shadow-xs print:rounded-none print:border-0 print:p-0 print:shadow-none"
            >
              <PrintSheetHeader
                orgName={organization?.name}
                tournamentName={tournament?.name}
                sheetTitle="Sponsor Hole Signage Placement Checklist"
                meta={[
                  formattedDate,
                  tournament?.location_name,
                  `${sponsors.filter((s) => s.active !== false).length} Active Sponsors`,
                ]}
                logoUrl={eventLogoUrl}
              />

              {sponsorGroups.length === 0 ? (
                <EmptyPrintable message="No active sponsors found for this tournament." />
              ) : (
                <div className="mt-5 space-y-5">
                  {sponsorGroups.map((bucket) => (
                    <div key={bucket.tierKey} className="print-avoid-break">
                      <h3 className="border-b border-slate-300 pb-1 text-xs font-bold uppercase tracking-wider text-slate-700">
                        {bucket.tierLabel} ({bucket.sponsors.length})
                      </h3>
                      <table className="mt-2 w-full border-collapse text-left text-xs">
                        <thead>
                          <tr className="bg-slate-50 text-[11px] font-semibold uppercase tracking-wider text-slate-500">
                            <th className="w-16 px-2 py-1.5">Logo</th>
                            <th className="px-2 py-1.5">Sponsor Name</th>
                            <th className="px-2 py-1.5">Assigned Hole / Slots</th>
                            <th className="w-24 px-2 py-1.5 text-center">Placed</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-200">
                          {bucket.sponsors.map((sp) => (
                            <tr key={sp.id}>
                              <td className="px-2 py-2">
                                {sp.logo_url ? (
                                  <img
                                    src={sp.logo_url}
                                    alt={sp.name}
                                    className="h-8 w-14 object-contain"
                                  />
                                ) : (
                                  <span className="text-[10px] text-slate-400">No logo</span>
                                )}
                              </td>
                              <td className="px-2 py-2 font-semibold text-slate-900">{sp.name}</td>
                              <td className="px-2 py-2 text-slate-700">
                                {[
                                  sp.hole_number ? `Hole ${sp.hole_number}` : null,
                                  sp.slot_count ? `${sp.slot_count} player slot${sp.slot_count === 1 ? '' : 's'}` : null,
                                ]
                                  .filter(Boolean)
                                  .join(' · ') || 'General Banner / Clubhouse'}
                              </td>
                              <td className="px-2 py-2 text-center">
                                <span className="inline-block h-4 w-4 rounded border-2 border-slate-500" aria-label="Placed checkbox" />
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  ))}
                </div>
              )}
            </section>
          )}
        </div>
      )}
    </div>
  );
};

function PrintSheetHeader({
  orgName,
  tournamentName,
  sheetTitle,
  meta,
  logoUrl,
}: {
  orgName?: string | null;
  tournamentName?: string | null;
  sheetTitle: string;
  meta: Array<string | null | undefined>;
  logoUrl?: string | null;
}) {
  return (
    <div className="flex items-center justify-between gap-4 border-b-2 border-slate-900 pb-3">
      <div>
        <p className="text-[11px] font-bold uppercase tracking-[0.18em] text-slate-500">
          {orgName || 'Tournament Operations'}
        </p>
        <h2 className="text-lg font-bold text-slate-950">{sheetTitle}</h2>
        <p className="text-xs font-medium text-slate-600">
          {[tournamentName, ...meta].filter(Boolean).join(' · ')}
        </p>
      </div>
      {logoUrl && (
        <img src={logoUrl} alt={tournamentName || 'Logo'} className="h-12 max-w-[120px] object-contain" />
      )}
    </div>
  );
}

function EmptyPrintable({ message }: { message: string }) {
  return (
    <div className="rounded-xl border border-dashed border-slate-300 bg-slate-50 p-10 text-center text-sm text-slate-500">
      {message}
    </div>
  );
}
