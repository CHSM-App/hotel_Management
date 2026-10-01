import { useEffect, useState } from 'react';
import { apiGet, apiPost, apiPatch, ApiError } from '../../lib/api';
import { getSession } from '../../lib/auth';
import { formatPrice } from './priceFormat';
import PageLoader from '../../components/PageLoader';
import Req from '../../components/RequiredMark';
import './forms.css';
import './chartSections.css';
import './MenuPanel.css';
import './RoomsPanel.css';

const emptyService = { name: '', unitLabel: 'use', price: '', gstRatePercent: '18' };
const emptyUse = { serviceId: '', quantity: '1', bookingId: '', guestName: '', guestPhone: '', note: '' };

const STATUS_LABEL = { IN_USE: 'In use', COMPLETED: 'Completed', CANCELLED: 'Cancelled' };

// Other services a lodge sells per use — laundry, a private pool, a gaming
// area. Two views: the catalogue (what is offered and at what price) and the
// usage list (who is using what, through to "ready to bill"). Billing itself
// happens in Billing > Services to bill, the way food does.
export default function ServicesPanel() {
  const token = getSession()?.token;
  const [view, setView] = useState('usage');
  const [services, setServices] = useState(null);
  const [usages, setUsages] = useState(null);
  const [guests, setGuests] = useState([]);
  const [error, setError] = useState('');
  const [form, setForm] = useState(null); // { id?, ...fields } while the service modal is open
  const [useForm, setUseForm] = useState(null); // fields while the "start use" modal is open
  const [formError, setFormError] = useState('');
  const [busy, setBusy] = useState(false);

  const fail = (err, fallback) => setError(err instanceof ApiError ? err.message : fallback);

  const loadServices = () =>
    apiGet('/lodge-services?includeInactive=true', { token })
      .then((d) => setServices(d.services))
      .catch((err) => fail(err, 'Could not load services.'));
  const loadUsages = () =>
    apiGet('/lodge-services/usages', { token })
      .then((d) => setUsages(d.usages))
      .catch((err) => fail(err, 'Could not load service use.'));

  useEffect(() => {
    loadServices();
    loadUsages();
    // Guests staying right now, so a use can be put on their room bill later.
    apiGet('/billing/food-tabs/in-house-guests', { token })
      .then((d) => setGuests(d.guests))
      .catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const saveService = async (e) => {
    e.preventDefault();
    setFormError('');
    if (!form.name.trim()) return setFormError('Enter a service name.');
    if (form.price === '' || Number(form.price) < 0) return setFormError('Enter the price per use.');
    const body = {
      name: form.name.trim(),
      unitLabel: form.unitLabel.trim() || 'use',
      price: Number(form.price),
      gstRatePercent: Number(form.gstRatePercent) || 0,
    };
    setBusy(true);
    try {
      if (form.id) await apiPatch(`/lodge-services/${form.id}`, body, { token });
      else await apiPost('/lodge-services', body, { token });
      setForm(null);
      loadServices();
    } catch (err) {
      setFormError(err instanceof ApiError ? err.message : 'Could not save the service.');
    } finally {
      setBusy(false);
    }
  };

  const toggleActive = (s) =>
    apiPatch(`/lodge-services/${s.id}`, { isActive: !s.isActive }, { token })
      .then(loadServices)
      .catch((err) => fail(err, 'Could not update the service.'));

  const startUse = async (e) => {
    e.preventDefault();
    setFormError('');
    if (!useForm.serviceId) return setFormError('Choose a service.');
    if (!(Number(useForm.quantity) > 0)) return setFormError('Quantity must be more than 0.');
    setBusy(true);
    try {
      await apiPost(
        '/lodge-services/usages',
        { ...useForm, serviceId: Number(useForm.serviceId), quantity: Number(useForm.quantity) },
        { token }
      );
      setUseForm(null);
      loadUsages();
    } catch (err) {
      setFormError(err instanceof ApiError ? err.message : 'Could not start this service.');
    } finally {
      setBusy(false);
    }
  };

  const act = (usage, action) =>
    apiPost(`/lodge-services/usages/${usage.id}/${action}`, {}, { token })
      .then(loadUsages)
      .catch((err) => fail(err, 'Could not update this service.'));

  const active = (services ?? []).filter((s) => s.isActive);
  const picked = active.find((s) => String(s.id) === String(useForm?.serviceId));

  return (
    <div className="tables-panel">
      <div className="rooms-panel__toolbar">
        <div className="toggle-group">
          <button type="button" aria-pressed={view === 'usage'} onClick={() => setView('usage')}>
            Service use
          </button>
          <button type="button" aria-pressed={view === 'catalogue'} onClick={() => setView('catalogue')}>
            Services &amp; prices
          </button>
        </div>
        {view === 'usage' ? (
          <button
            type="button"
            className="btn-accent"
            onClick={() => {
              setFormError('');
              setUseForm(emptyUse);
            }}
          >
            + Start a service
          </button>
        ) : (
          <button
            type="button"
            className="btn-accent"
            onClick={() => {
              setFormError('');
              setForm(emptyService);
            }}
          >
            + Add service
          </button>
        )}
      </div>

      {error && <div className="form-banner form-banner--error">{error}</div>}

      {view === 'catalogue' && (
        <div className="chart-section">
          {!services && <PageLoader inline label="Loading" />}
          {services && services.length === 0 && (
            <div className="dash-state">
              No services yet. Add what the lodge offers — laundry, private pool, gaming — with a price per use.
            </div>
          )}
          {services && services.length > 0 && (
            <div className="chart-list">
              {services.map((s) => (
                <div className="chart-row" key={s.id} style={s.isActive ? undefined : { opacity: 0.55 }}>
                  <span className="chart-row__name">
                    {s.name}
                    <span className="chart-row__dates">
                      {formatPrice(s.price)} per {s.unitLabel} · GST {s.gstRatePercent}% included
                    </span>
                  </span>
                  <span className="billing-panel__queue-actions">
                    <button
                      type="button"
                      className="btn-secondary"
                      onClick={() => {
                        setFormError('');
                        setForm({
                          id: s.id,
                          name: s.name,
                          unitLabel: s.unitLabel,
                          price: String(s.price),
                          gstRatePercent: String(s.gstRatePercent),
                        });
                      }}
                    >
                      Edit
                    </button>
                    <button type="button" className="btn-secondary" onClick={() => toggleActive(s)}>
                      {s.isActive ? 'Deactivate' : 'Activate'}
                    </button>
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {view === 'usage' && (
        <div className="chart-section">
          <div className="chart-section__header">
            <h3>Service use</h3>
            <span className="chart-section__hint">
              Start a service when the guest begins, mark it completed when done — it then appears in
              Billing &gt; Services to bill, where it is billed or added to the guest’s room bill.
            </span>
          </div>
          {!usages && <PageLoader inline label="Loading" />}
          {usages && usages.length === 0 && <div className="dash-state">Nothing yet.</div>}
          {usages && usages.length > 0 && (
            <div className="chart-list">
              {usages.map((u) => (
                <div className="chart-row" key={u.id}>
                  <span className="chart-row__name">
                    {u.serviceName} × {u.quantity}
                    <span className="chart-row__dates">
                      {[
                        STATUS_LABEL[u.status],
                        u.roomNumber ? `Room ${u.roomNumber}` : null,
                        u.guestName,
                        u.status === 'COMPLETED' ? (u.billed ? 'billed' : u.onRoomBill ? 'on room bill' : 'ready to bill') : null,
                      ]
                        .filter(Boolean)
                        .join(' · ')}
                    </span>
                  </span>
                  <span className="billing-panel__queue-actions">
                    <span className="chart-row__value">{formatPrice(u.lineTotal)}</span>
                    {u.status === 'IN_USE' && (
                      <button type="button" className="btn-accent" onClick={() => act(u, 'complete')}>
                        Complete
                      </button>
                    )}
                    {!u.billed && u.status !== 'CANCELLED' && (
                      <button type="button" className="btn-secondary" onClick={() => act(u, 'cancel')}>
                        Cancel
                      </button>
                    )}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {form && (
        <div className="glass-backdrop menu-panel__backdrop" onClick={() => !busy && setForm(null)}>
          <div className="glass-panel menu-panel__modal modal-form__panel" onClick={(e) => e.stopPropagation()}>
            <form className="modal-form" onSubmit={saveService} noValidate>
              <div className="modal-form__head">
                <div className="modal-form__head-row">
                  <h3>{form.id ? 'Edit service' : 'Add service'}</h3>
                  <button type="button" className="modal-form__close" onClick={() => setForm(null)} aria-label="Close">
                    ×
                  </button>
                </div>
                <p className="modal-form__sub">Price is what the guest pays, GST included. Past use keeps its old price.</p>
              </div>
              <div className="modal-form__body">
                {formError && <div className="form-banner form-banner--error">{formError}</div>}
                <div className="field">
                  <label htmlFor="svcName">
                    Service name
                    <Req />
                  </label>
                  <input
                    id="svcName"
                    value={form.name}
                    onChange={(e) => setForm({ ...form, name: e.target.value })}
                    placeholder="Laundry"
                    autoFocus
                  />
                </div>
                <div className="field-row">
                  <div className="field">
                    <label htmlFor="svcPrice">
                      Price
                      <Req />
                    </label>
                    <input
                      id="svcPrice"
                      type="number"
                      min="0"
                      step="0.01"
                      value={form.price}
                      onChange={(e) => setForm({ ...form, price: e.target.value })}
                    />
                  </div>
                  <div className="field">
                    <label htmlFor="svcUnit">Per</label>
                    <input
                      id="svcUnit"
                      value={form.unitLabel}
                      onChange={(e) => setForm({ ...form, unitLabel: e.target.value })}
                      placeholder="use, hour, kg"
                    />
                  </div>
                  <div className="field">
                    <label htmlFor="svcGst">GST %</label>
                    <input
                      id="svcGst"
                      type="number"
                      min="0"
                      max="28"
                      step="0.01"
                      value={form.gstRatePercent}
                      onChange={(e) => setForm({ ...form, gstRatePercent: e.target.value })}
                    />
                  </div>
                </div>
              </div>
              <div className="modal-form__foot">
                <div className="modal-form__foot-actions">
                  <button type="button" className="btn-secondary" onClick={() => setForm(null)} disabled={busy}>
                    Cancel
                  </button>
                  <button type="submit" className="btn-accent" disabled={busy}>
                    {busy ? 'Saving…' : 'Save'}
                  </button>
                </div>
              </div>
            </form>
          </div>
        </div>
      )}

      {useForm && (
        <div className="glass-backdrop menu-panel__backdrop" onClick={() => !busy && setUseForm(null)}>
          <div className="glass-panel menu-panel__modal modal-form__panel" onClick={(e) => e.stopPropagation()}>
            <form className="modal-form" onSubmit={startUse} noValidate>
              <div className="modal-form__head">
                <div className="modal-form__head-row">
                  <h3>Start a service</h3>
                  <button type="button" className="modal-form__close" onClick={() => setUseForm(null)} aria-label="Close">
                    ×
                  </button>
                </div>
                <p className="modal-form__sub">Pick a guest staying in-house, or type a walk-in’s name.</p>
              </div>
              <div className="modal-form__body">
                {formError && <div className="form-banner form-banner--error">{formError}</div>}
                {active.length === 0 && (
                  <div className="form-banner form-banner--error">Add a service under “Services &amp; prices” first.</div>
                )}
                <div className="field">
                  <label htmlFor="useService">
                    Service
                    <Req />
                  </label>
                  <select
                    id="useService"
                    value={useForm.serviceId}
                    onChange={(e) => setUseForm({ ...useForm, serviceId: e.target.value })}
                  >
                    <option value="">Choose…</option>
                    {active.map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.name} — {formatPrice(s.price)} per {s.unitLabel}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="field">
                  <label htmlFor="useQty">Quantity{picked ? ` (${picked.unitLabel})` : ''}</label>
                  <input
                    id="useQty"
                    type="number"
                    min="0"
                    step="0.01"
                    value={useForm.quantity}
                    onChange={(e) => setUseForm({ ...useForm, quantity: e.target.value })}
                  />
                </div>
                <div className="field">
                  <label htmlFor="useGuest">Staying guest</label>
                  <select
                    id="useGuest"
                    value={useForm.bookingId}
                    onChange={(e) => setUseForm({ ...useForm, bookingId: e.target.value })}
                  >
                    <option value="">Walk-in / not staying</option>
                    {guests.map((g) => (
                      <option key={g.bookingId} value={g.bookingId}>
                        Room {g.roomNumber} · {g.guestName}
                      </option>
                    ))}
                  </select>
                </div>
                {!useForm.bookingId && (
                  <div className="field-row">
                    <div className="field">
                      <label htmlFor="useName">Name</label>
                      <input
                        id="useName"
                        value={useForm.guestName}
                        onChange={(e) => setUseForm({ ...useForm, guestName: e.target.value })}
                      />
                    </div>
                    <div className="field">
                      <label htmlFor="usePhone">Phone</label>
                      <input
                        id="usePhone"
                        value={useForm.guestPhone}
                        onChange={(e) => setUseForm({ ...useForm, guestPhone: e.target.value })}
                      />
                    </div>
                  </div>
                )}
              </div>
              <div className="modal-form__foot">
                <div className="modal-form__summary">
                  <span className="modal-form__summary-label">Amount</span>
                  <span className="modal-form__summary-value">
                    {picked ? formatPrice(picked.price * (Number(useForm.quantity) || 0)) : '—'}
                  </span>
                </div>
                <div className="modal-form__foot-actions">
                  <button type="button" className="btn-secondary" onClick={() => setUseForm(null)} disabled={busy}>
                    Cancel
                  </button>
                  <button type="submit" className="btn-accent" disabled={busy}>
                    {busy ? 'Starting…' : 'Start'}
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
