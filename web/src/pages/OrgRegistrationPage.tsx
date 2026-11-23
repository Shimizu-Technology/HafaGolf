import React, { useState, useEffect, useMemo, useRef } from 'react';
import { useNavigate, useParams, Link } from 'react-router-dom';
import { Button, Card } from '../components/ui';
import { LiabilityWaiver } from '../components/LiabilityWaiver';
import { PublicHero } from '../components/PublicHero';
import {
  Trophy,
  AlertCircle,
  Loader2,
  Calendar,
  MapPin,
  ChevronLeft,
  Check,
  DollarSign,
  ChevronRight,
  BadgeCheck,
  CheckCircle2,
  UserPlus,
  Trash2,
  Users,
  Sparkles,
  Plus,
  Minus,
} from 'lucide-react';
import { api, Tournament, type TournamentAddOn } from '../services/api';
import { useOrganization } from '../components/OrganizationProvider';
import { formatEventDate } from '../utils/dates';
import { SignedInAdminBar } from '../components/SignedInAdminBar';
import { getPublicFacingCapacitySummary, isAtCapacity, isPublicAtCapacity } from '../utils/capacity';
import { useApplyBranding } from '../utils/branding';
import { getDefaultOrgSlug } from '../utils/tenant';
import { isFeatureEnabled } from '../utils/features';
import {
  calculateEffectiveEntryFeeCents,
  calculateEmployeeSavingsCents,
  formatUsdFromCents,
  normalizeEmployeeNumber,
} from '../utils/employeePricing';
import {
  buildInitialPlayers,
  buildRegistrationPayload,
  calculateRegistrationTotalCents,
  canAddPlayer,
  canRemovePlayer,
  createEmptyPlayerDraft,
  formatEntryFeeDisplay,
  formatEntryUnitSubtitle,
  getDisplayTeamName,
  getStepNames,
  hasValidationErrors,
  normalizeTeamSize,
  validateCaptainStep,
  validateTeammatesStep,
  validateWaiverStep,
  type TeamPlayerDraft,
  type TeamRegistrationValidationErrors,
} from '../utils/teamRegistration';

// ---------------------------------------------------------------------------
// Step indicator
// ---------------------------------------------------------------------------

function StepIndicator({ stepNames, currentStep }: { stepNames: string[]; currentStep: number }) {
  return (
    <div className="flex items-center justify-between mb-8">
      {stepNames.map((stepName, index) => (
        <React.Fragment key={stepName}>
          <div className="flex flex-col items-center">
            <div
              className={`w-9 h-9 rounded-full flex items-center justify-center font-semibold text-sm ${
                currentStep > index + 1
                  ? 'bg-brand-600 text-brand-foreground'
                  : currentStep === index + 1
                    ? 'bg-accent-600 text-accent-foreground'
                    : 'bg-neutral-200 text-neutral-500'
              }`}
            >
              {currentStep > index + 1 ? <Check className="w-4 h-4" /> : index + 1}
            </div>
            <span className="text-xs mt-1.5 font-medium text-neutral-600 hidden sm:block">{stepName}</span>
          </div>
          {index < stepNames.length - 1 && (
            <div className={`flex-1 h-0.5 mx-2 ${currentStep > index + 1 ? 'bg-brand-600' : 'bg-neutral-200'}`} />
          )}
        </React.Fragment>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export const OrgRegistrationPage: React.FC = () => {
  const navigate = useNavigate();
  const { tournamentSlug } = useParams<{ tournamentSlug: string }>();
  const { organization, isLoading: orgLoading } = useOrganization();
  const orgSlug = organization?.slug || (!orgLoading ? getDefaultOrgSlug() : '');

  const [currentStep, setCurrentStep] = useState(1);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [tournament, setTournament] = useState<Tournament | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const branding = useApplyBranding(organization, tournament);

  const [submitState, setSubmitState] = useState<'idle' | 'submitting' | 'redirecting'>('idle');
  const [paymentUrl, setPaymentUrl] = useState<string | null>(null);
  const [savedRegistration, setSavedRegistration] = useState<import('../services/api').Registration | null>(null);

  const [players, setPlayers] = useState<TeamPlayerDraft[]>(() => buildInitialPlayers(2, false));
  const [teamName, setTeamName] = useState('');
  const [teamCategory, setTeamCategory] = useState('');
  const [errors, setErrors] = useState<TeamRegistrationValidationErrors>({ players: {} });
  const [availableAddOns, setAvailableAddOns] = useState<TournamentAddOn[]>([]);
  const [selectedAddOns, setSelectedAddOns] = useState<Record<number, number>>({});

  const teamSize = useMemo(() => normalizeTeamSize(tournament?.team_size), [tournament?.team_size]);
  const allowPartialTeams = Boolean(tournament?.allow_partial_teams);
  const configuredCategories = useMemo(
    () => (Array.isArray(tournament?.team_categories) ? tournament.team_categories : []),
    [tournament?.team_categories]
  );
  const paymentMode = tournament?.payment_mode || organization?.payment_mode || 'offline';
  const isOfflineMode = paymentMode === 'offline';
  const waiverEnabled = tournament?.waiver_enabled !== false;
  const isStripeMode = paymentMode === 'platform_collect' || paymentMode === 'client_processor';

  const stepNames = useMemo(() => {
    const names = getStepNames(teamSize, waiverEnabled);
    if (isOfflineMode && names.length > 0) {
      return [...names.slice(0, -1), 'Review & Confirm'];
    }
    return names;
  }, [teamSize, isOfflineMode, waiverEnabled]);
  const totalSteps = stepNames.length;
  const isIndividual = teamSize === 1;

  // Logical step mapping (individual skips the Teammates step)
  const captainStep = 1;
  const teammatesStep = isIndividual ? -1 : 2;
  const waiverStep = waiverEnabled ? totalSteps - 1 : -1;
  const reviewStep = totalSteps;

  // Employee discount pricing state (only active when :employee_pricing feature is enabled)
  const [isEmployee, setIsEmployee] = useState(false);
  const [employeeNumberInput, setEmployeeNumberInput] = useState('');
  const [employeeValidation, setEmployeeValidation] = useState<{
    status: 'idle' | 'checking' | 'valid' | 'invalid';
    employeeNumber?: string;
    employeeEntryFeeCents?: number | null;
    message?: string;
  }>({ status: 'idle' });
  const [employeeError, setEmployeeError] = useState<string | null>(null);
  const validationReqRef = useRef(0);

  const employeePricingEnabled = isFeatureEnabled(
    tournament?.features ?? organization?.features,
    'employee_pricing',
    false
  );

  const isEmployeeValidated =
    employeePricingEnabled && isEmployee && employeeValidation.status === 'valid';

  const activeBaseFeeCents = tournament?.current_fee ?? tournament?.entry_fee ?? 0;

  const effectiveFeeCents = calculateEffectiveEntryFeeCents({
    entryFeeCents: activeBaseFeeCents,
    employeeEntryFeeCents:
      employeeValidation.employeeEntryFeeCents ?? tournament?.employee_entry_fee,
    employeePricingEnabled,
    isEmployeeValidated,
  });

  const employeeSavingsCents = calculateEmployeeSavingsCents({
    entryFeeCents: activeBaseFeeCents,
    employeeEntryFeeCents:
      employeeValidation.employeeEntryFeeCents ?? tournament?.employee_entry_fee,
    employeePricingEnabled,
    isEmployeeValidated,
  });

  const totalDueCents = calculateRegistrationTotalCents({
    entryFeeCents: activeBaseFeeCents,
    captainEffectiveFeeCents: effectiveFeeCents,
    playerCount: players.length,
    teamSize,
    capacityUnit: tournament?.capacity_unit,
  });

  const selectedAddOnItems = useMemo(() => {
    return availableAddOns
      .map((item) => ({ item, quantity: selectedAddOns[item.id] || 0 }))
      .filter((entry) => entry.quantity > 0);
  }, [availableAddOns, selectedAddOns]);

  const addOnsTotalCents = useMemo(
    () => selectedAddOnItems.reduce((sum, entry) => sum + entry.item.price_cents * entry.quantity, 0),
    [selectedAddOnItems]
  );

  const grandTotalCents = totalDueCents + addOnsTotalCents;

  const updateAddOnQuantity = (addOn: TournamentAddOn, delta: number) => {
    setSelectedAddOns((prev) => {
      const current = prev[addOn.id] || 0;
      const cap = addOn.remaining_quantity != null
        ? Math.min(addOn.max_quantity_per_order, addOn.remaining_quantity)
        : addOn.max_quantity_per_order;
      const next = Math.max(0, Math.min(cap, current + delta));
      const updated = { ...prev };
      if (next === 0) {
        delete updated[addOn.id];
      } else {
        updated[addOn.id] = next;
      }
      return updated;
    });
  };

  const handleValidateEmployeeNumber = async (rawValue?: string) => {
    if (!tournament || !employeePricingEnabled) return;
    const normalized = normalizeEmployeeNumber(rawValue ?? employeeNumberInput);
    if (!normalized) {
      validationReqRef.current += 1;
      setEmployeeValidation({ status: 'idle' });
      setEmployeeError('Please enter your employee number');
      return;
    }

    const reqId = ++validationReqRef.current;
    setEmployeeError(null);
    setEmployeeValidation({ status: 'checking' });

    try {
      const result = await api.validateEmployeeNumber(normalized, tournament.id, orgSlug);
      if (validationReqRef.current !== reqId) return;

      if (result.valid && result.available) {
        setEmployeeValidation({
          status: 'valid',
          employeeNumber: result.employee_number || normalized,
          employeeEntryFeeCents: result.employee_entry_fee_cents,
          message: 'Employee number verified',
        });
      } else {
        setEmployeeValidation({
          status: 'invalid',
          message: result.message || result.error || 'Employee number is invalid or already used',
        });
      }
    } catch (err) {
      if (validationReqRef.current !== reqId) return;
      setEmployeeValidation({
        status: 'invalid',
        message: err instanceof Error ? err.message : 'Unable to validate employee number',
      });
    }
  };

  useEffect(() => {
    if (orgLoading) return;
    if (!orgSlug || !tournamentSlug) {
      setIsLoading(false);
      return;
    }

    let cancelled = false;
    async function fetchTournament() {
      setIsLoading(true);
      setSubmitError(null);
      try {
        const data = await api.getOrganizationTournament(orgSlug, tournamentSlug!);
        if (!cancelled) {
          setTournament(data);
          setPlayers(buildInitialPlayers(data.team_size, Boolean(data.allow_partial_teams)));
          setCurrentStep(1);
          setErrors({ players: {} });
          setSelectedAddOns({});
          try {
            const addOnsRes = await api.getTournamentAddOns(data.id, false);
            if (!cancelled) {
              setAvailableAddOns((addOnsRes.add_ons || []).filter((a) => a.active && !a.sold_out));
            }
          } catch {
            if (!cancelled) setAvailableAddOns([]);
          }
        }
      } catch (err: unknown) {
        if (!cancelled) {
          const message = err instanceof Error ? err.message : 'Failed to load tournament';
          console.error('Failed to fetch tournament:', err);
          setSubmitError(message);
        }
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    }

    fetchTournament();
    return () => {
      cancelled = true;
    };
  }, [orgLoading, orgSlug, tournamentSlug]);

  const updatePlayer = <K extends keyof TeamPlayerDraft>(index: number, field: K, value: TeamPlayerDraft[K]) => {
    setPlayers((prev) => prev.map((player, idx) => (idx === index ? { ...player, [field]: value } : player)));
    setErrors((prev) => {
      if (!prev.players[index]) return prev;
      const nextPlayerErrors = { ...prev.players[index] };
      delete nextPlayerErrors[field as keyof typeof nextPlayerErrors];
      const nextPlayers = { ...prev.players };
      if (Object.keys(nextPlayerErrors).length === 0) {
        delete nextPlayers[index];
      } else {
        nextPlayers[index] = nextPlayerErrors;
      }
      return { ...prev, players: nextPlayers };
    });
  };

  const handleAddPlayer = () => {
    if (!canAddPlayer(players.length, teamSize, allowPartialTeams)) return;
    setPlayers((prev) => [...prev, createEmptyPlayerDraft(false)]);
  };

  const handleRemovePlayer = (index: number) => {
    if (index === 0 || !canRemovePlayer(players.length, teamSize, allowPartialTeams)) return;
    setPlayers((prev) => prev.filter((_, idx) => idx !== index));
    setErrors({ players: {} });
  };

  const validateStep = (step: number): boolean => {
    let nextErrors: TeamRegistrationValidationErrors = { players: {} };

    if (step === captainStep) {
      nextErrors = validateCaptainStep(players, {
        handicapRequired: Boolean(tournament?.handicap_required),
        teamCategories: configuredCategories,
        teamCategory,
        teamSize,
      });
      if (employeePricingEnabled && isEmployee) {
        if (!employeeNumberInput.trim()) {
          setEmployeeError('Employee number is required when employee discount is selected');
          setErrors(nextErrors);
          return false;
        }
        if (employeeValidation.status !== 'valid') {
          setEmployeeError('Please verify a valid, available employee number before continuing');
          setErrors(nextErrors);
          return false;
        }
      }
      setEmployeeError(null);
    } else if (step === teammatesStep) {
      nextErrors = validateTeammatesStep(players, {
        teamSize,
        allowPartialTeams,
        handicapRequired: Boolean(tournament?.handicap_required),
        teamCategories: configuredCategories,
        teamCategory,
      });
    } else if (step === waiverStep) {
      nextErrors = validateWaiverStep(players);
    }

    setErrors(nextErrors);
    return !hasValidationErrors(nextErrors);
  };

  const handleNext = () => {
    if (validateStep(currentStep)) {
      setCurrentStep((prev) => Math.min(prev + 1, totalSteps));
      window.scrollTo({ top: 0, behavior: 'instant' });
    }
  };

  const handleBack = () => {
    setCurrentStep((prev) => Math.max(prev - 1, 1));
    window.scrollTo({ top: 0, behavior: 'instant' });
  };

  const handleSubmit = async () => {
    if (!tournament) return;

    setSubmitState('submitting');
    setSubmitError(null);

    try {
      const paymentType = isOfflineMode ? 'pay_on_day' : isStripeMode ? 'stripe' : 'swipe_simple';

      const payload = buildRegistrationPayload(
        {
          players,
          teamName,
          teamCategory,
        },
        {
          paymentType,
          waiverEnabled,
          organizationSlug: orgSlug,
          isEmployee: isEmployeeValidated,
          employeeNumber: isEmployeeValidated ? employeeValidation.employeeNumber : undefined,
          addOns: selectedAddOnItems.map((entry) => ({
            add_on_id: entry.item.id,
            quantity: entry.quantity,
          })),
        }
      );

      let registration = savedRegistration;
      if (!registration) {
        const result = await api.createRegistration(tournament.id, payload);
        registration = result.registration;
        setSavedRegistration(registration);
      }
      const isWaitlisted = registration.registration_status === 'waitlist';

      const golferCompat = {
        id: registration.id,
        name: registration.contact_name || players[0]?.name || '',
        email: registration.contact_email || players[0]?.email || '',
        phone: registration.contact_phone || players[0]?.phone || '',
        partner_name: players[1]?.name || null,
        team_name: registration.display_team_name,
        registration_status: registration.registration_status,
        payment_token: registration.payment_token,
      };

      if (isWaitlisted) {
        navigate(`/${tournamentSlug}/success`, {
          state: {
            golfer: golferCompat,
            registration,
            tournament,
            waitlisted: true,
          },
        });
        return;
      }

      if (isOfflineMode) {
        navigate(`/${tournamentSlug}/success`, {
          state: {
            golfer: golferCompat,
            registration,
            tournament,
            paymentPending: true,
          },
        });
        return;
      }

      if (!registration.payment_token) {
        throw new Error('Registration saved, but payment link could not be initialized. Please contact the organizer.');
      }

      if (isStripeMode) {
        const checkoutResponse = await api.createCheckoutSession(registration.payment_token);
        if (checkoutResponse.checkout_url) {
          setSubmitState('redirecting');
          setPaymentUrl(checkoutResponse.checkout_url);
          window.location.href = checkoutResponse.checkout_url;
        } else {
          navigate(`/${tournamentSlug}/success`, {
            state: {
              golfer: golferCompat,
              registration,
              tournament,
              paymentPending: true,
            },
          });
        }
        return;
      }

      const checkoutResponse = await api.createSwipeSimpleCheckout(registration.payment_token);

      if (checkoutResponse.redirect_url) {
        setSubmitState('redirecting');
        setPaymentUrl(checkoutResponse.redirect_url);
        window.location.href = checkoutResponse.redirect_url;
      } else {
        navigate(`/${tournamentSlug}/success`, {
          state: {
            golfer: golferCompat,
            registration,
            tournament,
            swipeSimpleRedirect: true,
          },
        });
      }
    } catch (error: unknown) {
      setSubmitError(error instanceof Error ? error.message : 'Registration failed. Please try again.');
      setSubmitState('idle');
    }
  };

  const inputClass =
    'w-full rounded-xl border border-neutral-200 px-4 py-3 text-sm text-neutral-900 focus:outline-none focus:border-brand-600 focus:ring-2 focus:ring-brand-600/20 transition-colors min-h-[44px]';

  if (orgLoading || isLoading) {
    return (
      <div data-static-flow className="min-h-screen flex items-center justify-center bg-white">
        <div className="text-center">
          <Loader2 className="h-10 w-10 animate-spin mx-auto text-brand-600" />
          <p className="mt-4 text-sm text-neutral-500 tracking-wide uppercase">Loading registration</p>
        </div>
      </div>
    );
  }

  if (!tournament) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-white">
        <Card className="p-8 max-w-md text-center">
          <AlertCircle className="h-12 w-12 text-red-500 mx-auto mb-4" />
          <h1 className="text-xl font-bold text-neutral-900 mb-2">Tournament Not Found</h1>
          <p className="text-neutral-600 mb-4">{submitError || 'The tournament you are looking for does not exist.'}</p>
          <Button onClick={() => navigate('/')}>Back to Tournaments</Button>
        </Card>
      </div>
    );
  }

  const totalAtCapacity = isAtCapacity(tournament);
  const publicFull = isPublicAtCapacity(tournament);
  const anyAtCapacity = totalAtCapacity || publicFull;

  if (!tournament.can_register) {
    const publicOnlyFull = publicFull && !totalAtCapacity;
    const waitlistEnabled = tournament.waitlist_enabled;
    return (
      <div className="min-h-screen flex items-center justify-center bg-white">
        <Card className="p-8 max-w-md text-center">
          <AlertCircle className="h-12 w-12 text-yellow-500 mx-auto mb-4" />
          <h1 className="text-xl font-bold text-neutral-900 mb-2">
            {anyAtCapacity && !waitlistEnabled
              ? publicOnlyFull
                ? 'Public Registration Full'
                : 'Event Full'
              : 'Registration Closed'}
          </h1>
          <p className="text-neutral-600 mb-4">
            {anyAtCapacity && !waitlistEnabled
              ? publicOnlyFull
                ? `Public registration for ${tournament.name} is full because sponsor-reserved slots are held separately.`
                : `${tournament.name} has reached maximum capacity.`
              : `Registration for ${tournament.name} is currently closed.`}
          </p>
          {tournament.contact_name && (
            <p className="text-sm text-neutral-500 mb-4">
              Questions? Contact {tournament.contact_name}
              {tournament.contact_phone && ` at ${tournament.contact_phone}`}
              {tournament.contact_email && ` or ${tournament.contact_email}`}
            </p>
          )}
          <Button onClick={() => navigate('/')}>Back to Home</Button>
        </Card>
      </div>
    );
  }

  const capacitySummary = getPublicFacingCapacitySummary(tournament);
  const displayTeamName = getDisplayTeamName(teamName, players);
  const heroBannerUrl = branding.bannerUrl;
  const captain = players[0];

  return (
    <div className="min-h-screen bg-neutral-100" data-theme-pack={branding.themePackId} data-static-flow>
      <SignedInAdminBar />
      {/* ================================================================= */}
      {/* HERO HEADER (quiet operational screen — zero entrance animations) */}
      {/* ================================================================= */}
      <PublicHero
        imageUrl={heroBannerUrl}
        imageAlt={`${tournament.name} registration header artwork`}
        imageDisplay="showcase"
        maxWidthClassName="max-w-6xl"
        containerClassName="min-h-[280px] lg:min-h-[320px]"
        contentClassName="max-w-3xl"
        themePack={branding.themePack}
      >
        <button
          onClick={() => navigate(`/${tournamentSlug}`)}
          className="inline-flex items-center gap-1 text-sm text-white/70 transition-colors duration-200 hover:text-white"
        >
          <ChevronLeft className="w-4 h-4" strokeWidth={2} />
          Back to Tournament
        </button>

        <h1 className="mt-4 font-theme-heading text-2xl font-bold tracking-tight text-white sm:text-3xl lg:text-4xl">
          Register for {tournament.name}
        </h1>

        <div className="mt-4 flex flex-wrap items-center gap-4 text-sm text-white/82">
          {tournament.event_date && (
            <span className="inline-flex items-center gap-1.5">
              <Calendar className="w-4 h-4" strokeWidth={1.5} />
              {formatEventDate(tournament.event_date)}
            </span>
          )}
          {tournament.location_name && (
            <span className="inline-flex items-center gap-1.5">
              <MapPin className="w-4 h-4" strokeWidth={1.5} />
              {tournament.location_name}
            </span>
          )}
          <span className="inline-flex items-center gap-1.5">
            <Users className="w-4 h-4" strokeWidth={1.5} />
            {isIndividual
              ? 'Individual (1 player)'
              : allowPartialTeams
                ? `Teams up to ${teamSize} players`
                : `${teamSize}-player teams`}
          </span>
        </div>
      </PublicHero>

      {anyAtCapacity && tournament.waitlist_enabled && (
        <div className="bg-amber-50 border-b border-amber-200">
          <div className="max-w-6xl mx-auto px-6 py-3">
            <p className="text-sm text-amber-800 font-medium text-center">
              This event is at capacity. You will be placed on the waitlist and notified if a spot opens up.
            </p>
          </div>
        </div>
      )}

      {/* ================================================================= */}
      {/* TWO-COLUMN LAYOUT                                                 */}
      {/* ================================================================= */}
      <div className="max-w-6xl mx-auto px-4 sm:px-6 py-8 sm:py-12">
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
          {/* LEFT — Form */}
          <div className="lg:col-span-2 order-last lg:order-first">
            <StepIndicator stepNames={stepNames} currentStep={currentStep} />

            {submitError && (
              <div className="p-4 bg-red-50 border border-red-200 rounded-2xl text-red-700 text-sm mb-6">
                {submitError}
              </div>
            )}

            <div>
              {/* ---- STEP 1: Player 1 / Team Captain ---- */}
              {currentStep === captainStep && captain && (
                <div key="step-captain">
                  <div className="bg-white rounded-2xl border border-neutral-200 p-6 sm:p-8">
                    <div className="border-l-4 border-brand-600 pl-3 mb-6">
                      <h2 className="text-lg font-semibold text-neutral-900">
                        {isIndividual ? 'Player Information' : 'Team Captain (Player 1)'}
                      </h2>
                      <p className="text-sm text-neutral-500">
                        {isIndividual ? 'Your registration contact details' : 'Primary contact for the team'}
                      </p>
                    </div>
                    <div className="space-y-4">
                      <div>
                        <label htmlFor="captain-name" className="block text-sm font-medium text-neutral-700 mb-1.5">
                          Full Name *
                        </label>
                        <input
                          id="captain-name"
                          value={captain.name}
                          onChange={(e) => updatePlayer(0, 'name', e.target.value)}
                          placeholder="John Smith"
                          className={inputClass}
                        />
                        {errors.players[0]?.name && (
                          <p className="text-red-500 text-xs mt-1">{errors.players[0].name}</p>
                        )}
                      </div>
                      <div>
                        <label htmlFor="captain-email" className="block text-sm font-medium text-neutral-700 mb-1.5">
                          Email Address *
                        </label>
                        <input
                          id="captain-email"
                          type="email"
                          value={captain.email}
                          onChange={(e) => updatePlayer(0, 'email', e.target.value)}
                          placeholder="john@example.com"
                          className={inputClass}
                        />
                        {errors.players[0]?.email && (
                          <p className="text-red-500 text-xs mt-1">{errors.players[0].email}</p>
                        )}
                      </div>
                      <div>
                        <label htmlFor="captain-phone" className="block text-sm font-medium text-neutral-700 mb-1.5">
                          Phone Number * (Guam: +1671, CNMI: +1670)
                        </label>
                        <input
                          id="captain-phone"
                          type="tel"
                          value={captain.phone}
                          onChange={(e) => updatePlayer(0, 'phone', e.target.value)}
                          placeholder="+1671 xxx-xxxx"
                          className={inputClass}
                        />
                        {errors.players[0]?.phone && (
                          <p className="text-red-500 text-xs mt-1">{errors.players[0].phone}</p>
                        )}
                      </div>

                      {employeePricingEnabled && (
                        <div className="mt-2 rounded-2xl border border-brand-200 bg-brand-50/40 p-4 space-y-3">
                          <label className="flex items-start gap-3 cursor-pointer">
                            <input
                              type="checkbox"
                              checked={isEmployee}
                              onChange={(e) => {
                                const checked = e.target.checked;
                                validationReqRef.current += 1;
                                setIsEmployee(checked);
                                setEmployeeError(null);
                                if (!checked) {
                                  setEmployeeNumberInput('');
                                  setEmployeeValidation({ status: 'idle' });
                                }
                              }}
                              className="mt-0.5 h-5 w-5 rounded border-neutral-300 accent-brand-600"
                            />
                            <div>
                              <span className="inline-flex items-center gap-1.5 text-sm font-semibold text-neutral-900">
                                <BadgeCheck className="h-4 w-4 text-brand-600" />
                                Apply Employee Discount
                              </span>
                              <p className="text-xs text-neutral-600 mt-0.5">
                                {typeof tournament.employee_entry_fee === 'number'
                                  ? `Eligible employees pay ${formatUsdFromCents(tournament.employee_entry_fee)} instead of ${formatUsdFromCents(tournament.entry_fee || 0)}.`
                                  : 'Enter your assigned employee number to apply discounted pricing.'}
                              </p>
                            </div>
                          </label>

                          {isEmployee && (
                            <div className="space-y-2 pt-1">
                              <div className="flex gap-2">
                                <input
                                  type="text"
                                  value={employeeNumberInput}
                                  onChange={(e) => {
                                    validationReqRef.current += 1;
                                    setEmployeeNumberInput(e.target.value);
                                    setEmployeeError(null);
                                    if (employeeValidation.status !== 'idle') {
                                      setEmployeeValidation({ status: 'idle' });
                                    }
                                  }}
                                  onBlur={() => {
                                    if (employeeNumberInput.trim() && employeeValidation.status === 'idle') {
                                      handleValidateEmployeeNumber(employeeNumberInput);
                                    }
                                  }}
                                  placeholder="Enter employee number"
                                  className={`${inputClass} bg-white font-mono uppercase`}
                                />
                                <button
                                  type="button"
                                  onClick={() => handleValidateEmployeeNumber()}
                                  disabled={employeeValidation.status === 'checking' || !employeeNumberInput.trim()}
                                  className="shrink-0 rounded-xl bg-brand-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-brand-700 disabled:opacity-50 min-h-[44px]"
                                >
                                  {employeeValidation.status === 'checking' ? (
                                    <Loader2 className="h-4 w-4 animate-spin" />
                                  ) : (
                                    'Verify'
                                  )}
                                </button>
                              </div>

                              {employeeValidation.status === 'valid' && (
                                <div className="flex items-center gap-2 rounded-xl bg-green-50 border border-green-200 px-3 py-2 text-xs text-green-800">
                                  <CheckCircle2 className="h-4 w-4 text-green-600 shrink-0" />
                                  <span>
                                    {employeeValidation.message}
                                    {employeeSavingsCents > 0 && ` — saving ${formatUsdFromCents(employeeSavingsCents)}`}
                                  </span>
                                </div>
                              )}

                              {employeeValidation.status === 'invalid' && (
                                <div className="flex items-center gap-2 rounded-xl bg-red-50 border border-red-200 px-3 py-2 text-xs text-red-700">
                                  <AlertCircle className="h-4 w-4 text-red-500 shrink-0" />
                                  <span>{employeeValidation.message}</span>
                                </div>
                              )}

                              {employeeError && (
                                <p className="text-xs text-red-600">{employeeError}</p>
                              )}
                            </div>
                          )}
                        </div>
                      )}

                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                        <div>
                          <label htmlFor="captain-tshirt" className="block text-sm font-medium text-neutral-700 mb-1.5">
                            Shirt Size (optional)
                          </label>
                          <select
                            id="captain-tshirt"
                            value={captain.tshirt_size}
                            onChange={(e) => updatePlayer(0, 'tshirt_size', e.target.value)}
                            className={`${inputClass} bg-white`}
                          >
                            <option value="">Select size…</option>
                            <option value="S">S</option>
                            <option value="M">M</option>
                            <option value="L">L</option>
                            <option value="XL">XL</option>
                            <option value="2XL">2XL</option>
                            <option value="3XL">3XL</option>
                          </select>
                        </div>
                        {tournament.handicap_required && (
                          <div>
                            <label htmlFor="captain-handicap" className="block text-sm font-medium text-neutral-700 mb-1.5">
                              Handicap *
                            </label>
                            <input
                              id="captain-handicap"
                              type="number"
                              min={-10}
                              max={54}
                              step="0.1"
                              value={captain.handicap}
                              onChange={(e) => updatePlayer(0, 'handicap', e.target.value)}
                              placeholder="e.g., 14.2"
                              className={inputClass}
                            />
                            {errors.players[0]?.handicap && (
                              <p className="text-red-500 text-xs mt-1">{errors.players[0].handicap}</p>
                            )}
                          </div>
                        )}
                      </div>

                      {isIndividual && configuredCategories.length > 0 && (
                        <div>
                          <label htmlFor="individual-category" className="block text-sm font-medium text-neutral-700 mb-1.5">
                            Division / Category <span className="text-red-500">*</span>
                          </label>
                          <select
                            id="individual-category"
                            value={teamCategory}
                            onChange={(e) => {
                              setTeamCategory(e.target.value);
                              setErrors((prev) => ({ ...prev, teamCategory: undefined }));
                            }}
                            className={`${inputClass} bg-white ${errors.teamCategory ? 'border-red-400 ring-2 ring-red-100' : ''}`}
                          >
                            <option value="">Select…</option>
                            {configuredCategories.map((cat) => (
                              <option key={cat} value={cat}>
                                {cat}
                              </option>
                            ))}
                          </select>
                          {errors.teamCategory && <p className="text-xs text-red-500 mt-1">{errors.teamCategory}</p>}
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              )}

              {/* ---- STEP 2: Teammates (for 2-player pairs or 4-player foursomes) ---- */}
              {currentStep === teammatesStep && !isIndividual && (
                <div key="step-teammates" className="space-y-4">
                  <div className="bg-white rounded-2xl border border-neutral-200 p-6 sm:p-8">
                    <div className="flex items-start justify-between gap-4 mb-6">
                      <div className="border-l-4 border-brand-600 pl-3">
                        <h2 className="text-lg font-semibold text-neutral-900">
                          {teamSize === 2 ? 'Playing Partner (Player 2)' : `Teammates (Players 2–${teamSize})`}
                        </h2>
                        <p className="text-sm text-neutral-500">
                          {allowPartialTeams
                            ? `Register ${players.length} of up to ${teamSize} players — partial teams are welcome.`
                            : teamSize === 2
                              ? 'Your teammate'
                              : `Enter all ${teamSize - 1} teammates for your foursome`}
                        </p>
                      </div>

                      {canAddPlayer(players.length, teamSize, allowPartialTeams) && (
                        <button
                          type="button"
                          onClick={handleAddPlayer}
                          className="inline-flex items-center gap-1.5 rounded-full border border-brand-600 px-4 py-2 text-xs font-semibold text-brand-700 hover:bg-brand-50 transition-colors shrink-0"
                        >
                          <UserPlus className="w-4 h-4" />
                          Add Player
                        </button>
                      )}
                    </div>

                    {players.length === 1 && allowPartialTeams && (
                      <div className="rounded-2xl border border-dashed border-neutral-300 bg-neutral-50 p-5 text-center mb-6">
                        <p className="text-sm text-neutral-600">
                          Registering as a solo player for now. You can add teammates up to {teamSize} players or
                          continue as a partial team.
                        </p>
                      </div>
                    )}

                    <div className="space-y-6">
                      {players.slice(1).map((player, sliceIdx) => {
                        const playerIdx = sliceIdx + 1;
                        const playerErrors = errors.players[playerIdx] || {};
                        return (
                          <div
                            key={playerIdx}
                            className="rounded-2xl border border-neutral-200 bg-neutral-50/60 p-4 sm:p-5 space-y-4"
                          >
                            <div className="flex items-center justify-between">
                              <h3 className="text-sm font-semibold text-neutral-900">
                                {teamSize === 2 ? 'Playing Partner (Player 2)' : `Player ${playerIdx + 1}`}
                              </h3>
                              {canRemovePlayer(players.length, teamSize, allowPartialTeams) && (
                                <button
                                  type="button"
                                  onClick={() => handleRemovePlayer(playerIdx)}
                                  className="inline-flex items-center gap-1 text-xs font-medium text-red-600 hover:text-red-700"
                                >
                                  <Trash2 className="w-3.5 h-3.5" />
                                  Remove
                                </button>
                              )}
                            </div>

                            <div>
                              <label htmlFor={`player-${playerIdx}-name`} className="block text-sm font-medium text-neutral-700 mb-1.5">
                                Full Name *
                              </label>
                              <input
                                id={`player-${playerIdx}-name`}
                                value={player.name}
                                onChange={(e) => updatePlayer(playerIdx, 'name', e.target.value)}
                                placeholder={`Player ${playerIdx + 1} full name`}
                                className={`${inputClass} bg-white`}
                              />
                              {playerErrors.name && <p className="text-red-500 text-xs mt-1">{playerErrors.name}</p>}
                            </div>

                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                              <div>
                                <label htmlFor={`player-${playerIdx}-email`} className="block text-sm font-medium text-neutral-700 mb-1.5">
                                  Email Address (optional)
                                </label>
                                <input
                                  id={`player-${playerIdx}-email`}
                                  type="email"
                                  value={player.email}
                                  onChange={(e) => updatePlayer(playerIdx, 'email', e.target.value)}
                                  placeholder="player@example.com"
                                  className={`${inputClass} bg-white`}
                                />
                                {playerErrors.email && (
                                  <p className="text-red-500 text-xs mt-1">{playerErrors.email}</p>
                                )}
                              </div>
                              <div>
                                <label htmlFor={`player-${playerIdx}-phone`} className="block text-sm font-medium text-neutral-700 mb-1.5">
                                  Phone Number (optional)
                                </label>
                                <input
                                  id={`player-${playerIdx}-phone`}
                                  type="tel"
                                  value={player.phone}
                                  onChange={(e) => updatePlayer(playerIdx, 'phone', e.target.value)}
                                  placeholder="+1671 xxx-xxxx"
                                  className={`${inputClass} bg-white`}
                                />
                              </div>
                            </div>

                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                              <div>
                                <label htmlFor={`player-${playerIdx}-tshirt`} className="block text-sm font-medium text-neutral-700 mb-1.5">
                                  Shirt Size (optional)
                                </label>
                                <select
                                  id={`player-${playerIdx}-tshirt`}
                                  value={player.tshirt_size}
                                  onChange={(e) => updatePlayer(playerIdx, 'tshirt_size', e.target.value)}
                                  className={`${inputClass} bg-white`}
                                >
                                  <option value="">Select size…</option>
                                  <option value="S">S</option>
                                  <option value="M">M</option>
                                  <option value="L">L</option>
                                  <option value="XL">XL</option>
                                  <option value="2XL">2XL</option>
                                  <option value="3XL">3XL</option>
                                </select>
                              </div>
                              {tournament.handicap_required && (
                                <div>
                                  <label htmlFor={`player-${playerIdx}-handicap`} className="block text-sm font-medium text-neutral-700 mb-1.5">
                                    Handicap *
                                  </label>
                                  <input
                                    id={`player-${playerIdx}-handicap`}
                                    type="number"
                                    min={-10}
                                    max={54}
                                    step="0.1"
                                    value={player.handicap}
                                    onChange={(e) => updatePlayer(playerIdx, 'handicap', e.target.value)}
                                    placeholder="e.g., 16.0"
                                    className={`${inputClass} bg-white`}
                                  />
                                  {playerErrors.handicap && (
                                    <p className="text-red-500 text-xs mt-1">{playerErrors.handicap}</p>
                                  )}
                                </div>
                              )}
                            </div>
                          </div>
                        );
                      })}
                    </div>

                    <p className="text-xs text-neutral-500 mt-4">
                      If teammate contact info is left blank, all team communications will go to the Team Captain.
                    </p>

                    <div className="pt-5 mt-5 border-t border-neutral-100 space-y-4">
                      <div>
                        <label htmlFor="registration-team-name" className="block text-sm font-medium text-neutral-700 mb-1.5">
                          Team Name
                        </label>
                        <input
                          id="registration-team-name"
                          value={teamName}
                          onChange={(e) => setTeamName(e.target.value)}
                          placeholder={`Defaults to "${getDisplayTeamName('', players)}"`}
                          className={inputClass}
                        />
                        <p className="text-xs text-neutral-400 mt-1">Optional — defaults to player names</p>
                      </div>

                      {configuredCategories.length > 0 && (
                        <div>
                          <label htmlFor="registration-team-category" className="block text-sm font-medium text-neutral-700 mb-1.5">
                            Team Category <span className="text-red-500">*</span>
                          </label>
                          <select
                            id="registration-team-category"
                            value={teamCategory}
                            onChange={(e) => {
                              setTeamCategory(e.target.value);
                              setErrors((prev) => ({ ...prev, teamCategory: undefined }));
                            }}
                            className={`${inputClass} bg-white ${errors.teamCategory ? 'border-red-400 ring-2 ring-red-100' : ''}`}
                          >
                            <option value="">Select…</option>
                            {configuredCategories.map((cat) => (
                              <option key={cat} value={cat}>
                                {cat}
                              </option>
                            ))}
                          </select>
                          {errors.teamCategory && <p className="text-xs text-red-500 mt-1">{errors.teamCategory}</p>}
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              )}

              {/* ---- STEP 3 (or 2 for individual): Waiver ---- */}
              {currentStep === waiverStep && (
                <div key="step-waiver">
                  <div className="bg-white rounded-2xl border border-neutral-200 p-6 sm:p-8">
                    <div className="border-l-4 border-brand-600 pl-3 mb-6">
                      <h2 className="text-lg font-semibold text-neutral-900">Liability Waiver</h2>
                      <p className="text-sm text-neutral-500">
                        {players.length === 1
                          ? 'Please review and agree to continue'
                          : `All ${players.length} players must agree`}
                      </p>
                    </div>

                    <div className="bg-amber-50 border border-amber-200 rounded-2xl p-4 mb-6 max-h-64 overflow-y-auto">
                      <LiabilityWaiver organizationName={organization?.name} waiverText={tournament.waiver_text} />
                    </div>

                    <div className="space-y-4">
                      {players.map((player, index) => (
                        <div key={index} className="p-4 bg-neutral-100 rounded-2xl">
                          <label className="flex items-start gap-3 cursor-pointer">
                            <input
                              type="checkbox"
                              checked={player.waiver_accepted}
                              onChange={(e) => updatePlayer(index, 'waiver_accepted', e.target.checked)}
                              className="mt-1 w-5 h-5 min-w-[20px] rounded border-neutral-300 accent-brand-600"
                            />
                            <span className="text-sm text-neutral-700">
                              I, <strong>{player.name.trim() || `Player ${index + 1}`}</strong>, have read and agree to
                              the liability waiver
                            </span>
                          </label>
                          {errors.players[index]?.waiver_accepted && (
                            <p className="text-red-500 text-sm mt-2">{errors.players[index].waiver_accepted}</p>
                          )}
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              )}

              {/* ---- FINAL STEP: Review & Pay ---- */}
              {currentStep === reviewStep && (
                <div key="step-review">
                  <div className="bg-white rounded-2xl border border-neutral-200 p-6 sm:p-8">
                    <div className="border-l-4 border-brand-600 pl-3 mb-6">
                      <h2 className="text-lg font-semibold text-neutral-900">
                        {isOfflineMode ? 'Review & Confirm' : 'Review & Pay'}
                      </h2>
                      <p className="text-sm text-neutral-500">
                        {isOfflineMode
                          ? 'Confirm your registration details'
                          : 'Confirm your details before payment'}
                      </p>
                    </div>

                    <div className="space-y-4">
                      {players.map((player, index) => (
                        <div key={index} className="p-4 bg-neutral-100 rounded-2xl">
                          <p className="text-xs font-medium text-neutral-400 uppercase tracking-wider mb-1.5">
                            {index === 0
                              ? isIndividual
                                ? 'Player'
                                : 'Team Captain (Player 1)'
                              : `Player ${index + 1}`}
                          </p>
                          <p className="font-medium text-neutral-900">{player.name}</p>
                          {player.email && <p className="text-sm text-neutral-600">{player.email}</p>}
                          {player.phone && player.phone !== '+1671' && (
                            <p className="text-sm text-neutral-600">{player.phone}</p>
                          )}
                          {(player.tshirt_size || player.handicap) && (
                            <p className="text-xs text-neutral-500 mt-1">
                              {[
                                player.tshirt_size ? `Shirt: ${player.tshirt_size}` : null,
                                player.handicap ? `Handicap: ${player.handicap}` : null,
                              ]
                                .filter(Boolean)
                                .join(' • ')}
                            </p>
                          )}
                        </div>
                      ))}

                      <div className="p-4 bg-neutral-100 rounded-2xl space-y-2">
                        {!isIndividual && (
                          <div className="flex justify-between items-baseline">
                            <span className="text-sm text-neutral-500">Team Name</span>
                            <span className="font-medium text-neutral-900">{displayTeamName}</span>
                          </div>
                        )}
                        {teamCategory && (
                          <div className="flex justify-between items-baseline">
                            <span className="text-sm text-neutral-500">Category</span>
                            <span className="font-medium text-neutral-900">{teamCategory}</span>
                          </div>
                        )}
                        <div className="flex justify-between items-baseline">
                          <span className="text-sm text-neutral-500">Players</span>
                          <span className="font-medium text-neutral-900">{players.length}</span>
                        </div>
                        <div className="flex justify-between items-baseline">
                          <span className="text-sm text-neutral-500">Entry Fee</span>
                          <span className="text-lg font-bold text-neutral-900">
                            {isEmployeeValidated ? (
                              <span className="inline-flex items-baseline gap-2">
                                {employeeSavingsCents > 0 && (
                                  <span className="text-sm font-normal text-neutral-400 line-through">
                                    {formatUsdFromCents(tournament.entry_fee || 0)}
                                  </span>
                                )}
                                <span className="text-green-700">{formatUsdFromCents(effectiveFeeCents)}</span>
                              </span>
                            ) : (
                              formatEntryFeeDisplay(tournament)
                            )}
                          </span>
                        </div>
                        {isEmployeeValidated && employeeValidation.employeeNumber && (
                          <div className="mt-2 flex items-center justify-between text-xs text-green-700">
                            <span className="inline-flex items-center gap-1 font-medium">
                              <BadgeCheck className="h-3.5 w-3.5" />
                              Employee Discount ({employeeValidation.employeeNumber})
                            </span>
                            {employeeSavingsCents > 0 && (
                              <span>-{formatUsdFromCents(employeeSavingsCents)}</span>
                            )}
                          </div>
                        )}
                      </div>

                      {availableAddOns.length > 0 && (
                        <div className="p-4 bg-amber-50/70 border border-amber-200 rounded-2xl space-y-3" data-testid="registration-addons-section">
                          <div className="flex items-center gap-2">
                            <Sparkles className="w-4 h-4 text-amber-600 shrink-0" />
                            <div>
                              <h3 className="text-sm font-semibold text-neutral-900">
                                Optional Add-Ons &amp; Super Tickets
                              </h3>
                              <p className="text-xs text-neutral-600">
                                Pre-order mulligans or super tickets now — ready for pickup at check-in.
                              </p>
                            </div>
                          </div>
                          <div className="space-y-2.5">
                            {availableAddOns.map((addOn) => {
                              const qty = selectedAddOns[addOn.id] || 0;
                              const cap = addOn.remaining_quantity != null
                                ? Math.min(addOn.max_quantity_per_order, addOn.remaining_quantity)
                                : addOn.max_quantity_per_order;
                              return (
                                <div
                                  key={addOn.id}
                                  className={`flex items-center justify-between gap-3 rounded-xl border bg-white p-3 transition-colors ${
                                    qty > 0 ? 'border-brand-500 ring-1 ring-brand-500/20' : 'border-neutral-200'
                                  }`}
                                >
                                  <div className="min-w-0 flex-1">
                                    <div className="flex flex-wrap items-center gap-2">
                                      <p className="text-sm font-semibold text-neutral-900">{addOn.name}</p>
                                      <span className="text-xs font-bold text-brand-700">
                                        {formatUsdFromCents(addOn.price_cents)}
                                      </span>
                                      {addOn.remaining_quantity != null && addOn.remaining_quantity <= 15 && (
                                        <span className="text-[11px] font-medium px-2 py-0.5 rounded-full bg-amber-100 text-amber-800">
                                          {addOn.remaining_quantity} left
                                        </span>
                                      )}
                                    </div>
                                    {addOn.description && (
                                      <p className="text-xs text-neutral-500 mt-0.5">{addOn.description}</p>
                                    )}
                                  </div>
                                  <div className="flex items-center gap-2 shrink-0">
                                    <button
                                      type="button"
                                      onClick={() => updateAddOnQuantity(addOn, -1)}
                                      disabled={qty <= 0}
                                      aria-label={`Remove ${addOn.name}`}
                                      className="inline-flex items-center justify-center w-9 h-9 rounded-lg border border-neutral-300 bg-white text-neutral-700 hover:bg-neutral-50 disabled:opacity-40"
                                    >
                                      <Minus className="w-4 h-4" />
                                    </button>
                                    <span className="w-6 text-center text-sm font-semibold text-neutral-900" data-testid={`addon-qty-${addOn.id}`}>
                                      {qty}
                                    </span>
                                    <button
                                      type="button"
                                      onClick={() => updateAddOnQuantity(addOn, 1)}
                                      disabled={qty >= cap}
                                      aria-label={`Add ${addOn.name}`}
                                      className="inline-flex items-center justify-center w-9 h-9 rounded-lg border border-brand-600 bg-brand-600 text-white hover:bg-brand-700 disabled:opacity-40"
                                    >
                                      <Plus className="w-4 h-4" />
                                    </button>
                                  </div>
                                </div>
                              );
                            })}
                          </div>
                        </div>
                      )}

                      <div className="p-4 bg-neutral-100 rounded-2xl space-y-1.5">
                        {selectedAddOnItems.length > 0 && (
                          <>
                            <div className="flex justify-between items-baseline text-sm text-neutral-600">
                              <span>Entry Fee</span>
                              <span>{formatUsdFromCents(totalDueCents)}</span>
                            </div>
                            {selectedAddOnItems.map(({ item, quantity }) => (
                              <div key={item.id} className="flex justify-between items-baseline text-sm text-neutral-600">
                                <span>{quantity}× {item.name}</span>
                                <span>{formatUsdFromCents(item.price_cents * quantity)}</span>
                              </div>
                            ))}
                            <div className="border-t border-neutral-200 pt-2 mt-1" />
                          </>
                        )}
                        <div className="flex justify-between items-baseline">
                          <span className="text-sm font-medium text-neutral-700">Total</span>
                          <span className="text-xl font-bold text-neutral-900" data-testid="registration-grand-total">
                            {formatUsdFromCents(grandTotalCents)}
                          </span>
                        </div>
                      </div>

                      <div className="bg-brand-600/5 rounded-2xl p-4">
                        <p className="text-sm text-neutral-600">
                          {isOfflineMode
                            ? tournament.payment_instructions ||
                              'No online payment is required right now. Payment will be collected offline or on tournament day.'
                            : 'You will be redirected to complete payment securely online.'}
                        </p>
                      </div>
                    </div>
                  </div>
                </div>
              )}
            </div>

            {/* Navigation Buttons */}
            <div className="flex items-center justify-between mt-6">
              {currentStep > 1 ? (
                <button
                  type="button"
                  onClick={handleBack}
                  className="inline-flex items-center gap-1 border border-neutral-300 text-neutral-700 font-medium text-sm rounded-full px-6 py-3 hover:bg-neutral-50 transition-colors min-h-[44px] w-full sm:w-auto justify-center"
                >
                  <ChevronLeft className="w-4 h-4" />
                  Back
                </button>
              ) : (
                <div />
              )}

              {currentStep < totalSteps ? (
                <button
                  type="button"
                  onClick={handleNext}
                  className="inline-flex items-center gap-1 bg-brand-600 hover:bg-brand-700 text-brand-foreground font-semibold text-sm rounded-full px-6 py-3 transition-colors min-h-[44px] w-full sm:w-auto justify-center"
                >
                  Next
                  <ChevronRight className="w-4 h-4" />
                </button>
              ) : (
                <button
                  type="button"
                  onClick={handleSubmit}
                  disabled={submitState !== 'idle'}
                  className={`inline-flex items-center gap-2 ${
                    anyAtCapacity && tournament.waitlist_enabled
                      ? 'bg-amber-500 hover:bg-amber-600 text-white'
                      : 'bg-brand-600 hover:bg-brand-700 text-brand-foreground'
                  } font-semibold text-sm rounded-full px-8 py-3 transition-colors min-h-[44px] w-full sm:w-auto justify-center ${
                    submitState !== 'idle' ? 'opacity-75 cursor-not-allowed' : ''
                  }`}
                >
                  {submitState === 'idle' && (
                    <>
                      {anyAtCapacity && tournament.waitlist_enabled
                        ? 'Join Waitlist'
                        : isOfflineMode
                          ? 'Complete Registration'
                          : 'Register & Pay'}
                      <ChevronRight className="w-4 h-4" />
                    </>
                  )}
                  {submitState === 'submitting' && (
                    <span className="flex items-center gap-2">
                      <Loader2 className="h-4 w-4 animate-spin" />
                      Submitting...
                    </span>
                  )}
                  {submitState === 'redirecting' && (
                    <span className="flex items-center gap-2">
                      <Loader2 className="h-4 w-4 animate-spin" />
                      Redirecting to payment...
                    </span>
                  )}
                </button>
              )}

              {submitState === 'redirecting' && paymentUrl && (
                <div className="mt-4 p-4 bg-brand-600/5 rounded-2xl text-center">
                  <p className="text-sm text-neutral-600 mb-2">
                    Registration complete! If you are not automatically redirected:
                  </p>
                  <a
                    href={paymentUrl}
                    className="inline-flex items-center gap-2 text-brand-600 font-semibold text-sm hover:underline"
                  >
                    <DollarSign className="w-4 h-4" />
                    Tap here to proceed to payment
                  </a>
                </div>
              )}
            </div>
          </div>

          {/* RIGHT — Sticky Summary Card */}
          <div className="order-first lg:order-last">
            <div className="sticky top-8">
              <div className="bg-white rounded-2xl shadow-lg border border-neutral-200 p-6">
                <h3 className="font-bold text-lg text-neutral-900 mb-4">Registration Summary</h3>

                <div className="space-y-3 mb-6">
                  <div className="flex items-start gap-3">
                    <Trophy className="w-5 h-5 mt-0.5 shrink-0 text-brand-600" strokeWidth={1.5} />
                    <div>
                      <p className="font-medium text-neutral-900 text-sm">{tournament.name}</p>
                    </div>
                  </div>
                  {tournament.event_date && (
                    <div className="flex items-center gap-3">
                      <Calendar className="w-5 h-5 shrink-0 text-brand-600" strokeWidth={1.5} />
                      <p className="text-sm text-neutral-600">{formatEventDate(tournament.event_date)}</p>
                    </div>
                  )}
                  {tournament.location_name && (
                    <div className="flex items-center gap-3">
                      <MapPin className="w-5 h-5 shrink-0 text-brand-600" strokeWidth={1.5} />
                      <p className="text-sm text-neutral-600">{tournament.location_name}</p>
                    </div>
                  )}
                </div>

                <div className="border-t border-neutral-100 pt-4 mb-6">
                  <div className="flex justify-between items-baseline mb-2">
                    <span className="text-neutral-500 text-sm">Entry Fee</span>
                    {isEmployeeValidated ? (
                      <div className="text-right">
                        {employeeSavingsCents > 0 && (
                          <span className="text-sm text-neutral-400 line-through mr-2">
                            {formatUsdFromCents(tournament.entry_fee || 0)}
                          </span>
                        )}
                        <span className="text-2xl font-bold text-green-700">
                          {formatUsdFromCents(effectiveFeeCents)}
                        </span>
                      </div>
                    ) : (
                      <span className="text-2xl font-bold text-neutral-900">
                        {formatEntryFeeDisplay(tournament)}
                      </span>
                    )}
                  </div>
                  {isEmployeeValidated ? (
                    <p className="inline-flex items-center gap-1 text-xs font-medium text-green-700">
                      <BadgeCheck className="h-3.5 w-3.5" />
                      Employee rate applied ({employeeValidation.employeeNumber})
                    </p>
                  ) : (
                    <p className="text-xs text-neutral-400">
                      {formatEntryUnitSubtitle(teamSize, allowPartialTeams, tournament.capacity_unit)}
                    </p>
                  )}

                  {selectedAddOnItems.length > 0 && (
                    <div className="mt-4 pt-3 border-t border-neutral-100 space-y-1.5">
                      <p className="text-xs font-medium text-neutral-500 uppercase tracking-wider">Add-Ons</p>
                      {selectedAddOnItems.map(({ item, quantity }) => (
                        <div key={item.id} className="flex justify-between text-xs text-neutral-700">
                          <span>{quantity}× {item.name}</span>
                          <span className="font-semibold">{formatUsdFromCents(item.price_cents * quantity)}</span>
                        </div>
                      ))}
                      <div className="flex justify-between items-baseline pt-2 border-t border-neutral-100">
                        <span className="text-xs font-semibold text-neutral-700">Order Total</span>
                        <span className="text-lg font-bold text-brand-700">{formatUsdFromCents(grandTotalCents)}</span>
                      </div>
                    </div>
                  )}

                  {capacitySummary.label && (
                    <div className="mt-4 space-y-1.5">
                      <p className="text-xs font-medium text-neutral-500 uppercase tracking-wider">Capacity</p>
                      <p className="text-sm text-neutral-600 leading-relaxed">{capacitySummary.label}</p>
                      {capacitySummary.secondaryLabel && (
                        <p className="text-xs text-neutral-400">{capacitySummary.secondaryLabel}</p>
                      )}
                    </div>
                  )}

                  {tournament.fee_includes && (
                    <div className="mt-4 space-y-1.5">
                      <p className="text-xs font-medium text-neutral-500 uppercase tracking-wider">Includes</p>
                      <p className="text-sm text-neutral-600 leading-relaxed">{tournament.fee_includes}</p>
                    </div>
                  )}

                  {tournament.tournament_info && (
                    <div className="mt-4 space-y-1.5">
                      <p className="text-xs font-medium text-neutral-500 uppercase tracking-wider">Tournament Info</p>
                      <p className="text-sm text-neutral-600 leading-relaxed whitespace-pre-line">
                        {tournament.tournament_info}
                      </p>
                    </div>
                  )}
                </div>

                {anyAtCapacity && tournament.waitlist_enabled ? (
                  <div className="bg-amber-50 border border-amber-200 rounded-2xl p-3">
                    <p className="text-xs text-amber-800 font-medium mb-1">Waitlist Registration</p>
                    <p className="text-xs text-amber-700">
                      {publicFull && !totalAtCapacity
                        ? 'Public registration is currently full. Your registration will be added to the waitlist and notified if sponsor-reserved or public spots open up. No payment is required until confirmed.'
                        : 'This event is at capacity. Your registration will be added to the waitlist and you will be notified if a spot opens up. No payment is required until confirmed.'}
                    </p>
                  </div>
                ) : (
                  <div className="bg-brand-600/5 rounded-2xl p-3">
                    <p className="text-xs text-neutral-600">
                      {isOfflineMode
                        ? tournament.payment_instructions ||
                          'Payment is collected offline (cash/check or organizer instructions).'
                        : 'You will be redirected to complete payment securely after submitting.'}
                    </p>
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Footer */}
      <footer className="border-t border-neutral-200 mt-12">
        <div className="max-w-6xl mx-auto px-6 py-8 flex items-center justify-between text-sm text-neutral-400">
          <p>
            Powered by <span className="font-medium text-neutral-600">Shimizu Technology</span>
          </p>
          <Link to="/admin" className="text-xs text-neutral-400 hover:text-neutral-600 transition-colors">
            Admin
          </Link>
        </div>
      </footer>
    </div>
  );
};
