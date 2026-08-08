import { Navigate } from 'react-router-dom';
import { isLodgeUser } from '../lib/auth';

/**
 * Gate for lodge-staff screens (owner/reception/kitchen). Superadmin
 * sessions don't satisfy this — they belong on the /vtadmin side.
 */
export default function RequireLodgeAuth({ children }) {
  if (!isLodgeUser()) {
    return <Navigate to="/login" replace />;
  }

  return children;
}
