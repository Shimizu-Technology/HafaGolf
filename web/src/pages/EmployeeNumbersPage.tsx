import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { Link, useParams } from 'react-router-dom';
import {
  BadgeCheck,
  Search,
  Plus,
  Upload,
  RefreshCw,
  Trash2,
  RotateCcw,
  Loader2,
  CheckCircle2,
  Clock,
  Users,
  AlertCircle,
  X,
  FileSpreadsheet,
  ArrowLeft,
} from 'lucide-react';
import toast from 'react-hot-toast';
import { useOrganization } from '../components/OrganizationProvider';
import { useTournament } from '../contexts';
import {
  api,
  type EmployeeNumberRecord,
  type EmployeeNumberStats,
} from '../services/api';
import { adminEventPath, adminOrgRoutes } from '../utils/adminRoutes';
import { isFeatureEnabled } from '../utils/features';
import { formatDateTime } from '../utils/dates';
import {
  formatUsdFromCents,
  parseBulkEmployeeNumbersText,
} from '../utils/employeePricing';

type StatusFilter = 'all' | 'available' | 'used';

export const EmployeeNumbersPage: React.FC = () => {
  const { tournamentSlug } = useParams<{ tournamentSlug: string }>();
  const { organization } = useOrganization();
  const { tournaments } = useTournament();

  const tournament = useMemo(
    () => tournaments.find((t) => t.slug === tournamentSlug) ?? null,
    [tournaments, tournamentSlug]
  );

  const employeePricingEnabled = isFeatureEnabled(
    tournament?.features ?? organization?.features,
    'employee_pricing',
    false
  );

  const [records, setRecords] = useState<EmployeeNumberRecord[]>([]);
  const [stats, setStats] = useState<EmployeeNumberStats>({ total: 0, used: 0, available: 0 });
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');

  // Single add state
  const [newNumber, setNewNumber] = useState('');
  const [newName, setNewName] = useState('');
  const [submittingSingle, setSubmittingSingle] = useState(false);

  // Bulk import state
  const [showBulkModal, setShowBulkModal] = useState(false);
  const [bulkText, setBulkText] = useState('');
  const [submittingBulk, setSubmittingBulk] = useState(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  // Row action loading state
  const [busyId, setBusyId] = useState<number | null>(null);

  const parsedBulkPreview = useMemo(
    () => parseBulkEmployeeNumbersText(bulkText),
    [bulkText]
  );

  const fetchEmployeeNumbers = useCallback(async () => {
    if (!tournament?.id || !employeePricingEnabled) {
      setLoading(false);
      return;
    }

    setLoading(true);
    try {
      const data = await api.getEmployeeNumbers({
        tournament_id: tournament.id,
        search: searchTerm.trim() || undefined,
        status: statusFilter,
      });
      setRecords(data.employee_numbers);
      setStats(data.stats);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to load employee numbers');
    } finally {
      setLoading(false);
    }
  }, [tournament?.id, employeePricingEnabled, searchTerm, statusFilter]);

  useEffect(() => {
    fetchEmployeeNumbers();
  }, [fetchEmployeeNumbers]);

  const handleAddSingle = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!tournament?.id) return;
    if (!newNumber.trim()) {
      toast.error('Employee number is required');
      return;
    }

    setSubmittingSingle(true);
    try {
      await api.createEmployeeNumber({
        tournament_id: tournament.id,
        employee_number: newNumber.trim(),
        employee_name: newName.trim() || undefined,
      });
      toast.success(`Added employee number ${newNumber.trim().toUpperCase()}`);
      setNewNumber('');
      setNewName('');
      await fetchEmployeeNumbers();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to add employee number');
    } finally {
      setSubmittingSingle(false);
    }
  };

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = () => {
      const text = typeof reader.result === 'string' ? reader.result : '';
      setBulkText((prev) => (prev.trim() ? `${prev.trim()}\n${text}` : text));
    };
    reader.readAsText(file);
    e.target.value = '';
  };

  const handleBulkImport = async () => {
    if (!tournament?.id) return;
    if (parsedBulkPreview.length === 0) {
      toast.error('Paste or upload at least one employee number');
      return;
    }

    setSubmittingBulk(true);
    try {
      const result = await api.bulkCreateEmployeeNumbers({
        tournament_id: tournament.id,
        employee_numbers: parsedBulkPreview,
      });
      toast.success(
        `Imported ${result.created} employee number${result.created === 1 ? '' : 's'}` +
          (result.skipped > 0 ? ` (${result.skipped} skipped)` : '')
      );
      if (result.errors.length > 0) {
        toast.error(`${result.errors.length} row(s) had errors`);
      }
      setBulkText('');
      setShowBulkModal(false);
      await fetchEmployeeNumbers();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Bulk import failed');
    } finally {
      setSubmittingBulk(false);
    }
  };

  const handleRelease = async (record: EmployeeNumberRecord) => {
    if (!confirm(`Release employee number ${record.employee_number}? It will become available again.`)) {
      return;
    }

    setBusyId(record.id);
    try {
      await api.updateEmployeeNumber(record.id, { release: true });
      toast.success(`Released ${record.employee_number}`);
      await fetchEmployeeNumbers();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to release employee number');
    } finally {
      setBusyId(null);
    }
  };

  const handleDelete = async (record: EmployeeNumberRecord) => {
    const message = record.used
      ? `${record.employee_number} is currently claimed${record.used_by_golfer_name ? ` by ${record.used_by_golfer_name}` : ''}. Release and permanently delete it?`
      : `Delete employee number ${record.employee_number}?`;

    if (!confirm(message)) return;

    setBusyId(record.id);
    try {
      await api.deleteEmployeeNumber(record.id, { release: record.used });
      toast.success(`Deleted ${record.employee_number}`);
      await fetchEmployeeNumbers();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to delete employee number');
    } finally {
      setBusyId(null);
    }
  };

  if (!tournament) {
    return (
      <div className="min-h-[40vh] flex items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-brand-600" />
      </div>
    );
  }

  if (!employeePricingEnabled) {
    return (
      <div className="max-w-2xl mx-auto py-8">
        <div className="rounded-2xl border border-amber-200 bg-white p-8 text-center shadow-sm">
          <AlertCircle className="h-10 w-10 text-amber-500 mx-auto mb-3" />
          <h1 className="text-xl font-bold text-neutral-900">Employee Discount Pricing Is Disabled</h1>
          <p className="mt-2 text-sm text-neutral-600">
            Enable the <strong>Employee Discount Pricing</strong> feature flag in organization or event settings to manage eligible employee numbers.
          </p>
          <div className="mt-6 flex items-center justify-center gap-3">
            <Link
              to={adminEventPath(tournament.slug)}
              className="inline-flex items-center gap-2 rounded-xl border border-neutral-300 px-4 py-2 text-sm font-medium text-neutral-700 hover:bg-neutral-50"
            >
              <ArrowLeft className="h-4 w-4" />
              Back to Event
            </Link>
            <Link
              to={adminOrgRoutes.settings}
              className="inline-flex items-center gap-2 rounded-xl bg-brand-600 px-4 py-2 text-sm font-semibold text-white hover:bg-brand-700"
            >
              Open Settings
            </Link>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="rounded-2xl border border-neutral-200 bg-white p-6 shadow-sm">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <div className="flex items-center gap-2 text-brand-600 mb-1">
              <BadgeCheck className="h-5 w-5" />
              <span className="text-xs font-semibold uppercase tracking-wider">Employee Pricing</span>
            </div>
            <h1 className="text-2xl font-bold text-neutral-900">{tournament.name} — Employee Numbers</h1>
            <p className="mt-1 text-sm text-neutral-500">
              Manage eligible employee numbers for discounted registration
              {typeof tournament.employee_entry_fee === 'number' && (
                <span>
                  {' '}&bull; Employee Rate:{' '}
                  <strong className="text-neutral-800">{formatUsdFromCents(tournament.employee_entry_fee)}</strong>
                  {' '}(Standard: {formatUsdFromCents(tournament.entry_fee || 0)})
                </span>
              )}
            </p>
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={fetchEmployeeNumbers}
              className="inline-flex items-center gap-2 rounded-xl border border-neutral-300 bg-white px-3.5 py-2.5 text-sm font-medium text-neutral-700 hover:bg-neutral-50"
            >
              <RefreshCw className="h-4 w-4" />
              Refresh
            </button>
            <button
              onClick={() => setShowBulkModal(true)}
              className="inline-flex items-center gap-2 rounded-xl bg-brand-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-brand-700"
            >
              <Upload className="h-4 w-4" />
              Bulk Import
            </button>
          </div>
        </div>

        {/* Stats */}
        <div className="mt-6 grid grid-cols-3 gap-3">
          <div className="rounded-xl bg-neutral-50 border border-neutral-200 p-4">
            <div className="flex items-center gap-2 text-neutral-500 text-xs font-medium uppercase">
              <Users className="h-4 w-4" />
              Total
            </div>
            <p className="mt-1 text-2xl font-bold text-neutral-900">{stats.total}</p>
          </div>
          <div className="rounded-xl bg-green-50 border border-green-200 p-4">
            <div className="flex items-center gap-2 text-green-700 text-xs font-medium uppercase">
              <CheckCircle2 className="h-4 w-4" />
              Available
            </div>
            <p className="mt-1 text-2xl font-bold text-green-700">{stats.available}</p>
          </div>
          <div className="rounded-xl bg-blue-50 border border-blue-200 p-4">
            <div className="flex items-center gap-2 text-blue-700 text-xs font-medium uppercase">
              <Clock className="h-4 w-4" />
              Claimed
            </div>
            <p className="mt-1 text-2xl font-bold text-blue-700">{stats.used}</p>
          </div>
        </div>
      </div>

      {/* Add Single Employee Number */}
      <form
        onSubmit={handleAddSingle}
        className="rounded-2xl border border-neutral-200 bg-white p-5 shadow-sm"
      >
        <h2 className="text-sm font-semibold text-neutral-800 mb-3">Add Single Employee Number</h2>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-[1fr_1fr_auto]">
          <input
            type="text"
            value={newNumber}
            onChange={(e) => setNewNumber(e.target.value)}
            placeholder="Employee Number (e.g. EMP-1042)"
            className="rounded-xl border border-neutral-300 px-3.5 py-2.5 text-sm text-neutral-900 focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500/20"
            required
          />
          <input
            type="text"
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            placeholder="Employee Name (optional)"
            className="rounded-xl border border-neutral-300 px-3.5 py-2.5 text-sm text-neutral-900 focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500/20"
          />
          <button
            type="submit"
            disabled={submittingSingle}
            className="inline-flex items-center justify-center gap-2 rounded-xl bg-brand-600 px-5 py-2.5 text-sm font-semibold text-white hover:bg-brand-700 disabled:opacity-50"
          >
            {submittingSingle ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
            Add Number
          </button>
        </div>
      </form>

      {/* Search & Filter + List */}
      <div className="rounded-2xl border border-neutral-200 bg-white shadow-sm overflow-hidden">
        <div className="p-4 border-b border-neutral-200 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="relative flex-1 max-w-md">
            <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 h-4 w-4 text-neutral-400" />
            <input
              type="text"
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              placeholder="Search by employee number or name..."
              className="w-full rounded-xl border border-neutral-300 pl-10 pr-4 py-2 text-sm text-neutral-900 focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500/20"
            />
          </div>

          <div className="flex items-center gap-1.5">
            {(['all', 'available', 'used'] as StatusFilter[]).map((status) => (
              <button
                key={status}
                onClick={() => setStatusFilter(status)}
                className={`rounded-xl px-3.5 py-2 text-xs font-semibold capitalize transition ${
                  statusFilter === status
                    ? 'bg-brand-600 text-white'
                    : 'bg-neutral-100 text-neutral-600 hover:bg-neutral-200'
                }`}
              >
                {status === 'used' ? 'Claimed' : status}
              </button>
            ))}
          </div>
        </div>

        {loading ? (
          <div className="py-16 flex items-center justify-center">
            <Loader2 className="h-8 w-8 animate-spin text-brand-600" />
          </div>
        ) : records.length === 0 ? (
          <div className="py-14 text-center px-4">
            <BadgeCheck className="h-10 w-10 text-neutral-300 mx-auto mb-2" />
            <p className="text-sm font-medium text-neutral-600">No employee numbers found</p>
            <p className="text-xs text-neutral-400 mt-1">
              Add a single number above or use Bulk Import to upload a list.
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="bg-neutral-50 border-b border-neutral-200 text-xs uppercase text-neutral-500">
                <tr>
                  <th className="px-4 py-3 font-semibold">Employee #</th>
                  <th className="px-4 py-3 font-semibold">Employee Name</th>
                  <th className="px-4 py-3 font-semibold">Status</th>
                  <th className="px-4 py-3 font-semibold">Claimed By</th>
                  <th className="px-4 py-3 font-semibold text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-neutral-200">
                {records.map((record) => (
                  <tr key={record.id} className="hover:bg-neutral-50">
                    <td className="px-4 py-3 font-mono font-semibold text-neutral-900">
                      {record.employee_number}
                    </td>
                    <td className="px-4 py-3 text-neutral-700">
                      {record.employee_name || <span className="text-neutral-400">—</span>}
                    </td>
                    <td className="px-4 py-3">
                      {record.used ? (
                        <span className="inline-flex items-center gap-1 rounded-full bg-blue-100 px-2.5 py-0.5 text-xs font-medium text-blue-700">
                          <Clock className="h-3 w-3" />
                          Claimed
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1 rounded-full bg-green-100 px-2.5 py-0.5 text-xs font-medium text-green-700">
                          <CheckCircle2 className="h-3 w-3" />
                          Available
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-neutral-600">
                      {record.used ? (
                        <div>
                          <div className="font-medium text-neutral-900">
                            {record.used_by_golfer_name || 'Claimed manually'}
                          </div>
                          {record.used_at && (
                            <div className="text-xs text-neutral-400">
                              {formatDateTime(record.used_at)}
                            </div>
                          )}
                        </div>
                      ) : (
                        <span className="text-neutral-400">—</span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-right">
                      <div className="inline-flex items-center gap-2">
                        {record.used && (
                          <button
                            onClick={() => handleRelease(record)}
                            disabled={busyId === record.id}
                            className="inline-flex items-center gap-1 rounded-lg border border-amber-300 bg-amber-50 px-2.5 py-1.5 text-xs font-medium text-amber-800 hover:bg-amber-100 disabled:opacity-50"
                            title="Release employee number"
                          >
                            <RotateCcw className="h-3.5 w-3.5" />
                            Release
                          </button>
                        )}
                        <button
                          onClick={() => handleDelete(record)}
                          disabled={busyId === record.id}
                          className="inline-flex items-center gap-1 rounded-lg border border-red-200 px-2.5 py-1.5 text-xs font-medium text-red-600 hover:bg-red-50 disabled:opacity-50"
                          title="Delete employee number"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                          Delete
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Bulk Import Modal */}
      {showBulkModal && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
          onClick={() => setShowBulkModal(false)}
        >
          <div
            className="w-full max-w-lg rounded-2xl bg-white shadow-xl overflow-hidden"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between border-b border-neutral-200 px-6 py-4">
              <div className="flex items-center gap-2">
                <FileSpreadsheet className="h-5 w-5 text-brand-600" />
                <h3 className="text-lg font-semibold text-neutral-900">Bulk Import Employee Numbers</h3>
              </div>
              <button
                onClick={() => setShowBulkModal(false)}
                className="rounded-lg p-1 text-neutral-400 hover:bg-neutral-100 hover:text-neutral-600"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <div className="p-6 space-y-4">
              <p className="text-sm text-neutral-600">
                Paste one employee number per line, or <code className="rounded bg-neutral-100 px-1 py-0.5 text-xs">number, name</code> CSV rows. Duplicates are automatically skipped.
              </p>

              <div className="flex items-center gap-3">
                <input
                  ref={fileInputRef}
                  type="file"
                  accept=".csv,.txt"
                  onChange={handleFileUpload}
                  className="hidden"
                />
                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  className="inline-flex items-center gap-2 rounded-xl border border-neutral-300 px-3.5 py-2 text-xs font-medium text-neutral-700 hover:bg-neutral-50"
                >
                  <Upload className="h-4 w-4" />
                  Upload CSV / TXT
                </button>
                <span className="text-xs text-neutral-500">
                  {parsedBulkPreview.length} unique entr{parsedBulkPreview.length === 1 ? 'y' : 'ies'} ready
                </span>
              </div>

              <textarea
                value={bulkText}
                onChange={(e) => setBulkText(e.target.value)}
                rows={8}
                placeholder={'EMP-1001, Alice Santos\nEMP-1002, Bob Cruz\nEMP-1003'}
                className="w-full rounded-xl border border-neutral-300 p-3 font-mono text-sm text-neutral-900 focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500/20"
              />
            </div>

            <div className="flex items-center justify-end gap-3 border-t border-neutral-200 px-6 py-4">
              <button
                type="button"
                onClick={() => setShowBulkModal(false)}
                className="rounded-xl px-4 py-2 text-sm font-medium text-neutral-600 hover:bg-neutral-100"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleBulkImport}
                disabled={submittingBulk || parsedBulkPreview.length === 0}
                className="inline-flex items-center gap-2 rounded-xl bg-brand-600 px-5 py-2 text-sm font-semibold text-white hover:bg-brand-700 disabled:opacity-50"
              >
                {submittingBulk ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
                Import {parsedBulkPreview.length > 0 ? `(${parsedBulkPreview.length})` : ''}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
