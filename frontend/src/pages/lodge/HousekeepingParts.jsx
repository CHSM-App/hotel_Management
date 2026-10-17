// The small pieces the Housekeeping and Laundry panels both use.

// One small glyph per state, so a room reads at a glance without relying on
// colour alone.
const ICON_PATHS = {
  ready: ['M20 6 9 17l-5-5'],
  occupied: ['M3 18v-7a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v7', 'M3 14h18', 'M3 18v2', 'M21 18v2', 'M7 11h3'],
  dirty: ['M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8z', 'M19 16l.7 1.8 1.8.7-1.8.7L19 21l-.7-1.8-1.8-.7 1.8-.7z'],
  cleaning: ['M21 12a9 9 0 1 1-3-6.7', 'M21 4v5h-5'],
  ooo: ['M14.7 6.3a4 4 0 0 0-5.4 5.4L3 18l3 3 6.3-6.3a4 4 0 0 0 5.4-5.4l-2.5 2.5-2.5-.5-.5-2.5z'],
};

export function StatusIcon({ tone, size = 20 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {(ICON_PATHS[tone] ?? ICON_PATHS.ready).map((d) => (
        <path key={d} d={d} />
      ))}
    </svg>
  );
}

// + / − counter: counts are tapped, never typed, so a phone in a wet hand works.
export function Stepper({ value, onChange, label, max = Infinity }) {
  return (
    <span className="hk-stepper" role="group" aria-label={label}>
      <button type="button" onClick={() => onChange(Math.max(0, value - 1))} aria-label={`Less ${label}`}>
        −
      </button>
      <span className="hk-stepper__value">{value}</span>
      <button type="button" onClick={() => onChange(Math.min(max, value + 1))} disabled={value >= max} aria-label={`More ${label}`}>
        +
      </button>
    </span>
  );
}

export function Modal({ title, sub, onClose, busy, children, footer }) {
  return (
    <div className="glass-backdrop menu-panel__backdrop" onClick={() => !busy && onClose()}>
      <div className="glass-panel menu-panel__modal modal-form__panel" onClick={(e) => e.stopPropagation()}>
        <div className="modal-form">
          <div className="modal-form__head">
            <div className="modal-form__head-row">
              <h3>{title}</h3>
              <button type="button" className="modal-form__close" onClick={onClose} aria-label="Close">
                ×
              </button>
            </div>
            {sub && <p className="modal-form__sub">{sub}</p>}
          </div>
          <div className="modal-form__body">{children}</div>
          <div className="modal-form__foot">
            <div className="modal-form__foot-actions">{footer}</div>
          </div>
        </div>
      </div>
    </div>
  );
}

// The cards / table switch: four tiles for cards, ruled rows for the table.
const VIEW_PATHS = {
  cards: ['M4 4h6v6H4z', 'M14 4h6v6h-6z', 'M4 14h6v6H4z', 'M14 14h6v6h-6z'],
  table: ['M4 5h16v14H4z', 'M4 10h16', 'M4 14.5h16', 'M10 10v9'],
};

export function ViewSwitch({ view, onChange, label }) {
  return (
    <div className="hk-view" role="group" aria-label={label}>
      {['cards', 'table'].map((kind) => (
        <button
          key={kind}
          type="button"
          aria-pressed={view === kind}
          aria-label={kind === 'cards' ? 'Cards' : 'Table'}
          title={kind === 'cards' ? 'Cards' : 'Table'}
          onClick={() => onChange(kind)}
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            {VIEW_PATHS[kind].map((d) => (
              <path key={d} d={d} />
            ))}
          </svg>
        </button>
      ))}
    </div>
  );
}
