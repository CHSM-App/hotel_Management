import { useEffect, useRef, useState } from 'react';
import { apiGet } from '../../lib/api';
import { useToast } from '../../components/Toast';

// Rooms whose check-out is due soon or already past it, for the bell in the
// nav bar. Polled rather than pushed — there is no server event for "a clock
// ran out" — but a toast fires only once a room actually crosses into
// overdue, not on every "approaching" poll: around a single checkout hour
// most of the property's rooms cross the "due soon" line within the same few
// minutes, and a toast for each would be noise the desk learns to ignore.
export function useCheckoutAlerts(token, enabled) {
  const [alerts, setAlerts] = useState([]);
  const toast = useToast();
  // Which rooms were already overdue as of the last poll. Null until the
  // first answer, so opening the dashboard (or refreshing it) does not
  // re-announce a backlog of rooms that went overdue before anyone was
  // looking — only a room crossing into overdue while the tab is open earns
  // the interrupt. Same guard useOpenIssues uses for the same reason.
  const toastedOverdue = useRef(null);

  useEffect(() => {
    if (!enabled) return undefined;
    let stopped = false;
    const load = () =>
      apiGet('/bookings/checkout-alerts', { token })
        .then((d) => {
          if (stopped) return;
          const list = d.alerts || [];
          const nowOverdue = new Set(list.filter((a) => a.overdue).map((a) => a.bookingRoomId));
          if (toastedOverdue.current) {
            for (const a of list) {
              if (a.overdue && !toastedOverdue.current.has(a.bookingRoomId)) {
                toast.show(a.message, 'warning');
              }
            }
          }
          toastedOverdue.current = nowOverdue;
          setAlerts(
            list.map((a) => ({
              id: `checkout-${a.bookingRoomId}`,
              category: 'checkout',
              message: a.message,
              urgent: a.overdue,
            }))
          );
        })
        .catch(() => {
          if (!stopped) setAlerts([]);
        });
    load();
    const timer = setInterval(load, 60000);
    return () => {
      stopped = true;
      clearInterval(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token, enabled]);

  return enabled ? alerts : [];
}
