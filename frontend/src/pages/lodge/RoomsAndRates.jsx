import { useUrlState } from '../../lib/urlState';
import RoomsPanel from './RoomsPanel';
import PriceChartPanel from './PriceChartPanel';
import PriceSimulatorPanel from './PriceSimulatorPanel';
import CheckoutPolicyPanel from './CheckoutPolicyPanel';
import './RoomsAndRates.css';

const TABS = [
  { key: 'rooms', label: 'Rooms' },
  { key: 'chart', label: 'Price chart' },
  { key: 'simulator', label: 'Price simulator' },
  // Sits with rates rather than under bookings: a late-checkout fee is a price
  // the owner sets, not a decision the front desk makes on the day.
  { key: 'checkout', label: 'Checkout policy' },
];

export default function RoomsAndRates() {
  const [tab, setTab] = useUrlState('tab', 'rooms');
  // A ?tab= this screen doesn't own falls back to the first tab rather than
  // matching nothing and rendering an empty page under an unselected strip.
  // The sidebar drops the key when it moves between sections, so this catches
  // what it can't: a bookmark, a pasted link, a hand-edited URL.
  const activeTab = TABS.some((t) => t.key === tab) ? tab : 'rooms';

  return (
    <div>
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

      {activeTab === 'rooms' && <RoomsPanel />}
      {activeTab === 'chart' && <PriceChartPanel />}
      {activeTab === 'simulator' && <PriceSimulatorPanel />}
      {activeTab === 'checkout' && <CheckoutPolicyPanel />}
    </div>
  );
}
