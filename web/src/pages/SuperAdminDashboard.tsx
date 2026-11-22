import React, { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import toast from 'react-hot-toast';
import {
  Building2,
  CheckCircle2,
  Globe,
  Plus,
  Star,
  Trash2,
  X,
} from 'lucide-react';
import { api, type Organization, type OrganizationDomain } from '../services/api';
import { useOrganizationStore } from '../stores/organizationStore';
import { useAdmin } from '../contexts';

export const SuperAdminDashboard: React.FC = () => {
  const navigate = useNavigate();
  const { isSuperAdmin } = useAdmin();
  const { setOrganization, setAccessibleOrganizations } = useOrganizationStore();
  const [organizations, setOrganizations] = useState<Organization[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [newDomainBySlug, setNewDomainBySlug] = useState<Record<string, string>>({});

  const [form, setForm] = useState({
    name: '',
    slug: '',
    primary_color: '#1e3a8a',
    primary_domain: '',
    admin_email: '',
    contact_email: '',
    website_url: '',
  });

  const loadOrganizations = useCallback(async () => {
    try {
      setLoading(true);
      const data = await api.getAdminOrganizations();
      setOrganizations(data);
      setAccessibleOrganizations(data);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to load organizations');
    } finally {
      setLoading(false);
    }
  }, [setAccessibleOrganizations]);

  useEffect(() => {
    void loadOrganizations();
  }, [loadOrganizations]);

  const handleCreateOrg = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.name.trim()) {
      toast.error('Organization name is required');
      return;
    }

    try {
      setSubmitting(true);
      await api.createOrganization({
        name: form.name.trim(),
        slug: form.slug.trim() || undefined,
        primary_color: form.primary_color || undefined,
        primary_domain: form.primary_domain.trim() || undefined,
        admin_email: form.admin_email.trim() || undefined,
        contact_email: form.contact_email.trim() || undefined,
        website_url: form.website_url.trim() || undefined,
      });
      toast.success('Organization created');
      setShowCreateForm(false);
      setForm({
        name: '',
        slug: '',
        primary_color: '#1e3a8a',
        primary_domain: '',
        admin_email: '',
        contact_email: '',
        website_url: '',
      });
      await loadOrganizations();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to create organization');
    } finally {
      setSubmitting(false);
    }
  };

  const handleAddDomain = async (org: Organization) => {
    const hostname = (newDomainBySlug[org.slug] || '').trim();
    if (!hostname) return;

    try {
      await api.createOrganizationDomain(org.slug, { hostname });
      toast.success(`Added domain ${hostname}`);
      setNewDomainBySlug((prev) => ({ ...prev, [org.slug]: '' }));
      await loadOrganizations();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to add domain');
    }
  };

  const handleSetPrimaryDomain = async (org: Organization, domain: OrganizationDomain) => {
    try {
      await api.updateOrganizationDomain(org.slug, domain.id, { is_primary: true });
      toast.success(`${domain.hostname} set as primary host`);
      await loadOrganizations();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to update primary domain');
    }
  };

  const handleDeleteDomain = async (org: Organization, domain: OrganizationDomain) => {
    try {
      await api.deleteOrganizationDomain(org.slug, domain.id);
      toast.success(`Removed domain ${domain.hostname}`);
      await loadOrganizations();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to remove domain');
    }
  };

  const handleSwitchOrganization = (org: Organization) => {
    setOrganization(org);
    navigate('/admin');
  };

  if (!isSuperAdmin) {
    return (
      <div className="mx-auto max-w-3xl p-6">
        <div className="rounded-2xl border border-amber-200 bg-amber-50 p-6 text-amber-900">
          <h1 className="text-lg font-semibold">Super Admin Access Required</h1>
          <p className="mt-2 text-sm">
            Only platform super administrators can create organizations and manage custom domains.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-6xl space-y-6 p-4 sm:p-6">
      <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-center">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Organizations &amp; Domains</h1>
          <p className="mt-1 text-sm text-slate-600">
            Manage client organizations, custom hostnames, and off-season states across HafaGolf.
          </p>
        </div>
        <button
          type="button"
          onClick={() => setShowCreateForm((v) => !v)}
          className="inline-flex items-center gap-2 rounded-xl bg-slate-900 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-slate-800"
        >
          {showCreateForm ? <X className="h-4 w-4" /> : <Plus className="h-4 w-4" />}
          <span>{showCreateForm ? 'Cancel' : 'New Organization'}</span>
        </button>
      </div>

      {showCreateForm ? (
        <form
          onSubmit={handleCreateOrg}
          className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm space-y-4"
        >
          <h2 className="text-lg font-semibold text-slate-900">Create Organization</h2>
          <div className="grid gap-4 sm:grid-cols-2">
            <label className="block text-sm">
              <span className="font-medium text-slate-700">Organization Name *</span>
              <input
                type="text"
                required
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                placeholder="Pacific Classic Golf"
                className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
              />
            </label>
            <label className="block text-sm">
              <span className="font-medium text-slate-700">Slug (optional)</span>
              <input
                type="text"
                value={form.slug}
                onChange={(e) => setForm({ ...form, slug: e.target.value })}
                placeholder="pacific-classic"
                className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
              />
            </label>
            <label className="block text-sm">
              <span className="font-medium text-slate-700">Primary Custom Domain (optional)</span>
              <input
                type="text"
                value={form.primary_domain}
                onChange={(e) => setForm({ ...form, primary_domain: e.target.value })}
                placeholder="events.example.com"
                className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
              />
            </label>
            <label className="block text-sm">
              <span className="font-medium text-slate-700">Initial Admin Email (optional)</span>
              <input
                type="email"
                value={form.admin_email}
                onChange={(e) => setForm({ ...form, admin_email: e.target.value })}
                placeholder="organizer@example.com"
                className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
              />
            </label>
            <label className="block text-sm">
              <span className="font-medium text-slate-700">Brand Primary Color</span>
              <input
                type="color"
                value={form.primary_color}
                onChange={(e) => setForm({ ...form, primary_color: e.target.value })}
                className="mt-1 h-10 w-24 rounded-lg border border-slate-300 p-1"
              />
            </label>
            <label className="block text-sm">
              <span className="font-medium text-slate-700">Website URL (optional)</span>
              <input
                type="url"
                value={form.website_url}
                onChange={(e) => setForm({ ...form, website_url: e.target.value })}
                placeholder="https://example.org"
                className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
              />
            </label>
          </div>
          <div className="flex justify-end">
            <button
              type="submit"
              disabled={submitting}
              className="rounded-xl bg-slate-900 px-5 py-2.5 text-sm font-semibold text-white transition hover:bg-slate-800 disabled:opacity-50"
            >
              {submitting ? 'Creating...' : 'Create Organization'}
            </button>
          </div>
        </form>
      ) : null}

      {loading ? (
        <div className="rounded-2xl border border-slate-200 bg-white p-10 text-center text-sm text-slate-500">
          Loading organizations...
        </div>
      ) : organizations.length === 0 ? (
        <div className="rounded-2xl border border-slate-200 bg-white p-10 text-center text-sm text-slate-500">
          No organizations found yet.
        </div>
      ) : (
        <div className="space-y-4">
          {organizations.map((org) => (
            <div
              key={org.id}
              className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm"
            >
              <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-center">
                <div className="flex items-center gap-3">
                  <div
                    className="flex h-10 w-10 items-center justify-center rounded-xl text-white"
                    style={{ backgroundColor: org.primary_color || '#0f172a' }}
                  >
                    <Building2 className="h-5 w-5" />
                  </div>
                  <div>
                    <h2 className="text-lg font-semibold text-slate-900">{org.name}</h2>
                    <p className="text-xs text-slate-500">
                      Slug: <span className="font-mono">{org.slug}</span>
                      {' · '}
                      {org.tournament_count ?? 0} tournament{org.tournament_count === 1 ? '' : 's'}
                      {org.offseason_enabled ? ' · Off-season mode enabled' : ''}
                    </p>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => handleSwitchOrganization(org)}
                  className="inline-flex items-center gap-2 rounded-lg border border-slate-300 px-3.5 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50"
                >
                  <span>Open Dashboard</span>
                </button>
              </div>

              <div className="mt-4 border-t border-slate-100 pt-4">
                <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-slate-500">
                  <Globe className="h-3.5 w-3.5" />
                  <span>Custom Domains</span>
                </div>

                <div className="mt-2 space-y-2">
                  {(org.domains || []).map((domain) => (
                    <div
                      key={domain.id}
                      className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-slate-100 bg-slate-50 px-3 py-2 text-sm"
                    >
                      <div className="flex items-center gap-2">
                        <span className="font-mono text-slate-900">{domain.hostname}</span>
                        {domain.is_primary ? (
                          <span className="inline-flex items-center gap-1 rounded-full bg-emerald-100 px-2 py-0.5 text-xs font-medium text-emerald-800">
                            <Star className="h-3 w-3" />
                            Primary
                          </span>
                        ) : null}
                        {domain.verified_at ? (
                          <span className="inline-flex items-center gap-1 text-xs text-emerald-700">
                            <CheckCircle2 className="h-3.5 w-3.5" />
                            Verified
                          </span>
                        ) : null}
                      </div>
                      <div className="flex items-center gap-2">
                        {!domain.is_primary ? (
                          <button
                            type="button"
                            onClick={() => handleSetPrimaryDomain(org, domain)}
                            className="rounded-md border border-slate-300 px-2 py-1 text-xs font-medium text-slate-700 hover:bg-white"
                          >
                            Set primary
                          </button>
                        ) : null}
                        <button
                          type="button"
                          onClick={() => handleDeleteDomain(org, domain)}
                          aria-label={`Delete domain ${domain.hostname}`}
                          className="rounded-md p-1 text-slate-400 hover:bg-red-50 hover:text-red-600"
                        >
                          <Trash2 className="h-4 w-4" />
                        </button>
                      </div>
                    </div>
                  ))}
                </div>

                <div className="mt-3 flex gap-2">
                  <input
                    type="text"
                    value={newDomainBySlug[org.slug] || ''}
                    onChange={(e) =>
                      setNewDomainBySlug((prev) => ({ ...prev, [org.slug]: e.target.value }))
                    }
                    placeholder="Add hostname (e.g. tournament.example.com)"
                    className="flex-1 rounded-lg border border-slate-300 px-3 py-1.5 text-sm"
                  />
                  <button
                    type="button"
                    onClick={() => handleAddDomain(org)}
                    className="rounded-lg bg-slate-900 px-3.5 py-1.5 text-xs font-semibold text-white hover:bg-slate-800"
                  >
                    Add Domain
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};
