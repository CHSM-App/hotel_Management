// Small building blocks shared by the quotation screens.

const P = { fill: 'none', stroke: 'currentColor', strokeWidth: 1.8, strokeLinecap: 'round', strokeLinejoin: 'round' };

const ICONS = {
  ROOM: <path d="M3 18v-7a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v7M3 18h18M3 14h18M7 9V7h4v2" />,
  EVENT: <path d="m4 20 4-12 8 8-12 4Zm9-14 1-2m3 5 2-1m-3 6 2 1M14 4v0" />,
  FOOD: <path d="M7 3v8m-3-8v5a3 3 0 0 0 6 0V3M7 11v10M17 3c-2 2-3 5-3 8h3v10" />,
  BAR: <path d="M5 4h14l-7 8-7-8Zm7 8v8m-4 0h8" />,
};

export function KindIcon({ kind, size = 20 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true" {...P}>
      {ICONS[kind] || ICONS.ROOM}
    </svg>
  );
}

// One titled card of a quotation form.
export function QuoteSection({ title, hint, children }) {
  return (
    <section className="dash-card quote-section">
      <header>
        <h3>{title}</h3>
        {hint && <p>{hint}</p>}
      </header>
      {children}
    </section>
  );
}

// The create view's layout: the inputs on the left, customer / price / buttons on
// the right on a wide screen; stacked on a narrow one.
export function QuoteColumns({ main, side }) {
  return (
    <div className="quote-cols">
      <div className="quote-cols__main">{main}</div>
      <div className="quote-cols__side">{side}</div>
    </div>
  );
}

// "Save quotation" plus "Save & send on WhatsApp".
export function QuoteActions({ saving, disabled, onSave, onSaveAndSend }) {
  return (
    <div className="quote-actions">
      <button type="button" className="btn-accent" disabled={saving || disabled} onClick={onSave}>
        {saving ? 'Saving…' : 'Save quotation'}
      </button>
      <button type="button" className="btn-whatsapp" disabled={saving || disabled} onClick={onSaveAndSend}>
        Save &amp; send on WhatsApp
      </button>
    </div>
  );
}
