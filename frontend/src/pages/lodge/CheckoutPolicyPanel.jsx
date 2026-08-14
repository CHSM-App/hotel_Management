import { useEffect, useState } from 'react';
import { apiGet, apiPatch, ApiError } from '../../lib/api';
import { getSession } from '../../lib/auth';
import { readCache, writeCache } from '../../lib/dataCache';
import './forms.css';
import './RoomsAndRates.css';
import './CheckoutPolicyPanel.css';

const MODE_LABEL = {
  HOUR_24: '24-hour stays',
  NIGHT_BASED: 'Night-based stays',
};

const MODE_NOTE = {
  HOUR_24:
    'This property sells a 24-hour cycle, so a stay is due to end 24 hours per night after the guest actually checked in — arrive at 8pm for two nights and you are due out at 8pm two days later. Every guest gets their own deadline, so there is no property-wide checkout time to set.',
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

// The policy read back as the three bands reception will actually be quoted.
function previewSteps(policy) {
  const grace = Number(policy.lateGraceMinutes) || 0;
  const fullAfter = Number(policy.lateFullDayAfterMinutes) || 0;

  return [
    {
      tone: 'free',
      when: grace === 0 ? 'From the checkout deadline' : `First ${hoursAndMinutes(grace)} past checkout`,
      charge: grace === 0 ? 'No free grace period' : 'No charge',
    },
    {
      tone: 'half',
      when:
        grace === 0
          ? `Up to ${hoursAndMinutes(fullAfter)} past checkout`
          : `From ${hoursAndMinutes(grace)} to ${hoursAndMinutes(fullAfter)} past checkout`,
      charge: `${policy.lateHalfDayPercent}% of a night`,
    },
    {
      tone: 'full',
      when: `More than ${hoursAndMinutes(fullAfter)} past checkout`,
      charge: `${policy.lateFullDayPercent}% of a night`,
    },
  ];
}

export default function CheckoutPolicyPanel() {
  const session = getSession();
  const [policy, setPolicy] = useState(() => readCache('/rooms/checkout-policy'));
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    apiGet('/rooms/checkout-policy', { token: session?.token })
      .then((data) => {
        setPolicy(writeCache('/rooms/checkout-policy', data.policy));
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
      setPolicy(writeCache('/rooms/checkout-policy', data.policy));
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
    <div className="dash-card checkout-policy">
      <header className="checkout-policy__head">
        <div>
          <h2 className="checkout-policy__title">Checkout policy</h2>
          <p className="checkout-policy__subtitle">
            When a stay is due to end here, and what reception should charge a guest who stays past
            it.
          </p>
        </div>
        <span className="checkout-policy__mode">{MODE_LABEL[policy.checkinMode]}</span>
      </header>

      <section className="checkout-policy__section">
        <div>
          <h3 className="checkout-policy__section-title">When a stay ends</h3>
          <p className="checkout-policy__note">{MODE_NOTE[policy.checkinMode]}</p>
        </div>

        <div className="checkout-policy__body">
          {policy.checkinMode === 'HOUR_24' ? (
            // No field here on purpose. The stored checkout time only decides
            // stays with no arrival on record, and a booking cannot be checked
            // out until it has been checked in — so on a 24-hour property it is
            // a control over nothing. The stored value still rides along on
            // save, untouched, because the API requires it.
            <div className="checkout-policy__rule">
              <span className="checkout-policy__rule-label">Due out</span>
              <strong className="checkout-policy__rule-value">
                Arrival time + 24 hours per night booked
              </strong>
            </div>
          ) : (
            <div className="field checkout-policy__field--narrow">
              <label htmlFor="checkOutTime">Checkout time</label>
              <input
                id="checkOutTime"
                type="time"
                value={policy.checkOutTime}
                onChange={(e) => update({ checkOutTime: e.target.value })}
              />
              <p className="checkout-policy__hint">
                Every stay is due to end at this time on the departure date.
              </p>
            </div>
          )}
        </div>
      </section>

      <section className="checkout-policy__section">
        <div>
          <h3 className="checkout-policy__section-title">Charging for a late checkout</h3>
          <p className="checkout-policy__note">
            Reception is shown this as a suggestion when they check out a guest who has run past the
            deadline — they can change it or waive it. Percentages are of the room&apos;s rate on its
            last night, so a suite and a single scale on their own tariff.
          </p>
        </div>

        <div className="checkout-policy__body">
          <div className="field-row">
            <div className="field">
              <label htmlFor="lateGraceMinutes">Free grace period</label>
              <span className="checkout-policy__input">
                <input
                  id="lateGraceMinutes"
                  type="number"
                  min="0"
                  max="720"
                  value={policy.lateGraceMinutes}
                  onChange={(e) => update({ lateGraceMinutes: e.target.value })}
                />
                <span className="checkout-policy__unit">min</span>
              </span>
            </div>
            <div className="field">
              <label htmlFor="lateHalfDayPercent">Then charge</label>
              <span className="checkout-policy__input">
                <input
                  id="lateHalfDayPercent"
                  type="number"
                  min="0"
                  max="200"
                  value={policy.lateHalfDayPercent}
                  onChange={(e) => update({ lateHalfDayPercent: e.target.value })}
                />
                <span className="checkout-policy__unit">% night</span>
              </span>
            </div>
          </div>

          <div className="field-row">
            <div className="field">
              <label htmlFor="lateFullDayAfterMinutes">Full-night charge kicks in after</label>
              <span className="checkout-policy__input">
                <input
                  id="lateFullDayAfterMinutes"
                  type="number"
                  min="0"
                  max="1440"
                  value={policy.lateFullDayAfterMinutes}
                  onChange={(e) => update({ lateFullDayAfterMinutes: e.target.value })}
                />
                <span className="checkout-policy__unit">min</span>
              </span>
            </div>
            <div className="field">
              <label htmlFor="lateFullDayPercent">Full-night charge</label>
              <span className="checkout-policy__input">
                <input
                  id="lateFullDayPercent"
                  type="number"
                  min="0"
                  max="200"
                  value={policy.lateFullDayPercent}
                  onChange={(e) => update({ lateFullDayPercent: e.target.value })}
                />
                <span className="checkout-policy__unit">% night</span>
              </span>
            </div>
          </div>

          <div className="checkout-policy__preview">
            <div className="checkout-policy__preview-title">What reception will be quoted</div>
            <ol className="checkout-policy__steps">
              {previewSteps(policy).map((step) => (
                <li key={step.tone} className="checkout-policy__step" data-tone={step.tone}>
                  <span className="checkout-policy__marker" aria-hidden="true" />
                  <span>
                    <span className="checkout-policy__when">{step.when}</span>
                    <strong className="checkout-policy__charge">{step.charge}</strong>
                  </span>
                </li>
              ))}
            </ol>
          </div>
        </div>
      </section>

      {error && (
        <div className="form-banner form-banner--error checkout-policy__banner">{error}</div>
      )}

      <footer className="checkout-policy__footer">
        {saved && <span className="checkout-policy__saved">✓ Saved</span>}
        <button type="button" className="btn-accent" onClick={handleSave} disabled={saving}>
          {saving ? 'Saving…' : 'Save policy'}
        </button>
      </footer>
    </div>
  );
}
