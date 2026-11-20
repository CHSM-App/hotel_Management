import { useEffect, useState } from 'react';
import { apiGet } from '../../lib/api';
import PageLoader from '../../components/PageLoader';
import { Field, Note } from './BarBits';
import { barToken, errText, printBarBill, todayIso } from './barFormat';
import { formatPrice } from './priceFormat';
import './forms.css';
import './Bar.css';

const daysAgoIso = (n) => new Date(Date.now() + 5.5 * 3600 * 1000 - n * 86400000).toISOString().slice(0, 10);
const day = (d) => String(d).slice(0, 10);
const sourceLabel = (o) => (o.source === 'TABLE' ? `Table ${o.tableLabel ?? ''}` : o.source === 'ROOM' ? `Room ${o.roomNumber ?? ''}` : 'Counter');

// Issued bills (view and reprint) and every billed or cancelled order, by date.
// mode 'bills': every issued bill (view and reprint). mode 'orders': billed and cancelled orders.
export default function BarHistory({ lodge, canBill, mode = 'orders' }) {
  const token = barToken();
  const view = mode;
  const ALL = { from: '2000-01-01', to: todayIso() };
  const [range, setRange] = useState(mode === 'bills' ? ALL : { from: todayIso(), to: todayIso() });
  const key = `${view}|${range.from}|${range.to}`;
  const [result, setResult] = useState({ key: '', data: null, error: '' });
  const [bill, setBill] = useState(null);
  const [billError, setBillError] = useState('');
  const data = result.key === key ? result.data : null;
  const error = result.key === key ? result.error : '';

  useEffect(() => {
    let live = true;
    const path = view === 'bills' ? '/bar/bills' : '/bar/orders/history';
    apiGet(`${path}?from=${range.from}&to=${range.to}`, { token })
      .then((d) => live && setResult({ key, data: d, error: '' }))
      .catch((e) => live && setResult({ key, data: null, error: errText(e, 'Could not load history.') }));
    return () => {
      live = false;
    };
  }, [key, view, range, token]);

  const openBill = async (id) => {
    setBillError('');
    try {
      setBill(await apiGet(`/bar/bills/${id}`, { token }));
    } catch (e) {
      setBillError(errText(e, 'Could not open the bill.'));
    }
  };

  const presets = [
    ['Today', { from: todayIso(), to: todayIso() }],
    ['Yesterday', { from: daysAgoIso(1), to: daysAgoIso(1) }],
    ['Last 7 days', { from: daysAgoIso(6), to: todayIso() }],
    ...(mode === 'bills' ? [['All bills', ALL]] : []),
  ];
  const isPreset = (r) => r.from === range.from && r.to === range.to;

  return (
    <div className="bar">
      <div className="bar-filter">
        <div className="bar-filter__presets" role="group" aria-label="Period">
          {presets.map(([label, r]) => (
            <button key={label} type="button" aria-pressed={isPreset(r)} onClick={() => setRange(r)}>{label}</button>
          ))}
        </div>
        <div className="bar-filter__dates">
          <Field label="From"><input type="date" value={range.from} max={range.to} onChange={(e) => e.target.value && setRange({ ...range, from: e.target.value })} /></Field>
          <span className="bar-filter__dash" aria-hidden="true">–</span>
          <Field label="To"><input type="date" value={range.to} min={range.from} onChange={(e) => e.target.value && setRange({ ...range, to: e.target.value })} /></Field>
        </div>
      </div>
      {error && <Note kind="error">{error}</Note>}
      {billError && <Note kind="error">{billError}</Note>}
      {!data && !error && <PageLoader label="Loading history" />}

      {bill && (
        <section className="bar-card" aria-label="Bill">
          <div className="bar-card__head">
            <h3 className="bar-card__title">{bill.billNumber} <span className="bar-muted">· {day(bill.billDate)}{bill.customerName ? ` · ${bill.customerName}` : ''}</span></h3>
            <div className="bar-flex">
              <button type="button" className="bar-btn bar-btn--primary" onClick={() => printBarBill(bill, lodge?.name)}>Print bill</button>
              <button type="button" className="bar-btn" onClick={() => setBill(null)}>Close</button>
            </div>
          </div>
          <div>
            {[...bill.items, ...bill.foodItems].map((i, n) => (
              <div className="bar-receipt-line" key={n}>
                <span>{i.name}{i.size ? ` · ${i.size}` : ''} × {i.quantity}{i.kind === 'FOOD' && <> <span className="bar-chip bar-chip--brand">Food</span></>}</span>
                <b>{formatPrice(i.lineTotal)}</b>
              </div>
            ))}
            <hr className="bar-rule" />
            {bill.taxPercent > 0 && <div className="bar-receipt-line"><span>Drinks tax {bill.taxPercent}% (incl.)</span><b>{formatPrice(bill.taxAmount)}</b></div>}
            {bill.foodTaxAmount > 0 && <div className="bar-receipt-line"><span>Food GST {bill.foodTaxPercent}% (incl.)</span><b>{formatPrice(bill.foodTaxAmount)}</b></div>}
            <div className="bar-total"><span className="bar-strong">Total</span><b>{formatPrice(bill.total)}</b></div>
            <div className="bar-muted" style={{ marginTop: 6 }}>Paid by {bill.payments.map((p) => `${p.method} ${formatPrice(p.amount)}`).join(' · ')}</div>
          </div>
        </section>
      )}

      {data && view === 'bills' && (
        <section className="bar-card">
          <h3 className="bar-card__title">Issued bills <span className="bar-oc__count">{data.bills.length}</span></h3>
          <div className="bar-table-wrap">
            <table className="bar-table">
              <thead><tr><th>Bill</th><th>Date</th><th>Customer</th><th className="is-num">Total</th><th /></tr></thead>
              <tbody>
                {data.bills.map((b) => (
                  <tr key={b.id}>
                    <td className="bar-strong">{b.billNumber}</td>
                    <td>{day(b.billDate)}</td>
                    <td>{b.customerName || '—'}</td>
                    <td className="is-num bar-strong">{formatPrice(b.total)}</td>
                    <td className="is-num"><button type="button" className="bar-btn bar-btn--sm" onClick={() => openBill(b.id)}>View / Print</button></td>
                  </tr>
                ))}
                {data.bills.length === 0 && <tr><td colSpan={5} className="bar-empty">No bills in this period.</td></tr>}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {data && view === 'orders' && (
        <section className="bar-card">
          <h3 className="bar-card__title">Order history <span className="bar-oc__count">{data.orders.length}</span></h3>
          <div className="bar-table-wrap">
            <table className="bar-table">
              <thead><tr><th>Order</th><th>Date</th><th>For</th><th>Items</th><th>Status</th><th className="is-num">Total</th></tr></thead>
              <tbody>
                {data.orders.map((o) => (
                  <tr key={o.id}>
                    <td className="bar-strong">#{o.orderNumber}</td>
                    <td>{day(o.orderDate)}</td>
                    <td>{sourceLabel(o)}{o.guestName ? <div className="bar-muted">{o.guestName}</div> : null}</td>
                    <td>{[...o.items.map((i) => `${i.name} ${i.size} ×${i.quantity}`), ...o.foodItems.map((f) => `${f.name} ×${f.quantity}`)].join(', ') || '—'}</td>
                    <td>
                      {o.status === 'BILLED' && o.roomInvoiceNumber ? (
                        <span className="bar-chip bar-chip--brand">On room bill · {o.roomInvoiceNumber}</span>
                      ) : o.status === 'BILLED' ? (
                        o.billId && canBill ? <button type="button" className="bar-link" onClick={() => openBill(o.billId)}>Billed · {o.billNumber}</button> : <span className="bar-chip bar-chip--ok">Billed{o.billNumber ? ` · ${o.billNumber}` : ''}</span>
                      ) : (
                        <span className="bar-chip bar-chip--out">Cancelled</span>
                      )}
                    </td>
                    <td className="is-num bar-strong">{o.status === 'CANCELLED' ? '—' : formatPrice(o.subtotal)}</td>
                  </tr>
                ))}
                {data.orders.length === 0 && <tr><td colSpan={6} className="bar-empty">No orders in this period.</td></tr>}
              </tbody>
            </table>
          </div>
        </section>
      )}
    </div>
  );
}
