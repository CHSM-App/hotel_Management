// "12 min", "2 h 5 min", "3 days" — how long something has been going on.
export function ago(timestamp, now) {
  const minutes = Math.max(0, Math.floor((now - new Date(timestamp).getTime()) / 60000));
  if (minutes < 1) return 'under a minute';
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return minutes % 60 ? `${hours} h ${minutes % 60} min` : `${hours} h`;
  const days = Math.floor(hours / 24);
  return `${days} ${days === 1 ? 'day' : 'days'}`;
}

// Raised by the Issues list when one is closed or the Finish popup when one is
// reported, so the sidebar count catches up at once instead of on its next poll.
export const ISSUES_CHANGED = 'hk-issues-changed';

// Cards or table, one choice for the room board and the Issues list, remembered
// on this device. Storage can be blocked (a private window), and the screens
// must still open.
const VIEW_KEY = 'hm_hk_rooms_view';

export function readView() {
  try {
    return localStorage.getItem(VIEW_KEY) === 'table' ? 'table' : 'cards';
  } catch {
    return 'cards';
  }
}

export function saveView(view) {
  try {
    localStorage.setItem(VIEW_KEY, view);
  } catch {
    // not remembered, nothing else to do
  }
}
