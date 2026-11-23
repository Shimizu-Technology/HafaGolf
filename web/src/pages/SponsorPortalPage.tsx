import React, { useState, useEffect, useCallback } from 'react';
import { useSearchParams } from 'react-router-dom';
import { CheckCircle, ArrowRight, AlertCircle, Shield, Flag } from 'lucide-react';
import toast from 'react-hot-toast';
import { useOrganization } from '../components/OrganizationProvider';
import { SponsorPortalDashboard } from '../components/sponsors/SponsorPortalDashboard';
import { toVerifiedPortalData, type VerifiedSponsorPortalData } from '../components/sponsors/sponsorPortalTypes';
import {
  clearSponsorPortalSession,
  loadSponsorPortalSession,
  saveSponsorPortalSession,
} from './sponsorPortalSession';

const API_URL = import.meta.env.VITE_API_URL;

// ---------------------------------------------------------------------------
// Login Screen
// ---------------------------------------------------------------------------
const LoginScreen: React.FC = () => {
  const { organization } = useOrganization();
  const [email, setEmail] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [linkSent, setLinkSent] = useState(false);
  const orgName = organization?.name || 'HafaGolf';

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email.trim()) { toast.error('Please enter your email address'); return; }
    setIsSubmitting(true);
    try {
      const res = await fetch(`${API_URL}/api/v1/sponsor_access/request_link`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: email.trim() }),
      });
      if (res.ok) { setLinkSent(true); toast.success('Check your email for an access link!'); }
      else { const data = await res.json().catch(() => null); toast.error(data?.error || 'Could not send access link.'); }
    } catch { toast.error('Something went wrong. Please try again.'); }
    finally { setIsSubmitting(false); }
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-[#f0f4f8] to-[#e2e8f0] flex flex-col">
      {/* Minimal header */}
      <header className="px-6 py-5">
        <div className="max-w-md mx-auto flex items-center gap-3">
          {organization?.logo_url ? (
            <img src={organization.logo_url} alt={orgName} className="h-8 w-auto rounded object-contain" />
          ) : (
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-brand-600 text-brand-foreground">
              <Flag className="h-4 w-4" />
            </div>
          )}
          <div>
            <div className="font-bold text-gray-900 text-sm">Sponsor Portal</div>
            <div className="text-gray-500 text-xs">{orgName}</div>
          </div>
        </div>
      </header>

      <main className="flex-1 flex items-center justify-center px-6 pb-12">
        <div className="w-full max-w-md">
          {!linkSent ? (
            <div className="bg-white rounded-2xl shadow-lg border border-gray-100 overflow-hidden">
              {/* Branded top accent */}
              <div className="h-1.5 bg-gradient-to-r from-brand-600 to-brand-800" />
              <div className="p-8">
                <div className="text-center mb-8">
                  <div className="w-14 h-14 bg-brand-600/10 rounded-2xl flex items-center justify-center mx-auto mb-4">
                    <Shield className="w-7 h-7 text-brand-600" />
                  </div>
                  <h1 className="text-2xl font-bold text-gray-900 mb-2">Sponsor Portal Login</h1>
                  <p className="text-gray-500 text-sm leading-relaxed">
                    Enter the email address associated with your sponsorship. We'll send you a secure access link.
                  </p>
                </div>

                <form onSubmit={handleSubmit} className="space-y-5">
                  <div>
                    <label htmlFor="email" className="block text-sm font-medium text-gray-700 mb-1.5">
                      Sponsor Email
                    </label>
                    <input
                      type="email" id="email" value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      placeholder="your@company.com"
                      className="w-full px-4 py-3 border border-gray-200 rounded-xl focus:ring-2 focus:ring-brand-600/20 focus:border-brand-600 text-base"
                      disabled={isSubmitting} autoComplete="email" autoFocus
                    />
                  </div>
                  <button
                    type="submit" disabled={isSubmitting || !email.trim()}
                    className="w-full bg-brand-600 hover:bg-brand-700 disabled:bg-gray-300 disabled:cursor-not-allowed text-brand-foreground min-h-[48px] py-3 px-6 rounded-xl font-semibold text-base flex items-center justify-center gap-2"
                  >
                    {isSubmitting ? 'Sending…' : (<>Send Access Link <ArrowRight className="w-4 h-4" /></>)}
                  </button>
                </form>

                <p className="mt-6 text-center text-xs text-gray-400">
                  The link will be valid for 7 days. Contact your event organizer if you need help.
                </p>
              </div>
            </div>
          ) : (
            <div className="bg-white rounded-2xl shadow-lg border border-gray-100 overflow-hidden">
              <div className="h-1.5 bg-gradient-to-r from-green-500 to-emerald-500" />
              <div className="p-8 text-center">
                <div className="w-14 h-14 bg-green-50 rounded-2xl flex items-center justify-center mx-auto mb-4">
                  <CheckCircle className="w-7 h-7 text-green-600" />
                </div>
                <h2 className="text-xl font-bold text-gray-900 mb-2">Check Your Email</h2>
                <p className="text-gray-500 text-sm mb-6">
                  We've sent an access link to <strong className="text-gray-700">{email}</strong>. Click the link in the email to access your portal.
                </p>
                <div className="bg-amber-50 border border-amber-200 rounded-xl p-3 mb-6 text-left">
                  <p className="text-xs text-amber-700">
                    <strong>Don't see it?</strong> Check your spam/junk folder, or wait a minute and try again.
                  </p>
                </div>
                <button onClick={() => { setLinkSent(false); setEmail(''); }} className="text-sm text-brand-600 hover:underline font-medium">
                  Try a different email
                </button>
              </div>
            </div>
          )}
        </div>
      </main>
    </div>
  );
};

// ---------------------------------------------------------------------------
// Shared confirm helper — calls POST /confirm and returns full data
// ---------------------------------------------------------------------------
async function confirmAccess(token: string, email: string): Promise<
  { ok: true; data: VerifiedSponsorPortalData }
  | { ok: false; error: string }
> {
  try {
    const res = await fetch(`${API_URL}/api/v1/sponsor_access/confirm`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token, email }),
    });
    const data = await res.json();
    if (!res.ok) return { ok: false, error: data.error || 'Verification failed.' };
    return { ok: true, data: toVerifiedPortalData(data) };
  } catch {
    return { ok: false, error: 'Something went wrong. Please try again.' };
  }
}

// ---------------------------------------------------------------------------
// Email Verification Gate — shown after clicking magic link, before dashboard
// ---------------------------------------------------------------------------
const EmailVerification: React.FC<{
  token: string;
  sponsorName: string;
  onVerified: (data: VerifiedSponsorPortalData) => void;
}> = ({ token, sponsorName, onVerified }) => {
  const { organization } = useOrganization();
  const [email, setEmail] = useState('');
  const [verifying, setVerifying] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');
  const orgName = organization?.name || 'HafaGolf';

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email.trim()) return;
    setVerifying(true);
    setErrorMsg('');

    const result = await confirmAccess(token, email.trim());
    if (!result.ok) {
      setErrorMsg(result.error);
      setVerifying(false);
      return;
    }

    saveSponsorPortalSession(token, result.data);
    onVerified(result.data);
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-[#f0f4f8] to-[#e2e8f0] flex flex-col">
      <header className="px-6 py-5">
        <div className="max-w-md mx-auto flex items-center gap-3">
          {organization?.logo_url ? (
            <img src={organization.logo_url} alt={orgName} className="h-8 w-auto rounded object-contain" />
          ) : (
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-brand-600 text-brand-foreground">
              <Flag className="h-4 w-4" />
            </div>
          )}
          <div>
            <div className="font-bold text-gray-900 text-sm">Sponsor Portal</div>
            <div className="text-gray-500 text-xs">{orgName}</div>
          </div>
        </div>
      </header>

      <main className="flex-1 flex items-center justify-center px-6 pb-12">
        <div className="w-full max-w-md">
          <div className="bg-white rounded-2xl shadow-lg border border-gray-100 overflow-hidden">
            <div className="h-1.5 bg-gradient-to-r from-brand-600 to-brand-800" />
            <div className="p-8">
              <div className="text-center mb-6">
                <div className="w-14 h-14 bg-brand-600/10 rounded-2xl flex items-center justify-center mx-auto mb-4">
                  <Shield className="w-7 h-7 text-brand-600" />
                </div>
                <h1 className="text-xl font-bold text-gray-900 mb-1">Verify Your Identity</h1>
                <p className="text-gray-500 text-sm leading-relaxed">
                  Welcome, <strong className="text-gray-700">{sponsorName}</strong>. For security, please confirm your email address to access the portal.
                </p>
              </div>

              <form onSubmit={handleSubmit} className="space-y-4">
                <div>
                  <label htmlFor="verify-email" className="block text-sm font-medium text-gray-700 mb-1.5">
                    Sponsor Email Address
                  </label>
                  <input
                    type="email" id="verify-email" value={email}
                    onChange={(e) => { setEmail(e.target.value); setErrorMsg(''); }}
                    placeholder="your@company.com"
                    className={`w-full px-4 py-3 border rounded-xl focus:ring-2 focus:ring-brand-600/20 focus:border-brand-600 text-base ${
                      errorMsg ? 'border-red-300' : 'border-gray-200'
                    }`}
                    disabled={verifying} autoComplete="email" autoFocus
                  />
                  {errorMsg && (
                    <p className="mt-2 text-sm text-red-600 flex items-start gap-1.5">
                      <AlertCircle className="w-4 h-4 flex-shrink-0 mt-0.5" />
                      {errorMsg}
                    </p>
                  )}
                </div>

                <button
                  type="submit" disabled={verifying || !email.trim()}
                  className="w-full bg-brand-600 hover:bg-brand-700 disabled:bg-gray-300 disabled:cursor-not-allowed text-brand-foreground min-h-[48px] py-3 px-6 rounded-xl font-semibold text-base flex items-center justify-center gap-2"
                >
                  {verifying ? 'Verifying…' : (<><Shield className="w-4 h-4" /> Verify & Continue</>)}
                </button>
              </form>

              <p className="mt-5 text-center text-xs text-gray-400">
                Enter the email address your organization used to set up this sponsorship.
              </p>
            </div>
          </div>
        </div>
      </main>
    </div>
  );
};

// ---------------------------------------------------------------------------
// Authenticated Flow — verify token, then email gate, then dashboard
// ---------------------------------------------------------------------------
const AuthenticatedFlow: React.FC<{ token: string }> = ({ token }) => {
  type Phase = 'loading' | 'email_verify' | 'dashboard' | 'error';
  const [phase, setPhase] = useState<Phase>('loading');
  const [sponsorName, setSponsorName] = useState('');
  const [error, setError] = useState('');
  const [verifiedData, setVerifiedData] = useState<VerifiedSponsorPortalData | null>(null);

  const handleSessionExpired = useCallback(() => {
    clearSponsorPortalSession(token);
    setSponsorName((prev) => prev || verifiedData?.sponsor.name || 'Sponsor');
    setVerifiedData(null);
    setPhase('email_verify');
    toast.error('Your sponsor session expired. Please verify your email again.');
  }, [token, verifiedData?.sponsor.name]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const savedSession = loadSponsorPortalSession<VerifiedSponsorPortalData>(token);
      if (savedSession) {
        if (!cancelled) {
          setVerifiedData(savedSession);
          setSponsorName(savedSession.sponsor.name);
          setPhase('dashboard');
        }
        return;
      }

      if (cancelled) return;

      try {
        const res = await fetch(`${API_URL}/api/v1/sponsor_access/verify?token=${encodeURIComponent(token)}`);
        if (!res.ok) {
          if (!cancelled) { setError('Invalid or expired access link. Please request a new one.'); setPhase('error'); }
          return;
        }
        const data = await res.json();
        if (!cancelled) {
          setSponsorName(data.sponsor_name || 'Sponsor');
          setPhase('email_verify');
        }
      } catch {
        if (!cancelled) { setError('Could not verify your access link. Please try again.'); setPhase('error'); }
      }
    })();
    return () => { cancelled = true; };
  }, [token]);

  if (phase === 'loading') {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-[#f0f4f8] to-[#e2e8f0]">
        <div className="text-center">
          <p className="text-gray-600 text-base">Checking your access link…</p>
        </div>
      </div>
    );
  }

  if (phase === 'error') {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-[#f0f4f8] to-[#e2e8f0] px-6">
        <div className="bg-white rounded-2xl shadow-lg border border-red-100 p-8 max-w-md w-full text-center">
          <AlertCircle className="w-10 h-10 text-red-500 mx-auto mb-3" />
          <h2 className="font-bold text-gray-900 text-lg mb-2">Access Denied</h2>
          <p className="text-gray-500 text-sm mb-6">{error}</p>
          <a href="/sponsor-portal" className="inline-flex items-center gap-2 text-brand-600 font-medium text-sm hover:underline">
            <ArrowRight className="w-4 h-4 rotate-180" /> Request a new link
          </a>
        </div>
      </div>
    );
  }

  if (phase === 'email_verify') {
    return (
      <EmailVerification
        token={token}
        sponsorName={sponsorName}
        onVerified={(data) => {
          setVerifiedData(data);
          setPhase('dashboard');
        }}
      />
    );
  }

  if (phase === 'dashboard' && verifiedData) {
    return (
      <SponsorPortalDashboard
        key={verifiedData.sponsor.id}
        sessionToken={verifiedData.sessionToken}
        initialSponsor={verifiedData.sponsor}
        initialTournament={verifiedData.tournament}
        initialOrg={verifiedData.organization}
        onSessionExpired={handleSessionExpired}
        onSwitchSponsorship={(data) => {
          saveSponsorPortalSession(token, data);
          setVerifiedData(data);
          setSponsorName(data.sponsor.name);
          window.scrollTo({ top: 0 });
        }}
      />
    );
  }

  return null;
};

// ---------------------------------------------------------------------------
// Main Page
// ---------------------------------------------------------------------------
export const SponsorPortalPage: React.FC = () => {
  const [searchParams] = useSearchParams();
  const token = searchParams.get('token');

  return token ? <AuthenticatedFlow token={token} /> : <LoginScreen />;
};

export default SponsorPortalPage;
