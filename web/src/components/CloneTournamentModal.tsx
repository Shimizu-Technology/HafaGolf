import React, { useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  Building2,
  Calendar,
  Copy,
  Info,
  Loader2,
  ShieldAlert,
  Ticket,
  Users,
  X,
} from 'lucide-react';
import {
  api,
  type CloneTournamentParams,
  type CloneTournamentResponse,
  type Organization,
  type Tournament,
} from '../services/api';
import { useOrganizationStore } from '../stores/organizationStore';
import {
  buildDefaultCloneForm,
  isCrossOrgClone,
  type CloneFormState,
} from '../utils/tournamentClone';

export interface CloneTournamentModalProps {
  tournament: Tournament;
  currentOrganizationId?: string;
  isSuperAdmin: boolean;
  organizations?: Organization[];
  onClose: () => void;
  onCloned: (response: CloneTournamentResponse, targetOrg?: Organization) => void | Promise<void>;
}

export const CloneTournamentModal: React.FC<CloneTournamentModalProps> = ({
  tournament,
  currentOrganizationId,
  isSuperAdmin,
  organizations: providedOrganizations,
  onClose,
  onCloned,
}) => {
  const storeOrganizations = useOrganizationStore((state) => state.accessibleOrganizations);
  const [loadedOrganizations, setLoadedOrganizations] = useState<Organization[]>(
    providedOrganizations ?? storeOrganizations
  );
  const [loadingOrgs, setLoadingOrgs] = useState(false);

  const [form, setForm] = useState<CloneFormState>(() => buildDefaultCloneForm(tournament));
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const sourceOrgId = tournament.organization_id || currentOrganizationId;

  useEffect(() => {
    setForm(buildDefaultCloneForm(tournament));
    setError(null);
  }, [tournament]);

  useEffect(() => {
    if (providedOrganizations) {
      setLoadedOrganizations(providedOrganizations);
      return;
    }

    if (!isSuperAdmin) return;

    let cancelled = false;
    setLoadingOrgs(true);
    api
      .getAdminOrganizations()
      .then((orgs) => {
        if (!cancelled) {
          setLoadedOrganizations(orgs);
        }
      })
      .catch(() => {
        if (!cancelled && storeOrganizations.length > 0) {
          setLoadedOrganizations(storeOrganizations);
        }
      })
      .finally(() => {
        if (!cancelled) {
          setLoadingOrgs(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [isSuperAdmin, providedOrganizations, storeOrganizations]);

  const otherOrganizations = useMemo(
    () => loadedOrganizations.filter((org) => org.id !== sourceOrgId),
    [loadedOrganizations, sourceOrgId]
  );

  const crossOrgMode = isSuperAdmin && isCrossOrgClone(sourceOrgId, form.target_organization_id);

  const selectedTargetOrg = useMemo(
    () => otherOrganizations.find((org) => org.id === form.target_organization_id),
    [otherOrganizations, form.target_organization_id]
  );

  const sourceHasExternalPaymentUrls = Boolean(
    tournament.swipe_simple_url || tournament.walkin_swipe_simple_url
  );

  const handleTargetOrgChange = (targetId: string) => {
    const nextIsCrossOrg = isCrossOrgClone(sourceOrgId, targetId);
    setForm((prev) => ({
      ...prev,
      target_organization_id: targetId,
      copy_sponsor_shells: nextIsCrossOrg ? false : prev.copy_sponsor_shells,
    }));
  };

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    setError(null);

    const trimmedName = form.name.trim();
    if (!trimmedName) {
      setError('Tournament name is required.');
      return;
    }

    const parsedYear = parseInt(form.year, 10);
    if (Number.isNaN(parsedYear) || parsedYear < 2000 || parsedYear > 2100) {
      setError('Please enter a valid 4-digit year.');
      return;
    }

    const payload: CloneTournamentParams = {
      name: trimmedName,
      year: parsedYear,
      edition: form.edition.trim() || null,
      event_date: form.event_date.trim() || null,
      copy_raffle_prizes: form.copy_raffle_prizes,
      copy_sponsor_shells: crossOrgMode ? false : form.copy_sponsor_shells,
    };

    if (crossOrgMode && form.target_organization_id) {
      payload.target_organization_id = form.target_organization_id;
    }

    setSubmitting(true);
    try {
      const response = await api.cloneTournament(tournament.id, payload);
      await onCloned(response, selectedTargetOrg);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to clone tournament.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="clone-tournament-title"
      onClick={onClose}
    >
      <div
        className="max-h-[90vh] w-full max-w-xl overflow-y-auto rounded-3xl bg-white shadow-elevated"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-4 border-b border-neutral-200 px-6 py-5">
          <div className="flex items-start gap-3">
            <div className="rounded-2xl bg-brand-50 p-2.5 text-brand-700">
              <Copy className="h-5 w-5" />
            </div>
            <div>
              <h2 id="clone-tournament-title" className="text-lg font-semibold text-neutral-900">
                Clone Tournament
              </h2>
              <p className="mt-0.5 text-sm text-neutral-500">
                Create a new draft event based on <span className="font-medium text-neutral-700">{tournament.name}</span>.
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close clone tournament modal"
            className="rounded-xl p-1.5 text-neutral-400 transition hover:bg-neutral-100 hover:text-neutral-600"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-5 px-6 py-5">
          {error && (
            <div
              role="alert"
              className="flex items-start gap-2.5 rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800"
            >
              <AlertTriangle className="mt-0.5 h-4 w-4 flex-shrink-0 text-red-600" />
              <span>{error}</span>
            </div>
          )}

          <div className="space-y-4">
            <div>
              <label htmlFor="clone-name" className="mb-1.5 block text-sm font-medium text-neutral-700">
                New Tournament Name
              </label>
              <input
                id="clone-name"
                type="text"
                required
                value={form.name}
                onChange={(event) => setForm((prev) => ({ ...prev, name: event.target.value }))}
                placeholder="Annual Golf Classic"
                className="w-full rounded-2xl border border-neutral-200 px-3.5 py-2.5 text-sm text-neutral-900 outline-none transition focus:border-brand-500 focus:ring-2 focus:ring-brand-100"
              />
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <label htmlFor="clone-year" className="mb-1.5 block text-sm font-medium text-neutral-700">
                  Year
                </label>
                <input
                  id="clone-year"
                  type="number"
                  required
                  min={2000}
                  max={2100}
                  value={form.year}
                  onChange={(event) => setForm((prev) => ({ ...prev, year: event.target.value }))}
                  className="w-full rounded-2xl border border-neutral-200 px-3.5 py-2.5 text-sm text-neutral-900 outline-none transition focus:border-brand-500 focus:ring-2 focus:ring-brand-100"
                />
              </div>

              <div>
                <label htmlFor="clone-edition" className="mb-1.5 block text-sm font-medium text-neutral-700">
                  Edition <span className="font-normal text-neutral-400">(optional)</span>
                </label>
                <input
                  id="clone-edition"
                  type="text"
                  value={form.edition}
                  onChange={(event) => setForm((prev) => ({ ...prev, edition: event.target.value }))}
                  placeholder="e.g. 6th Annual"
                  className="w-full rounded-2xl border border-neutral-200 px-3.5 py-2.5 text-sm text-neutral-900 outline-none transition focus:border-brand-500 focus:ring-2 focus:ring-brand-100"
                />
              </div>
            </div>

            <div>
              <label htmlFor="clone-event-date" className="mb-1.5 block text-sm font-medium text-neutral-700">
                Event Date <span className="font-normal text-neutral-400">(optional — cleared by default)</span>
              </label>
              <div className="relative">
                <Calendar className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-neutral-400" />
                <input
                  id="clone-event-date"
                  type="text"
                  value={form.event_date}
                  onChange={(event) => setForm((prev) => ({ ...prev, event_date: event.target.value }))}
                  placeholder="Leave blank for TBD (e.g. May 15, 2027)"
                  className="w-full rounded-2xl border border-neutral-200 py-2.5 pl-10 pr-3.5 text-sm text-neutral-900 outline-none transition focus:border-brand-500 focus:ring-2 focus:ring-brand-100"
                />
              </div>
            </div>
          </div>

          {isSuperAdmin && (
            <div className="rounded-2xl border border-neutral-200 bg-neutral-50 p-4 space-y-3">
              <div className="flex items-center gap-2">
                <Building2 className="h-4 w-4 text-brand-600" />
                <label htmlFor="clone-target-org" className="text-sm font-semibold text-neutral-900">
                  Clone as Template to Another Organization
                </label>
              </div>
              <select
                id="clone-target-org"
                value={form.target_organization_id}
                onChange={(event) => handleTargetOrgChange(event.target.value)}
                disabled={loadingOrgs}
                className="w-full rounded-xl border border-neutral-200 bg-white px-3 py-2.5 text-sm text-neutral-900 outline-none transition focus:border-brand-500 focus:ring-2 focus:ring-brand-100 disabled:opacity-60"
              >
                <option value="">Same organization (next-year clone)</option>
                {otherOrganizations.map((org) => (
                  <option key={org.id} value={org.id}>
                    {org.name} ({org.slug})
                  </option>
                ))}
              </select>

              {crossOrgMode && (
                <div
                  data-testid="cross-org-strip-notice"
                  className="flex items-start gap-2.5 rounded-xl border border-amber-200 bg-amber-50 px-3.5 py-3 text-xs leading-5 text-amber-900"
                >
                  <ShieldAlert className="mt-0.5 h-4 w-4 flex-shrink-0 text-amber-600" />
                  <div>
                    <p className="font-semibold">Cross-organization template mode</p>
                    <p className="mt-0.5">
                      Source-organization branding overrides, contact info, checks-payable-to instructions, external
                      payment URLs, and sponsors will be stripped automatically. Only format, course/hole setup,
                      valid feature overrides, and raffle bundle templates will be copied to{' '}
                      <span className="font-medium">{selectedTargetOrg?.name || 'the target organization'}</span>.
                    </p>
                  </div>
                </div>
              )}
            </div>
          )}

          <div className="space-y-3">
            <p className="text-sm font-semibold text-neutral-900">Optional templates to include</p>

            <label className="flex cursor-pointer items-start gap-3 rounded-2xl border border-neutral-200 p-3.5 transition hover:bg-neutral-50">
              <input
                type="checkbox"
                checked={form.copy_raffle_prizes}
                onChange={(event) =>
                  setForm((prev) => ({ ...prev, copy_raffle_prizes: event.target.checked }))
                }
                className="mt-0.5 h-4 w-4 rounded border-neutral-300 text-brand-600 focus:ring-brand-500"
              />
              <div className="min-w-0">
                <span className="flex items-center gap-1.5 text-sm font-medium text-neutral-900">
                  <Ticket className="h-4 w-4 text-brand-600" />
                  Copy raffle prize templates (without winners/tickets)
                </span>
                <p className="mt-0.5 text-xs text-neutral-500">
                  Copies prize names, tiers, descriptions, and values only. All winners, tickets, and draw history are reset.
                </p>
              </div>
            </label>

            {!crossOrgMode && (
              <label className="flex cursor-pointer items-start gap-3 rounded-2xl border border-neutral-200 p-3.5 transition hover:bg-neutral-50">
                <input
                  type="checkbox"
                  checked={form.copy_sponsor_shells}
                  onChange={(event) =>
                    setForm((prev) => ({ ...prev, copy_sponsor_shells: event.target.checked }))
                  }
                  className="mt-0.5 h-4 w-4 rounded border-neutral-300 text-brand-600 focus:ring-brand-500"
                />
                <div className="min-w-0">
                  <span className="flex items-center gap-1.5 text-sm font-medium text-neutral-900">
                    <Users className="h-4 w-4 text-brand-600" />
                    Copy sponsor directory shells (without player slots or links)
                  </span>
                  <p className="mt-0.5 text-xs text-neutral-500">
                    Copies sponsor names, tiers, contacts, and slot counts in inactive draft state with zero filled player data and no portal magic links.
                  </p>
                </div>
              </label>
            )}
          </div>

          {sourceHasExternalPaymentUrls && (
            <div className="flex items-start gap-2.5 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-xs leading-5 text-amber-900">
              <AlertTriangle className="mt-0.5 h-4 w-4 flex-shrink-0 text-amber-600" />
              <span>
                This event has external payment URLs configured. They will be cleared on the cloned event so last
                year&apos;s payment links are never reused accidentally.
              </span>
            </div>
          )}

          <div className="flex items-start gap-2.5 rounded-2xl border border-neutral-200 bg-neutral-50 px-4 py-3 text-xs leading-5 text-neutral-600">
            <Info className="mt-0.5 h-4 w-4 flex-shrink-0 text-neutral-500" />
            <span>
              The cloned event starts in <strong className="font-medium text-neutral-800">draft</strong> status with
              registration closed and past deadlines cleared. Golfers, groups, scores, raffle tickets, payments, and
              activity logs are never copied.
            </span>
          </div>

          <div className="flex flex-col-reverse gap-3 border-t border-neutral-100 pt-4 sm:flex-row sm:justify-end">
            <button
              type="button"
              onClick={onClose}
              disabled={submitting}
              className="rounded-2xl border border-neutral-200 px-5 py-2.5 text-sm font-medium text-neutral-700 transition hover:bg-neutral-50 disabled:opacity-50"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={submitting}
              className="inline-flex items-center justify-center gap-2 rounded-2xl bg-brand-600 px-5 py-2.5 text-sm font-medium text-white transition hover:bg-brand-700 disabled:opacity-60"
            >
              {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Copy className="h-4 w-4" />}
              <span>{crossOrgMode ? 'Clone to Organization' : 'Clone Tournament'}</span>
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

export default CloneTournamentModal;
