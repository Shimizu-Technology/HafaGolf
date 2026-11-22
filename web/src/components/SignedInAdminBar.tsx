import React from 'react';
import { useNavigate } from 'react-router-dom';
import { LayoutDashboard } from 'lucide-react';
import { useClerkAuthBridge } from '../contexts/ClerkAuthBridge';
import { resolveBestDashboardPath } from '../utils/dashboardRouting';

interface SignedInAdminBarProps {
  dashboardPath?: string;
}

/**
 * Displays a quick jump bar back to the admin console when an admin is signed in.
 * Uses ClerkAuthBridgeContext so public client domain bundles never load or execute Clerk JS.
 */
export const SignedInAdminBar: React.FC<SignedInAdminBarProps> = ({ dashboardPath }) => {
  const navigate = useNavigate();
  const { isClerkAvailable, isSignedIn, isLoaded, getToken } = useClerkAuthBridge();

  if (!isClerkAvailable || !isLoaded || !isSignedIn) return null;

  const goToBestDashboard = async () => {
    const path = await resolveBestDashboardPath(getToken, dashboardPath);
    navigate(path);
  };

  return (
    <div className="relative z-20 bg-brand-700 text-white py-2 px-3 md:px-4">
      <div className="max-w-6xl mx-auto flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 min-w-0">
          <LayoutDashboard size={16} className="flex-shrink-0" />
          <span className="text-xs md:text-sm truncate">
            Signed in as <strong className="font-semibold">Admin</strong>
          </span>
        </div>
        <div className="flex items-center gap-2 md:gap-4 flex-shrink-0">
          <button
            onClick={goToBestDashboard}
            className="text-xs md:text-sm hover:underline whitespace-nowrap"
          >
            Go to Dashboard
          </button>
        </div>
      </div>
    </div>
  );
};
