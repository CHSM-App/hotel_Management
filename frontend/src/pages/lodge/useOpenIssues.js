import { useEffect, useRef, useState } from 'react';
import { apiGet } from '../../lib/api';
import { useToast } from '../../components/Toast';
import { ISSUES_CHANGED } from './housekeepingFormat';

// How many problems and found items housekeeping has reported that nobody has
// closed yet — the number on the sidebar. It also tells the desk when a new one
// arrives: a cleaner reports from a room upstairs, and without this the report
// sits unseen until someone happens to open Housekeeping.
export function useOpenIssues(token, enabled) {
  const [count, setCount] = useState(0);
  const toast = useToast();
  // The newest report already seen. Null until the first answer, so opening the
  // app does not announce everything that was already waiting.
  const seen = useRef(null);

  useEffect(() => {
    if (!enabled) return undefined;
    let stopped = false;
    const load = () =>
      apiGet('/housekeeping/issues/count', { token })
        .then((d) => {
          if (stopped) return;
          if (seen.current !== null && d.latestKey && d.latestKey !== seen.current.key && d.count > seen.current.count) {
            const what = d.latest.kind === 'FOUND' ? 'Item found' : 'Problem reported';
            toast.show(`Room ${d.latest.roomNumber}: ${what} — ${d.latest.text}`, 'info');
          }
          seen.current = { key: d.latestKey, count: d.count };
          setCount(d.count);
        })
        .catch(() => {});
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

  return enabled ? count : 0;
}
