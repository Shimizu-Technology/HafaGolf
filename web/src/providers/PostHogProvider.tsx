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

const SENSITIVE_QUERY_KEYS = new Set([
  'token',
  'session_token',
  'access_token',
  'magic_token',
  'code',
]);

const SENSITIVE_PATH_PREFIXES = ['/sponsor-portal', '/score/verify'];

export function isSensitiveAnalyticsRoute(pathname: string, search = ''): boolean {
  if (SENSITIVE_PATH_PREFIXES.some((prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`))) {
    return true;
  }
  if (!search) return false;
  const params = new URLSearchParams(search);
  for (const key of params.keys()) {
    if (SENSITIVE_QUERY_KEYS.has(key.toLowerCase())) return true;
  }
  return false;
}

export function sanitizeUrlForAnalytics(rawUrl: string): string {
  try {
    const parsed = new URL(rawUrl, 'http://localhost');
    let stripped = false;
    for (const key of Array.from(parsed.searchParams.keys())) {
      if (SENSITIVE_QUERY_KEYS.has(key.toLowerCase())) {
        parsed.searchParams.delete(key);
        stripped = true;
      }
    }
    if (!stripped) return rawUrl;
    const isAbsolute = /^https?:\/\//i.test(rawUrl);
    return isAbsolute ? parsed.toString() : `${parsed.pathname}${parsed.search}${parsed.hash}`;
  } catch {
    return rawUrl.split('?')[0];
  }
}

export function sanitizeSearchForAnalytics(search: string): string {
  if (!search) return '';
  const params = new URLSearchParams(search);
  for (const key of Array.from(params.keys())) {
    if (SENSITIVE_QUERY_KEYS.has(key.toLowerCase())) {
      params.delete(key);
    }
  }
  const serialized = params.toString();
  return serialized ? `?${serialized}` : '';
}

export function sanitizePostHogProperties(properties: Record<string, unknown>): Record<string, unknown> {
  const sanitized = { ...properties };
  for (const key of ['$current_url', '$referrer', '$initial_referrer', '$initial_current_url']) {
    if (typeof sanitized[key] === 'string') {
      sanitized[key] = sanitizeUrlForAnalytics(sanitized[key]);
    }
  }
  if (typeof sanitized.$search === 'string') {
    sanitized.$search = sanitizeSearchForAnalytics(sanitized.$search);
  }
  return sanitized;
}

export function PostHogPageView() {
  const location = useLocation();
  const posthogClient = usePostHog();
  const isReady = usePostHogReady();
  const lastCapturedPathRef = useRef<string | null>(null);

  useEffect(() => {
    if (!posthogClient || !isPostHogEnabled || !isReady) return;

    const sensitive = isSensitiveAnalyticsRoute(location.pathname, location.search);
    if (sensitive) {
      posthogClient.stopSessionRecording?.();
      lastCapturedPathRef.current = location.pathname;
      return;
    }

    const safeSearch = sanitizeSearchForAnalytics(location.search);
    const currentPath = `${location.pathname}${safeSearch}${location.hash}`;

    // Provider init captures the initial pageview once.
    if (lastCapturedPathRef.current === null && initialCapturedPath === currentPath) {
      lastCapturedPathRef.current = currentPath;
      return;
    }

    if (lastCapturedPathRef.current === currentPath) return;

    posthogClient.capture('$pageview', {
      $current_url: sanitizeUrlForAnalytics(window.location.href),
      $pathname: location.pathname,
      $search: safeSearch,
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

    const initialSensitive = isSensitiveAnalyticsRoute(window.location.pathname, window.location.search);
    const safeInitialSearch = sanitizeSearchForAnalytics(window.location.search);

    if (posthogInitialized) {
      if (!initialCapturedPath) {
        initialCapturedPath = `${window.location.pathname}${safeInitialSearch}${window.location.hash}`;
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
      disable_session_recording: initialSensitive,
      sanitize_properties: sanitizePostHogProperties,
      session_recording: {
        maskAllInputs: true,
      },
      loaded: () => {
        if (import.meta.env.DEV) {
          console.info('PostHog initialized');
        }
      },
    });

    if (!initialSensitive) {
      posthog.capture('$pageview', {
        $current_url: sanitizeUrlForAnalytics(window.location.href),
        $pathname: window.location.pathname,
        $search: safeInitialSearch,
        $hash: window.location.hash,
        area: window.location.pathname.startsWith('/admin') ? 'admin' : 'public',
      });
    }

    initialCapturedPath = `${window.location.pathname}${safeInitialSearch}${window.location.hash}`;
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
