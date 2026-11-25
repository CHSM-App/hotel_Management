import { useEffect, useRef, useState } from 'react';
import { apiGet, apiPost } from '../../lib/api';
import PageLoader from '../../components/PageLoader';
import PaymentLines from './PaymentLines';
import BarAddToRoom from './BarAddToRoom';
import { Field, Note } from './BarBits';
import { emptyPaymentLine, sumLines } from './paymentSplit';
import { barToken, errText, printBarBill } from './barFormat';
import { formatPrice } from './priceFormat';
import './forms.css';
import './Bar.css';

// Bar bills, for the shared Billing screen (Restaurant | Bar toggle) and the Bar
// section's Bill tab. Open bar orders are grouped per table, room or counter
// order; one is billed at a time, with split payments.
export default function BarBilling({ lodge, pickKey = null }) {
  const token = barToken();
  const [tabs, setTabs] = useState(null);
  const [taxPercent, setTaxPercent] = useState(0);
  const [picked, setPicked] = useState(null);
  const [lines, setLines] = useState([emptyPaymentLine()]);
  const [customer, setCustomer] = useState('');
  const [discount, setDiscount] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [bill, setBill] = useState(null);
  const [toRoom, setToRoom] = useState(false);
  const [note, setNote] = useState('');
  const [version, setVersion] = useState(0);
  const reload = () => setVersion((v) => v + 1);
  const pickedOnce = useRef(false);

  const pick = (tab) => {
    setPicked(tab);
    setCustomer(tab.guestName || '');
    setLines([{ ...emptyPaymentLine(), amount: String(tab.subtotal) }]);
    setDiscount('');
    setError('');
    setToRoom(false);
    setBill(null);
  };

  useEffect(() => {
    let live = true;
    Promise.all([apiGet('/bar/tabs', { token }), apiGet('/bar/settings', { token })])
      .then(([t, s]) => {
        if (!live) return;
        setTabs(t.tabs);
        setTaxPercent(s.taxPercent);
        // Arrived from "Issue bill" on an order card: open that tab straight away.
        const wanted = pickKey && t.tabs.find((x) => x.key === pickKey);
        if (wanted && !pickedOnce.current) {
          pickedOnce.current = true;
          pick(wanted);
        }
      })
      .catch((e) => live && setError(errText(e, 'Could not load bar bills.')));
    return () => {
      live = false;
    };
  }, [token, version, pickKey]);


  const paid = picked ? sumLines(lines) : 0;
  const drinksTotal = picked ? picked.items.reduce((s, i) => s + i.lineTotal, 0) : 0;
  const foodTotal = picked ? picked.foodItems.reduce((s, f) => s + f.lineTotal, 0) : 0;
  // What the desk takes off, never more than the bill; drinks and food give it up in proportion.
  const off = picked ? Math.min(Math.max(Math.round((Number(discount) || 0) * 100) / 100, 0), picked.subtotal) : 0;
  const total = picked ? Math.round((picked.subtotal - off) * 100) / 100 : 0;
  const netDrinks = picked && picked.subtotal > 0 ? (drinksTotal * total) / picked.subtotal : 0;
  const tax = Math.round((netDrinks - netDrinks / (1 + taxPercent / 100)) * 100) / 100;
  const diff = picked ? Math.round((total - paid) * 100) / 100 : 0;

  const changeDiscount = (v) => {
    setDiscount(v);
    // One payment row simply follows the new total.
    if (lines.length === 1) {
      const n = Math.min(Math.max(Number(v) || 0, 0), picked.subtotal);
      setLines([{ ...lines[0], amount: String(Math.round((picked.subtotal - n) * 100) / 100) }]);
    }
  };

  const issue = async () => {
    setError('');
    if (lines.some((l) => !l.method || !(Number(l.amount) > 0))) return setError('Choose a payment type and amount for every row.');
    if (Math.abs(diff) > 0.009) return setError(`Payments add up to ${formatPrice(paid)}, but the bill is ${formatPrice(total)}.`);
    setBusy(true);
    try {
      const made = await apiPost(
        '/bar/bills',
        {
          orderIds: picked.orderIds,
          customerName: customer || null,
          ...(off > 0 ? { discountAmount: off } : {}),
          payments: lines.map((l) => ({ method: l.method, amount: Number(l.amount), reference: l.reference || null })),
        },
        { token }
      );
      setBill(made);
      setPicked(null);
      reload();
    } catch (e) {
      setError(errText(e, 'Could not issue the bill.'));
      reload();
    } finally {
      setBusy(false);
    }
  };

  if (!tabs) return error ? <Note kind="error">{error}</Note> : <PageLoader label="Loading bar bills" />;

  return (
    <div className="bar-bill">
      <section className="bar-card" aria-label="Bar to bill">
        <div>
          <h3 className="bar-card__title">Open bills</h3>
          <div className="bar-card__sub">Open orders to bill, by table, room or counter.</div>
        </div>
        {tabs.length === 0 ? (
          <div className="bar-empty">Nothing to bill. Take an order from Open orders.</div>
        ) : (
          <div className="bar-stack">
            {tabs.map((t) => (
              <button key={t.key} type="button" className="bar-tab" aria-pressed={picked?.key === t.key} onClick={() => pick(t)}>
                <span>
                  <span className="bar-tab__label">{t.label}</span>
                  <span className="bar-muted" style={{ display: 'block' }}>
                    {t.guestName ? `${t.guestName} · ` : ''}{t.items.length + t.foodItems.length} item{t.items.length + t.foodItems.length === 1 ? '' : 's'}
                    {t.pendingDelivery > 0 && <> · <span className="bar-chip bar-chip--low">{t.pendingDelivery} to deliver</span></>}
                  </span>
                </span>
                <span className="bar-tab__amt">{formatPrice(t.subtotal)}</span>
              </button>
            ))}
          </div>
        )}
      </section>

      <section className="bar-card bar-sticky" aria-label="Bill">
        {bill && (
          <div className="bar-success">
            <Note kind="ok">✓ Bill {bill.billNumber} issued · {formatPrice(bill.total)}</Note>
            <button type="button" className="bar-btn bar-btn--primary" onClick={() => printBarBill(bill, lodge?.name)}>Print bill</button>
          </div>
        )}
        {note && !picked && !bill && <Note kind="ok">✓ {note}</Note>}
        {!picked && !bill && <div className="bar-empty">Choose an order on the left to bill it.</div>}
        {picked && (
          <>
            <div className="bar-card__head">
              <h3 className="bar-card__title">{picked.label}</h3>
              <span className="bar-chip bar-chip--brand">Bar</span>
            </div>
            <div>
              {picked.items.map((i) => (
                <div className="bar-receipt-line" key={`d${i.id}`}>
                  <span>{i.name} · {i.size} × {i.quantity}</span>
                  <b>{formatPrice(i.lineTotal)}</b>
                </div>
              ))}
              {picked.foodItems.map((f) => (
                <div className="bar-receipt-line" key={`f${f.id}`}>
                  <span>{f.name}{f.portion ? ` · ${f.portion}` : ''} × {f.quantity} <span className="bar-chip bar-chip--brand">Food</span></span>
                  <b>{formatPrice(f.lineTotal)}</b>
                </div>
              ))}
              <hr className="bar-rule" />
              {drinksTotal > 0 && <div className="bar-receipt-line"><span>Drinks include tax ({taxPercent}%)</span><b>{formatPrice(tax)}</b></div>}
              {foodTotal > 0 && <div className="bar-receipt-line"><span>Food total (GST added on the bill if registered)</span><b>{formatPrice(foodTotal)}</b></div>}
              {off > 0 && <div className="bar-receipt-line"><span>Discount</span><b>-{formatPrice(off)}</b></div>}
              <div className="bar-total"><span className="bar-strong">Total</span><b>{formatPrice(total)}</b></div>
            </div>
            {!toRoom && (
              <>
                <Field label="Customer name (optional)">
                  <input value={customer} onChange={(e) => setCustomer(e.target.value)} />
                </Field>
                <Field label="Discount (optional)">
                  <input type="number" min="0" step="1" inputMode="decimal" placeholder="₹ 0" value={discount} onChange={(e) => changeDiscount(e.target.value)} />
                </Field>
                <div>
                  <div className="bar-strong" style={{ fontSize: 12.5, marginBottom: 6 }}>Payment</div>
                  <PaymentLines lines={lines} onChange={setLines} idPrefix="bar" required />
                  {Math.abs(diff) > 0.009 && (
                    <div className="bar-muted" style={{ marginTop: 6 }}>
                      {diff > 0 ? `${formatPrice(diff)} still to collect` : `${formatPrice(-diff)} over the total`}
                    </div>
                  )}
                </div>
              </>
            )}
            {error && <Note kind="error">{error}</Note>}
            {toRoom ? (
              // Posting to a room instead of billing here: no payment, no Issue bill.
              <BarAddToRoom
                primary
                orderIds={picked.orderIds}
                fixedRoom={picked.source === 'ROOM' && picked.roomId && picked.bookingId ? { roomId: picked.roomId, bookingId: picked.bookingId, roomNumber: String(picked.label).replace(/^Room\s*/, ''), guestName: picked.guestName } : null}
                onCancel={() => setToRoom(false)}
                onDone={(msg) => { setToRoom(false); setPicked(null); setBill(null); setNote(msg); reload(); }}
              />
            ) : (
              <>
                <button type="button" className="bar-btn bar-btn--block" onClick={() => setToRoom(true)}>Add to room bill instead</button>
                <button type="button" className="bar-btn bar-btn--primary bar-btn--block" disabled={busy} onClick={issue}>
                  {busy ? 'Issuing bill…' : `Issue bill · ${formatPrice(total)}`}
                </button>
              </>
            )}
          </>
        )}
        {error && !picked && <Note kind="error">{error}</Note>}
      </section>
    </div>
  );
}
