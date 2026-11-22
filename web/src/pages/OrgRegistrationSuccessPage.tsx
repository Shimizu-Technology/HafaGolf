import { useEffect } from 'react';
import { Link, useLocation, useParams, useNavigate } from 'react-router-dom';
import { useOrganization } from '../components/OrganizationProvider';
import { CheckCircle, Calendar, MapPin, Mail, CreditCard, ArrowLeft, Share2, Check, Users, Clock } from 'lucide-react';
import { Button, Card } from '../components/ui';
import confetti from 'canvas-confetti';
import { formatEventDate } from '../utils/dates';
import { SignedInAdminBar } from '../components/SignedInAdminBar';
import { useApplyBranding } from '../utils/branding';
import { getDefaultOrgSlug } from '../utils/tenant';

export function OrgRegistrationSuccessPage() {
  const { tournamentSlug } = useParams<{ tournamentSlug: string }>();
  const { organization } = useOrganization();
  const orgSlug = organization?.slug || getDefaultOrgSlug();
  const location = useLocation();
  const navigate = useNavigate();
  
  const { golfer, registration, tournament, paymentPending, paymentComplete, swipeSimpleRedirect, waitlisted } = location.state || {};
  useApplyBranding(organization, tournament);

  const externalPaymentUrl: string | undefined = tournament?.swipe_simple_url;
  const amountDueCents: number | null =
    typeof registration?.payment_amount_cents === 'number'
      ? registration.payment_amount_cents
      : typeof registration?.expected_entry_fee_cents === 'number'
        ? registration.expected_entry_fee_cents
        : typeof tournament?.entry_fee === 'number'
          ? tournament.entry_fee
          : null;
  const formattedAmountDue =
    amountDueCents !== null ? `$${(amountDueCents / 100).toFixed(2)}` : `$${tournament?.entry_fee_dollars?.toFixed(2) || '0.00'}`;
  const teamMembers: Array<{ id?: number; name: string; email?: string | null; is_captain?: boolean; position?: number }> =
    Array.isArray(registration?.team_members) ? registration.team_members : [];

  useEffect(() => {
    if (waitlisted) return;
    confetti({ particleCount: 100, spread: 70, origin: { y: 0.6 } });
    setTimeout(() => {
      confetti({ particleCount: 50, angle: 60, spread: 55, origin: { x: 0 } });
      confetti({ particleCount: 50, angle: 120, spread: 55, origin: { x: 1 } });
    }, 250);
  }, [waitlisted]);

  useEffect(() => {
    if (!tournament && !golfer) {
      navigate(`/${tournamentSlug}`);
    }
  }, [tournament, golfer, navigate, orgSlug, tournamentSlug]);

  if (!tournament) {
    return null;
  }

  return (
    <div className="min-h-screen bg-white flex flex-col">
      <SignedInAdminBar />

      {/* Hero header — branded gradient matching public pages */}
      <header className="relative text-brand-foreground overflow-hidden">
        <div className="absolute inset-0 bg-gradient-to-br from-brand-600 via-brand-700 to-brand-900" />
        <div className="relative max-w-2xl mx-auto px-4 py-10 sm:py-14 text-center">
          {waitlisted ? (
            <>
              <div className="inline-flex items-center justify-center w-16 h-16 rounded-full bg-white/15 mb-5">
                <Clock className="h-8 w-8" />
              </div>
              <h1 className="text-2xl sm:text-3xl font-bold mb-2">You're on the Waitlist</h1>
              <p className="text-base sm:text-lg text-white/80 max-w-md mx-auto">
                We've added your team to the waitlist for {tournament.name}
              </p>
            </>
          ) : (
            <>
              <div className="inline-flex items-center justify-center w-16 h-16 rounded-full bg-white/15 mb-5">
                <CheckCircle className="h-8 w-8" />
              </div>
              <h1 className="text-2xl sm:text-3xl font-bold mb-2">You're Registered!</h1>
              <p className="text-base sm:text-lg text-white/80 max-w-md mx-auto">
                Your team is confirmed for {tournament.name}
              </p>
            </>
          )}
        </div>
      </header>

      {/* Main Content */}
      <main className="flex-1 max-w-2xl mx-auto w-full px-4 py-8 -mt-4">
        {/* Registration Details Card */}
        <Card className="p-5 sm:p-6 mb-5">
          <h2 className="font-bold text-lg mb-4 text-neutral-900">Registration Details</h2>
          
          {(golfer || registration) && (
            <div className="bg-neutral-50 rounded-xl p-4 mb-5">
              {(registration?.display_team_name || golfer?.team_name || golfer?.partner_name) && (
                <div className="flex items-center gap-2 mb-3 pb-3 border-b border-neutral-200">
                  <Users size={16} className="text-brand-600" />
                  <p className="font-semibold text-neutral-900">
                    {registration?.display_team_name || golfer?.team_name || `${golfer?.name} & ${golfer?.partner_name}`}
                  </p>
                </div>
              )}
              {teamMembers.length > 0 ? (
                <div className="space-y-2.5">
                  {teamMembers.map((member, index) => (
                    <div key={member.id ?? index}>
                      <p className="text-xs font-medium text-neutral-400 uppercase tracking-wider">
                        {index === 0
                          ? teamMembers.length === 1
                            ? 'Player'
                            : 'Team Captain'
                          : `Player ${index + 1}`}
                      </p>
                      <p className="font-medium text-neutral-900">{member.name}</p>
                      {member.email && (
                        <p className="text-neutral-500 flex items-center gap-1.5 text-sm mt-0.5">
                          <Mail size={14} />
                          {member.email}
                        </p>
                      )}
                    </div>
                  ))}
                </div>
              ) : (
                <div className="space-y-2">
                  <div>
                    <p className="text-xs font-medium text-neutral-400 uppercase tracking-wider">Team Captain</p>
                    <p className="font-medium text-neutral-900">{golfer?.name}</p>
                    {golfer?.email && (
                      <p className="text-neutral-500 flex items-center gap-1.5 text-sm mt-0.5">
                        <Mail size={14} />
                        {golfer.email}
                      </p>
                    )}
                  </div>
                  {golfer?.partner_name && (
                    <div>
                      <p className="text-xs font-medium text-neutral-400 uppercase tracking-wider">Playing Partner</p>
                      <p className="font-medium text-neutral-900">{golfer.partner_name}</p>
                    </div>
                  )}
                </div>
              )}
            </div>
          )}

          <div className="space-y-4">
            <div className="flex items-start gap-3">
              <Calendar className="text-neutral-400 mt-1" size={20} />
              <div>
                <p className="font-medium text-neutral-900">{tournament.event_date || 'Date TBA'}</p>
                {tournament.registration_time && (
                  <p className="text-neutral-500 text-sm">Registration: {tournament.registration_time}</p>
                )}
                {tournament.start_time && (
                  <p className="text-neutral-500 text-sm">Start: {tournament.start_time}</p>
                )}
              </div>
            </div>

            {tournament.location_name && (
              <div className="flex items-start gap-3">
                <MapPin className="text-neutral-400 mt-1" size={20} />
                <div>
                  <p className="font-medium text-neutral-900">{tournament.location_name}</p>
                  {tournament.location_address && (
                    <p className="text-neutral-500 text-sm">{tournament.location_address}</p>
                  )}
                </div>
              </div>
            )}
          </div>
        </Card>

        {waitlisted ? (
          <>
            {/* Waitlist Info Card */}
            <Card className="p-5 sm:p-6 mb-5">
              <div className="bg-brand-600/5 border border-brand-600/15 rounded-xl p-4">
                <h3 className="font-semibold text-brand-600 mb-2">What does this mean?</h3>
                <p className="text-sm text-neutral-600 leading-relaxed">
                  The event is currently at capacity. Your team has been added to the waitlist.
                  If a spot opens up, we'll notify you by email with a link to complete your registration and payment.
                  No payment is required at this time.
                </p>
              </div>
            </Card>

            {/* What's Next Card */}
            <Card className="p-5 sm:p-6 mb-5">
              <h3 className="font-bold mb-4 text-neutral-900">What's Next?</h3>
              <ul className="space-y-3 text-neutral-600">
                <li className="flex items-start gap-3">
                  <span className="bg-brand-600/10 text-brand-600 rounded-full w-6 h-6 flex items-center justify-center text-sm font-semibold flex-shrink-0">1</span>
                  <span>Check your email for a waitlist confirmation</span>
                </li>
                <li className="flex items-start gap-3">
                  <span className="bg-brand-600/10 text-brand-600 rounded-full w-6 h-6 flex items-center justify-center text-sm font-semibold flex-shrink-0">2</span>
                  <span>We'll email you if a spot opens up</span>
                </li>
                <li className="flex items-start gap-3">
                  <span className="bg-brand-600/10 text-brand-600 rounded-full w-6 h-6 flex items-center justify-center text-sm font-semibold flex-shrink-0">3</span>
                  <span>If promoted, you'll receive a payment link to confirm your spot</span>
                </li>
              </ul>
            </Card>
          </>
        ) : (
          <>
            {/* Payment Status Card */}
            <Card className="p-5 sm:p-6 mb-5">
              <div className="flex items-start gap-3">
                <CreditCard className="text-neutral-400 mt-1" size={20} />
                <div className="flex-1">
                  <h3 className="font-bold mb-2 text-neutral-900">Payment Status</h3>
                  
                  {swipeSimpleRedirect ? (
                    <div className="bg-brand-600/5 text-neutral-700 p-3 rounded-lg">
                      <p className="font-medium">Registration submitted! Complete your payment using the checkout link.</p>
                      {externalPaymentUrl && (
                        <p className="text-sm mt-2">
                          If the payment window did not open, <a href={externalPaymentUrl} target="_blank" rel="noopener noreferrer" className="underline font-medium text-brand-600">click here to pay</a>.
                        </p>
                      )}
                    </div>
                  ) : paymentComplete ? (
                    <div className="bg-green-50 text-green-800 p-3 rounded-lg">
                      <p className="font-medium flex items-center gap-1"><Check className="w-4 h-4" /> Payment Complete</p>
                      <p className="text-sm">Thank you! Your payment has been processed.</p>
                    </div>
                  ) : paymentPending ? (
                    <div className="bg-yellow-50 text-yellow-800 p-3 rounded-lg">
                      <p className="font-medium">Payment Due on Tournament Day</p>
                      <p className="text-sm">
                        Please bring {formattedAmountDue}
                        {tournament.allow_cash && tournament.allow_check 
                          ? ' (cash or check)'
                          : tournament.allow_cash 
                          ? ' (cash)'
                          : tournament.allow_check
                          ? ' (check)'
                          : ''}
                      </p>
                      {tournament.checks_payable_to && (
                        <p className="text-sm mt-1">
                          Checks payable to: {tournament.checks_payable_to}
                        </p>
                      )}
                    </div>
                  ) : (
                    <div className="bg-neutral-50 text-neutral-600 p-3 rounded-lg">
                      <p className="text-sm">Payment status will be confirmed via email.</p>
                    </div>
                  )}
                </div>
              </div>
            </Card>

            {/* What's Next Card */}
            <Card className="p-5 sm:p-6 mb-5">
              <h3 className="font-bold mb-4 text-neutral-900">What's Next?</h3>
              <ul className="space-y-3 text-neutral-600">
                <li className="flex items-start gap-3">
                  <span className="bg-brand-600/10 text-brand-600 rounded-full w-6 h-6 flex items-center justify-center text-sm font-semibold flex-shrink-0">1</span>
                  <span>Check your email for a confirmation message</span>
                </li>
                <li className="flex items-start gap-3">
                  <span className="bg-brand-600/10 text-brand-600 rounded-full w-6 h-6 flex items-center justify-center text-sm font-semibold flex-shrink-0">2</span>
                  <span>Mark your calendar for {formatEventDate(tournament.event_date)}</span>
                </li>
                <li className="flex items-start gap-3">
                  <span className="bg-brand-600/10 text-brand-600 rounded-full w-6 h-6 flex items-center justify-center text-sm font-semibold flex-shrink-0">3</span>
                  <span>
                    Arrive at {tournament.location_name || 'the venue'} by {tournament.registration_time || 'the registration time'}
                  </span>
                </li>
                {paymentPending && (
                  <li className="flex items-start gap-3">
                    <span className="bg-yellow-100 text-yellow-800 rounded-full w-6 h-6 flex items-center justify-center text-sm font-medium flex-shrink-0">4</span>
                    <span>Bring payment: {formattedAmountDue}</span>
                  </li>
                )}
              </ul>
            </Card>
          </>
        )}

        {/* Action Buttons */}
        <div className="flex flex-col sm:flex-row gap-3">
          <Link to={`/${tournamentSlug}`} className="flex-1">
            <Button variant="outline" className="w-full">
              <ArrowLeft size={18} className="mr-2" />
              Back to Event
            </Button>
          </Link>
          <Button 
            className="flex-1"
            onClick={() => {
              if (navigator.share) {
                navigator.share({
                  title: tournament.name,
                  text: `I just registered for ${tournament.name}!`,
                  url: window.location.origin + `/${tournamentSlug}`,
                });
              }
            }}
          >
            <Share2 size={18} className="mr-2" />
            Share
          </Button>
        </div>
      </main>

      {/* Footer — matches site footer style */}
      <footer className="border-t border-neutral-200 py-6 px-4 mt-8">
        <div className="max-w-2xl mx-auto text-center">
          <p className="text-sm text-neutral-400">
            Powered by <span className="font-semibold text-neutral-500">Shimizu Technology</span>
          </p>
        </div>
      </footer>
    </div>
  );
}
