import { useEffect, useSyncExternalStore } from 'react';

// One loading state for the whole app. Anything that is waiting on data
// registers itself while it waits (PageLoader does this just by being mounted);
// GlobalLoader shows a single full-page overlay for as long as anything is
// registered. Screens no longer draw their own spinners.
let holds = 0;
let label = 'Loading';
let snapshot = { loading: false, label };
const listeners = new Set();

function publish() {
  const next = { loading: holds > 0, label };
  if (next.loading === snapshot.loading && next.label === snapshot.label) return;
  snapshot = next;
  listeners.forEach((l) => l());
}

export function startLoading(text) {
  holds += 1;
  if (text) label = text;
  publish();
  let released = false;
  return () => {
    if (released) return;
    released = true;
    holds = Math.max(0, holds - 1);
    publish();
  };
}

// Registers for as long as the calling component is mounted.
export function useLoadingHold(text) {
  useEffect(() => startLoading(text), [text]);
}

export function useLoadingState() {
  return useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    () => snapshot
  );
}
