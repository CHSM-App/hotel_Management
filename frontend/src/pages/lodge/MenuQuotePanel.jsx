import { useEffect, useMemo, useState } from 'react';
import { apiGet, apiPost, ApiError } from '../../lib/api';
import { getSession } from '../../lib/auth';
import { formatPrice } from './priceFormat';
import GuestFields from './QuoteGuestFields';
import { QuoteSection, QuoteColumns, QuoteActions } from './QuoteBits';
import { useQuotationSend } from './useQuotationSend';
import { isIndianMobile } from './quotationKinds';

/**
 * New FOOD or BAR quotation: pick items and quantities, optionally a
 * discount. Prices shown are the menu's today; the server prices the lines
 * again on save, so what is stored is its answer.
 */
export default function MenuQuotePanel({ kind, onSaved }) {
  const token = getSession()?.token;
  const isBar = kind === 'BAR';
  const { send, host } = useQuotationSend();
  const [entries, setEntries] = useState(null);
  const [qty, setQty] = useState({});
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [search, setSearch] = useState('');
  const [discount, setDiscount] = useState('');
  const [note, setNote] = useState('');
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  // One entry per sellable line: a dish (or one size of it), or one bar size.
  useEffect(() => {
    apiGet(isBar ? '/bar/menu' : '/menu', { token })
      .then((data) => {
        const out = [];
        if (isBar) {
          const cats = Object.fromEntries((data.categories || []).map((c) => [c.id, c.name]));
          for (const p of (data.products || []).filter((x) => x.isActive)) {
            for (const s of (p.sizes || []).filter((x) => x.isActive && x.isAvailable)) {
              out.push({ key: `b${s.id}`, group: cats[p.categoryId] || 'Bar', name: `${p.name} ${s.label}`, price: s.price, payload: { menuItemId: s.id } });
            }
          }
        } else {
          for (const sec of (data.sections || []).filter((x) => x.isActive)) {
            for (const i of (sec.items || []).filter((x) => x.isActive && x.isAvailable)) {
              if (!(i.portions || []).length) {
                out.push({ key: `f${i.id}`, group: sec.name, name: i.name, price: i.price, payload: { itemId: i.id } });
              } else {
                for (const pt of i.portions.filter((x) => x.isAvailable)) {
                  out.push({ key: `f${i.id}p${pt.id}`, group: sec.name, name: `${i.name} · ${pt.label}`, price: pt.price, payload: { itemId: i.id, portionId: pt.id } });
                }
              }
            }
          }
        }
        setEntries(out);
      })
      .catch((err) => setError(err instanceof ApiError ? err.message : 'Could not load the menu.'));
  }, [isBar, token]);

  const shown = useMemo(() => {
    const needle = search.trim().toLowerCase();
    return (entries || []).filter((e) => !needle || e.name.toLowerCase().includes(needle) || e.group.toLowerCase().includes(needle));
  }, [entries, search]);

  const subtotal = (entries || []).reduce((sum, e) => sum + Number(e.price) * (qty[e.key] || 0), 0);
  const off = Math.min(Math.max(Number(discount) || 0, 0), subtotal);
  const count = Object.values(qty).reduce((a, b) => a + b, 0);
  const bump = (key, by) =>
    setQty((q) => {
      const next = Math.min(Math.max((q[key] || 0) + by, 0), 999);
      return Object.fromEntries(Object.entries({ ...q, [key]: next }).filter(([, n]) => n > 0));
    });

  const phoneBad = phone !== '' && !isIndianMobile(phone);
  const save = async (andSend) => {
    if (phoneBad) return;
    const items = entries.filter((e) => qty[e.key] > 0).map((e) => ({ ...e.payload, quantity: qty[e.key] }));
    if (!items.length) {
      setError('Add at least one item.');
      return;
    }
    setSaving(true);
    setError('');
    try {
      const saved = await apiPost(
        '/quotations',
        {
          kind,
          guestName: name.trim() || undefined,
          guestPhone: phone || undefined,
          items,
          discountAmount: discount !== '' ? Number(discount) : undefined,
          note: note.trim() || undefined,
        },
        { token }
      );
      // Send before leaving this form: the list that follows would unmount it.
      if (andSend) window.alert(await send(saved));
      onSaved?.();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not save the quotation.');
    } finally {
      setSaving(false);
    }
  };

  const main = (
    <QuoteSection
      title={isBar ? 'Bar items' : 'Menu items'}
      hint={count === 0 ? 'Press + to add an item.' : `${count} item${count === 1 ? '' : 's'} added.`}
    >
      <div className="field">
        <input
          type="search"
          aria-label={isBar ? 'Search bar items' : 'Search the menu'}
          placeholder={isBar ? 'Search bar items' : 'Search the menu'}
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
      </div>
      {entries === null && !error && <div className="dash-state">Loading…</div>}
      {entries && shown.length === 0 && <div className="dash-state">Nothing matches.</div>}
      {shown.map((e) => (
        <div className="quote-items__row" key={e.key}>
          <span>
            <strong>{e.name}</strong>
            <small>
              {e.group} · {formatPrice(e.price)}
            </small>
          </span>
          <span className="quote-items__step">
            {qty[e.key] > 0 && (
              <>
                <button type="button" aria-label={`Fewer ${e.name}`} onClick={() => bump(e.key, -1)}>
                  −
                </button>
                <b>{qty[e.key]}</b>
              </>
            )}
            <button type="button" aria-label={`Add ${e.name}`} onClick={() => bump(e.key, 1)}>
              +
            </button>
          </span>
        </div>
      ))}
    </QuoteSection>
  );

  const side = (
    <>
      <QuoteSection title="Customer" hint="Shown under “Prepared for”. Both are optional.">
        <GuestFields name={name} setName={setName} phone={phone} setPhone={setPhone} />
      </QuoteSection>
      <QuoteSection title="Summary">
        <div className="sim-fields">
          <div className="field">
            <label htmlFor="mq-disc">Discount (₹)</label>
            <input id="mq-disc" type="number" min="0" placeholder="Optional" value={discount} onChange={(e) => setDiscount(e.target.value)} />
          </div>
          <div className="field">
            <label htmlFor="mq-note">Note</label>
            <input id="mq-note" placeholder="Printed on the quotation" value={note} maxLength={300} onChange={(e) => setNote(e.target.value)} />
          </div>
        </div>
        {off > 0 && (
          <>
            <div className="sim-result__line">
              <span>Subtotal</span>
              <span>{formatPrice(subtotal)}</span>
            </div>
            <div className="sim-result__line">
              <span>Discount</span>
              <span>− {formatPrice(off)}</span>
            </div>
          </>
        )}
        <div className="quote-total">
          <span>Total{isBar ? ' (prices include tax)' : ''}</span>
          <strong>{formatPrice(subtotal - off)}</strong>
        </div>
      </QuoteSection>
      {error && <div className="form-banner form-banner--error">{error}</div>}
      <QuoteActions saving={saving} disabled={subtotal === 0 || phoneBad} onSave={() => save(false)} onSaveAndSend={() => save(true)} />
    </>
  );

  return (
    <>
      <QuoteColumns main={main} side={side} />
      {host}
    </>
  );
}
