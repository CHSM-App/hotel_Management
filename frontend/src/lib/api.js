import { clearSession, getSession } from './auth';

// Local development: points at the backend on port 8000 (PORT in backend/.env).
// Swap to the production line below before building for deploy.
//  export const API_BASE = 'https://hotel.vengurlatech.com';
export const API_BASE = 'http://192.168.1.8:5000';


// `field`, when the server sent one, names the form input the message is about,
// so a form can show it under that field and put the cursor there rather than
// in a banner at the top. Null for everything that isn't about one input.
export class ApiError extends Error {
  constructor(message, status, field = null) {
    super(message);
    this.status = status;
    this.field = field;
  }
}

// A 401 on a request we sent a session with means that session is no longer
// good — expired, revoked, or the account changed underneath it. No screen can
// do anything useful with that, so it is handled once here instead of every
// panel rendering "Sign in required." on a dashboard that can no longer load
// anything.
//
// Deliberately NOT every 401:
//   /auth  — signing in with the wrong password is a 401, and belongs on the
//            login form as an error, not as a bounce back to itself.
//   /public — a guest mistyping the food PIN from their check-in slip is a
//            401 too. Sending them to a staff login would be nonsense.
// And with no session stored there is nothing to have expired.
function isExpiredSession(res, path) {
  if (res.status !== 401) return false;
  if (path.startsWith('/auth') || path.startsWith('/public')) return false;
  return Boolean(getSession());
}

// Full page replace rather than a router navigate: this runs outside React,
// and throwing away every panel's state is exactly what should happen when the
// session behind it has gone. `replace` so Back doesn't return to a dashboard
// that can no longer load.
function goToLogin() {
  const target = getSession()?.role === 'SUPERADMIN' ? '/vtadmin' : '/login';
  clearSession();
  if (window.location.pathname !== target) {
    window.location.replace(target);
  }
}

async function handleResponse(res, path) {
  const data = await res.json().catch(() => null);

  if (!res.ok) {
    if (isExpiredSession(res, path)) goToLogin();
    throw new ApiError(
      data?.error || 'Something went wrong. Try again.',
      res.status,
      data?.field ?? null
    );
  }

  return data;
}

export async function apiGet(path, { token } = {}) {
  const res = await fetch(`${API_BASE}${path}`, {
    headers: {
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
  });

  return handleResponse(res, path);
}

export async function apiPost(path, body, { token } = {}) {
  const res = await fetch(`${API_BASE}${path}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(body),
  });

  return handleResponse(res, path);
}

// No Content-Type header here — the browser sets multipart/form-data with
// the right boundary itself; setting it manually breaks the upload.
export async function apiPostForm(path, formData, { token } = {}) {
  const res = await fetch(`${API_BASE}${path}`, {
    method: 'POST',
    headers: {
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: formData,
  });

  return handleResponse(res, path);
}

export async function apiGetBlob(path, { token } = {}) {
  const res = await fetch(`${API_BASE}${path}`, {
    headers: {
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
  });

  if (!res.ok) {
    const data = await res.json().catch(() => null);
    if (isExpiredSession(res, path)) goToLogin();
    throw new ApiError(
      data?.error || 'Something went wrong. Try again.',
      res.status,
      data?.field ?? null
    );
  }

  return res.blob();
}

export async function apiPatch(path, body, { token } = {}) {
  const res = await fetch(`${API_BASE}${path}`, {
    method: 'PATCH',
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(body),
  });

  return handleResponse(res, path);
}

// PUT where the request replaces a whole collection rather than editing parts
// of one row — a dish's portions are saved as the complete set they should end
// up as, not as a diff.
export async function apiPut(path, body, { token } = {}) {
  const res = await fetch(`${API_BASE}${path}`, {
    method: 'PUT',
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(body),
  });

  return handleResponse(res, path);
}

export async function apiPatchForm(path, formData, { token } = {}) {
  const res = await fetch(`${API_BASE}${path}`, {
    method: 'PATCH',
    headers: {
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: formData,
  });

  return handleResponse(res, path);
}

export async function apiDelete(path, { token } = {}) {
  const res = await fetch(`${API_BASE}${path}`, {
    method: 'DELETE',
    headers: {
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
  });

  return handleResponse(res, path);
}
