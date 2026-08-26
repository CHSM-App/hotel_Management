import { useUrlState } from '../../lib/urlState';
import MenuPanel from './MenuPanel';
import RecipesPanel from './RecipesPanel';
import InventoryPanel from './InventoryPanel';
import TablesPanel from './TablesPanel';
import QrCodesPanel from './QrCodesPanel';
import FoodSettingsPanel from './FoodSettingsPanel';
import './RoomsAndRates.css';

export default function FoodSetup({ lodge, onLodgeChange }) {
  const [tab, setTab] = useUrlState('tab', 'menu');
  // Settings can switch table service on mid-session, and the tab strip has to
  // follow without a reload — so it reads the live lodge object, not the one
  // this component mounted with.
  //
  // Recipes and Inventory sit next to Menu because they're read in that order:
  // what we sell, what each dish is made of, what we have left of it.
  const tabs = [
    { key: 'menu', label: 'Menu' },
    { key: 'recipes', label: 'Recipes' },
    { key: 'inventory', label: 'Inventory' },
    ...(lodge?.foodTableService ? [{ key: 'tables', label: 'Tables' }] : []),
    { key: 'qr', label: 'QR codes' },
    { key: 'settings', label: 'Settings' },
  ];

  const activeTab = tabs.some((t) => t.key === tab) ? tab : 'menu';

  return (
    <div>
      <div className="subtabs">
        {tabs.map((t) => (
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

      {activeTab === 'menu' && <MenuPanel />}
      {activeTab === 'recipes' && <RecipesPanel />}
      {activeTab === 'inventory' && <InventoryPanel />}
      {activeTab === 'tables' && <TablesPanel />}
      {activeTab === 'qr' && <QrCodesPanel lodge={lodge} />}
      {activeTab === 'settings' && <FoodSettingsPanel onSaved={onLodgeChange} />}
    </div>
  );
}
