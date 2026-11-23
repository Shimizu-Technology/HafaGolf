import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  AlertCircle,
  ClipboardList,
  Flag,
  Globe,
  HandCoins,
  Loader2,
  RotateCcw,
  Sliders,
} from 'lucide-react';
import toast from 'react-hot-toast';
import { api } from '../services/api';
import { useOrganizationStore } from '../stores/organizationStore';
import {
  getUnmetDependencies,
  groupCatalogByCategory,
  isFeatureEnabled,
  type FeatureCategory,
  type FeatureKey,
  type OrganizationFeaturesResponse,
} from '../utils/features';

interface OrgFeaturesPanelProps {
  organizationSlug: string;
  title?: string;
  featureKeys?: readonly FeatureKey[];
  eventId?: number;
  onFeaturesUpdated?: (data: OrganizationFeaturesResponse) => void;
}

const CATEGORY_ICONS: Record<FeatureCategory, React.ComponentType<{ className?: string }>> = {
  fundraising: HandCoins,
  event_day: Flag,
  registration: ClipboardList,
  site: Globe,
};

export const OrgFeaturesPanel: React.FC<OrgFeaturesPanelProps> = ({
  organizationSlug,
  title = 'Platform Features',
  featureKeys,
  eventId,
  onFeaturesUpdated,
}) => {
  const [data, setData] = useState<OrganizationFeaturesResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [savingKey, setSavingKey] = useState<string | null>(null);
  const [scopeTab, setScopeTab] = useState<'organization' | 'tournament'>(eventId ? 'tournament' : 'organization');
  const [selectedTournamentId, setSelectedTournamentId] = useState<number | null>(null);

  const fetchFeatures = useCallback(async () => {
    if (!organizationSlug) return;
    setLoading(true);
    setError(null);
    try {
      const payload = await api.getOrganizationFeatures(organizationSlug);
      setData(payload);
      setSelectedTournamentId((prev) => {
        if (eventId && payload.tournaments.some((t) => t.id === eventId)) return eventId;
        if (prev && payload.tournaments.some((t) => t.id === prev)) return prev;
        const active = payload.tournaments.find((t) => t.status !== 'archived') || payload.tournaments[0];
        return active ? active.id : null;
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load platform features');
    } finally {
      setLoading(false);
    }
  }, [eventId, organizationSlug]);

  useEffect(() => {
    fetchFeatures();
  }, [fetchFeatures]);

  const groupedCatalog = useMemo(
    () => (data ? groupCatalogByCategory(data.catalog.filter((feature) => !featureKeys || featureKeys.includes(feature.key))) : []),
    [data, featureKeys]
  );

  const selectedTournament = useMemo(
    () => data?.tournaments.find((t) => t.id === selectedTournamentId) ?? null,
    [data, selectedTournamentId]
  );

  const syncStores = (updated: OrganizationFeaturesResponse) => {
    const store = useOrganizationStore.getState();
    if (store.organization && store.organization.slug === updated.organization.slug) {
      const updatedOrg = {
        ...store.organization,
        offseason_enabled: updated.organization.offseason_enabled,
        features: updated.organization.features,
        feature_overrides: updated.organization.feature_overrides,
        settings: {
          ...(store.organization.settings || {}),
          features: updated.organization.feature_overrides,
        },
      };
      store.setOrganization(updatedOrg);
      store.setAccessibleOrganizations(
        store.accessibleOrganizations.map((org) =>
          org.slug === updated.organization.slug ? updatedOrg : org
        )
      );
    }
    onFeaturesUpdated?.(updated);
  };

  const patchFeatures = async (
    key: FeatureKey,
    payload: {
      organization_features?: Partial<Record<FeatureKey, boolean | null>>;
      tournament_id?: number;
      tournament_features?: Partial<Record<FeatureKey, boolean | null>>;
    },
    successMessage: string
  ) => {
    setSavingKey(key);
    try {
      const updated = await api.updateOrganizationFeatures(organizationSlug, payload);
      setData(updated);
      syncStores(updated);
      toast.success(successMessage);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to update feature');
    } finally {
      setSavingKey(null);
    }
  };

  const handleOrgToggle = (key: FeatureKey, nextValue: boolean) => {
    patchFeatures(
      key,
      { organization_features: { [key]: nextValue } },
      `${nextValue ? 'Enabled' : 'Disabled'} organization feature`
    );
  };

  const handleOrgReset = (key: FeatureKey) => {
    patchFeatures(
      key,
      { organization_features: { [key]: null } },
      'Reset feature to platform default'
    );
  };

  const handleTournamentOverride = (key: FeatureKey, nextValue: boolean | null) => {
    if (!selectedTournament) return;
    const message =
      nextValue === null
        ? 'Event now inherits organization default'
        : `${nextValue ? 'Enabled' : 'Disabled'} feature for ${selectedTournament.name}`;
    patchFeatures(
      key,
      {
        tournament_id: selectedTournament.id,
        tournament_features: { [key]: nextValue },
      },
      message
    );
  };

  const hasTournaments = Boolean(data && data.tournaments.length > 0);
  const featureLabelByKey = useMemo(() => {
    const map = new Map<FeatureKey, string>();
    data?.catalog.forEach((item) => map.set(item.key, item.label));
    return map;
  }, [data]);

  return (
    <div className="bg-white rounded-xl shadow-sm p-4 sm:p-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between mb-5">
        <div className="flex items-start gap-3">
          <div className="p-2 bg-brand-50 rounded-lg flex-shrink-0">
            <Sliders className="w-5 h-5 text-brand-600" />
          </div>
          <div>
            <h2 className="text-base sm:text-lg font-semibold text-gray-900">{title}</h2>
            <p className="text-xs sm:text-sm text-gray-500">
              Choose what’s available for all events or change it for one event. These choices save immediately.
            </p>
          </div>
        </div>

        {hasTournaments && (
          <div className="inline-flex rounded-xl bg-gray-100 p-1 self-start flex-shrink-0">
            <button
              type="button"
              onClick={() => setScopeTab('organization')}
              className={`min-h-[48px] px-3 rounded-lg text-xs font-medium transition ${
                scopeTab === 'organization'
                  ? 'bg-white text-gray-900 shadow-sm'
                  : 'text-gray-600 hover:text-gray-900'
              }`}
            >
              All events
            </button>
            <button
              type="button"
              onClick={() => setScopeTab('tournament')}
              className={`min-h-[48px] px-3 rounded-lg text-xs font-medium transition ${
                scopeTab === 'tournament'
                  ? 'bg-white text-gray-900 shadow-sm'
                  : 'text-gray-600 hover:text-gray-900'
              }`}
            >
              One event
            </button>
          </div>
        )}
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-8 text-sm text-gray-500 gap-2">
          <Loader2 className="w-4 h-4 animate-spin text-brand-600" />
          Loading feature configuration...
        </div>
      ) : error || !data ? (
        <div className="rounded-xl border border-red-200 bg-red-50 p-4 flex items-center justify-between gap-3">
          <div className="flex items-center gap-2 text-sm text-red-700">
            <AlertCircle className="w-4 h-4 flex-shrink-0" />
            <span>{error || 'Unable to load feature configuration.'}</span>
          </div>
          <button
            type="button"
            onClick={fetchFeatures}
            className="text-xs font-medium text-red-700 underline hover:text-red-900"
          >
            Retry
          </button>
        </div>
      ) : (
        <div className="space-y-6">
          {scopeTab === 'tournament' && selectedTournament && (
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 rounded-xl border border-gray-200 bg-gray-50 px-4 py-3">
              <div>
                <p className="text-xs font-semibold uppercase tracking-wider text-gray-500">
                  Selected Event
                </p>
                <p className="text-xs text-gray-500">
                  Event overrides take priority over organization defaults.
                </p>
              </div>
              <select
                aria-label="Select event for feature overrides"
                value={selectedTournament.id}
                onChange={(e) => setSelectedTournamentId(Number(e.target.value))}
                className="min-h-[48px] px-3 py-2 border border-gray-300 rounded-xl bg-white text-base font-medium text-gray-900 focus:outline-none focus:ring-2 focus:ring-brand-500"
              >
                {data.tournaments.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name} ({t.status.replace('_', ' ')})
                  </option>
                ))}
              </select>
            </div>
          )}

          {groupedCatalog.map((group) => {
            const CategoryIcon = CATEGORY_ICONS[group.category] || Sliders;
            return (
              <div key={group.category} className="space-y-2.5">
                <div className="flex items-center gap-2 pb-1 border-b border-gray-100">
                  <CategoryIcon className="w-4 h-4 text-gray-400" />
                  <h3 className="text-xs font-semibold uppercase tracking-wider text-gray-500">
                    {group.label}
                  </h3>
                </div>

                <div className="divide-y divide-gray-100 rounded-xl border border-gray-200 overflow-hidden">
                  {group.items.map((feature) => {
                    const isSaving = savingKey === feature.key;

                    if (scopeTab === 'organization') {
                      const effective = isFeatureEnabled(
                        data.organization.features,
                        feature.key,
                        feature.default
                      );
                      const hasOverride = Object.prototype.hasOwnProperty.call(
                        data.organization.feature_overrides,
                        feature.key
                      );
                      const unmetDeps = getUnmetDependencies(feature, data.organization.features);

                      return (
                        <div
                          key={feature.key}
                          className="flex items-center justify-between gap-4 px-4 py-3.5 bg-white hover:bg-gray-50/70 transition-colors"
                        >
                          <div className="min-w-0 flex-1">
                            <div className="flex items-center gap-2 flex-wrap">
                              <span className="text-sm font-medium text-gray-900">
                                {feature.label}
                              </span>
                              {hasOverride ? (
                                <span className="inline-flex items-center rounded-full bg-brand-50 px-2 py-0.5 text-[11px] font-medium text-brand-700">
                                  Custom
                                </span>
                              ) : (
                                <span className="inline-flex items-center rounded-full bg-gray-100 px-2 py-0.5 text-[11px] font-medium text-gray-500">
                                  Default: {feature.default ? 'On' : 'Off'}
                                </span>
                              )}
                              {!feature.tournament_overridable && (
                                <span className="inline-flex items-center rounded-full bg-gray-100 px-2 py-0.5 text-[11px] font-medium text-gray-500">
                                  Org-wide
                                </span>
                              )}
                            </div>
                            <p className="text-xs text-gray-500 mt-0.5">{feature.description}</p>
                            {unmetDeps.length > 0 && (
                              <p className="text-xs text-amber-700 mt-1 flex items-center gap-1">
                                <AlertCircle className="w-3.5 h-3.5 flex-shrink-0" />
                                Requires{' '}
                                {unmetDeps
                                  .map((dep) => featureLabelByKey.get(dep) || dep)
                                  .join(', ')}
                              </p>
                            )}
                          </div>

                          <div className="flex items-center gap-2 flex-shrink-0">
                            {hasOverride && (
                              <button
                                type="button"
                                onClick={() => handleOrgReset(feature.key)}
                                disabled={Boolean(savingKey)}
                                title="Reset to platform default"
                                className="min-h-[48px] min-w-[48px] text-gray-400 hover:text-gray-700 hover:bg-gray-100 rounded-lg transition disabled:opacity-50"
                              >
                                <RotateCcw className="w-3.5 h-3.5" />
                              </button>
                            )}
                            <button
                              type="button"
                              role="switch"
                              aria-checked={effective}
                              aria-label={`Toggle ${feature.label}`}
                              disabled={Boolean(savingKey) || unmetDeps.length > 0}
                              onClick={() => handleOrgToggle(feature.key, !effective)}
                              className={`relative inline-flex h-[48px] w-[48px] items-center flex-shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 focus:outline-none focus:ring-2 focus:ring-brand-500 focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 ${
                                effective ? 'bg-brand-600' : 'bg-gray-200'
                              }`}
                            >
                              {isSaving ? (
                                <Loader2 className="w-3.5 h-3.5 animate-spin text-white m-auto" />
                              ) : (
                                <span
                                  className={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow ring-0 transition duration-200 ${
                                    effective ? 'translate-x-6' : 'translate-x-0'
                                  }`}
                                />
                              )}
                            </button>
                          </div>
                        </div>
                      );
                    }

                    // Tournament override view
                    const tournament = selectedTournament;
                    if (!tournament) return null;

                    const orgEffective = isFeatureEnabled(
                      data.organization.features,
                      feature.key,
                      feature.default
                    );
                    const hasExplicitOverride = Object.prototype.hasOwnProperty.call(
                      tournament.feature_overrides,
                      feature.key
                    );
                    const overrideValue = hasExplicitOverride
                      ? tournament.feature_overrides[feature.key]
                      : null;
                    const tournamentEffective = isFeatureEnabled(
                      tournament.features,
                      feature.key,
                      orgEffective
                    );
                    const unmetDeps = getUnmetDependencies(feature, tournament.features);

                    return (
                      <div
                        key={feature.key}
                        className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 px-4 py-3.5 bg-white hover:bg-gray-50/70 transition-colors"
                      >
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className="text-sm font-medium text-gray-900">
                              {feature.label}
                            </span>
                            <span
                              className={`inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-medium ${
                                tournamentEffective
                                  ? 'bg-emerald-50 text-emerald-700'
                                  : 'bg-gray-100 text-gray-600'
                              }`}
                            >
                              Effective: {tournamentEffective ? 'On' : 'Off'}
                            </span>
                            <span className="text-[11px] text-gray-400">
                              Org default: {orgEffective ? 'On' : 'Off'}
                            </span>
                          </div>
                          <p className="text-xs text-gray-500 mt-0.5">{feature.description}</p>
                          {unmetDeps.length > 0 && (
                            <p className="text-xs text-amber-700 mt-1 flex items-center gap-1">
                              <AlertCircle className="w-3.5 h-3.5 flex-shrink-0" />
                              Requires{' '}
                              {unmetDeps
                                .map((dep) => featureLabelByKey.get(dep) || dep)
                                .join(', ')}
                            </p>
                          )}
                        </div>

                        <div className="flex items-center gap-2 flex-shrink-0">
                          {!feature.tournament_overridable ? (
                            <span className="text-xs font-medium text-gray-400 px-2.5 py-1 rounded-lg bg-gray-50 border border-gray-200">
                              Organization-wide
                            </span>
                          ) : (
                            <div className="inline-flex rounded-lg border border-gray-200 bg-gray-50 p-0.5">
                              {(['inherit', 'on', 'off'] as const).map((mode) => {
                                const isSelected =
                                  (mode === 'inherit' && overrideValue === null) ||
                                  (mode === 'on' && overrideValue === true) ||
                                  (mode === 'off' && overrideValue === false);
                                const targetVal =
                                  mode === 'inherit' ? null : mode === 'on';

                                return (
                                  <button
                                    key={mode}
                                    type="button"
                                    disabled={Boolean(savingKey) || (mode === 'on' && unmetDeps.length > 0)}
                                    onClick={() => handleTournamentOverride(feature.key, targetVal)}
                                    className={`min-h-[48px] px-2.5 rounded-md text-sm font-medium capitalize transition disabled:opacity-50 ${
                                      isSelected
                                        ? mode === 'on'
                                          ? 'bg-brand-600 text-white shadow-sm'
                                          : mode === 'off'
                                          ? 'bg-gray-800 text-white shadow-sm'
                                          : 'bg-white text-gray-900 shadow-sm'
                                        : 'text-gray-600 hover:text-gray-900'
                                    }`}
                                  >
                                    {isSaving && isSelected ? (
                                      <Loader2 className="w-3 h-3 animate-spin" />
                                    ) : (
                                      mode
                                    )}
                                  </button>
                                );
                              })}
                            </div>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};

export default OrgFeaturesPanel;
