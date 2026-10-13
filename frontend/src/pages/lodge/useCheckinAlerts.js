import { useEffect, useRef, useState } from 'react';
import { apiGet } from '../../lib/api';
import { useToast } from '../../components/Toast';

// Today's arrivals, due soon or already overdue — the check-in mirror of
// useCheckoutAlerts. Same first-poll-is-silent guard: opening or refreshing
// the dashboard must not re-announce arrivals that were already overdue
// before anyone was looking.
export function useCheckinAlerts(token, enabled) {
  const [alerts, setAlerts] = useState([]);
  const toast = useToast();
  const toastedOverdue = useRef(null);

  useEffect(() => {
    if (!enabled) return undefined;
    let stopped = false;
    const load = () =>
      apiGet('/bookings/checkin-alerts', { token })
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
              id: `checkin-${a.bookingRoomId}`,
              category: 'checkin',
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
