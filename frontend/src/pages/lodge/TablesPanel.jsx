import { useEffect, useRef, useState } from 'react';
import { apiGet, apiPost, apiPatch, apiDelete, ApiError } from '../../lib/api';
import { getSession } from '../../lib/auth';
import { readCache, writeCache, invalidateCache } from '../../lib/dataCache';
import IconButton from '../../components/IconButton';
import { EditIcon, TrashIcon, RefreshIcon } from '../../components/ActionIcons';
import Req from '../../components/RequiredMark';
import './forms.css';
import './MenuPanel.css';
import './RoomsPanel.css';
import './TablesPanel.css';

const emptyForm = { mode: 'single', label: '', prefix: 'T', rangeStart: '', rangeEnd: '', seats: '' };

// A chair glyph, at the same 12px box and stroke weight as the chip icons in
// RoomsPanel, so a seats chip sits at the same optical size as the rest of
// the app's card chips.
function SeatsIcon() {
  return (
    <svg
      width="12"
      height="12"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M6 9V4a1 1 0 0 1 1-1h10a1 1 0 0 1 1 1v5" />
      <path d="M5 9h14a1 1 0 0 1 1 1v4a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1v-4a1 1 0 0 1 1-1Z" />
      <path d="M6 15v6M18 15v6" />
    </svg>
  );
}

export default function TablesPanel() {
  const session = getSession();
  const [tables, setTables] = useState(() => readCache('/tables'));
  const [error, setError] = useState('');
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [form, setForm] = useState(emptyForm);
  const [formError, setFormError] = useState('');
  const [fieldError, setFieldError] = useState(null);
  const [submitting, setSubmitting] = useState(false);
  const formErrorRef = useRef(null);
  const reportFormError = (message) => {
    setFormError(message);
    requestAnimationFrame(() => {
      formErrorRef.current?.scrollIntoView({ block: 'center', behavior: 'smooth' });
    });
  };
  const failOn = (id, message) => {
    setFieldError({ id, message });
    const el = document.getElementById(id);
    if (!el) return;
    el.focus({ preventScroll: true });
    el.scrollIntoView({ block: 'center', behavior: 'smooth' });
  };
  const fieldErr = (id) =>
    id && fieldError?.id === id ? <p className="field__error">{fieldError.message}</p> : null;
  const invalid = (id) => Boolean(id) && fieldError?.id === id;
  const [deletingId, setDeletingId] = useState(null);

  // Returns the promise so a delete can wait for the corrected list before it
  // lets go of the row it removed optimistically.
  const load = () =>
    apiGet('/tables', { token: session?.token })
      .then((data) => {
        setTables(writeCache('/tables', data.tables));
        setError('');
      })
      .catch((err) => setError(err instanceof ApiError ? err.message : 'Could not load tables.'));

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const openForm = (table) => {
    setEditingId(table?.id ?? null);
    setForm(
      table
        ? { ...emptyForm, label: table.label, seats: table.seats != null ? String(table.seats) : '' }
        : emptyForm
    );
    setFormError('');
    setFieldError(null);
    setShowForm(true);
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setFormError('');
    setFieldError(null);

    if (editingId || form.mode !== 'bulk') {
      if (!form.label.trim()) {
        failOn('tableLabel', 'Enter a table name.');
        return;
      }
    } else if (!form.rangeStart) {
      failOn('tableFrom', 'Enter the start of the range.');
      return;
    } else if (!form.rangeEnd) {
      failOn('tableTo', 'Enter the end of the range.');
      return;
    } else if (Number(form.rangeEnd) < Number(form.rangeStart)) {
      failOn('tableTo', 'The range end must not be before its start.');
      return;
    }

    setSubmitting(true);
    try {
      if (editingId) {
        await apiPatch(
          `/tables/${editingId}`,
          { label: form.label.trim(), seats: form.seats || null },
          { token: session?.token }
        );
      } else if (form.mode === 'bulk') {
        await apiPost(
          '/tables/bulk',
          {
            prefix: form.prefix,
            rangeStart: form.rangeStart,
            rangeEnd: form.rangeEnd,
            seats: form.seats || null,
          },
          { token: session?.token }
        );
      } else {
        await apiPost(
          '/tables',
          { label: form.label.trim(), seats: form.seats || null },
          { token: session?.token }
        );
      }
      setShowForm(false);
      invalidateCache('/tables');
      load();
    } catch (err) {
      if (err instanceof ApiError && err.field && document.getElementById(err.field)) {
        failOn(err.field, err.message);
      } else {
        reportFormError(err instanceof ApiError ? err.message : 'Could not save the table.');
      }
    } finally {
      setSubmitting(false);
    }
  };

  const toggleActive = async (table) => {
    try {
      await apiPatch(`/tables/${table.id}/status`, { isActive: !table.isActive }, { token: session?.token });
      invalidateCache('/tables');
      load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not update the table.');
    }
  };

  const regenerateQr = async (table) => {
    const confirmed = window.confirm(
      `Issue a new QR code for ${table.label}?\n\nEvery printed copy of the current code will stop working, so you'll need to print and stick the new one.`
    );
    if (!confirmed) return;
    try {
      await apiPost(`/tables/${table.id}/regenerate-qr`, {}, { token: session?.token });
      invalidateCache('/tables');
      load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not issue a new QR code.');
    }
  };

  // Deletes exactly the one table whose button was pressed. The row goes from
  // the list straight away rather than waiting for the refetch — over a slow
  // link the old list stayed on screen long enough to look like nothing had
  // happened, and a second impatient click would then delete the next table.
  // `deletingId` closes that window; the refetch behind it is what corrects
  // the list if the server disagrees.
  const remove = async (table) => {
    if (deletingId) return;
    if (!window.confirm(`Delete ${table.label}?`)) return;
    setDeletingId(table.id);
    try {
      await apiDelete(`/tables/${table.id}`, { token: session?.token });
      setTables((current) => (current ? current.filter((t) => t.id !== table.id) : current));
      // Both the QR codes tab and Orders read tables from this cache, so a
      // delete that only rewrote this panel's key left the deleted table's QR
      // card on screen — and back in this list on the next visit.
      invalidateCache('/tables');
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not delete the table.');
      invalidateCache('/tables');
      load();
    } finally {
      setDeletingId(null);
    }
  };

  // How many tables this submit will create, for the footer. A range whose ends
  // aren't both filled in yet has no count to give, so it says so rather than
  // showing a wrong one. Display only — handleSubmit is untouched.
  const tableCountLabel = (() => {
    if (editingId) return form.label.trim() || 'This table';
    if (form.mode !== 'bulk') return form.label.trim() || '1 table';
    const from = Number(form.rangeStart);
    const to = Number(form.rangeEnd);
    if (!form.rangeStart || !form.rangeEnd) return 'Table range';
    if (!Number.isFinite(from) || !Number.isFinite(to) || to < from) return 'Table range';
    const n = to - from + 1;
    return `${n} table${n === 1 ? '' : 's'}`;
  })();

  return (
    <div className="tables-panel">
      <div className="rooms-panel__toolbar">
        <span className="rooms-panel__count">
          {tables ? `${tables.length} table${tables.length === 1 ? '' : 's'}` : ' '}
        </span>
        <button type="button" className="btn-accent" onClick={() => openForm(null)}>
          + Add tables
        </button>
      </div>

      {error && (
        <div className="dash-card">
          <div className="dash-state">{error}</div>
        </div>
      )}

      {!error && !tables && (
        <div className="dash-card">
          <div className="dash-state">Loading tables…</div>
        </div>
      )}

      {!error && tables && tables.length === 0 && (
        <div className="dash-card">
          <div className="dash-state">
            No tables yet. Add them here, then print each one&apos;s QR code from the QR codes tab.
          </div>
        </div>
      )}

      {!error && tables && tables.length > 0 && (
        <div className="table-grid">
          {tables.map((table) => (
            <div className={`table-card${table.isActive ? '' : ' table-card--off'}`} key={table.id}>
              <div className="table-card__band">
                <span className="table-card__label">{table.label}</span>
                <button
                  type="button"
                  className={`table-card__status badge ${table.isActive ? 'badge--on' : 'badge--off'}`}
                  onClick={() => toggleActive(table)}
                  title={`Click to ${table.isActive ? 'deactivate' : 'activate'} ${table.label}`}
                  aria-label={`${table.label} is ${table.isActive ? 'active' : 'inactive'}. Click to ${
                    table.isActive ? 'deactivate' : 'activate'
                  }.`}
                >
                  {table.isActive ? 'Active' : 'Inactive'}
                </button>
              </div>

              <div className="table-card__body">
                {table.seats ? (
                  <span className="table-card__chip">
                    <SeatsIcon />
                    {table.seats} seat{table.seats === 1 ? '' : 's'}
                  </span>
                ) : (
                  <span className="table-card__chip table-card__chip--muted">Seats not set</span>
                )}
              </div>

              <div className="table-card__actions">
                <IconButton
                  label={`Edit ${table.label}`}
                  icon={<EditIcon />}
                  onClick={() => openForm(table)}
                />
                <IconButton
                  label={`New QR code for ${table.label}`}
                  icon={<RefreshIcon />}
                  onClick={() => regenerateQr(table)}
                />
                <IconButton
                  label={`Delete ${table.label}`}
                  icon={<TrashIcon />}
                  tone="danger"
                  disabled={deletingId != null}
                  onClick={() => remove(table)}
                />
              </div>
            </div>
          ))}
        </div>
      )}

      {showForm && (
        <div className="glass-backdrop menu-panel__backdrop" onClick={() => !submitting && setShowForm(false)}>
          <div
            className="glass-panel menu-panel__modal modal-form__panel"
            onClick={(e) => e.stopPropagation()}
          >
            <form className="modal-form" onSubmit={handleSubmit} noValidate>
              <div className="modal-form__head">
                <div className="modal-form__head-row">
                  <h3>{editingId ? 'Edit table' : 'Add tables'}</h3>
                  {/* One table or a room's worth is the first decision, so it
                      belongs beside the title. An edit is always one table. */}
                  {!editingId && (
                    <div className="toggle-group">
                      <button
                        type="button"
                        aria-pressed={form.mode === 'single'}
                        onClick={() => setForm((f) => ({ ...f, mode: 'single' }))}
                      >
                        One table
                      </button>
                      <button
                        type="button"
                        aria-pressed={form.mode === 'bulk'}
                        onClick={() => setForm((f) => ({ ...f, mode: 'bulk' }))}
                      >
                        A range
                      </button>
                    </div>
                  )}
                  <button
                    type="button"
                    className="modal-form__close"
                    onClick={() => setShowForm(false)}
                    disabled={submitting}
                    aria-label="Close"
                    title="Close"
                  >
                    ×
                  </button>
                </div>
                <p className="modal-form__sub">
                  {editingId
                    ? 'What this table is called, and how many it seats.'
                    : form.mode === 'bulk'
                      ? 'Creates every table in the range at once, all seating the same number.'
                      : 'Adds one table. Orders are taken against it by name.'}
                </p>
              </div>

              <div className="modal-form__body">
              {formError && (
                <div ref={formErrorRef} className="form-banner form-banner--error form-banner--flash">
                  {formError}
                </div>
              )}

              {editingId || form.mode === 'single' ? (
                <div className="field">
                  <label htmlFor="tableLabel">
                    Table name
                    <Req />
                  </label>
                  <input
                    id="tableLabel"
                    aria-invalid={invalid('tableLabel')}
                    value={form.label}
                    onChange={(e) => setForm((f) => ({ ...f, label: e.target.value }))}
                    placeholder="T1"
                    autoFocus
                  />
                  {fieldErr('tableLabel')}
                </div>
              ) : (
                <>
                  <div className="field">
                    <label htmlFor="tablePrefix">Name starts with</label>
                    <input
                      id="tablePrefix"
                      value={form.prefix}
                      onChange={(e) => setForm((f) => ({ ...f, prefix: e.target.value }))}
                      placeholder="T"
                    />
                  </div>
                  <div className="field-row">
                    <div className="field">
                      <label htmlFor="tableFrom">
                        From
                        <Req />
                      </label>
                      <input
                        id="tableFrom"
                        type="number"
                        aria-invalid={invalid('tableFrom')}
                        value={form.rangeStart}
                        onChange={(e) => setForm((f) => ({ ...f, rangeStart: e.target.value }))}
                        placeholder="1"
                      />
                      {fieldErr('tableFrom')}
                    </div>
                    <div className="field">
                      <label htmlFor="tableTo">
                        To
                        <Req />
                      </label>
                      <input
                        id="tableTo"
                        type="number"
                        aria-invalid={invalid('tableTo')}
                        value={form.rangeEnd}
                        onChange={(e) => setForm((f) => ({ ...f, rangeEnd: e.target.value }))}
                        placeholder="12"
                      />
                      {fieldErr('tableTo')}
                    </div>
                  </div>
                </>
              )}

              <div className="field">
                <label htmlFor="tableSeats">Seats (optional)</label>
                <input
                  id="tableSeats"
                  type="number"
                  value={form.seats}
                  onChange={(e) => setForm((f) => ({ ...f, seats: e.target.value }))}
                  placeholder="4"
                />
              </div>
              </div>

              <div className="modal-form__foot">
                <div className="modal-form__summary">
                  <span className="modal-form__summary-label">{tableCountLabel}</span>
                  <span className="modal-form__summary-value">
                    {String(form.seats).trim() === '' ? '—' : form.seats}
                    <span className="modal-form__summary-unit"> seats each</span>
                  </span>
                </div>
                <div className="modal-form__foot-actions">
                  <button
                    type="button"
                    className="btn-secondary"
                    onClick={() => setShowForm(false)}
                    disabled={submitting}
                  >
                    Cancel
                  </button>
                  <button type="submit" className="btn-accent" disabled={submitting}>
                    {submitting ? 'Saving…' : 'Save'}
                  </button>
                </div>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
