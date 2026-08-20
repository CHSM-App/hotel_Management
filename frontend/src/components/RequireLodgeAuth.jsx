import { Navigate } from 'react-router-dom';
import { isLodgeUser } from '../lib/auth';
import usePinHistory from './usePinHistory';

/**
 * Gate for lodge-staff screens (owner/reception/kitchen). Superadmin
 * sessions don't satisfy this — they belong on the /vtadmin side.
 */
export default function RequireLodgeAuth({ children }) {
  const authed = isLodgeUser();

  // While signed in, Back does not take them off this screen and back to a
  // sign-in form they have already satisfied. Called before the early return so
  // the hook count is the same on both paths; the flag keeps it inert for a
  // signed-out visitor, who is about to be sent to /login and must still be
  // able to navigate normally.
  usePinHistory(authed);

  if (!authed) {
    return <Navigate to="/login" replace />;
  }

  return children;
}
