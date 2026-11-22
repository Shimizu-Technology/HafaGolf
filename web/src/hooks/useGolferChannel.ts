import { useEffect, useRef, useCallback, useState } from 'react';
import { createConsumer } from '@rails/actioncable';
import { Golfer } from '../services/api';
import { api } from '../services/api';

interface GolferChannelCallbacks {
  onGolferUpdated?: (golfer: Golfer) => void;
  onGolferCreated?: (golfer: Golfer) => void;
  onGolferDeleted?: (golferId: number) => void;
  onReconnect?: () => void;
}

/**
 * Hook to subscribe to real-time golfer updates via ActionCable
 * 
 * Usage:
 * ```
 * useGolferChannel({
 *   onGolferUpdated: (golfer) => {
 *     setGolfers(prev => prev.map(g => g.id === golfer.id ? golfer : g));
 *   },
 *   onGolferCreated: (golfer) => {
 *     setGolfers(prev => [...prev, golfer]);
 *   },
 *   onGolferDeleted: (golferId) => {
 *     setGolfers(prev => prev.filter(g => g.id !== golferId));
 *   }
 * });
 * ```
 */
export function useGolferChannel(callbacks: GolferChannelCallbacks) {
  const consumerRef = useRef<ReturnType<typeof createConsumer> | null>(null);
  const subscriptionRef = useRef<{ unsubscribe: () => void } | null>(null);
  const callbacksRef = useRef(callbacks);
  const hasConnectedOnceRef = useRef(false);
  const [isConnected, setIsConnected] = useState(false);

  // Keep callbacks ref updated
  useEffect(() => {
    callbacksRef.current = callbacks;
  }, [callbacks]);

  const handleReceived = useCallback((data: { action: string; golfer?: Golfer; golfer_id?: number }) => {
    console.log('[GolfersChannel] Received:', data.action);
    
    switch (data.action) {
      case 'updated':
        if (data.golfer && callbacksRef.current.onGolferUpdated) {
          callbacksRef.current.onGolferUpdated(data.golfer);
        }
        break;
      case 'created':
        if (data.golfer && callbacksRef.current.onGolferCreated) {
          callbacksRef.current.onGolferCreated(data.golfer);
        }
        break;
      case 'deleted':
        if (data.golfer?.id && callbacksRef.current.onGolferDeleted) {
          callbacksRef.current.onGolferDeleted(data.golfer.id);
        }
        break;
    }
  }, []);

  useEffect(() => {
    let isMounted = true;

    const setupSubscription = async () => {
      const token = await api.getWebSocketToken();
      if (!token) {
        console.warn('[GolfersChannel] No auth token available, skipping websocket connection');
        return;
      }

      // Determine the WebSocket URL based on environment
      const apiUrl = import.meta.env.VITE_API_URL || 'http://localhost:3000';
      const wsBaseUrl = import.meta.env.VITE_WS_URL || `${apiUrl.replace(/^http/, 'ws')}/cable`;
      const separator = wsBaseUrl.includes('?') ? '&' : '?';
      const wsUrl = `${wsBaseUrl}${separator}token=${encodeURIComponent(token)}`;

      console.log('[GolfersChannel] Connecting to:', wsBaseUrl);

      if (!isMounted) return;

      try {
        // Create the consumer
        consumerRef.current = createConsumer(wsUrl);

        // Subscribe to the golfers channel
        subscriptionRef.current = consumerRef.current.subscriptions.create(
          { channel: 'GolfersChannel' },
          {
            connected() {
              console.log('[GolfersChannel] Connected');
              if (!isMounted) return;
              setIsConnected(true);
              if (hasConnectedOnceRef.current) {
                callbacksRef.current.onReconnect?.();
              } else {
                hasConnectedOnceRef.current = true;
              }
            },
            disconnected() {
              console.log('[GolfersChannel] Disconnected');
              if (isMounted) setIsConnected(false);
            },
            rejected() {
              console.log('[GolfersChannel] Subscription rejected');
              if (isMounted) setIsConnected(false);
            },
            received: handleReceived,
          }
        );
      } catch (error) {
        console.error('[GolfersChannel] Error setting up subscription:', error);
      }
    };

    setupSubscription();

    // Cleanup on unmount
    return () => {
      isMounted = false;
      setIsConnected(false);
      console.log('[GolfersChannel] Cleaning up');
      if (subscriptionRef.current) {
        subscriptionRef.current.unsubscribe();
        subscriptionRef.current = null;
      }
      if (consumerRef.current) {
        consumerRef.current.disconnect();
        consumerRef.current = null;
      }
    };
  }, [handleReceived]);

  return {
    isConnected,
  };
}
