// What the dashboard has already fetched this session.
//
// Every section is conditionally rendered, so switching away unmounts the
// panel and throws its state out. That is the right shape — a mounted Bookings
// panel polls, and eight panels polling in the background would be worse than
// any refetch — but it means revisiting a section starts from nothing and
// shows a loading state again.
//
// That is fine against a local database and painful against this one: the
// server talks to SQL Server over the internet, where listing rooms costs
// ~400ms warm and a couple of seconds cold. Paying that every time somebody
// clicks between Rooms and Bookings is what makes the app feel like it is
// always loading.
//
// So: a panel paints immediately from whatever it saw last, and refetches
// behind that to correct it. Stale for the length of one request, never
// stale-and-silent — the fetch always runs.
//
// Deliberately a plain module-level Map, not React state or a library. It has
// to outlive the components that fill it, which is the whole point, and it
// holds nothing a page couldn't re-request a moment later.
const store = new Map();

export function readCache(key) {
  return store.has(key) ? store.get(key) : null;
}

export function writeCache(key, value) {
  store.set(key, value);
  return value;
}

// Cleared on sign-out. The next person at this terminal must not be shown the
// last one's guest list while their own request is still in flight.
export function clearCache() {
  store.clear();
}

// Drops every key for one resource after a write that changed it.
//
// The same rows are cached under several keys — tables live under both
// `/tables` and `/tables:active` — so a panel that deletes a table cannot just
// rewrite its own key: the other panels would keep painting the deleted row
// from their stale entry until something else happened to refetch it. Matching
// on the prefix clears the whole family in one call.
//
// Prefix, not exact key, because some keys carry a query string
// (`/bookings?fromDate=…`) and the caller has no way to know which date ranges
// somebody else cached.
export function invalidateCache(prefix) {
  for (const key of Array.from(store.keys())) {
    if (key === prefix || key.startsWith(`${prefix}:`) || key.startsWith(`${prefix}?`)) {
      store.delete(key);
    }
  }
}
