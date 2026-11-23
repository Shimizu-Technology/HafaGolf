import { useCallback, useLayoutEffect, useMemo } from 'react';

// Start a request before awaiting authentication. Check the returned function
// before committing results or showing errors from an older request.
export function useLatestRequest(scope?: string) {
  const request = useMemo(() => ({ scope, active: false, sequence: 0 }), [scope]);

  useLayoutEffect(() => {
    request.active = true;
    return () => {
      request.active = false;
      request.sequence++;
    };
  }, [request]);

  return useCallback(() => {
    const sequence = ++request.sequence;
    return () => request.active && sequence === request.sequence;
  }, [request]);
}
