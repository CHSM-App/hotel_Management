import { useCallback, useEffect, useRef, useState } from 'react';
import { apiGet } from '../../lib/api';
import { useToast } from '../../components/Toast';

// New enquiries from the public page that nobody has picked up yet. Polls the
// summary endpoint every minute and toasts only for ids it hasn't seen before —
// the first load just records what's already waiting, so opening the dashboard
// doesn't fire a toast for every old enquiry. `refresh` lets the Enquiries
// panel update the bell straight after a status change.
export function useEnquiryAlerts(token, enabled) {
  const [alerts, setAlerts] = useState([]);
  const toast = useToast();
  const seenIds = useRef(null);
  const stopped = useRef(false);

  const load = useCallback(
    () =>
      apiGet('/enquiries/summary', { token })
        .then((d) => {
          if (stopped.current) return;
          const items = d.items || [];
          if (seenIds.current) {
            for (const item of items) {
              if (!seenIds.current.has(item.id)) {
                toast.show(`New enquiry from ${item.name} (${item.referenceCode}).`, 'info');
              }
            }
          }
          seenIds.current = new Set(items.map((i) => i.id));
          setAlerts(
            items.map((i) => ({
              id: `enquiry-${i.id}`,
              category: 'enquiry',
              message: `New ${i.kind.toLowerCase()} enquiry from ${i.name} — ${i.referenceCode}.`,
              urgent: false,
            }))
          );
        })
        .catch(() => {
          if (!stopped.current) setAlerts([]);
        }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [token]
  );

  useEffect(() => {
    if (!enabled) return undefined;
    stopped.current = false;
    load();
    const timer = setInterval(load, 60000);
    return () => {
      stopped.current = true;
      clearInterval(timer);
    };
  }, [enabled, load]);

  return { alerts: enabled ? alerts : [], refresh: load };
}
