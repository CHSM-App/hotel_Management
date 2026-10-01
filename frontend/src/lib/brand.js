import { useSyncExternalStore } from 'react';

// The property's logo, kept where the loaders can reach it. The dashboard sets it
// once the lodge has loaded; it is also remembered in localStorage (as a full
// address) so the very next visit can show the logo before anything has loaded,
// including in the boot loader in index.html.
const KEY = 'hm_logo';
let logo = null;
try {
  logo = localStorage.getItem(KEY) || null;
} catch {
  /* storage blocked: the logo just shows once the lodge has loaded */
}
const listeners = new Set();

export function setBrandLogo(url) {
  const next = url || null;
  if (next === logo) return;
  logo = next;
  try {
    if (next) localStorage.setItem(KEY, next);
    else localStorage.removeItem(KEY);
  } catch {
    /* ignore */
  }
  listeners.forEach((l) => l());
}

export function useBrandLogo() {
  return useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    () => logo
  );
}
