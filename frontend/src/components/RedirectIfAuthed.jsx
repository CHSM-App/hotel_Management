import { useEffect } from 'react';
import { Navigate } from 'react-router-dom';
import { isLodgeUser, isStaff } from '../lib/auth';

/**
 * The mirror of RequireLodgeAuth / RequireStaff: keeps a signed-in user off the
 * sign-in pages. Wraps /login and /vtadmin.
 *
 * The case this exists for is Back. Signing in navigates with `replace`, so the
 * login entry is overwritten — but Back can still reach it when the entry came
 * from somewhere else (a bookmark, a typed URL, or a full page load that pushed
 * a fresh entry). Landing on a sign-in form you have already satisfied reads as
 * being signed out, and pressing Forward to get back to work is not something
 * anyone should have to discover.
 *
 * `to` is where a signed-in user belongs instead. Navigate with `replace` so the
 * bounce does not add another entry — otherwise Back from the dashboard hits
 * this page again and the two ping-pong.
 */
export default function RedirectIfAuthed({ children, to, when }) {
  const authed = when === 'staff' ? isStaff() : isLodgeUser();

  // A page restored from the browser's back/forward cache does not re-run the
  // component, so the check above is stale on exactly the journey this guard is
  // for. pageshow with persisted=true is that restore, and the session may have
  // been cleared in another tab since — reload so the guard runs against what is
  // actually in storage now.
  useEffect(() => {
    const onPageShow = (e) => {
      if (e.persisted) window.location.reload();
    };
    window.addEventListener('pageshow', onPageShow);
    return () => window.removeEventListener('pageshow', onPageShow);
  }, []);

  if (authed) {
    return <Navigate to={to} replace />;
  }

  return children;
}
