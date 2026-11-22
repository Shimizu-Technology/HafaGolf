import { createContext, useContext } from 'react';

export interface ClerkAuthBridgeValue {
  isClerkAvailable: boolean;
  isSignedIn: boolean;
  isLoaded: boolean;
  getToken: () => Promise<string | null>;
}

export const defaultClerkAuthBridge: ClerkAuthBridgeValue = {
  isClerkAvailable: false,
  isSignedIn: false,
  isLoaded: true,
  getToken: async () => null,
};

export const ClerkAuthBridgeContext = createContext<ClerkAuthBridgeValue>(defaultClerkAuthBridge);

export function useClerkAuthBridge() {
  return useContext(ClerkAuthBridgeContext);
}
