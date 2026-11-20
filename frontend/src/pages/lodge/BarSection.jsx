import { useEffect, useRef, useState } from 'react';
import { apiGet, apiPost } from '../../lib/api';
import PageLoader from '../../components/PageLoader';
import BarBilling from './BarBilling';
import BarTakeOrder from './BarTakeOrder';
import BarHistory from './BarHistory';
import BarAddToRoom from './BarAddToRoom';
import { Note } from './BarBits';
import { barToken, errText, stockText } from './barFormat';
import { formatPrice } from './priceFormat';
import './Events.css';
import './forms.css';
import './Bar.css';

// Bar orders & billing. Home is Open orders; "+ Take order" opens the Take order
// page and returns here with the new order showing. Menu & Stock is its own
// sidebar entry; the report lives under Reports > Bar. Billing is also on the
// shared Billing screen's Restaurant | Bar toggle.
export default function BarSection({ lodge, permissions = [], onViewReport = null }) {
  const canTake = permissions.includes('bar.take');
  const canBill = permissions.includes('bar.bill');
  const tabs = [(canTake || canBill) && ['orders', 'Open orders'], canBill && ['billing', 'Ready to bill'], canBill && ['bills', 'Bills'], (canTake || canBill) && ['history', 'Order history']].filter(Boolean);
  const [tab, setTab] = useState(tabs[0]?.[0]);
  const [taking, setTaking] = useState(false);
  const [editing, setEditing] = useState(null); // an open order being edited
  const [placed, setPlaced] = useState(null); // { id, orderNumber } just placed
  const [pickKey, setPickKey] = useState(null); // tab to open in Bill
  if (!tabs.length) return null;

  const onPlaced = (order) => {
    setPlaced(order);
    setTaking(false);
    setTab('orders');
  };
  // "Issue bill" on an order card: jump to Bill with that order's tab selected.
  const issueBill = (o) => {
    setPickKey(o.source === 'TABLE' ? `T${o.tableId}` : o.source === 'ROOM' ? `R${o.roomId}` : `C${o.id}`);
    setTab('billing');
  };

  if (taking || editing) return <BarTakeOrder key={editing?.id ?? 'new'} hasFood={Boolean(lodge?.servesFood)} editOrder={editing} onBack={() => { setTaking(false); setEditing(null); }} onPlaced={(o) => { setEditing(null); onPlaced(o); }} />;

  return (
    <div className="bar">
      <div className="subtabs">
        {tabs.map(([key, label]) => (
          <button key={key} type="button" className="subtabs__item" aria-current={tab === key ? 'page' : undefined} onClick={() => setTab(key)}>
            {label}
          </button>
        ))}
        <div className="subtabs__tools">
          {onViewReport && (tab === 'bills' || tab === 'history') && (
            <button type="button" className="bar-btn" onClick={onViewReport}>Bar report →</button>
          )}
          {canTake && tab === 'orders' && (
            <button type="button" className="bar-btn bar-btn--primary" onClick={() => { setPlaced(null); setTaking(true); }}>+ Take order</button>
          )}
        </div>
      </div>
      {tab === 'orders' && <OpenOrders placed={placed} canTake={canTake} canRoom={canTake || canBill} onIssueBill={canBill ? issueBill : null} onEdit={canTake ? setEditing : null} />}
      {tab === 'billing' && <BarBilling lodge={lodge} pickKey={pickKey} />}
      {tab === 'bills' && <BarHistory key="bills" mode="bills" lodge={lodge} canBill={canBill} />}
      {tab === 'history' && <BarHistory key="orders" mode="orders" lodge={lodge} canBill={canBill} />}
    </div>
  );
}

const sourceLabel = (o) =>
  o.source === 'TABLE' ? `Table ${o.tableLabel ?? ''}` : o.source === 'ROOM' ? `Room ${o.roomNumber ?? ''}` : 'Counter';

const KITCHEN_LABEL = { QUEUED: 'In kitchen queue', PREPARING: 'Cooking', READY: 'Ready', DELIVERED: 'Delivered' };

function OpenOrders({ placed, canTake, canRoom, onIssueBill, onEdit }) {
  const token = barToken();
  const [orders, setOrders] = useState(null);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [lowNotice, setLowNotice] = useState('');
  const [confirm, setConfirm] = useState(null); // path awaiting a second click
  const [busy, setBusy] = useState(null);
  const [roomFor, setRoomFor] = useState(null); // order id whose room picker is open
  const [version, setVersion] = useState(0);
  const [highlight, setHighlight] = useState(placed?.id ?? null);
  const reload = () => setVersion((v) => v + 1);
  const lowSeen = useRef(null); // ids already low, so only a sale that crosses the limit raises the alert

  // Poll: dishes move through the kitchen while the captain is looking at this page.
  useEffect(() => {
    const t = setInterval(() => setVersion((v) => v + 1), 10000);
    return () => clearInterval(t);
  }, []);

  useEffect(() => {
    let live = true;
    // The bar menu is only for the low-stock alert; reading it needs bar.take or bar.bill.
    Promise.all([apiGet('/bar/orders', { token }), apiGet('/bar/menu', { token }).catch(() => ({ products: [] }))])
      .then(([o, m]) => {
        if (!live) return;
        const low = m.products.filter((p) => p.isLow);
        const crossed = lowSeen.current ? low.filter((p) => !lowSeen.current.has(p.id)) : [];
        lowSeen.current = new Set(low.map((p) => p.id));
        if (crossed.length) setLowNotice(`Low stock: ${crossed.map((p) => `${p.name} (${stockText(p)})`).join(', ')}`);
        // Orders marked ready to bill leave this list; they wait on the Ready to bill tab.
        setOrders(o.orders.filter((x) => !x.readyToBill));
      })
      .catch((e) => live && setError(errText(e, 'Could not load open orders.')));
    return () => {
      live = false;
    };
  }, [token, version]);

  // The order just placed stays highlighted for a few seconds.
  useEffect(() => {
    if (!highlight) return undefined;
    const t = setTimeout(() => setHighlight(null), 6000);
    return () => clearTimeout(t);
  }, [highlight]);

  // One place for every write: run it, reload, surface the server's message on failure.
  const act = async (path, label, body = {}) => {
    setError('');
    setNotice('');
    setBusy(path);
    try {
      const res = await apiPost(path, body, { token });
      if (res?.foodNotReady) setNotice(`Drinks delivered. ${res.foodNotReady} food order${res.foodNotReady === 1 ? ' is' : 's are'} still in the kitchen.`);
      else if (label) setNotice(label);
      reload();
    } catch (e) {
      setError(errText(e));
    } finally {
      setBusy(null);
    }
  };

  // Destructive: the first click arms the button, the second one does it.
  const cancel = (path) => {
    if (confirm !== path) return setConfirm(path);
    setConfirm(null);
    act(path);
  };

  if (!orders) return error ? <Note kind="error">{error}</Note> : <PageLoader label="Loading open orders" />;
  const armed = (path) => (confirm === path ? ' is-confirm' : '');

  return (
    <>
      {placed && <Note kind="ok">✓ Order #{placed.orderNumber} {placed.updated ? 'updated' : 'placed'}.</Note>}
      {lowNotice && <Note kind="warn">⚠ {lowNotice}</Note>}
      {notice && <Note kind="ok">{notice}</Note>}
      {error && <Note kind="error">{error}</Note>}

      {orders.length === 0 ? (
        <div className="bar-card"><div className="bar-empty">No open bar orders.{canTake ? ' Tap “+ Take order” to start one.' : ''}</div></div>
      ) : (
        <div className="bar-oc__grid">
          {orders.map((o) => {
            const orderPath = `/bar/orders/${o.id}/cancel`;
            const deliverAllPath = `/bar/orders/${o.id}/deliver`;
            const readyPath = `/bar/orders/${o.id}/ready-to-bill`;
            const state = o.readyToBill ? ['ready', 'Ready to bill'] : o.undelivered === 0 ? ['done', 'All delivered'] : ['wait', `${o.undelivered} to deliver`];
            return (
              <article className={`bar-oc bar-oc--${state[0]}${highlight === o.id ? ' bar-oc--new' : ''}`} key={o.id}>
                <header className="bar-oc__top">
                  <div className="bar-oc__who">
                    <span className="bar-oc__no">#{o.orderNumber}</span>
                    <span className="bar-oc__src">{sourceLabel(o)}</span>
                    {o.guestName && <span className="bar-oc__guest">{o.guestName}</span>}
                  </div>
                  <div className="bar-oc__amt">
                    <b>{formatPrice(o.subtotal)}</b>
                    <span className={`bar-oc__state bar-oc__state--${state[0]}`}>{state[1]}</span>
                  </div>
                </header>

                <ul className="bar-oc__items">
                  {o.items.map((i) => {
                    const delPath = `/bar/orders/${o.id}/items/${i.id}/deliver`;
                    const rmPath = `/bar/orders/${o.id}/items/${i.id}/cancel`;
                    return (
                      <li className="bar-oc__item" key={`d${i.id}`}>
                        <span className="bar-oc__qty">{i.quantity}×</span>
                        <span className="bar-oc__name">{i.name}<small>{i.size}</small></span>
                        <span className="bar-oc__acts">
                          {i.deliveredAt ? (
                            <span className="bar-oc__ok">✓ Delivered</span>
                          ) : canTake ? (
                            <>
                              <button type="button" className="bar-btn bar-btn--sm bar-btn--brand" disabled={busy === delPath} onClick={() => act(delPath)}>Deliver</button>
                              <button type="button" className={`bar-oc__x${armed(rmPath)}`} aria-label={`Remove ${i.name}`} title={confirm === rmPath ? 'Click again to confirm' : 'Remove'} onClick={() => cancel(rmPath)} onBlur={() => setConfirm(null)}>{confirm === rmPath ? 'Sure?' : '×'}</button>
                            </>
                          ) : (
                            <span className="bar-oc__wait">Pending</span>
                          )}
                        </span>
                      </li>
                    );
                  })}
                  {o.foodItems.map((f) => {
                    const delPath = `/bar/food-orders/${f.foodOrderId}/items/${f.id}/deliver`;
                    return (
                      <li className="bar-oc__item" key={`f${f.id}`}>
                        <span className="bar-oc__qty">{f.quantity}×</span>
                        <span className="bar-oc__name">{f.name}<small>{f.portion ? `${f.portion} · ` : ''}Kitchen</small></span>
                        <span className="bar-oc__acts">
                          {f.kitchenStatus === 'DELIVERED' ? (
                            <span className="bar-oc__ok">✓ Delivered</span>
                          ) : (
                            <>
                              <span className={`bar-oc__k bar-oc__k--${f.kitchenStatus.toLowerCase()}`}>{KITCHEN_LABEL[f.kitchenStatus]}</span>
                              {canTake && f.kitchenStatus === 'READY' && (
                                <button type="button" className="bar-btn bar-btn--sm bar-btn--brand" disabled={busy === delPath} onClick={() => act(delPath)}>Deliver</button>
                              )}
                            </>
                          )}
                        </span>
                      </li>
                    );
                  })}
                </ul>

                {roomFor === o.id && (
                  <div className="bar-oc__room">
                    <BarAddToRoom
                      orderIds={[o.id]}
                      onCancel={() => setRoomFor(null)}
                      onDone={(msg) => { setRoomFor(null); setNotice(`Order #${o.orderNumber}: ${msg}`); reload(); }}
                    />
                  </div>
                )}
                <footer className="bar-oc__foot">
                  <div className="bar-oc__main">
                  {canTake && o.undelivered > 0 && (
                    <button type="button" className="bar-btn bar-btn--sm" disabled={busy === deliverAllPath} onClick={() => act(deliverAllPath)}>Deliver all</button>
                  )}
                  {o.undelivered === 0 && !o.readyToBill && (
                    <button type="button" className="bar-btn bar-btn--sm bar-btn--brand" disabled={busy === readyPath} onClick={() => act(readyPath, `Order #${o.orderNumber} is ready to bill.`)}>Ready to bill</button>
                  )}
                  {onIssueBill && o.readyToBill && (
                    <button type="button" className="bar-btn bar-btn--sm bar-btn--primary" onClick={() => onIssueBill(o)}>Issue bill</button>
                  )}
                  </div>
                  <div className="bar-oc__more">
                  {canRoom && roomFor !== o.id && (
                    o.source === 'ROOM' && o.roomId && o.bookingId ? (
                      // Placed for a room: straight onto that room's bill, no picker.
                      <button
                        type="button"
                        className="bar-btn bar-btn--sm"
                        disabled={busy === `room${o.id}`}
                        onClick={() => act(`/bar/orders/${o.id}/add-to-room`, `Order #${o.orderNumber} added to Room ${o.roomNumber ?? ''}${o.guestName ? ` · ${o.guestName}` : ''}.`, { bookingId: o.bookingId, roomId: o.roomId })}
                      >
                        Add to room bill
                      </button>
                    ) : (
                      <button type="button" className="bar-btn bar-btn--sm" onClick={() => setRoomFor(o.id)}>Add to room bill</button>
                    )
                  )}
                  {onEdit && (
                    <button type="button" className="bar-btn bar-btn--sm" onClick={() => onEdit(o)}>Edit order</button>
                  )}
                  {canTake && (
                    <button type="button" className={`bar-btn bar-btn--sm bar-btn--danger bar-oc__cancel${armed(orderPath)}`} onClick={() => cancel(orderPath)} onBlur={() => setConfirm(null)}>
                      {confirm === orderPath ? 'Confirm cancel' : 'Cancel order'}
                    </button>
                  )}
                  </div>
                </footer>
              </article>
            );
          })}
        </div>
      )}
    </>
  );
}
