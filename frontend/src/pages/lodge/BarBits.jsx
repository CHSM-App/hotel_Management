import { stockText } from './barFormat';

// Small shared pieces for the bar screens.

export const Field = ({ label, children }) => (
  <label className="bar-field">
    <span>{label}</span>
    {children}
  </label>
);

export const Seg = ({ value, onChange, options }) => (
  <div className="bar-seg" role="group">
    {options.map(([key, label]) => (
      <button key={key} type="button" aria-pressed={value === key} onClick={() => onChange(key)}>
        {label}
      </button>
    ))}
  </div>
);

export const Note = ({ kind = 'warn', children }) => (
  <div className={`bar-note bar-note--${kind}`} role={kind === 'error' ? 'alert' : 'status'}>
    {children}
  </div>
);

// Out / Low / In stock, from the server's own isLow (product limit or lodge default).
export function StockChip({ product }) {
  if (product.stockMl <= 0) return <span className="bar-chip bar-chip--out">Out of stock</span>;
  if (product.isLow) return <span className="bar-chip bar-chip--low">Low stock</span>;
  return <span className="bar-chip bar-chip--ok">In stock</span>;
}

export const StockLine = ({ product }) => (
  <span className="bar-num" title={`${product.bottleMl} ml bottle`}>
    {stockText(product)}
  </span>
);

export const Stat = ({ label, value, warn = false }) => (
  <div className={`bar-stat${warn ? ' bar-stat--warn' : ''}`}>
    <span className="bar-stat__label">{label}</span>
    <span className="bar-stat__value">{value}</span>
  </div>
);
