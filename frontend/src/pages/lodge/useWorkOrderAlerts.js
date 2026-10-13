import { useEffect, useRef, useState } from 'react';
import { apiGet } from '../../lib/api';
import { useToast } from '../../components/Toast';

const ISSUE_TYPE_LABEL = { BREAKDOWN: 'Breakdown', ROUTINE_SERVICE: 'Routine service' };

function relativeTime(iso) {
  const mins = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60000));
  if (mins < 60) return `${mins} min ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.round(hours / 24)}d ago`;
}

// Maintenance's own open-tickets list, read the same way an open housekeeping
// issue is. A toast fires only for a work order that wasn't on the previous
// poll — never for the backlog already open when the dashboard loads (see
// useCheckoutAlerts for why the first poll stays silent).
export function useWorkOrderAlerts(token, enabled) {
  const [alerts, setAlerts] = useState([]);
  const toast = useToast();
  const seenIds = useRef(null);

  useEffect(() => {
    if (!enabled) return undefined;
    let stopped = false;
    const load = () =>
      apiGet('/assets/work-orders?status=OPEN', { token })
        .then((d) => {
          if (stopped) return;
          const list = d.workOrders || [];
          const ids = new Set(list.map((w) => w.id));
          if (seenIds.current) {
            for (const w of list) {
              if (!seenIds.current.has(w.id)) {
                toast.show(
                  `New work order — ${w.assetName}: ${ISSUE_TYPE_LABEL[w.issueType] || w.issueType}.`,
                  'info'
                );
              }
            }
          }
          seenIds.current = ids;
          setAlerts(
            list.map((w) => ({
              id: `workorder-${w.id}`,
              category: 'workOrder',
              message: `New work order — ${w.assetName}: ${ISSUE_TYPE_LABEL[w.issueType] || w.issueType} (opened ${relativeTime(w.openedAt)}).`,
              urgent: false,
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
