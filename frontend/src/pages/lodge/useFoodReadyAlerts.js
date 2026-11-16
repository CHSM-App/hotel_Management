import { useEffect, useRef, useState } from 'react';
import { apiGet } from '../../lib/api';
import { useToast } from '../../components/Toast';

// Food the kitchen has finished (READY/DELIVERED) that nobody has billed yet —
// the same list as Billing's "Food to bill" — so the owner or receptionist
// hears about it without having to sit on that tab.
export function useFoodReadyAlerts(token, enabled) {
  const [alerts, setAlerts] = useState([]);
  const toast = useToast();
  const seen = useRef(null);

  useEffect(() => {
    if (!enabled) return undefined;
    let stopped = false;
    const load = () =>
      apiGet('/billing/food-tabs', { token })
        .then((d) => {
          if (stopped) return;
          const tabs = d.tabs || [];
          // Keyed on tab + order count so a further order on an open table re-alerts.
          const keys = new Set(tabs.map((t) => `${t.tab}:${t.orderCount}`));
          if (seen.current) {
            for (const t of tabs) {
              if (!seen.current.has(`${t.tab}:${t.orderCount}`)) {
                toast.show(`${t.tableLabel} — food is ready, waiting to be billed.`, 'info');
              }
            }
          }
          seen.current = keys;
          setAlerts(
            tabs.map((t) => ({
              id: `food-ready-${t.tab}`,
              category: 'foodBill',
              message: `${t.tableLabel}${t.guestName ? ` · ${t.guestName}` : ''} — food ready, waiting to be billed.`,
              urgent: false,
            }))
          );
        })
        .catch(() => {
          if (!stopped) setAlerts([]);
        });
    load();
    const timer = setInterval(load, 20000);
    return () => {
      stopped = true;
      clearInterval(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token, enabled]);

  return enabled ? alerts : [];
}
