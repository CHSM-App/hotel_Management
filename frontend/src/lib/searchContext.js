import { createContext, useContext } from 'react';

// The app bar's search box, made readable by whatever panel is on screen.
//
// A context rather than props because the box and the list it filters are not
// near each other: the input lives in the topbar, the rooms grid is three
// components down through RoomsAndRates, and every layer in between would have
// had to carry a prop it has no use for. The panels that want it opt in; the
// ones that don't never see it.
//
// Default '' so a panel rendered outside the dashboard — a test, or a screen
// that never mounts the bar — reads "nothing typed" instead of crashing.
export const SearchContext = createContext('');

export function useSearchTerm() {
  return useContext(SearchContext);
}

// Case- and space-insensitive contains, which is what someone typing "del" into
// a search box means. Kept here so every panel matches the same way rather than
// each inventing its own rules.
export function matchesSearch(term, ...fields) {
  const needle = term.trim().toLowerCase();
  if (!needle) return true;
  return fields.some((f) => f != null && String(f).toLowerCase().includes(needle));
}
