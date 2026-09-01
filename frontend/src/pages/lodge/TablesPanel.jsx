import { useEffect, useState } from 'react';
import { apiGet, apiPost, apiPatch, apiDelete, ApiError } from '../../lib/api';
import { getSession } from '../../lib/auth';
import { readCache, writeCache, invalidateCache } from '../../lib/dataCache';
import IconButton from '../../components/IconButton';
import { EditIcon, TrashIcon, RefreshIcon } from '../../components/ActionIcons';
import Req from '../../components/RequiredMark';
import './forms.css';
import './MenuPanel.css';

const emptyForm = { mode: 'single', label: '', prefix: 'T', rangeStart: '', rangeEnd: '', seats: '' };

export default function TablesPanel() {
  const session = getSession();
  const [tables, setTables] = useState(() => readCache('/tables'));
  const [error, setError] = useState('');
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [form, setForm] = useState(emptyForm);
  const [formError, setFormError] = useState('');
  const [submitting, setSubmitting] = useState(false);
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
      invalidateCache('/tables');
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
                  <IconButton
                    label={`Edit ${table.label}`}
                    icon={<EditIcon />}
                    onClick={() => openForm(table)}
                  />
                  <button type="button" onClick={() => toggleActive(table)}>
                    {table.isActive ? 'Deactivate' : 'Activate'}
                  </button>
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
                  <label htmlFor="tableLabel">
                    Table name
                    <Req />
                  </label>
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
                      <label htmlFor="tableFrom">
                        From
                        <Req />
                      </label>
                      <input
                        id="tableFrom"
                        type="number"
                        value={form.rangeStart}
                        onChange={(e) => setForm((f) => ({ ...f, rangeStart: e.target.value }))}
                        placeholder="1"
                      />
                    </div>
                    <div className="field">
                      <label htmlFor="tableTo">
                        To
                        <Req />
                      </label>
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
