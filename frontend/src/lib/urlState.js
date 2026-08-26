import { useCallback } from 'react';
import { useSearchParams } from 'react-router-dom';

// Keeps a piece of navigation state in the query string instead of useState, so
// a refresh lands where the user was rather than back at the first tab.
//
// The dashboard is one route, /dashboard, with the section and every panel's
// sub-tab held in component state. That state dies on reload — reception deep
// in Billing → Numbering pressed F5 and came back to the tape chart. It also
// means a screen cannot be linked to or reopened after a crash.
//
// The query string is the natural home for it: the browser already persists it,
// Back already understands it, and it needs no storage to go stale.
//
// `replace` rather than push: clicking four tabs should not put four entries in
// history for Back to walk out through. The trade is that Back does not undo a
// tab change — it leaves the dashboard, which is what the button means here.
//
// A value equal to the fallback is removed rather than written, so the common
// case stays a clean /dashboard with no query at all.
export function useUrlState(key, fallback = null) {
  const [params, setParams] = useSearchParams();
  const value = params.get(key) ?? fallback;

  const setValue = useCallback(
    (next) => {
      setParams(
        (prev) => {
          const updated = new URLSearchParams(prev);
          if (next == null || next === fallback) updated.delete(key);
          else updated.set(key, String(next));
          return updated;
        },
        { replace: true }
      );
    },
    [key, fallback, setParams]
  );

  return [value, setValue];
}
