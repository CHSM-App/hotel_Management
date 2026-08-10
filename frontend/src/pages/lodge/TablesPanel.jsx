import { useEffect, useState } from 'react';
import { apiGet, apiPost, apiPatch, apiDelete, ApiError } from '../../lib/api';
import { getSession } from '../../lib/auth';
import './forms.css';
import './MenuPanel.css';

const emptyForm = { mode: 'single', label: '', prefix: 'T', rangeStart: '', rangeEnd: '', seats: '' };

export default function TablesPanel() {
  const session = getSession();
  const [tables, setTables] = useState(null);
  const [error, setError] = useState('');
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [form, setForm] = useState(emptyForm);
  const [formError, setFormError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const load = () => {
    apiGet('/tables', { token: session?.token })
      .then((data) => {
        setTables(data.tables);
        setError('');
      })
      .catch((err) => setError(err instanceof ApiError ? err.message : 'Could not load tables.'));
  };

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
    setShowForm(true);
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setFormError('');
    setSubmitting(true);
    try {
      if (editingId) {
        await apiPatch(
          `/tables/${editingId}`,
          { label: form.label, seats: form.seats || null },
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
        await apiPost('/tables', { label: form.label, seats: form.seats || null }, { token: session?.token });
      }
      setShowForm(false);
      load();
    } catch (err) {
      setFormError(err instanceof ApiError ? err.message : 'Could not save the table.');
    } finally {
      setSubmitting(false);
    }
  };

  const toggleActive = async (table) => {
    try {
      await apiPatch(`/tables/${table.id}/status`, { isActive: !table.isActive }, { token: session?.token });
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
      load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not issue a new QR code.');
    }
  };

  const remove = async (table) => {
    if (!window.confirm(`Delete ${table.label}?`)) return;
    try {
      await apiDelete(`/tables/${table.id}`, { token: session?.token });
      load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not delete the table.');
    }
  };

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
        <div className="menu-section">
          <ul className="menu-items">
            {tables.map((table) => (
              <li className={`menu-item ${table.isActive ? '' : 'menu-item--out'}`} key={table.id}>
                <div className="menu-item__body">
                  <div className="menu-item__name">
                    {table.label}
                    {!table.isActive && <span className="badge badge--off">Inactive</span>}
                  </div>
                  <div className="menu-item__desc">
                    {table.seats ? `${table.seats} seats` : 'Seats not set'}
                  </div>
                </div>
                <div className="menu-item__actions">
                  <button type="button" onClick={() => openForm(table)}>
                    Edit
                  </button>
                  <button type="button" onClick={() => toggleActive(table)}>
                    {table.isActive ? 'Deactivate' : 'Activate'}
                  </button>
                  <button type="button" onClick={() => regenerateQr(table)}>
                    New QR
                  </button>
                  <button type="button" className="menu-danger" onClick={() => remove(table)}>
                    Delete
                  </button>
                </div>
              </li>
            ))}
          </ul>
        </div>
      )}

      {showForm && (
        <div className="glass-backdrop" onClick={() => !submitting && setShowForm(false)}>
          <div className="glass-panel menu-panel__modal" onClick={(e) => e.stopPropagation()}>
            <h3>{editingId ? 'Edit table' : 'Add tables'}</h3>
            <form onSubmit={handleSubmit} noValidate>
              {formError && <div className="form-banner form-banner--error">{formError}</div>}

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

              {editingId || form.mode === 'single' ? (
                <div className="field">
                  <label htmlFor="tableLabel">Table name</label>
                  <input
                    id="tableLabel"
                    value={form.label}
                    onChange={(e) => setForm((f) => ({ ...f, label: e.target.value }))}
                    placeholder="T1"
                    autoFocus
                  />
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
                      <label htmlFor="tableFrom">From</label>
                      <input
                        id="tableFrom"
                        type="number"
                        value={form.rangeStart}
                        onChange={(e) => setForm((f) => ({ ...f, rangeStart: e.target.value }))}
                        placeholder="1"
                      />
                    </div>
                    <div className="field">
                      <label htmlFor="tableTo">To</label>
                      <input
                        id="tableTo"
                        type="number"
                        value={form.rangeEnd}
                        onChange={(e) => setForm((f) => ({ ...f, rangeEnd: e.target.value }))}
                        placeholder="12"
                      />
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

              <div className="menu-panel__modal-actions">
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
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
