import { useEffect, useState } from 'react';
import { apiGet } from '../../lib/api';

// A month's runway to renew or budget for lapsing cover — long enough to be
// useful, short enough to still mean something.
const WINDOW_DAYS = 30;

const COVERAGE_FIELDS = [
  ['warrantyExpiry', 'Warranty'],
  ['amcExpiry', 'AMC'],
];

function daysUntil(iso) {
  const target = new Date(`${String(iso).slice(0, 10)}T00:00:00`);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return Math.round((target.getTime() - today.getTime()) / 86400000);
}

function dateLabel(iso) {
  return new Date(`${String(iso).slice(0, 10)}T00:00:00`).toLocaleDateString('en-IN', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });
}

// Assets whose warranty or AMC runs out within the month — a planning
// horizon, not a fire, so this polls slowly and never interrupts with a toast.
export function useCoverageAlerts(token, enabled) {
  const [alerts, setAlerts] = useState([]);

  useEffect(() => {
    if (!enabled) return undefined;
    let stopped = false;
    const load = () =>
      apiGet('/assets', { token })
        .then((d) => {
          if (stopped) return;
          const out = [];
          for (const a of d.assets || []) {
            for (const [field, label] of COVERAGE_FIELDS) {
              const iso = a[field];
              if (!iso) continue;
              const days = daysUntil(iso);
              if (days > WINDOW_DAYS) continue;
              out.push({
                id: `coverage-${a.id}-${field}`,
                category: 'coverage',
                message:
                  days < 0
                    ? `${a.name} — ${label} coverage expired on ${dateLabel(iso)}.`
                    : `${a.name} — ${label} coverage expires on ${dateLabel(iso)}.`,
                urgent: false,
              });
            }
          }
          setAlerts(out);
        })
        .catch(() => {
          if (!stopped) setAlerts([]);
        });
    load();
    const timer = setInterval(load, 300000);
    return () => {
      stopped = true;
      clearInterval(timer);
    };
  }, [token, enabled]);

  return enabled ? alerts : [];
}
