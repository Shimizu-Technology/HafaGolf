import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import posthog from 'posthog-js';
import { PostHogProvider as PHProvider, usePostHog } from 'posthog-js/react';
import { useLocation } from 'react-router-dom';

const POSTHOG_KEY = import.meta.env.VITE_PUBLIC_POSTHOG_KEY;
const POSTHOG_HOST = import.meta.env.VITE_PUBLIC_POSTHOG_HOST || 'https://us.i.posthog.com';
const isPostHogEnabled = Boolean(POSTHOG_KEY && POSTHOG_KEY !== 'YOUR_POSTHOG_KEY');

let posthogInitialized = false;
let initialCapturedPath: string | null = null;
let disabledLogged = false;

const PostHogReadyContext = createContext(false);

export function usePostHogReady() {
  return useContext(PostHogReadyContext);
}

export function PostHogPageView() {
  const location = useLocation();
  const posthogClient = usePostHog();
  const isReady = usePostHogReady();
  const lastCapturedPathRef = useRef<string | null>(null);

  useEffect(() => {
    if (!posthogClient || !isPostHogEnabled || !isReady) return;

    const currentPath = `${location.pathname}${location.search}${location.hash}`;

    // Provider init captures the initial pageview once.
    if (lastCapturedPathRef.current === null && initialCapturedPath === currentPath) {
      lastCapturedPathRef.current = currentPath;
      return;
    }

    if (lastCapturedPathRef.current === currentPath) return;

    posthogClient.capture('$pageview', {
      $current_url: window.location.href,
      $pathname: location.pathname,
      $search: location.search,
      $hash: location.hash,
      area: location.pathname.startsWith('/admin') ? 'admin' : 'public',
    });

    lastCapturedPathRef.current = currentPath;
  }, [location.pathname, location.search, location.hash, posthogClient, isReady]);

  return null;
}

export function PostHogProvider({ children }: { children: ReactNode }) {
  const [isReady, setIsReady] = useState(posthogInitialized);

  useEffect(() => {
    if (!isPostHogEnabled) {
      if (import.meta.env.DEV && !disabledLogged) {
        console.info('PostHog not configured - analytics disabled');
        disabledLogged = true;
      }
      return;
    }

    if (typeof window === 'undefined') return;

    if (posthogInitialized) {
      if (!initialCapturedPath) {
        initialCapturedPath = `${window.location.pathname}${window.location.search}${window.location.hash}`;
      }
      setIsReady(true);
      return;
    }

    posthog.init(POSTHOG_KEY, {
      api_host: POSTHOG_HOST,
      defaults: '2025-11-30',
      capture_pageview: false,
      capture_pageleave: true,
      autocapture: true,
      disable_session_recording: false,
      session_recording: {
        maskAllInputs: true,
      },
      loaded: () => {
        if (import.meta.env.DEV) {
          console.info('PostHog initialized');
        }
      },
    });

    posthog.capture('$pageview', {
      $current_url: window.location.href,
      $pathname: window.location.pathname,
      $search: window.location.search,
      $hash: window.location.hash,
      area: window.location.pathname.startsWith('/admin') ? 'admin' : 'public',
    });

    initialCapturedPath = `${window.location.pathname}${window.location.search}${window.location.hash}`;
    posthogInitialized = true;
    setIsReady(true);
  }, []);

  if (!isPostHogEnabled) {
    return <>{children}</>;
  }

  return (
    <PHProvider client={posthog}>
      <PostHogReadyContext.Provider value={isReady}>
        {children}
      </PostHogReadyContext.Provider>
    </PHProvider>
  );
}
