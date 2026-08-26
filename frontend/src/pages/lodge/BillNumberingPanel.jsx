import { useEffect, useState } from 'react';
import { apiGet, apiPatch, ApiError } from '../../lib/api';
import { getSession } from '../../lib/auth';
import './forms.css';
import './BillNumberingPanel.css';

// The two documents a guest is handed, and the serial each one continues from.
//
// Named for what the owner recognises rather than for the series row behind it:
// whether this property bills under GST was decided at onboarding and is stored
// on the lodge, so only one of the two invoice series is ever used. Showing
// "GST invoice" and "bill of supply" as separate settings would be offering a
// choice that has already been made.
const SERIES = [
  {
    key: 'final',
    api: 'FINAL',
    title: 'Bills',
    note: 'The bill a guest is given at checkout.',
  },
  {
    key: 'advance',
    api: 'ADVANCE',
    title: 'Advance receipts',
    note: 'The receipt for money taken when a booking is made.',
  },
];

// What is already spent, said plainly. Split out because the prefixed-history
// case needs a sentence rather than a number.
function hint(data) {
  if (data.highestIssued > 0) {
    return `Already issued up to ${data.highestIssued}, so this must be ${data.minimumAllowed} or higher.`;
  }
  if (data.issuedCount > 0) {
    return `${data.issuedCount} already issued under the old prefixed numbering — those keep the numbers they were printed with. Choose where the new plain numbering should start.`;
  }
  return 'Nothing has been issued yet, so you can start anywhere.';
}

function SeriesCard({ series, data, token, onSaved }) {
  const [value, setValue] = useState(String(data.nextNumber));
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  const parsed = Number(value);
  const isWhole = Number.isInteger(parsed) && parsed >= 1;
  const tooLow = isWhole && parsed < data.minimumAllowed;
  const unchanged = isWhole && parsed === data.nextNumber;

  const handleSave = async () => {
    setError('');
    setSaving(true);
    try {
      const updated = await apiPatch(
        `/billing/series/${series.api}`,
        { nextNumber: parsed },
        { token }
      );
      onSaved(series.key, updated);
      setSaved(true);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not save the number.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <section className="numbering__card">
      <header className="numbering__card-head">
        <h3 className="numbering__card-title">{series.title}</h3>
        <p className="numbering__card-note">{series.note}</p>
      </header>

      <div className="numbering__current">
        <span className="numbering__current-label">Next one will be</span>
        <strong className="numbering__current-value">{data.nextDocumentNumber}</strong>
      </div>

      <label className="form-field numbering__field">
        <span className="form-field__label">Start numbering from</span>
        <input
          type="number"
          min={data.minimumAllowed}
          step="1"
          className="form-field__input"
          value={value}
          onChange={(e) => {
            setValue(e.target.value);
            setSaved(false);
            setError('');
          }}
        />
        {/* The floor is stated rather than only enforced: an owner picking a
            number needs to know what is already spent before they choose, not
            after the save is rejected.

            Three cases, not two. A property whose history is entirely under the
            old prefixed numbering has documents but no plain-integer floor —
            telling it "nothing has been issued yet" would be false and might
            talk someone into restarting a series they meant to continue. */}
        <span className="form-field__hint">{hint(data)}</span>
      </label>

      {tooLow && (
        <p className="numbering__error">
          Number {parsed} has already been used. Start from {data.minimumAllowed} or higher so no
          bill carries a number twice.
        </p>
      )}
      {error && <p className="numbering__error">{error}</p>}
      {saved && !error && <p className="numbering__saved">Saved.</p>}

      <button
        type="button"
        className="btn btn--primary"
        disabled={saving || !isWhole || tooLow || unchanged}
        onClick={handleSave}
      >
        {saving ? 'Saving…' : 'Save'}
      </button>
    </section>
  );
}

export default function BillNumberingPanel() {
  const session = getSession();
  const [data, setData] = useState(null);
  const [error, setError] = useState('');

  useEffect(() => {
    apiGet('/billing/series', { token: session?.token })
      .then((res) => {
        setData(res);
        setError('');
      })
      .catch((err) =>
        setError(err instanceof ApiError ? err.message : 'Could not load the numbering settings.')
      );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleSaved = (key, updated) => setData((d) => ({ ...d, [key]: updated }));

  if (error && !data) {
    return (
      <div className="dash-card">
        <div className="dash-state">{error}</div>
      </div>
    );
  }
  if (!data) {
    return (
      <div className="dash-card">
        <div className="dash-state">Loading the numbering settings…</div>
      </div>
    );
  }

  return (
    <div className="dash-card numbering">
      <header className="numbering__head">
        <h2 className="numbering__title">Bill numbering</h2>
        <p className="numbering__subtitle">
          Bills and advance receipts are numbered separately, each counting up on its own. Numbers
          already printed are never changed — this only sets where the next one continues from.
        </p>
      </header>

      <div className="numbering__grid">
        {SERIES.map((series) => (
          <SeriesCard
            // Remounts the card when the saved number changes, so the input
            // resets to what the server actually stored rather than keeping a
            // stale local edit.
            key={`${series.key}-${data[series.key].nextNumber}`}
            series={series}
            data={data[series.key]}
            token={session?.token}
            onSaved={handleSaved}
          />
        ))}
      </div>
    </div>
  );
}
