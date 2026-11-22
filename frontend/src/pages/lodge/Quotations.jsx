import { useUrlState } from '../../lib/urlState';
import PriceSimulatorPanel from './PriceSimulatorPanel';
import SavedQuotations from './SavedQuotations';
import './RoomsAndRates.css';
import './SavedQuotations.css';

const TABS = [
  { key: 'new', label: 'New quotation' },
  { key: 'saved', label: 'Saved' },
];

// The Quotations page: price a stay, keep it until check-in, and turn it into
// a booking. A secondary page of the Room Chart (its toolbar's Quotation button
// opens it, Back returns) rather than a sidebar section. Uses Rooms & rates'
// .subtabs strip.
export default function Quotations({ onBack, onConvert }) {
  const [tab, setTab] = useUrlState('tab', 'new');
  const activeTab = TABS.some((t) => t.key === tab) ? tab : 'new';

  return (
    <div>
      <div className="quotations-head">
        <button type="button" className="btn-secondary" onClick={onBack}>
          ← Room Chart
        </button>
        <h2>Quotations</h2>
      </div>
      <div className="subtabs">
        {TABS.map((t) => (
          <button
            key={t.key}
            type="button"
            className="subtabs__item"
            aria-current={activeTab === t.key ? 'page' : undefined}
            onClick={() => setTab(t.key)}
          >
            {t.label}
          </button>
        ))}
      </div>

      {activeTab === 'new' && <PriceSimulatorPanel onSaved={() => setTab('saved')} />}
      {activeTab === 'saved' && <SavedQuotations onConvert={onConvert} />}
    </div>
  );
}
