import { useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useUrlState } from '../../lib/urlState';
import OrdersPanel from './OrdersPanel';
import Billing from './Billing';
import './Events.css';

// One sidebar entry for the restaurant, one tab strip: the orders tabs, then the
// billing tabs. Which tabs a login gets follows what it may already do —
// orders.manage / orders.take open the orders tabs, billing.manage the billing
// ones — so an accountant still sees only billing and a captain or the kitchen
// only orders.
//
// ?view= says which screen (queue | active | history | billing); on billing the
// tab is Billing's own ?tab=, so Billing works exactly as before with its own
// strip lifted up here.
const BILLING_TABS = [
  { key: 'tables', label: 'Food to bill' },
  { key: 'bills', label: 'Bills' },
  { key: 'numbering', label: 'Numbering' },
];

export default function FoodSection({ lodge, permissions = [], initialView = null }) {
  const canWork = permissions.includes('orders.manage');
  const canOrders = canWork || permissions.includes('orders.take');
  const canBill = permissions.includes('billing.manage');
  const [view] = useUrlState('view');
  const [billTab] = useUrlState('tab', 'tables');
  const [, setSearchParams] = useSearchParams();
  // Screen and billing tab are written in ONE update: two separate URL setters
  // in a row each start from the same snapshot, so the second erases the first.
  const go = (nextView, nextTab = null) =>
    setSearchParams(
      (prev) => {
        const updated = new URLSearchParams(prev);
        updated.set('view', nextView);
        if (nextTab) updated.set('tab', nextTab);
        else updated.delete('tab');
        return updated;
      },
      { replace: true }
    );
  const [pending, setPending] = useState(0);
  // Where the orders actions (sound, take an order) land: the right end of this
  // same strip, so the tabs and the buttons share one row.
  const [toolsHost, setToolsHost] = useState(null);
  if (!canOrders && !canBill) return null;

  // The live tab: the kitchen queue for whoever works it, "what is still open"
  // for a captain (same tab, same label as before).
  const liveKey = canWork ? 'queue' : 'active';
  const orderKeys = [liveKey, 'history'];
  const wanted = view || initialView;
  const showing = canOrders && !(wanted === 'billing' && canBill) ? (orderKeys.includes(wanted) ? wanted : liveKey) : 'billing';
  // With the orders tabs there is no separate Food to bill or Bills list: History
  // rows carry an Issue bill button and each bill's number / View bill. The billing
  // strip keeps only what is left (Numbering).
  const billingTabs = BILLING_TABS.filter((t) => !(canOrders && (t.key === 'bills' || t.key === 'tables')));
  const activeBillTab = billingTabs.some((t) => t.key === billTab) ? billTab : billingTabs[0]?.key;

  const strip = [
    ...(canOrders
      ? [
          { id: liveKey, label: 'Kitchen queue', badge: !canWork ? pending : 0, on: showing === liveKey, go: () => go(liveKey) },
          { id: 'history', label: 'History', on: showing === 'history', go: () => go('history') },
        ]
      : []),
    // "Bills" is left out when the login has the orders tabs: History already
    // shows each order's bill number, status and View bill, so the two lists
    // were the same rows. Billing-only logins (accountant) keep the Bills list.
    ...(canBill
      ? billingTabs.map((t) => ({
          id: t.key,
          label: t.label,
          on: showing === 'billing' && activeBillTab === t.key,
          go: () => go('billing', t.key),
        }))
      : []),
  ];

  return (
    <div>
      {canOrders && (
        <div className="subtabs">
          {strip.map((t) => (
            <button
              key={t.id}
              type="button"
              className="subtabs__item"
              aria-current={t.on ? 'page' : undefined}
              onClick={t.go}
            >
              {t.label}
              {t.badge > 0 && <span className="orders-tab__badge">{t.badge}</span>}
            </button>
          ))}
          {showing !== 'billing' && <div className="subtabs__tools" ref={setToolsHost} />}
        </div>
      )}

      {showing !== 'billing' && (
        <OrdersPanel
          lodge={lodge}
          permissions={permissions}
          view={showing.toUpperCase()}
          onViewChange={(v) => go(v.toLowerCase())}
          hideTabs
          toolsHost={toolsHost}
          onPendingChange={setPending}
        />
      )}

      {showing === 'billing' && <Billing lodge={lodge} stream="restaurant" hideTabs={canOrders} forceTab={canOrders ? activeBillTab : null} />}
    </div>
  );
}
