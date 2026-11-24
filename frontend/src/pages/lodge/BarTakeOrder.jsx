import { useEffect, useMemo, useState } from 'react';
import { apiGet, apiPatch, apiPost } from '../../lib/api';
import PageLoader from '../../components/PageLoader';
import { Note, Seg } from './BarBits';
import { barToken, errText } from './barFormat';
import { formatPrice } from './priceFormat';
import './forms.css';
import './Bar.css';

const n = (v) => Number(v || 0).toLocaleString('en-IN');
// "3 btl 180 ml", "180 ml" or "Out": short enough to sit on one row.
const stockShort = (p) => (p.stockMl <= 0 ? 'Out of stock' : `${p.bottles > 0 ? `${n(p.bottles)} btl ` : ''}${p.looseMl > 0 || p.bottles === 0 ? `${n(p.looseMl)} ml` : ''}`.trim());

// The Take order page. One screen, no page scroll: the menu scrolls inside its own
// panel (drinks or restaurant dishes, filtered by section chips and search) and the
// order panel stays beside it with the total and the Place order button always in view.
// editOrder: an open order being changed. Its drinks (not yet served) can be
// re-counted or removed here, and more drinks or dishes added; where it goes is fixed.
export default function BarTakeOrder({ hasFood, onBack, onPlaced, editOrder = null }) {
  const token = barToken();
  const [menu, setMenu] = useState(null);
  const [food, setFood] = useState([]);
  const [targets, setTargets] = useState({ tables: [], guests: [] });
  const [kind, setKind] = useState('drinks');
  const [cart, setCart] = useState([]);
  const [source, setSource] = useState('COUNTER');
  const [targetId, setTargetId] = useState('');
  const [guestName, setGuestName] = useState('');
  const [guestPhone, setGuestPhone] = useState('');
  const [search, setSearch] = useState('');
  const [cat, setCat] = useState('ALL');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [existing, setExisting] = useState(editOrder);
  // Customers with an open order, per table, so a second round goes to the same person.
  const [openCustomers, setOpenCustomers] = useState({});
  useEffect(() => {
    apiGet('/tables/customers', { token }).then((d) => setOpenCustomers(d.customers || {})).catch(() => {});
  }, [token]);

  useEffect(() => {
    let live = true;
    apiGet('/bar/menu', { token })
      .then((m) => live && setMenu(m))
      .catch((e) => live && setError(errText(e, 'Could not load the bar menu.')));
    apiGet('/bar/targets', { token }).then((t) => live && setTargets(t)).catch(() => {});
    if (hasFood) apiGet('/bar/food-menu', { token }).then((f) => live && setFood(f.sections || [])).catch(() => {});
    return () => {
      live = false;
    };
  }, [token, hasFood]);

  const qtyOf = (key) => cart.find((l) => l.key === key)?.qty || 0;
  const addLine = (line) =>
    setCart((c) => {
      const hit = c.find((l) => l.key === line.key);
      return hit ? c.map((l) => (l === hit ? { ...l, qty: (Number(l.qty) || 0) + 1 } : l)) : [...c, { ...line, qty: 1 }];
    });
  const bump = (key, d) => setCart((c) => c.map((l) => (l.key === key ? { ...l, qty: l.qty + d } : l)).filter((l) => l.qty > 0));
  // Typed quantity: blank while editing, clamped to 1-100 on leaving the field.
  const setQty = (key, v) => setCart((c) => c.map((l) => (l.key === key ? { ...l, qty: v === '' ? '' : Math.min(100, Math.max(0, parseInt(v, 10) || 0)) } : l)));
  const fixQty = (key) => setCart((c) => c.map((l) => (l.key === key && !l.qty ? { ...l, qty: 1 } : l)));
  const remove = (key) => setCart((c) => c.filter((l) => l.key !== key));
  const total = cart.reduce((s, l) => s + l.price * (Number(l.qty) || 0), 0);
  const count = cart.reduce((s, l) => s + (Number(l.qty) || 0), 0);

  // Re-read the order after an edit so counts, totals and served flags are the server's.
  const refreshExisting = async () => {
    const r = await apiGet('/bar/orders', { token });
    setExisting(r.orders.find((o) => o.id === editOrder.id) || null);
  };
  const changeExisting = async (itemId, quantity) => {
    setError('');
    try {
      if (quantity < 1) await apiPost(`/bar/orders/${editOrder.id}/items/${itemId}/cancel`, {}, { token });
      else await apiPatch(`/bar/orders/${editOrder.id}/items/${itemId}`, { quantity }, { token });
      await refreshExisting();
    } catch (e) {
      setError(errText(e));
      refreshExisting().catch(() => {});
    }
  };

  const kotOf = (where, title) => ({
    title, where: `Bar - ${where}`, guest: guestName || null,
    items: cart.map((l) => ({ name: `${l.name}${l.size ? ` ${l.size}` : ''}`, qty: Number(l.qty) || 1 })),
  });

  const place = async () => {
    setError('');
    if (editOrder) {
      setBusy(true);
      try {
        await apiPost(
          `/bar/orders/${editOrder.id}/items`,
          {
            items: cart.filter((l) => l.kind === 'DRINK').map((l) => ({ menuItemId: l.menuItemId, quantity: Number(l.qty) || 1 })),
            foodItems: cart.filter((l) => l.kind === 'FOOD').map((l) => ({ itemId: l.itemId, portionId: l.portionId, quantity: Number(l.qty) || 1 })),
          },
          { token }
        );
        onPlaced({ id: editOrder.id, orderNumber: editOrder.orderNumber, updated: true, kot: kotOf(editOrder.tableLabel ? `Table ${editOrder.tableLabel}` : editOrder.roomNumber ? `Room ${editOrder.roomNumber}` : 'Counter', 'KOT - ADD-ON') });
      } catch (e) {
        setError(errText(e, 'Could not update the order.'));
        setBusy(false);
      }
      return;
    }
    if (source === 'TABLE' && !targetId) return setError('Choose a table.');
    if (source === 'ROOM' && !targetId) return setError('Choose a room.');
    // Mobile is optional, but if it is given it must be a 10-digit number.
    const phone = guestPhone.replace(/\D/g, '').replace(/^(91|0)(?=\d{10}$)/, '');
    if (source !== 'ROOM' && guestPhone.trim() && phone.length !== 10) return setError('Enter a 10-digit mobile number, or leave it blank.');
    setBusy(true);
    try {
      const guest = source === 'ROOM' ? targets.guests.find((g) => String(g.roomId) === String(targetId)) : null;
      const res = await apiPost(
        '/bar/orders',
        {
          source: source === 'PARCEL' ? 'COUNTER' : source,
          isParcel: source === 'PARCEL',
          tableId: source === 'TABLE' ? Number(targetId) : null,
          roomId: guest ? guest.roomId : null,
          bookingId: guest ? guest.bookingId : null,
          guestName: guest ? guest.guestName : guestName || null,
          guestPhone: guest ? guest.guestPhone : phone || null,
          customerTag: source === 'TABLE' ? guestName.trim() || null : null,
          items: cart.filter((l) => l.kind === 'DRINK').map((l) => ({ menuItemId: l.menuItemId, quantity: l.qty })),
          foodItems: cart.filter((l) => l.kind === 'FOOD').map((l) => ({ itemId: l.itemId, portionId: l.portionId, quantity: l.qty })),
        },
        { token }
      );
      const tl = source === 'TABLE' ? targets.tables.find((t) => String(t.id) === String(targetId))?.label : null;
      onPlaced({ ...res, kot: kotOf(source === 'TABLE' ? `Table ${tl ?? ''}` : source === 'ROOM' ? `Room ${guest?.roomNumber ?? ''}` : source === 'PARCEL' ? 'Parcel' : 'Counter', 'KOT') });
    } catch (e) {
      setError(errText(e, 'Could not place the order.'));
      setBusy(false);
    }
  };

  const switchKind = (k) => {
    setKind(k);
    setSearch('');
    setCat('ALL');
  };

  // Drinks: in-stock first, then by name.
  const drinks = useMemo(() => {
    if (!menu) return [];
    const q = search.trim().toLowerCase();
    return menu.products
      .filter(
        (p) =>
          p.isActive &&
          p.sizes.some((s) => s.isActive) &&
          (cat === 'ALL' || (cat === 'NONE' ? p.categoryId == null : String(p.categoryId) === cat)) &&
          (!q || `${p.name} ${p.brand || ''}`.toLowerCase().includes(q))
      )
      .sort((a, b) => Number(a.stockMl <= 0) - Number(b.stockMl <= 0) || a.name.localeCompare(b.name));
  }, [menu, search, cat]);

  // Dishes the kitchen can make right now, by menu section.
  const sections = useMemo(
    () =>
      food
        .filter((s) => s.isActive)
        .map((s) => ({
          ...s,
          items: s.items
            .filter((i) => i.isActive && i.isAvailable)
            .map((i) => ({ ...i, portions: i.portions.filter((p) => p.isAvailable), hadSizes: i.portions.length > 0 }))
            .filter((i) => !i.hadSizes || i.portions.length > 0),
        }))
        .filter((s) => s.items.length > 0),
    [food]
  );
  const dishes = useMemo(() => {
    const q = search.trim().toLowerCase();
    return sections
      .filter((s) => cat === 'ALL' || String(s.id) === cat)
      .map((s) => ({ ...s, items: s.items.filter((i) => !q || i.name.toLowerCase().includes(q)) }))
      .filter((s) => s.items.length > 0);
  }, [sections, search, cat]);

  if (!menu) return error ? <Note kind="error">{error}</Note> : <PageLoader label="Loading the menu" />;

  const chips =
    kind === 'drinks'
      ? [['ALL', 'All'], ...menu.categories.filter((c) => c.isActive).map((c) => [String(c.id), c.name]), ...(menu.products.some((p) => p.categoryId == null) ? [['NONE', 'Other']] : [])]
      : [['ALL', 'All'], ...sections.map((s) => [String(s.id), s.name])];

  return (
    <div className="bar-tk">
      <div className="bar-tk__top">
        <button type="button" className="bar-btn" onClick={onBack}>← Open orders</button>
        <h2 className="bar-tk__title">{editOrder ? `Edit order #${editOrder.orderNumber}` : 'Take order'}</h2>
      </div>
      {error && <Note kind="error">{error}</Note>}

      <div className="bar-tk__grid">
        <section className="bar-tk__menu" aria-label="Menu">
          <div className="bar-tk__bar">
            {hasFood && <Seg value={kind} onChange={switchKind} options={[['drinks', 'Drinks'], ['food', 'Food']]} />}
            <input className="bar-input bar-tk__search" type="search" placeholder={kind === 'food' ? 'Search dishes' : 'Search drinks or brands'} aria-label="Search" value={search} onChange={(e) => setSearch(e.target.value)} />
          </div>
          {chips.length > 2 && (
            <div className="bar-tk__chips" role="group" aria-label="Sections">
              {chips.map(([key, label]) => (
                <button key={key} type="button" aria-pressed={cat === key} onClick={() => setCat(key)}>{label}</button>
              ))}
            </div>
          )}

          <div className="bar-tk__list">
            {kind === 'drinks' &&
              (drinks.length === 0 ? (
                <div className="bar-empty">{menu.products.length === 0 ? 'No drinks yet. Add products under Bar menu & Stock.' : 'No drinks match.'}</div>
              ) : (
                drinks.map((p) => (
                  <div className={`bar-tk__row${p.stockMl <= 0 ? ' is-out' : ''}`} key={p.id}>
                    <div className="bar-tk__info">
                      <div className="bar-tk__name">
                        <i className={`bar-dot ${p.stockMl <= 0 ? 'bar-dot--out' : p.isLow ? 'bar-dot--low' : 'bar-dot--ok'}`} aria-hidden="true" />
                        {p.name}
                        {p.isLow && p.stockMl > 0 && <span className="bar-tk__tag bar-tk__tag--low">Low</span>}
                      </div>
                      <div className="bar-tk__sub">{p.brand ? `${p.brand} · ` : ''}<span className={p.stockMl <= 0 ? 'bar-tk__out' : undefined}>{stockShort(p)}</span></div>
                    </div>
                    <div className="bar-tk__sizes">
                      {p.sizes.filter((s) => s.isActive).map((s) => {
                        const q = qtyOf(`d${s.id}`);
                        return (
                          <button key={s.id} type="button" className="bar-tk__size" disabled={!s.isAvailable} aria-label={`Add ${p.name} ${s.label}`}
                            onClick={() => addLine({ key: `d${s.id}`, kind: 'DRINK', menuItemId: s.id, name: p.name, size: s.label, price: s.price })}>
                            <b>{s.label}</b>
                            <span>{formatPrice(s.price)}</span>
                            {q > 0 && <em className="bar-tk__qty">{q}</em>}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                ))
              ))}

            {kind === 'food' &&
              (dishes.length === 0 ? (
                <div className="bar-empty">No dishes available.</div>
              ) : (
                dishes.map((s) => (
                  <div key={s.id}>
                    <div className="bar-tk__section">{s.name}</div>
                    {s.items.map((i) => (
                      <div className="bar-tk__row" key={i.id}>
                        <div className="bar-tk__info">
                          <div className="bar-tk__name">
                            <span className={`bar-veg bar-veg--${i.foodType === 'NON_VEG' ? 'non' : 'veg'}`} aria-label={i.foodType === 'NON_VEG' ? 'Non-veg' : 'Veg'} />
                            {i.name}
                          </div>
                        </div>
                        <div className="bar-tk__sizes">
                          {(i.hadSizes ? i.portions : [{ id: null, label: 'Plate', price: i.price }]).map((p) => {
                            const key = `f${i.id}:${p.id ?? ''}`;
                            const q = qtyOf(key);
                            return (
                              <button key={p.id ?? 'x'} type="button" className="bar-tk__size" aria-label={`Add ${i.name} ${p.label}`}
                                onClick={() => addLine({ key, kind: 'FOOD', itemId: i.id, portionId: p.id, name: i.name, size: i.hadSizes ? p.label : '', price: p.price })}>
                                <b>{p.label}</b>
                                <span>{formatPrice(p.price)}</span>
                                {q > 0 && <em className="bar-tk__qty">{q}</em>}
                              </button>
                            );
                          })}
                        </div>
                      </div>
                    ))}
                  </div>
                ))
              ))}
          </div>
        </section>

        <aside className="bar-tk__cart" id="bar-tk-cart" aria-label="New order">
          <header className="bar-tk__cart-head">
            <span>{editOrder ? `Order #${editOrder.orderNumber}` : 'New order'}</span>
            <span className="bar-tk__count">{count} item{count === 1 ? '' : 's'}</span>
          </header>

          {!editOrder && (
          <div className="bar-tk__dest">
            <label className="bar-field">
              <span>For</span>
              <select value={source} onChange={(e) => { setSource(e.target.value); setTargetId(''); }}>
                <option value="COUNTER">Counter</option>
                <option value="PARCEL">Parcel</option>
                <option value="TABLE">Table</option>
                <option value="ROOM">Room</option>
              </select>
            </label>
            {source === 'TABLE' && (
              <label className="bar-field">
                <span>Table</span>
                <select value={targetId} onChange={(e) => setTargetId(e.target.value)}>
                  <option value="">Choose…</option>
                  {targets.tables.map((t) => <option key={t.id} value={t.id}>{t.label}</option>)}
                </select>
              </label>
            )}
            {source === 'ROOM' && (
              <label className="bar-field">
                <span>Room</span>
                <select value={targetId} onChange={(e) => setTargetId(e.target.value)}>
                  <option value="">Choose…</option>
                  {targets.guests.map((g) => <option key={g.roomId} value={g.roomId}>{g.roomNumber} · {g.guestName}</option>)}
                </select>
              </label>
            )}
            {source !== 'ROOM' && (
              <>
                <label className="bar-field">
                  <span>{source === 'TABLE' ? 'Customer' : 'Guest name'}</span>
                  <input
                    value={guestName}
                    placeholder={source === 'TABLE' ? 'Who at the table? (billed separately)' : 'Optional'}
                    list={source === 'TABLE' ? 'bar-open-customers' : undefined}
                    onChange={(e) => setGuestName(e.target.value)}
                  />
                  {source === 'TABLE' && (
                    <datalist id="bar-open-customers">
                      {(openCustomers[targetId] || []).map((c) => <option key={c} value={c} />)}
                    </datalist>
                  )}
                </label>
                <label className="bar-field">
                  <span>Mobile number</span>
                  <input type="tel" inputMode="numeric" autoComplete="off" maxLength={14} value={guestPhone} placeholder="Optional" onChange={(e) => setGuestPhone(e.target.value)} />
                </label>
              </>
            )}
          </div>
          )}

          <div className="bar-tk__lines">
            {existing && (
              <div className="bar-tk__existing">
                <div className="bar-tk__existing-head">On this order · {formatPrice(existing.subtotal)}</div>
                {existing.items.map((i) => (
                  <div className="bar-tk__line" key={`e${i.id}`}>
                    <div className="bar-tk__line-name"><span>{i.name}</span><small>{i.size} · {formatPrice(i.unitPrice)}{i.deliveredAt ? ' · Served' : ''}</small></div>
                    {i.deliveredAt ? (
                      <><span className="bar-oc__ok">✓ Served ×{i.quantity}</span><b className="bar-tk__line-amt">{formatPrice(i.lineTotal)}</b><span /></>
                    ) : (
                      <>
                        <div className="bar-step">
                          <button type="button" onClick={() => changeExisting(i.id, i.quantity - 1)} aria-label={`Fewer ${i.name}`}>−</button>
                          <input type="number" inputMode="numeric" min="1" max="100" defaultValue={i.quantity} key={`${i.id}-${i.quantity}`} aria-label={`Quantity of ${i.name}`} onFocus={(e) => e.target.select()} onBlur={(e) => { const q = parseInt(e.target.value, 10); if (q >= 1 && q !== i.quantity) changeExisting(i.id, q); }} />
                          <button type="button" onClick={() => changeExisting(i.id, i.quantity + 1)} aria-label={`More ${i.name}`}>+</button>
                        </div>
                        <b className="bar-tk__line-amt">{formatPrice(i.lineTotal)}</b>
                        <button type="button" className="bar-tk__rm" onClick={() => changeExisting(i.id, 0)} aria-label={`Remove ${i.name}`} title="Remove">×</button>
                      </>
                    )}
                  </div>
                ))}
                {existing.foodItems.map((f) => (
                  <div className="bar-tk__line" key={`ef${f.id}`}>
                    <div className="bar-tk__line-name"><span>{f.name}</span><small>{f.portion ? `${f.portion} · ` : ''}Kitchen · {f.quantity}×</small></div>
                    <span /><b className="bar-tk__line-amt">{formatPrice(f.lineTotal)}</b><span />
                  </div>
                ))}
              </div>
            )}
            {editOrder && cart.length > 0 && <div className="bar-tk__existing-head">Adding</div>}
            {cart.length === 0 && <div className="bar-tk__hint">{editOrder ? 'Tap a size to add more to this order.' : 'Tap a size to add it to the order.'}</div>}
            {cart.map((l) => (
              <div className="bar-tk__line" key={l.key}>
                <div className="bar-tk__line-name">
                  <span>{l.name}</span>
                  <small>{l.size ? `${l.size} · ` : ''}{formatPrice(l.price)}{l.kind === 'FOOD' ? ' · Kitchen' : ''}</small>
                </div>
                <div className="bar-step">
                  <button type="button" onClick={() => bump(l.key, -1)} aria-label={`Fewer ${l.name}`}>−</button>
                  <input type="number" inputMode="numeric" min="1" max="100" value={l.qty} aria-label={`Quantity of ${l.name}`} onFocus={(e) => e.target.select()} onChange={(e) => setQty(l.key, e.target.value)} onBlur={() => fixQty(l.key)} />
                  <button type="button" onClick={() => bump(l.key, 1)} aria-label={`More ${l.name}`}>+</button>
                </div>
                <b className="bar-tk__line-amt">{formatPrice(l.price * (Number(l.qty) || 0))}</b>
                <button type="button" className="bar-tk__rm" onClick={() => remove(l.key)} aria-label={`Remove ${l.name}`} title="Remove">×</button>
              </div>
            ))}
          </div>

          <footer className="bar-tk__foot">
            {cart.length > 0 && <button type="button" className="bar-link" onClick={() => setCart([])}>Clear</button>}
            <div className="bar-tk__total"><span>Total</span><b>{formatPrice(total)}</b></div>
            <button type="button" className="bar-btn bar-btn--primary bar-btn--block" disabled={(!cart.length && !editOrder) || busy} onClick={cart.length || !editOrder ? place : onBack}>
              {busy ? (editOrder ? 'Saving…' : 'Placing order…') : editOrder ? (count ? `Add to order · ${count}` : 'Done') : `Place order${count ? ` · ${count}` : ''}`}
            </button>
          </footer>
        </aside>
      </div>

      {/* Phones: the order panel is below the menu, so keep the total and a way to it in reach. */}
      <button type="button" className="bar-tk__fab" onClick={() => document.getElementById('bar-tk-cart')?.scrollIntoView({ behavior: 'smooth' })}>
        <span>{count} item{count === 1 ? '' : 's'}</span>
        <b>{formatPrice(total)}</b>
        <span>Review order ↓</span>
      </button>
    </div>
  );
}
