import { useEffect } from 'react';
import { Navigate } from 'react-router-dom';
import { isStaff } from '../lib/auth';

/**
 * Gate for our-team-only screens. Also strips the page from search
 * indexing, since obscurity is a second layer, not the access control —
 * the real boundary is the role check below, backed by /auth/admin-login
 * only ever issuing tokens with role SUPERADMIN.
 */
export default function RequireStaff({ children }) {
  useEffect(() => {
    const meta = document.createElement('meta');
    meta.name = 'robots';
    meta.content = 'noindex,nofollow';
    document.head.appendChild(meta);
    return () => document.head.removeChild(meta);
  }, []);

  if (!isStaff()) {
    return <Navigate to="/vtadmin" replace />;
  }

  return children;
}
