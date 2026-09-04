import { useCallback, useEffect, useState } from 'react';
import { apiDelete, apiGet, apiPatch, apiPost } from '../../lib/api';
import { getSession } from '../../lib/auth';
import { buildWhatsAppLink, openExternal } from '../../lib/shareLinks';
import { formatPrice } from './priceFormat';
import AdvanceReceiptModal from './AdvanceReceiptModal';
import EventForm from './EventForm';
import {
  EVENT_STATUS_LABEL,
  EVENT_TYPE_LABEL,
  SLOT_LABEL,
  formatEventDate,
  formatEventWhen,
  formatHoldRemaining,
  statusBadgeClass,
} from './eventFormat';
import './forms.css';
import './Events.css';

const TIMELINE = ['ENQUIRY', 'TENTATIVE', 'CONFIRMED', 'SETTLED'];

function escapeHtml(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

// Catering is whatever was quoted at a rate above zero; there is no flag.
function hasCatering(event) {
  return Number(event.perPlateRate) > 0;
}

// "4 rooms · Thu 12 Nov – Sat 14 Nov (2 nights)"
function roomsSummary(event) {
  if (!event.roomsRequired) return '';
  const nights =
    event.roomsFrom && event.roomsTo
      ? Math.round((new Date(`${event.roomsTo}T00:00:00`) - new Date(`${event.roomsFrom}T00:00:00`)) / 86400000)
      : 0;
  const count = event.roomsCount != null ? `${event.roomsCount} room${event.roomsCount === 1 ? '' : 's'}` : 'Rooms';
  const when = event.roomsFrom && event.roomsTo ? ` · ${formatEventDate(event.roomsFrom)} – ${formatEventDate(event.roomsTo)}` : '';
  return `${count}${when}${nights > 0 ? ` (${nights} night${nights === 1 ? '' : 's'})` : ''}`;
}

// The kitchen and the floor get a paper copy: they don't carry the tablet.
function printFunctionSheet(event) {
  const w = window.open('', '_blank', 'width=800,height=900');
  if (!w) return;
  const addons = (event.addons || [])
    .map((a) => `<li>${escapeHtml(a.label)} × ${a.quantity}${a.isExtra ? ' <em>(added on the day)</em>' : ''}</li>`)
    .join('');
  const note = (title, text) =>
    `<h3>${title}</h3><p>${text ? escapeHtml(text).replace(/\n/g, '<br>') : '<em>—</em>'}</p>`;
  w.document.write(`<!doctype html><html><head><title>Function sheet – ${escapeHtml(event.title)}</title>
<style>body{font-family:system-ui,sans-serif;padding:24px;color:#111;max-width:720px}h1{font-size:22px;margin:0 0 4px}
h3{font-size:13px;text-transform:uppercase;letter-spacing:.05em;margin:18px 0 4px;color:#555}p{margin:0;white-space:pre-wrap}
table{border-collapse:collapse;margin-top:10px}td{padding:4px 12px 4px 0;vertical-align:top}td:first-child{color:#555}
@media print{button{display:none}}</style></head><body>
<h1>${escapeHtml(event.title)}</h1>
<div>${escapeHtml(EVENT_TYPE_LABEL[event.eventType] || event.eventType)} · ${escapeHtml(EVENT_STATUS_LABEL[event.status] || event.status)}</div>
<table>
<tr><td>When</td><td>${escapeHtml(formatEventWhen(event.startAt, event.endAt))} (${escapeHtml(SLOT_LABEL[event.slot] || '')})</td></tr>
<tr><td>Venue</td><td>${escapeHtml(event.venueName)}</td></tr>
<tr><td>Organiser</td><td>${escapeHtml(event.organiserName)} · ${escapeHtml(event.organiserPhone)}${event.organiserAltPhone ? ' / ' + escapeHtml(event.organiserAltPhone) : ''}</td></tr>
<tr><td>Guests</td><td>Expected ${event.expectedPax}${hasCatering(event) ? ' · Guaranteed ' + event.guaranteedPax : ''}${event.finalPax != null ? ' · Final ' + event.finalPax : ''}</td></tr>
${event.roomsRequired ? `<tr><td>Rooms</td><td>${escapeHtml(roomsSummary(event))}${event.roomsNotes ? ' — ' + escapeHtml(event.roomsNotes) : ''}</td></tr>` : ''}
</table>
${hasCatering(event) ? note('Menu', event.menuNotes) : ''}
${note('Setup', event.setupNotes)}
${note('Schedule', event.scheduleNotes)}
<h3>Add-ons</h3>${addons ? `<ul>${addons}</ul>` : '<p><em>—</em></p>'}
<p style="margin-top:24px"><button onclick="window.print()">Print</button></p>
</body></html>`);
  w.document.close();
}

function quoteMessage(event, lodge) {
  const lines = [
    lodge?.name ? `${lodge.name} – function quote` : 'Function quote',
    `${event.title} (${EVENT_TYPE_LABEL[event.eventType] || event.eventType})`,
    `Venue: ${event.venueName}`,
    `When: ${formatEventWhen(event.startAt, event.endAt)}`,
    hasCatering(event) ? `Guests: ${event.expectedPax} expected, ${event.guaranteedPax} guaranteed` : `Guests: ${event.expectedPax} expected`,
    `Total: ${formatPrice(event.totalAmount)}`,
  ];
  if (event.roomsRequired) lines.push(`Rooms: ${roomsSummary(event)}`);
  if (Number(event.advanceAmount) > 0) lines.push(`Advance received: ${formatPrice(event.advanceAmount)}`);
  lines.push(`Balance: ${formatPrice(event.balanceDue)}`);
  return lines.join('\n');
}

function Fact({ label, children }) {
  return (
    <div className="events-detail__fact">
      <span>{label}</span>
      <span>{children}</span>
    </div>
  );
}

// A one-line inline editor: shows the value, turns into an input on Edit,
// saves with a PATCH of a single field.
function InlineNumber({ label, value, onSave, hint }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);
  return (
    <div className="events-detail__fact">
      <span>{label}</span>
      {editing ? (
        <span style={{ display: 'inline-flex', gap: 6, alignItems: 'center' }}>
          <input type="number" min="0" value={draft} onChange={(e) => setDraft(e.target.value)} autoFocus />
          <button
            type="button"
            className="chart-row__link-btn"
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              try {
                await onSave(draft === '' ? null : Number(draft));
                setEditing(false);
              } finally {
                setBusy(false);
              }
            }}
          >
            Save
          </button>
          <button type="button" className="chart-row__link-btn" onClick={() => setEditing(false)} disabled={busy}>
            Cancel
          </button>
        </span>
      ) : (
        <span>
          {value ?? '—'}{' '}
          <button
            type="button"
            className="chart-row__link-btn"
            title={hint}
            onClick={() => {
              setDraft(value ?? '');
              setEditing(true);
            }}
          >
            Edit
          </button>
        </span>
      )}
    </div>
  );
}

// Extras asked for while the function is on — more chairs, a second mic —
// noted here so they reach the bill. A price can be typed now or left for
// later; an unpriced line is the reminder, and billing refuses to issue
// until it is set.
function ExtrasCard({ event, open, onChanged, onError }) {
  const token = getSession()?.token;
  const [draft, setDraft] = useState({ label: '', quantity: '1', amount: '' });
  const [pricing, setPricing] = useState({});
  const [busy, setBusy] = useState(false);

  const extras = (event.addons || []).filter((a) => a.isExtra);
  const unpriced = extras.filter((a) => a.needsPricing);

  const run = async (fn) => {
    setBusy(true);
    onError('');
    try {
      const data = await fn();
      onChanged(data.event);
      return true;
    } catch (err) {
      onError(err.message);
      return false;
    } finally {
      setBusy(false);
    }
  };

  const add = async () => {
    if (!draft.label.trim()) return;
    const body = { label: draft.label.trim(), quantity: Number(draft.quantity) || 1 };
    if (draft.amount !== '') body.agreedAmount = Number(draft.amount);
    if (await run(() => apiPost(`/events/${event.id}/extras`, body, { token }))) {
      setDraft({ label: '', quantity: '1', amount: '' });
    }
  };

  const price = async (line) => {
    const amount = pricing[line.id];
    if (amount === '' || amount == null) return;
    if (await run(() => apiPatch(`/events/${event.id}/extras/${line.id}`, { agreedAmount: Number(amount) }, { token }))) {
      setPricing((p) => ({ ...p, [line.id]: undefined }));
    }
  };

  const remove = (line) => run(() => apiDelete(`/events/${event.id}/extras/${line.id}`, { token }));

  return (
    <div className="events-detail__card events-detail__card--wide">
      <h4>Extras on the day</h4>
      {unpriced.length > 0 && (
        <div className="form-banner form-banner--info events-extras__reminder">
          {unpriced.length === 1 ? 'One extra still needs a price' : `${unpriced.length} extras still need a price`} before the bill can be issued.
        </div>
      )}
      {extras.length === 0 && <div className="events-detail__empty">Nothing added on the day yet.</div>}
      {extras.map((line) => (
        <div key={line.id} className="events-extras__row">
          <span className="events-extras__what">
            {line.label}
            {line.quantity > 1 ? ` × ${line.quantity}` : ''}
            {line.notedAt && <small>noted {formatEventDate(line.notedAt)}</small>}
          </span>
          {line.needsPricing && open ? (
            <span className="events-extras__price">
              <input
                type="number"
                min="0"
                placeholder="₹ agreed"
                value={pricing[line.id] ?? ''}
                onChange={(e) => setPricing((p) => ({ ...p, [line.id]: e.target.value }))}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') price(line);
                }}
              />
              <button type="button" className="chart-row__link-btn" disabled={busy || !(pricing[line.id] > 0 || pricing[line.id] === '0')} onClick={() => price(line)}>
                Set price
              </button>
            </span>
          ) : (
            <span className="events-extras__price">
              {line.needsPricing ? <span className="badge badge--off">price to set</span> : formatPrice(line.agreedAmount)}
            </span>
          )}
          {open && (
            <button type="button" className="chart-row__link-btn" disabled={busy} onClick={() => remove(line)} title="Remove this extra">
              Remove
            </button>
          )}
        </div>
      ))}
      {open && (
        <div className="events-extras__add">
          <input
            placeholder="Extra asked for — e.g. 50 more chairs"
            value={draft.label}
            onChange={(e) => setDraft((d) => ({ ...d, label: e.target.value }))}
            onKeyDown={(e) => {
              if (e.key === 'Enter') add();
            }}
          />
          <input
            type="number"
            min="1"
            title="Quantity"
            aria-label="Quantity"
            value={draft.quantity}
            onChange={(e) => setDraft((d) => ({ ...d, quantity: e.target.value }))}
          />
          <input
            type="number"
            min="0"
            placeholder="₹ (leave blank to price later)"
            aria-label="Agreed amount"
            value={draft.amount}
            onChange={(e) => setDraft((d) => ({ ...d, amount: e.target.value }))}
            onKeyDown={(e) => {
              if (e.key === 'Enter') add();
            }}
          />
          <button type="button" className="btn-accent" disabled={busy || !draft.label.trim()} onClick={add}>
            Add
          </button>
        </div>
      )}
    </div>
  );
}

function NotesCard({ event, onPatch }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState({});
  const [busy, setBusy] = useState(false);
  const start = () => {
    setDraft({ menuNotes: event.menuNotes || '', setupNotes: event.setupNotes || '', scheduleNotes: event.scheduleNotes || '' });
    setEditing(true);
  };
  const save = async () => {
    setBusy(true);
    try {
      await onPatch({
        menuNotes: draft.menuNotes.trim() || null,
        setupNotes: draft.setupNotes.trim() || null,
        scheduleNotes: draft.scheduleNotes.trim() || null,
      });
      setEditing(false);
    } finally {
      setBusy(false);
    }
  };
  const sections = [
    ...(hasCatering(event) ? [['menuNotes', 'Menu']] : []),
    ['setupNotes', 'Setup'],
    ['scheduleNotes', 'Schedule'],
  ];
  return (
    <div className="events-detail__card events-detail__card--wide">
      <h4>
        Function sheet
        {!editing ? (
          <button type="button" className="chart-row__link-btn" onClick={start}>
            Edit
          </button>
        ) : (
          <span className="chart-row__actions">
            <button type="button" className="chart-row__link-btn" onClick={save} disabled={busy}>
              Save
            </button>
            <button type="button" className="chart-row__link-btn" onClick={() => setEditing(false)} disabled={busy}>
              Cancel
            </button>
          </span>
        )}
      </h4>
      {sections.map(([key, title]) =>
        editing ? (
          <div className="field" key={key}>
            <label>{title}</label>
            <textarea value={draft[key]} onChange={(e) => setDraft((d) => ({ ...d, [key]: e.target.value }))} />
          </div>
        ) : (
          <div key={key}>
            <div className="events-detail__notes-title">{title}</div>
            <div className="events-detail__notes">{event[key] || <span className="events-detail__empty">Nothing noted.</span>}</div>
          </div>
        )
      )}
    </div>
  );
}

export default function EventDetail({ eventId, lodge, venues = [], addons = [], onChanged, onClose, onBillEvent, onViewInvoice }) {
  const token = getSession()?.token;
  const [event, setEvent] = useState(null);
  const [receipts, setReceipts] = useState([]);
  const [loadError, setLoadError] = useState('');
  const [actionError, setActionError] = useState('');
  const [busy, setBusy] = useState(false);
  const [editing, setEditing] = useState(false);
  const [takingAdvance, setTakingAdvance] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const [cancelForm, setCancelForm] = useState({ reason: '', refundAmount: '' });
  const [holdHours, setHoldHours] = useState('48');
  const [now, setNow] = useState(() => Date.now());

  const reload = useCallback(async () => {
    try {
      const [ev, rc] = await Promise.all([
        apiGet(`/events/${eventId}`, { token }),
        apiGet(`/billing/events/${eventId}/advance-receipts`, { token }).catch(() => ({ receipts: [] })),
      ]);
      setEvent(ev.event);
      setReceipts(rc.receipts || []);
      setLoadError('');
      return ev.event;
    } catch (err) {
      setLoadError(err.message);
      return null;
    }
  }, [eventId, token]);

  useEffect(() => {
    reload();
  }, [reload]);

  // The hold countdown ticks by the minute; nothing else on the modal moves.
  useEffect(() => {
    if (event?.status !== 'TENTATIVE') return undefined;
    const t = setInterval(() => setNow(Date.now()), 60000);
    return () => clearInterval(t);
  }, [event?.status]);

  useEffect(() => {
    const onKey = (e) => {
      if (e.key === 'Escape' && !busy && !editing && !takingAdvance) onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [busy, editing, takingAdvance, onClose]);

  const applyChanged = (ev) => {
    setEvent(ev);
    onChanged?.(ev);
  };

  const patch = async (body) => {
    setActionError('');
    try {
      const data = await apiPatch(`/events/${eventId}`, body, { token });
      applyChanged(data.event);
    } catch (err) {
      setActionError(err.message);
      throw err;
    }
  };

  const transition = async (path, body = {}) => {
    setBusy(true);
    setActionError('');
    try {
      const data = await apiPatch(`/events/${eventId}/${path}`, body, { token });
      applyChanged(data.event);
      return true;
    } catch (err) {
      setActionError(err.message);
      return false;
    } finally {
      setBusy(false);
    }
  };

  // Opens the settlement with the whole advance offered back — keeping any of
  // it is a decision made by typing a smaller figure, not a forgotten default.
  const openCancel = () => {
    setActionError('');
    setCancelForm({ reason: '', refundAmount: event?.advanceAmount > 0 ? String(event.advanceAmount) : '' });
    setCancelling(true);
  };

  const submitCancel = async () => {
    if (!cancelForm.reason.trim()) {
      setActionError('Give a reason for the cancellation.');
      return;
    }
    const advance = Number(event?.advanceAmount) || 0;
    const body = { reason: cancelForm.reason.trim() };
    if (advance > 0) {
      const refund = Number(cancelForm.refundAmount);
      if (cancelForm.refundAmount === '' || !Number.isFinite(refund) || refund < 0) {
        setActionError('Enter how much of the advance goes back — 0 keeps all of it.');
        return;
      }
      if (refund > advance) {
        setActionError(`The refund can’t be more than the ${formatPrice(advance)} advance held.`);
        return;
      }
      body.refundAmount = refund;
    } else if (cancelForm.refundAmount !== '') {
      body.refundAmount = Number(cancelForm.refundAmount);
    }
    if (await transition('cancel', body)) setCancelling(false);
  };

  if (loadError) {
    return (
      <div className="glass-backdrop events-modal__backdrop">
        <div className="glass-panel events-modal">
          <div className="form-banner form-banner--error">{loadError}</div>
          <div className="events-modal__actions">
            <button type="button" className="btn-secondary" onClick={onClose}>
              Close
            </button>
          </div>
        </div>
      </div>
    );
  }

  if (!event) {
    return (
      <div className="glass-backdrop events-modal__backdrop">
        <div className="glass-panel events-modal">
          <div className="dash-state">Loading…</div>
        </div>
      </div>
    );
  }

  const status = event.status;
  const pricingLines = event.pricing?.lines || [];
  const closed = status === 'CANCELLED' || status === 'EXPIRED';
  const currentIdx = TIMELINE.indexOf(status);
  const canEdit = ['ENQUIRY', 'TENTATIVE', 'CONFIRMED', 'EXPIRED'].includes(status);
  const canTakeAdvance = ['ENQUIRY', 'TENTATIVE', 'CONFIRMED'].includes(status);

  return (
    <>
      <div className="glass-backdrop events-modal__backdrop">
        <div className="glass-panel events-modal" role="dialog" aria-modal="true" aria-labelledby="event-detail-title">
          <div className="events-modal__head">
            <div>
              <h3 id="event-detail-title">
                {event.title}
                <span className="events-modal__badges">
                  <span className="badge badge--accent">{EVENT_TYPE_LABEL[event.eventType] || event.eventType}</span>
                  <span className={statusBadgeClass(status)}>{EVENT_STATUS_LABEL[status] || status}</span>
                </span>
              </h3>
              <div className="events-modal__sub">
                {formatEventWhen(event.startAt, event.endAt)} · {event.venueName}
                {event.venueCapacity ? ` (up to ${event.venueCapacity})` : ''}
              </div>
              <div className="events-modal__sub">
                {event.organiserName} · {event.organiserPhone}
                {event.organiserAltPhone ? ` / ${event.organiserAltPhone}` : ''}{' '}
                <button
                  type="button"
                  className="chart-row__link-btn"
                  onClick={() => openExternal(buildWhatsAppLink(event.organiserPhone, quoteMessage(event, lodge)))}
                >
                  Share quote on WhatsApp
                </button>
              </div>
            </div>
            <button type="button" className="events-modal__close" onClick={onClose} aria-label="Close">
              ×
            </button>
          </div>

          {!closed && (
            <div className="events-timeline">
              {TIMELINE.map((s, i) => (
                <div
                  key={s}
                  className={`events-timeline__step${i < currentIdx ? ' events-timeline__step--done' : ''}${i === currentIdx ? ' events-timeline__step--current' : ''}`}
                >
                  {EVENT_STATUS_LABEL[s]}
                </div>
              ))}
            </div>
          )}

          {status === 'CANCELLED' && (
            <div className="events-detail__cancelled">
              Cancelled{event.cancelReason ? `: ${event.cancelReason}` : ''}
              {Number(event.refundAmount) > 0 && ` · Refunded ${formatPrice(event.refundAmount)}`}
              {Number(event.cancellationCharge) > 0 &&
                ` · Cancellation charge kept ${formatPrice(event.cancellationCharge)}`}
            </div>
          )}
          {status === 'EXPIRED' && (
            <div className="events-detail__cancelled">The hold on this date lapsed{event.holdExpiresAt ? ` on ${formatEventDate(event.holdExpiresAt)}` : ''}.</div>
          )}
          {status === 'TENTATIVE' && event.holdExpiresAt && (
            <div className="events-detail__hold" style={{ marginBottom: 12 }}>
              Hold expires {formatHoldRemaining(event.holdExpiresAt, now)} ({formatEventWhen(event.holdExpiresAt)})
            </div>
          )}

          {actionError && <div className="form-banner form-banner--error">{actionError}</div>}

          <div className="events-detail__grid">
            <div className="events-detail__card">
              <h4>Quote</h4>
              {pricingLines.map((l, i) => (
                <div key={i} className="events-quote__line">
                  <span>
                    {l.label}
                    {l.note && <small>{l.note}</small>}
                  </span>
                  <span>{formatPrice(l.amount)}</span>
                </div>
              ))}
              {Number(event.discountAmount) > 0 && (
                <div className="events-quote__line">
                  <span>
                    Concession
                    {event.discountReason && <small>{event.discountReason}</small>}
                  </span>
                  <span>− {formatPrice(event.discountAmount)}</span>
                </div>
              )}
              <div className="events-quote__line events-quote__line--total">
                <span>Total</span>
                <span>{formatPrice(event.totalAmount)}</span>
              </div>
              <div className="events-quote__line">
                <span>Advance held</span>
                <span>{formatPrice(event.advanceAmount || 0)}</span>
              </div>
              <div className="events-quote__line events-quote__line--due">
                <span>Balance due</span>
                <span>{formatPrice(event.balanceDue)}</span>
              </div>
            </div>

            <div className="events-detail__card">
              <h4>Head count</h4>
              <Fact label="Expected">{event.expectedPax}</Fact>
              {hasCatering(event) ? (
                <>
                  <Fact label="Guaranteed minimum">{event.guaranteedPax}</Fact>
                  {canEdit ? (
                    <InlineNumber label="Final count" value={event.finalPax} onSave={(v) => patch({ finalPax: v })} hint="Set after the function" />
                  ) : (
                    <Fact label="Final count">{event.finalPax ?? '—'}</Fact>
                  )}
                  <Fact label="Billed on">{event.billablePax} guests</Fact>
                  <p className="field__hint">Catering is billed on the larger of the final count and the guaranteed minimum.</p>
                </>
              ) : (
                <p className="field__hint">No catering on this function.</p>
              )}

              {event.roomsRequired && (
                <>
                  <h4 style={{ marginTop: 14 }}>Rooms for guests</h4>
                  <div className="events-detail__rooms">
                    <strong>{roomsSummary(event)}</strong>
                    {event.roomsNotes && <div className="events-detail__notes">{event.roomsNotes}</div>}
                    <div className="field__hint">Not booked yet — book them from the tape chart under the organiser’s name.</div>
                  </div>
                </>
              )}

              <h4 style={{ marginTop: 14 }}>Add-ons</h4>
              {(event.addons || []).filter((a) => !a.isExtra).length === 0 && <div className="events-detail__empty">None.</div>}
              {(event.addons || [])
                .filter((a) => !a.isExtra)
                .map((a) => (
                  <Fact key={a.id} label={`${a.label} × ${a.quantity}`}>
                    {formatPrice(a.agreedAmount)}
                  </Fact>
                ))}
            </div>

            <ExtrasCard event={event} open={!closed && status !== 'SETTLED'} onChanged={applyChanged} onError={setActionError} />

            <NotesCard event={event} onPatch={patch} />

            <div className="events-detail__card events-detail__card--wide">
              <h4>
                Advances
                {canTakeAdvance && (
                  <button type="button" className="chart-row__link-btn" onClick={() => setTakingAdvance(true)}>
                    Take advance / print receipt
                  </button>
                )}
              </h4>
              {receipts.length === 0 && <div className="events-detail__empty">No advance taken yet.</div>}
              {receipts.map((r) => (
                <div key={r.id} className="events-detail__fact">
                  <span>
                    {r.receiptNumber || r.number || `#${r.id}`} · {formatEventDate(r.issuedAt || r.createdAt)}
                    {r.status === 'VOID' && ' · void'}
                  </span>
                  <span>
                    {formatPrice(r.amountReceived ?? r.amount)}
                    {r.paymentMethod ? ` · ${r.paymentMethod}` : ''}
                  </span>
                </div>
              ))}
              {event.invoice && (
                <Fact label="Invoice">
                  {event.invoice.invoiceNumber} · {formatPrice(event.invoice.totalAmount)}
                </Fact>
              )}
            </div>
          </div>

          {cancelling && (
            <div className="events-cancel">
              <h4>Cancel this function</h4>
              <div className="field">
                <label htmlFor="ev-cancel-reason">Reason</label>
                <input id="ev-cancel-reason" value={cancelForm.reason} onChange={(e) => setCancelForm((f) => ({ ...f, reason: e.target.value }))} autoFocus />
              </div>
              {Number(event.advanceAmount) > 0 && (
                <>
                  <p className="events-cancel__hint">
                    An advance of <strong>{formatPrice(event.advanceAmount)}</strong> is held on this function.
                    Whatever is not refunded is recorded as a cancellation charge.
                  </p>
                  <div className="field">
                    <label htmlFor="ev-cancel-refund">Refund to organiser</label>
                    <input
                      id="ev-cancel-refund"
                      type="number"
                      min="0"
                      max={event.advanceAmount}
                      step="0.01"
                      value={cancelForm.refundAmount}
                      onChange={(e) => setCancelForm((f) => ({ ...f, refundAmount: e.target.value }))}
                    />
                  </div>
                  <p className="events-cancel__hint">
                    Kept as cancellation charge:{' '}
                    <strong>
                      {formatPrice(
                        Math.max(0, (Number(event.advanceAmount) || 0) - (Number(cancelForm.refundAmount) || 0))
                      )}
                    </strong>
                  </p>
                </>
              )}
              <div className="events-cancel__actions">
                <button type="button" className="btn-secondary" onClick={() => setCancelling(false)} disabled={busy}>
                  Keep it
                </button>
                <button type="button" className="confirm-dialog__danger" onClick={submitCancel} disabled={busy}>
                  Cancel function
                </button>
              </div>
            </div>
          )}

          <div className="events-modal__actions">
            <button type="button" className="btn-secondary" onClick={() => printFunctionSheet(event)}>
              Print function sheet
            </button>
            <span className="events-modal__spacer" />

            {(status === 'ENQUIRY' || status === 'EXPIRED') && (
              <>
                <input
                  type="number"
                  min="1"
                  value={holdHours}
                  onChange={(e) => setHoldHours(e.target.value)}
                  aria-label="Hold hours"
                  style={{ width: 70, padding: '8px 10px', borderRadius: 8, border: '1px solid var(--border)' }}
                />
                <button type="button" className="btn-secondary" disabled={busy} onClick={() => transition('hold', { holdHours: Number(holdHours) || 48 })}>
                  {status === 'EXPIRED' ? 'Hold again' : 'Hold date'}
                </button>
              </>
            )}
            {status === 'TENTATIVE' && (
              <button type="button" className="btn-secondary" disabled={busy} onClick={() => transition('release')}>
                Release hold
              </button>
            )}
            {['ENQUIRY', 'TENTATIVE', 'EXPIRED'].includes(status) && (
              <button type="button" className="btn-accent" disabled={busy} onClick={() => transition('confirm')}>
                Confirm
              </button>
            )}
            {status === 'CONFIRMED' && (
              <button type="button" className="btn-accent" disabled={busy} onClick={() => onBillEvent?.(event.id)}>
                Settle &amp; bill
              </button>
            )}
            {status === 'SETTLED' && (
              <button
                type="button"
                className="btn-accent"
                // The issued document, by id. Only if the bill somehow is not
                // on the function does this fall back to the billing screen.
                onClick={() => (event.invoice?.id && onViewInvoice ? onViewInvoice(event.invoice.id) : onBillEvent?.(event.id))}
              >
                View bill{event.invoice?.invoiceNumber ? ` ${event.invoice.invoiceNumber}` : ''}
              </button>
            )}
            {canEdit && status !== 'EXPIRED' && (
              <button type="button" className="btn-secondary" disabled={busy} onClick={() => setEditing(true)}>
                Edit
              </button>
            )}
            {!closed && status !== 'SETTLED' && !cancelling && (
              <button type="button" className="confirm-dialog__danger" style={{ marginLeft: 0 }} disabled={busy} onClick={openCancel}>
                Cancel event
              </button>
            )}
            {/* Always here: the way out of the modal, kept apart from the
                button that cancels the function so the two are never mistaken
                for each other. */}
            <button type="button" className="btn-secondary" disabled={busy} onClick={onClose}>
              Close
            </button>
          </div>
        </div>
      </div>

      {editing && (
        <EventForm
          event={event}
          venues={venues}
          addons={addons}
          lodge={lodge}
          onClose={() => setEditing(false)}
          onSaved={(ev) => {
            setEditing(false);
            applyChanged(ev);
          }}
        />
      )}

      {takingAdvance && (
        <AdvanceReceiptModal
          eventBooking={event}
          existingReceipts={receipts}
          onClose={() => setTakingAdvance(false)}
          onTaken={() => reload().then((ev) => ev && onChanged?.(ev))}
          onVoided={() => reload().then((ev) => ev && onChanged?.(ev))}
        />
      )}
    </>
  );
}
