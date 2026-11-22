import React, { useEffect } from 'react';
import { SignIn, useAuth } from '@clerk/clerk-react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Flag } from 'lucide-react';

export const AdminLoginPage: React.FC = () => {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { isSignedIn, isLoaded } = useAuth();
  const requestedOrg = searchParams.get('org');
  const postLoginTarget = requestedOrg ? `/admin?org=${encodeURIComponent(requestedOrg)}` : '/admin';

  useEffect(() => {
    if (isLoaded && isSignedIn) {
      navigate(postLoginTarget, { replace: true });
    }
  }, [isSignedIn, isLoaded, navigate, postLoginTarget]);

  if (!isLoaded) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gradient-to-b from-brand-50 to-white">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-brand-600"></div>
      </div>
    );
  }

  if (isSignedIn) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gradient-to-b from-brand-50 to-white">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-brand-600 mx-auto mb-4"></div>
          <p className="text-gray-600">Redirecting to dashboard...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-b from-brand-50 to-white flex items-center justify-center py-12 px-4">
      <div className="max-w-md w-full">
        <div className="text-center mb-8">
          <div className="flex justify-center items-center mb-4">
            <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-brand-600 text-brand-foreground shadow-sm">
              <Flag className="h-6 w-6" />
            </div>
          </div>
          <h1 className="text-3xl font-bold text-brand-800 mb-2">
            Admin Console
          </h1>
          <p className="text-gray-600">
            HafaGolf Tournament Administration
          </p>
        </div>

        <div className="flex justify-center">
          <SignIn
            forceRedirectUrl={postLoginTarget}
            signUpForceRedirectUrl={postLoginTarget}
            appearance={{
              elements: {
                rootBox: 'w-full',
                card: 'shadow-lg rounded-lg',
                headerTitle: 'text-brand-800',
                headerSubtitle: 'text-gray-600',
                socialButtonsBlockButton: 'border-gray-300 hover:bg-gray-50',
                formButtonPrimary: 'bg-brand-600 hover:bg-brand-700',
                footerActionLink: 'text-brand-600 hover:text-brand-700',
              },
            }}
          />
        </div>
      </div>
    </div>
  );
};
