import { useEffect, useState } from 'react';
import { apiGet, apiPatch, ApiError } from '../../lib/api';
import { getSession } from '../../lib/auth';
import './forms.css';
import './MenuPanel.css';

export default function FoodSettingsPanel({ onSaved }) {
  const session = getSession();
  const [settings, setSettings] = useState(null);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    apiGet('/menu/settings', { token: session?.token })
      .then((data) => {
        setSettings(data.settings);
        setError('');
      })
      .catch((err) => setError(err instanceof ApiError ? err.message : 'Could not load these settings.'));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const update = (patch) => {
    setSaved(false);
    setSettings((s) => ({ ...s, ...patch }));
  };

  const handleSave = async () => {
    setError('');
    setSaving(true);
    try {
      const data = await apiPatch(
        '/menu/settings',
        {
          servesFood: settings.servesFood,
          foodRoomService: settings.foodRoomService,
          foodTableService: settings.foodTableService,
        },
        { token: session?.token }
      );
      setSettings(data.settings);
      setSaved(true);
      onSaved?.(data.settings);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not save these settings.');
    } finally {
      setSaving(false);
    }
  };

  if (error && !settings) {
    return (
      <div className="dash-card">
        <div className="dash-state">{error}</div>
      </div>
    );
  }

  if (!settings) {
    return (
      <div className="dash-card">
        <div className="dash-state">Loading settings…</div>
      </div>
    );
  }

  return (
    <div className="dash-card food-settings">
      {error && <div className="form-banner form-banner--error">{error}</div>}

      <div className="checkbox-inline">
        <input
          id="servesFood"
          type="checkbox"
          checked={settings.servesFood}
          onChange={(e) => update({ servesFood: e.target.checked })}
        />
        <label htmlFor="servesFood">This property serves food</label>
      </div>

      <div className="food-settings__group">
        <div className="checkbox-inline">
          <input
            id="foodRoomService"
            type="checkbox"
            checked={settings.foodRoomService}
            disabled={!settings.servesFood || !settings.hasRooms}
            onChange={(e) => update({ foodRoomService: e.target.checked })}
          />
          <label htmlFor="foodRoomService">
            Take orders from rooms
            {!settings.hasRooms && <span className="food-settings__why"> — this property has no rooms</span>}
          </label>
        </div>

        <div className="checkbox-inline">
          <input
            id="foodTableService"
            type="checkbox"
            checked={settings.foodTableService}
            disabled={!settings.servesFood}
            onChange={(e) => update({ foodTableService: e.target.checked })}
          />
          <label htmlFor="foodTableService">Take orders from dining tables</label>
        </div>
      </div>

      <p className="menu-panel__hint">
        One QR code covers the whole property. Guests scan it, pick their items, then enter their
        room number and the PIN reception gave them at check-in — which stops working the moment
        they check out. Five wrong PINs locks that room out of ordering for fifteen minutes;
        reception can unlock it from the booking. Table orders have no PIN — they wait in the queue
        until the kitchen accepts them, so a prank order costs a tap, not a dish.
      </p>

      <div className="menu-panel__modal-actions">
        {saved && <span className="food-settings__saved">Saved</span>}
        <button type="button" className="btn-accent" onClick={handleSave} disabled={saving}>
          {saving ? 'Saving…' : 'Save settings'}
        </button>
      </div>
    </div>
  );
}
