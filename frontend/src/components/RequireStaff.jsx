import { useEffect } from 'react';
import { Navigate } from 'react-router-dom';
import { isStaff } from '../lib/auth';
import usePinHistory from './usePinHistory';

/**
 * Gate for our-team-only screens. Also strips the page from search
 * indexing, since obscurity is a second layer, not the access control —
 * the real boundary is the role check below, backed by /auth/admin-login
 * only ever issuing tokens with role SUPERADMIN.
 */
export default function RequireStaff({ children }) {
  const authed = isStaff();

  useEffect(() => {
    const meta = document.createElement('meta');
    meta.name = 'robots';
    meta.content = 'noindex,nofollow';
    document.head.appendChild(meta);
    return () => document.head.removeChild(meta);
  }, []);

  // Same pin as the lodge side: Back must not drop a signed-in admin onto the
  // /vtadmin sign-in form.
  usePinHistory(authed);

  if (!authed) {
    return <Navigate to="/vtadmin" replace />;
  }

  return children;
}
