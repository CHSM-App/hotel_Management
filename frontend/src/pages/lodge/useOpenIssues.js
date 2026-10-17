import { useEffect, useRef, useState } from 'react';
import { apiGet } from '../../lib/api';
import { useToast } from '../../components/Toast';
import { ISSUES_CHANGED } from './housekeepingFormat';

// Problems and found items housekeeping has reported that nobody has closed
// yet: a count for the sidebar badge, a toast when a new one arrives, and now
// also the full rows themselves, so the nav bell's housekeeping section reads
// off the same poll rather than opening a second one against a second
// endpoint — two independent polls on two schedules let the sidebar badge and
// the bell briefly disagree about how many were open.
export function useOpenIssues(token, enabled) {
  const [issues, setIssues] = useState([]);
  const toast = useToast();
  // The newest report already seen. Null until the first answer, so opening the
  // app does not announce everything that was already waiting.
  const seen = useRef(null);

  useEffect(() => {
    if (!enabled) return undefined;
    let stopped = false;
    const load = () =>
      apiGet('/housekeeping/issues?scope=open', { token })
        .then((d) => {
          if (stopped) return;
          const list = d.issues || [];
          const latest = list[0] ?? null;
          const latestKey = latest ? `${latest.logId}:${latest.kind}` : null;
          if (seen.current !== null && latestKey && latestKey !== seen.current.key && list.length > seen.current.count) {
            const what = latest.kind === 'FOUND' ? 'Item found' : 'Problem reported';
            const where = latest.space === 'VENUE' ? latest.roomNumber : `Room ${latest.roomNumber}`;
            toast.show(`${where}: ${what} — ${latest.text}`, 'info');
          }
          seen.current = { key: latestKey, count: list.length };
          setIssues(list);
        })
        .catch(() => {
          if (!stopped) setIssues([]);
        });
    load();
    const timer = setInterval(load, 30000);
    window.addEventListener(ISSUES_CHANGED, load);
    return () => {
      stopped = true;
      clearInterval(timer);
      window.removeEventListener(ISSUES_CHANGED, load);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token, enabled]);

  return {
    count: enabled ? issues.length : 0,
    issues: enabled ? issues : [],
  };
}
