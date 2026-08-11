import { useEffect, useState } from 'react';
import { apiGet, apiPatch, ApiError } from '../../lib/api';
import { getSession } from '../../lib/auth';
import './forms.css';
import './RoomsAndRates.css';

const MODE_NOTE = {
  HOUR_24:
    'This property sells a 24-hour cycle, so a stay is due to end 24 hours per night after the guest actually checked in. The checkout time below is only used for stays that were never formally checked in.',
  NIGHT_BASED:
    'This property is night-based, so every stay is due to end at the checkout time below on the departure date, whatever time the guest arrived.',
};

// How long "1h 30m" reads better than "90". Used for the two minute fields,
// which owners think about in hours but the policy stores in minutes.
function hoursAndMinutes(minutes) {
  if (minutes === 0) return 'immediately';
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  if (h === 0) return `${m} min`;
  return m === 0 ? `${h}h` : `${h}h ${m}m`;
}

export default function CheckoutPolicyPanel() {
  const session = getSession();
  const [policy, setPolicy] = useState(null);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    apiGet('/rooms/checkout-policy', { token: session?.token })
      .then((data) => {
        setPolicy(data.policy);
        setError('');
      })
      .catch((err) =>
        setError(err instanceof ApiError ? err.message : 'Could not load the checkout policy.')
      );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const update = (patch) => {
    setSaved(false);
    setPolicy((p) => ({ ...p, ...patch }));
  };

  const handleSave = async () => {
    setError('');
    setSaving(true);
    try {
      const data = await apiPatch(
        '/rooms/checkout-policy',
        {
          checkOutTime: policy.checkOutTime,
          lateGraceMinutes: Number(policy.lateGraceMinutes),
          lateHalfDayPercent: Number(policy.lateHalfDayPercent),
          lateFullDayAfterMinutes: Number(policy.lateFullDayAfterMinutes),
          lateFullDayPercent: Number(policy.lateFullDayPercent),
        },
        { token: session?.token }
      );
      setPolicy(data.policy);
      setSaved(true);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not save the checkout policy.');
    } finally {
      setSaving(false);
    }
  };

  if (error && !policy) {
    return (
      <div className="dash-card">
        <div className="dash-state">{error}</div>
      </div>
    );
  }

  if (!policy) {
    return (
      <div className="dash-card">
        <div className="dash-state">Loading the checkout policy…</div>
      </div>
    );
  }

  return (
    <div className="dash-card">
      <div className="form-section">
        <div className="form-section__title">When a stay ends</div>
        <p className="checkout-policy__note">{MODE_NOTE[policy.checkinMode]}</p>

        <div className="field">
          <label htmlFor="checkOutTime">Checkout time</label>
          <input
            id="checkOutTime"
            type="time"
            value={policy.checkOutTime}
            onChange={(e) => update({ checkOutTime: e.target.value })}
          />
        </div>
      </div>

      <div className="form-section">
        <div className="form-section__title">Charging for a late checkout</div>
        <p className="checkout-policy__note">
          Reception is shown this as a suggestion when they check out a guest who has run past the
          deadline — they can change it or waive it. Percentages are of the room&apos;s rate on its
          last night, so a suite and a single scale on their own tariff.
        </p>

        <div className="field-row">
          <div className="field">
            <label htmlFor="lateGraceMinutes">Free grace period (minutes)</label>
            <input
              id="lateGraceMinutes"
              type="number"
              min="0"
              max="720"
              value={policy.lateGraceMinutes}
              onChange={(e) => update({ lateGraceMinutes: e.target.value })}
            />
          </div>
          <div className="field">
            <label htmlFor="lateHalfDayPercent">Then charge (% of a night)</label>
            <input
              id="lateHalfDayPercent"
              type="number"
              min="0"
              max="200"
              value={policy.lateHalfDayPercent}
              onChange={(e) => update({ lateHalfDayPercent: e.target.value })}
            />
          </div>
        </div>

        <div className="field-row">
          <div className="field">
            <label htmlFor="lateFullDayAfterMinutes">Full-night charge kicks in after (minutes)</label>
            <input
              id="lateFullDayAfterMinutes"
              type="number"
              min="0"
              max="1440"
              value={policy.lateFullDayAfterMinutes}
              onChange={(e) => update({ lateFullDayAfterMinutes: e.target.value })}
            />
          </div>
          <div className="field">
            <label htmlFor="lateFullDayPercent">Full-night charge (% of a night)</label>
            <input
              id="lateFullDayPercent"
              type="number"
              min="0"
              max="200"
              value={policy.lateFullDayPercent}
              onChange={(e) => update({ lateFullDayPercent: e.target.value })}
            />
          </div>
        </div>

        {/* The policy read back as a sentence. Four number fields are easy to
            fill in and hard to picture; this is what reception will actually
            see quoted at them in the checkout dialog. */}
        <p className="checkout-policy__summary">
          Free for {hoursAndMinutes(Number(policy.lateGraceMinutes) || 0)} past checkout, then{' '}
          <strong>{policy.lateHalfDayPercent}%</strong> of a night — and{' '}
          <strong>{policy.lateFullDayPercent}%</strong> once they are more than{' '}
          {hoursAndMinutes(Number(policy.lateFullDayAfterMinutes) || 0)} over.
        </p>
      </div>

      {error && <div className="form-banner form-banner--error">{error}</div>}

      <div className="checkout-policy__actions">
        {saved && <span className="checkout-policy__saved">Saved</span>}
        <button type="button" className="btn-accent" onClick={handleSave} disabled={saving}>
          {saving ? 'Saving…' : 'Save policy'}
        </button>
      </div>
    </div>
  );
}
