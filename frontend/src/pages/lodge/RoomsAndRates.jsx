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

  return (
    <div>
      <div className="subtabs">
        {TABS.map((t) => (
          <button
            key={t.key}
            type="button"
            className="subtabs__item"
            aria-current={tab === t.key ? 'page' : undefined}
            onClick={() => setTab(t.key)}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === 'rooms' && <RoomsPanel />}
      {tab === 'chart' && <PriceChartPanel />}
      {tab === 'simulator' && <PriceSimulatorPanel />}
      {tab === 'checkout' && <CheckoutPolicyPanel />}
    </div>
  );
}
