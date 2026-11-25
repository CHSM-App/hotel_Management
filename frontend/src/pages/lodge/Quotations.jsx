import { useState } from 'react';
import PriceSimulatorPanel from './PriceSimulatorPanel';
import EventQuotePanel from './EventQuotePanel';
import MenuQuotePanel from './MenuQuotePanel';
import SavedQuotations from './SavedQuotations';
import { KindIcon } from './QuoteBits';
import { quotableKinds, KIND_LABEL } from './quotationKinds';
import './RoomsAndRates.css';
import './SavedQuotations.css';

// The Quotations page. The list of saved quotations is the home; "New quotation"
// steps into a create view (choose a kind, fill the form) and a save drops back
// to the list with the new quotation at the top.
//
// From the Room Chart it has no `kind`: the create view offers every kind the
// login may quote (`permissions`). An Events, Restaurant or Bar screen opens it
// with its own `kind` locked, so staff there only see their own quotations.
export default function Quotations({ onBack, onConvert, kind = null, permissions = [], backLabel = '← Room Chart' }) {
  const kinds = kind ? [kind] : quotableKinds(permissions);
  const [creating, setCreating] = useState(false);
  const [picked, setPicked] = useState(null);
  // A new key after each save so the list reloads and shows what was just kept.
  const [savedGen, setSavedGen] = useState(0);
  const current = kinds.includes(picked) ? picked : kinds[0] || 'ROOM';

  const saved = () => {
    setSavedGen((g) => g + 1);
    setCreating(false);
  };

  if (creating) {
    return (
      <div className="quote-create">
        <div className="quotations-head">
          <button type="button" className="btn-secondary" onClick={() => setCreating(false)}>
            ← Quotations
          </button>
          <h2>New quotation</h2>
        </div>
        {!kind && kinds.length > 1 && (
          <div className="quote-kinds" role="tablist" aria-label="What are you quoting?">
            {kinds.map((k) => (
              <button
                key={k}
                type="button"
                role="tab"
                aria-selected={current === k}
                className={`quote-kind quote-kind--${k.toLowerCase()}${current === k ? ' quote-kind--on' : ''}`}
                onClick={() => setPicked(k)}
              >
                <KindIcon kind={k} />
                {KIND_LABEL[k]}
              </button>
            ))}
          </div>
        )}
        {current === 'ROOM' && <PriceSimulatorPanel onSaved={saved} />}
        {current === 'EVENT' && <EventQuotePanel onSaved={saved} />}
        {(current === 'FOOD' || current === 'BAR') && <MenuQuotePanel key={current} kind={current} onSaved={saved} />}
      </div>
    );
  }

  return (
    <div>
      {onBack && (
        <div className="quotations-head">
          <button type="button" className="btn-secondary" onClick={onBack}>
            {backLabel}
          </button>
        </div>
      )}
      <SavedQuotations
        key={`${savedGen}-${kind || 'all'}`}
        onConvert={onConvert}
        kind={kind}
        kinds={kinds}
        onNew={() => setCreating(true)}
      />
    </div>
  );
}
