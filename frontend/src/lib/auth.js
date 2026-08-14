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

export function isLodgeUser() {
  return ['OWNER', 'RECEPTION', 'KITCHEN'].includes(getSession()?.role);
}
