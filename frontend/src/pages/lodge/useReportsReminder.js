import { useEffect, useState } from 'react';

const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

// The property's own wall clock, not the browser's local zone and not a
// server round trip — there's no lodge-specific data behind this, just
// today's date pinned to Asia/Kolkata the same way the rest of the app pins
// its deadlines.
function istParts(date) {
  const fmt = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Kolkata',
    year: 'numeric',
    month: 'numeric',
    day: 'numeric',
  });
  const parts = Object.fromEntries(fmt.formatToParts(date).map((p) => [p.type, p.value]));
  return { year: Number(parts.year), month: Number(parts.month), day: Number(parts.day) };
}

// Day 0 of next month is the last day of this one.
function daysInMonth(year, month) {
  return new Date(year, month, 0).getDate();
}

// A once-a-month nudge that the owner's reports are worth a look. Shown from
// the month's last day through the 3rd of the next month, referencing
// whichever month just closed, so it isn't missed if nobody opens the
// dashboard on the exact last day.
function computeReminder() {
  const { year, month, day } = istParts(new Date());
  const lastDay = daysInMonth(year, month);

  let targetYear = year;
  let targetMonth = month;
  let show = false;
  if (day === lastDay) {
    show = true;
  } else if (day <= 3) {
    show = true;
    targetMonth = month - 1;
    if (targetMonth === 0) {
      targetMonth = 12;
      targetYear -= 1;
    }
  }

  return show
    ? {
        id: 'reports-reminder',
        category: 'reports',
        message: `Monthly reports for ${MONTH_NAMES[targetMonth - 1]} ${targetYear} are ready for your review.`,
        urgent: false,
      }
    : null;
}

export function useReportsReminder(enabled) {
  // Computed lazily on first render rather than in an effect — this is a pure
  // read of the current date, not a fetch, so there's nothing to defer.
  const [alert, setAlert] = useState(computeReminder);

  // Recomputed hourly so a tab left open overnight still picks up the month
  // rolling over, without a full page refresh.
  useEffect(() => {
    if (!enabled) return undefined;
    const timer = setInterval(() => setAlert(computeReminder()), 3600000);
    return () => clearInterval(timer);
  }, [enabled]);

  return enabled && alert ? [alert] : [];
}
