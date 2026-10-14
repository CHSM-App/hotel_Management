import { useEffect, useRef, useState } from 'react';
import { apiGet } from '../../lib/api';
import { useToast } from '../../components/Toast';

const PENDING_THRESHOLD_MINUTES = 20;

// Table orders nobody has accepted yet. Only table orders can sit in PENDING
// at all — a room order is PIN-verified straight into QUEUED (see
// placeRoomOrder in public.service.js) — so every alert here is a QR order
// waiting on someone to accept it, kitchen or captain alike (both can take a
// PENDING order into the queue).
//
// Deliberately /orders?status=PENDING rather than /orders/queue: the queue
// endpoint is kitchen/owner-only (orders.manage) by design, but a captain
// (orders.take) is exactly who walks over and accepts a stray QR order in
// person — and until this hook existed, a captain had no way to learn an
// order had gone stale, only that a new one had arrived (see the chime on
// the Orders tab in OrdersPanel.jsx, which never repeats for a delay). The
// general list endpoint is open to both permissions and, with no from/to
// given, defaults server-side to today in the lodge's own timezone.
export function usePendingOrderAlerts(token, enabled) {
  const [alerts, setAlerts] = useState([]);
  const toast = useToast();
  const toastedIds = useRef(null);

  useEffect(() => {
    if (!enabled) return undefined;
    let stopped = false;
    const load = () =>
      apiGet('/orders?status=PENDING', { token })
        .then((d) => {
          if (stopped) return;
          const now = Date.now();
          const overdue = (d.orders || []).filter((o) => {
            if (o.status !== 'PENDING') return false;
            return (now - new Date(o.placedAt).getTime()) / 60000 >= PENDING_THRESHOLD_MINUTES;
          });
          const ids = new Set(overdue.map((o) => o.id));
          if (toastedIds.current) {
            for (const o of overdue) {
              if (!toastedIds.current.has(o.id)) {
                toast.show(
                  `Table ${o.tableLabel || '—'} · Order #${o.orderNumber} is still waiting for the kitchen to accept it.`,
                  'warning'
                );
              }
            }
          }
          toastedIds.current = ids;
          setAlerts(
            overdue.map((o) => ({
              id: `order-${o.id}`,
              category: 'order',
              message: `Table ${o.tableLabel || '—'} · Order #${o.orderNumber} — still waiting ${Math.floor((now - new Date(o.placedAt).getTime()) / 60000)} min for the kitchen to accept it.`,
              urgent: true,
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
