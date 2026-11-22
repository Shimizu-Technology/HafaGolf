import { useCallback, useContext } from 'react';
import { ClerkAuthBridgeContext } from '../contexts/ClerkAuthBridge';
import { GolferAuthContext } from '../contexts/GolferAuthContext';

/**
 * Hook that provides an auth token from either:
 * 1. Clerk (only when mounted inside the lazy-loaded AdminRoutesApp)
 * 2. Golfer session (for golfers accessing their scorecard on public client domains)
 *
 * Imports ZERO Clerk code so public client domain bundles stay completely Clerk-free.
 */
export function useAuthToken() {
  const { getToken: getClerkToken, isSignedIn: isClerkSignedIn } = useContext(ClerkAuthBridgeContext);

  const golferContext = useContext(GolferAuthContext);
  const isGolferAuthenticated = golferContext?.isAuthenticated ?? false;
  const golferToken = golferContext?.token ?? null;

  const authType = isClerkSignedIn ? 'clerk' : isGolferAuthenticated ? 'golfer' : null;
  const isAuthenticated = isClerkSignedIn || isGolferAuthenticated;

  const getToken = useCallback(async (): Promise<string | null> => {
    if (isClerkSignedIn) {
      try {
        return await getClerkToken();
      } catch (error) {
        console.error('Failed to get Clerk token:', error);
        return null;
      }
    }

    if (isGolferAuthenticated && golferToken) {
      return golferToken;
    }

    return null;
  }, [isClerkSignedIn, getClerkToken, isGolferAuthenticated, golferToken]);

  return {
    getToken,
    isAuthenticated,
    authType,
    isClerkAuth: !!isClerkSignedIn,
    isGolferAuth: isGolferAuthenticated && !isClerkSignedIn,
  };
}

export default useAuthToken;
