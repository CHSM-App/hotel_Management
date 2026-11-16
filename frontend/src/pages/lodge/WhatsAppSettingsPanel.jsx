import { useEffect, useState } from 'react';
import { previewLabel, previewText } from './whatsappPreviews';
import { apiGet, apiPatch, ApiError } from '../../lib/api';
import { getSession } from '../../lib/auth';
import PageLoader from '../../components/PageLoader';
import './WhatsAppSettingsPanel.css';

// Which guest messages go out by themselves and which the desk sends by hand.
// Manual sending keeps working either way; this only decides whether the
// message also fires on its own. Shared with the superadmin lodge editor via
// WA_MESSAGES.
export const WA_MESSAGES = [
  { key: 'waAutoBooking', group: 'Bookings', title: 'Booking confirmation', note: 'When a booking is saved.' },
  { key: 'waAutoWalkin', group: 'Bookings', title: 'Walk-in welcome', note: 'When a walk-in guest is checked in.' },
  { key: 'waAutoCancel', group: 'Bookings', title: 'Booking cancelled', note: 'When a booking is cancelled.' },
  { key: 'waAutoBill', group: 'Billing', title: 'Bill link', note: 'As soon as a bill is issued.' },
  {
    key: 'waAutoReceipt',
    group: 'Billing',
    title: 'Advance receipt',
    note: 'When an advance is taken. The booking confirmation already has a receipt link.',
  },
];
const GROUPS = ['Bookings', 'Billing'];

// Two-option selector. A switch says "on/off" and leaves the owner to work out
// what off means; naming both outcomes ("Auto" / "Manual") does not.
function Mode({ label, auto, busy, onPick }) {
  return (
    <div className="wa-mode" role="radiogroup" aria-label={label}>
      <button
        type="button"
        role="radio"
        aria-checked={auto}
        className={`wa-mode__opt${auto ? ' wa-mode__opt--active' : ''}`}
        disabled={busy}
        onClick={() => !auto && onPick(true)}
      >
        Auto
      </button>
      <button
        type="button"
        role="radio"
        aria-checked={!auto}
        className={`wa-mode__opt${!auto ? ' wa-mode__opt--active' : ''}`}
        disabled={busy}
        onClick={() => auto && onPick(false)}
      >
        Manual
      </button>
    </div>
  );
}

export default function WhatsAppSettingsPanel({ lodge, onChange }) {
  const token = getSession()?.token;
  const [settings, setSettings] = useState(null);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState('');
  const [previewKey, setPreviewKey] = useState(null);

  useEffect(() => {
    if (!previewKey) return undefined;
    const onKey = (e) => e.key === 'Escape' && setPreviewKey(null);
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [previewKey]);

  useEffect(() => {
    apiGet('/me/settings', { token })
      .then(setSettings)
      .catch((err) => setError(err instanceof ApiError ? err.message : 'Could not load these settings.'));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const pick = async (key, auto) => {
    setSaving(key);
    setError('');
    try {
      const saved = await apiPatch('/me/settings', { [key]: auto }, { token });
      setSettings(saved);
      onChange?.(saved);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not save this change.');
    } finally {
      setSaving('');
    }
  };

  if (!settings) {
    return (
      <div className="dash-card">
        {error ? <div className="dash-state">{error}</div> : <PageLoader inline label="Loading WhatsApp settings" />}
      </div>
    );
  }

  const autoCount = WA_MESSAGES.filter((m) => settings[m.key]).length;

  return (
    <div className="dash-card wa-settings">
      <header className="wa-settings__head">
        <div>
          <h2 className="wa-settings__title">WhatsApp messages</h2>
          <p className="wa-settings__hint">
            <strong>Auto</strong> sends the message by itself. <strong>Manual</strong> adds a Send button on the
            booking or bill.
          </p>
        </div>
        <span className="wa-settings__count" aria-live="polite">
          {autoCount} auto · {WA_MESSAGES.length - autoCount} manual
        </span>
      </header>

      {error && (
        <div className="wa-settings__error" role="alert">
          {error}
        </div>
      )}

      {GROUPS.map((group) => (
        <section className="wa-settings__group" key={group} aria-labelledby={`wa-group-${group}`}>
          <h3 className="wa-settings__group-title" id={`wa-group-${group}`}>
            {group}
          </h3>
          <ul className="wa-settings__list">
            {WA_MESSAGES.filter((m) => m.group === group).map(({ key, title, note }) => (
              <li className="wa-settings__row" key={key}>
                <div className="wa-settings__text">
                  <span className="wa-settings__name">{title}</span>
                  <span className="wa-settings__note">{note}</span>
                </div>
                <div className="wa-settings__actions">
                  <button type="button" className="wa-settings__preview" onClick={() => setPreviewKey(key)}>
                    Preview
                  </button>
                  <Mode label={`${title}: send automatically or manually`} auto={settings[key]} busy={saving === key} onPick={(auto) => pick(key, auto)} />
                </div>
              </li>
            ))}
          </ul>
        </section>
      ))}

      {previewKey && (
        <div className="wa-preview" role="presentation" onClick={() => setPreviewKey(null)}>
          <div
            className="wa-preview__dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="wa-preview-title"
            onClick={(e) => e.stopPropagation()}
          >
            <header className="wa-preview__head">
              <h3 id="wa-preview-title">{previewLabel(previewKey)}</h3>
              <button type="button" className="wa-preview__close" aria-label="Close preview" onClick={() => setPreviewKey(null)}>
                ×
              </button>
            </header>
            <div className="wa-preview__chat">
              <div className="wa-preview__bubble">{previewText(previewKey, lodge)}</div>
            </div>
            <p className="wa-preview__foot">
              A sample with demo guest details. Nothing is sent, and the real message uses the guest's own details.
            </p>
          </div>
        </div>
      )}
    </div>
  );
}
