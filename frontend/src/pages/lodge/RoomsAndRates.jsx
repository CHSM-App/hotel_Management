import { useState } from 'react';
import RoomsPanel from './RoomsPanel';
import PriceChartPanel from './PriceChartPanel';
import PriceSimulatorPanel from './PriceSimulatorPanel';
import './RoomsAndRates.css';

const TABS = [
  { key: 'rooms', label: 'Rooms' },
  { key: 'chart', label: 'Price chart' },
  { key: 'simulator', label: 'Price simulator' },
];

export default function RoomsAndRates() {
  const [tab, setTab] = useState('rooms');

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
    </div>
  );
}
