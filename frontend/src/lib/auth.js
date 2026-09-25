import { clearCache } from './dataCache';

const STORAGE_KEY = 'lms.session';

export function getSession() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

export function setSession({ token, role, name }) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify({ token, role, name }));
}

export function clearSession() {
  localStorage.removeItem(STORAGE_KEY);
  // Whatever the dashboard had cached belonged to the account that just left.
  clearCache();
}

export function isStaff() {
  return getSession()?.role === 'SUPERADMIN';
}

// Every non-SUPERADMIN session is a lodge role — built-in or a lodge's own
// custom one — so this is the complement of isStaff() rather than a second
// list of role names to keep in step with the built-ins backend/auth.service.js
// seeds. A custom role (Night Manager, say) was never going to appear in a
// hardcoded list anyway.
export function isLodgeUser() {
  const role = getSession()?.role;
  return Boolean(role) && role !== 'SUPERADMIN';
}
