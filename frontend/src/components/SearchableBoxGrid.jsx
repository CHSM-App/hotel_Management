import { useMemo, useState } from 'react';
import './SearchableBoxGrid.css';

/* One box in the grid.

   The colour is passed in rather than picked from a class, and it does two jobs:
   it fills the box, and it tints the rings that ping out of it. Both read the
   same two custom properties, so a new colour needs no CSS at all — a box is
   whatever colour it was handed, and it pings in that colour.

   isHighlighted is the only thing that starts the animation. Keeping it a prop
   rather than state inside the box means the parent stays the single place that
   decides what is currently found, which is what lets a click clear it. */
export function Box({ label, color, isHighlighted = false, onClick }) {
  return (
    <button
      type="button"
      className={`box${isHighlighted ? ' box--highlighted' : ''}`}
      style={{ '--box-color': color, '--pulse-color': color }}
      onClick={onClick}
      // The ping is decoration; the fact it is a match is not. Said out loud
      // here so the highlight is not purely visual.
      aria-pressed={isHighlighted || undefined}
    >
      <span className="box__label">{label}</span>
    </button>
  );
}

/* The grid, its search box, and the rule for what counts as a match.

   Matching is a plain case-insensitive substring test against the label. It is
   deliberately not a filter: the boxes all stay where they are and the matches
   ping in place, so the grid never reflows under the person typing into it and
   a match can be read against the ones around it. */
export default function SearchableBoxGrid({ boxes }) {
  const [search, setSearch] = useState('');
  // Boxes the reader has clicked to quieten. Cleared whenever the query
  // changes — a dismissal applies to the search that produced it, not to every
  // future one, or a box silenced once would never ping again.
  const [dismissed, setDismissed] = useState(() => new Set());

  const query = search.trim().toLowerCase();

  const matchIds = useMemo(() => {
    if (!query) return new Set();
    return new Set(
      boxes.filter((b) => b.label.toLowerCase().includes(query)).map((b) => b.id)
    );
  }, [boxes, query]);

  const onSearchChange = (text) => {
    setSearch(text);
    // A new question deserves a fresh answer, including from the boxes that
    // were told to be quiet about the last one.
    setDismissed(new Set());
  };

  const dismiss = (id) => {
    setDismissed((prev) => {
      const next = new Set(prev);
      next.add(id);
      return next;
    });
  };

  const matchCount = matchIds.size;

  return (
    <div className="box-grid-panel">
      <input
        type="search"
        className="box-grid__search"
        value={search}
        onChange={(e) => onSearchChange(e.target.value)}
        placeholder="Search boxes…"
        aria-label="Search boxes"
      />

      {/* Spoken on change, so the result of a search is announced rather than
          only pinged at someone who can see it. */}
      <p className="box-grid__count" role="status" aria-live="polite">
        {query === ''
          ? `${boxes.length} boxes`
          : `${matchCount} match${matchCount === 1 ? '' : 'es'} for “${search.trim()}”`}
      </p>

      <div className="box-grid">
        {boxes.map((box) => (
          <Box
            key={box.id}
            label={box.label}
            color={box.color}
            // Two ways to stop: clear the search, or click the box. The first
            // empties matchIds, the second puts this box in `dismissed`.
            isHighlighted={matchIds.has(box.id) && !dismissed.has(box.id)}
            onClick={() => dismiss(box.id)}
          />
        ))}
      </div>
    </div>
  );
}
