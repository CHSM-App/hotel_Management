import { useEffect, useState } from 'react';
import { apiGet, apiPost, apiPatch, ApiError } from '../../lib/api';
import { getSession } from '../../lib/auth';
import { formatPrice } from './priceFormat';
import { triggerDownload } from './bookingReportFile';
import PageLoader from '../../components/PageLoader';
import Req from '../../components/RequiredMark';
import { Modal, Stepper, StatusIcon } from './HousekeepingParts';
import { ago } from './housekeepingFormat';
import './forms.css';
import './chartSections.css';
import './MenuPanel.css';
import './RoomsPanel.css';
import './RoomsAndRates.css';
import './HousekeepingPanel.css';

const errorText = (err, fallback) => (err instanceof ApiError ? err.message : fallback);

// ---------------------------------------------------------------------------
// Hotel linen
// ---------------------------------------------------------------------------

const MOVE_LABEL = {
  CHANGED: 'Changed in a room or venue',
  SENT: 'Sent for washing',
  RECEIVED: 'Received washed',
  LOST: 'Marked lost',
  DAMAGED: 'Marked damaged',
};
const MOVE_FILTERS = [
  { key: 'ALL', label: 'All', kinds: null },
  { key: 'SENT', label: 'Sent', kinds: ['SENT'] },
  { key: 'RECEIVED', label: 'Received', kinds: ['RECEIVED'] },
  { key: 'ROOMS', label: 'Rooms', kinds: ['CHANGED'] },
  { key: 'LOSS', label: 'Lost or damaged', kinds: ['LOST', 'DAMAGED'] },
];

// The filtered history as a spreadsheet: one row per item moved, newest first.
// Cells are plain values; numbers (qty, amounts) are right-aligned as numbers.
async function downloadSheet(sheet, filename, headings, rows, widths) {
  const { default: writeXlsxFile } = await import('write-excel-file/browser');
  const head = headings.map((value) => ({ value, fontWeight: 'bold', backgroundColor: '#e8e6f5' }));
  const data = rows.map((r) =>
    r.map((v) => (typeof v === 'number' ? { value: v, type: Number, align: 'right' } : { value: v === '' ? null : v }))
  );
  const workbook = await writeXlsxFile(
    [{ data: [head, ...data], sheet, stickyRowsCount: 1, columns: widths.map((width) => ({ width })) }],
    { fontFamily: 'Calibri', fontSize: 11 }
  );
  triggerDownload(await workbook.toBlob(), `${filename}-${new Date().toISOString().slice(0, 10)}.xlsx`);
}

const sheetDate = (value) =>
  value ? new Date(value).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }) : '';
const sheetTime = (value) =>
  value ? new Date(value).toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit' }) : '';

const LINEN_COLS = ['Date', 'Time', 'Action', 'Room / venue', 'Item', 'Qty', 'Washed by', 'Charge (₹)', 'Entered by', 'Note'];
// What the lodge's own laundry is recorded as, so the report groups it under one name.
const OWN_LAUNDRY = 'Own laundry';

// Who washed last time is who washes this time, more often than not: the
// lodge's own laundry, or the same outside vendor by name.
const washerFrom = (lastWashedBy, lastPhone = '') => {
  const last = String(lastWashedBy ?? '').trim();
  const own = last.toLowerCase() === OWN_LAUNDRY.toLowerCase();
  return { washer: own ? 'OWN' : 'VENDOR', washedBy: own ? '' : last, vendorPhone: own ? '' : String(lastPhone ?? ''), charge: '' };
};
const washerBody = (m) => ({
  washedBy: m.washer === 'OWN' ? OWN_LAUNDRY : m.washedBy.trim(),
  vendorPhone: m.washer === 'VENDOR' ? String(m.vendorPhone ?? '').trim() : '',
  // A charge only means something when somebody outside is paid for the wash.
  charge: m.washer === 'VENDOR' && m.charge !== '' ? Number(m.charge) : null,
});
// What is wrong with the washer fields, per field, or {} when nothing is.
// `needName` and `needPrice` say which of an outside vendor's details this
// step insists on; a phone is checked only when one is typed.
const washerErrors = (m, { needName = false, needPrice = false } = {}) => {
  const errs = {};
  if (m.washer !== 'VENDOR') return errs;
  if (needName && !m.washedBy.trim()) errs.washedBy = 'Vendor name is required';
  const phone = String(m.vendorPhone ?? '').replace(/\D/g, '');
  if (String(m.vendorPhone ?? '').trim() && phone.length !== 10) errs.vendorPhone = 'Enter a 10-digit mobile number';
  if (m.charge === '') {
    if (needPrice) errs.charge = 'Price is required';
  } else if (!(Number(m.charge) >= 0)) {
    errs.charge = 'Enter the price as a number';
  }
  return errs;
};
// The first of those as one line, for a popup that shows a single banner.
const washerError = (m, rules) => Object.values(washerErrors(m, rules))[0] ?? '';

// Who washes it — hotel linen and guest laundry ask the same way. An outside
// vendor has a name and may have a price; the lodge's own laundry has neither.
// It is what the Laundry report groups by.
function WasherFields({ value, onChange, priceLabel, hideLabel = false, withPhone = false, needName = false, needPrice = false, errors = {} }) {
  const name = (
    <div className="field">
      <label htmlFor="hkWashedBy">
        Vendor name{needName ? <Req /> : ' (optional)'}
      </label>
      <input
        id="hkWashedBy"
        maxLength={100}
        value={value.washedBy}
        aria-invalid={Boolean(errors.washedBy) || undefined}
        onChange={(e) => onChange({ washedBy: e.target.value })}
        placeholder="e.g. Sai Laundry"
      />
      {errors.washedBy && <p className="field__error">{errors.washedBy}</p>}
    </div>
  );
  const price = (
    <div className="field">
      <label htmlFor="hkWashCharge">
        {priceLabel}
        {needPrice ? <Req /> : ' (optional)'}
      </label>
      <input
        id="hkWashCharge"
        type="number"
        inputMode="decimal"
        min="0"
        step="0.5"
        value={value.charge}
        aria-invalid={Boolean(errors.charge) || undefined}
        onChange={(e) => onChange({ charge: e.target.value })}
        placeholder="e.g. 450"
      />
      {errors.charge && <p className="field__error">{errors.charge}</p>}
    </div>
  );
  return (
    <>
      <div className="field">
        {!hideLabel && <label>Washed by</label>}
        <div className="toggle-group">
          <button type="button" aria-pressed={value.washer === 'VENDOR'} onClick={() => onChange({ washer: 'VENDOR' })}>
            Outside vendor
          </button>
          <button type="button" aria-pressed={value.washer === 'OWN'} onClick={() => onChange({ washer: 'OWN' })}>
            Own laundry
          </button>
        </div>
      </div>
      {value.washer === 'VENDOR' &&
        (withPhone ? (
          <>
            <div className="field-row">
              {name}
              <div className="field">
                <label htmlFor="hkVendorPhone">Vendor mobile</label>
                <input
                  id="hkVendorPhone"
                  type="tel"
                  inputMode="numeric"
                  maxLength={15}
                  value={value.vendorPhone ?? ''}
                  aria-invalid={Boolean(errors.vendorPhone) || undefined}
                  onChange={(e) => onChange({ vendorPhone: e.target.value })}
                  placeholder="10-digit number"
                />
                {errors.vendorPhone && <p className="field__error">{errors.vendorPhone}</p>}
              </div>
            </div>
            {price}
          </>
        ) : (
          <div className="field-row">
            {name}
            {price}
          </div>
        ))}
    </>
  );
}

const linenRow = (m) => [
  sheetDate(m.createdAt), sheetTime(m.createdAt), MOVE_LABEL[m.kind], m.roomNumber || m.venueName || '', m.itemName,
  m.quantity, m.washedBy || '', m.washCharge ?? '', m.userName || '', m.note || '',
];

const GUEST_COLS = ['Tag', 'Guest', 'Room', 'Items', 'Pieces', 'Status', 'Sent to wash', 'Handed over', 'Amount', 'Washed by', 'Vendor mobile', 'Vendor price (₹)', 'Note'];
// Sent to wash, received back from the wash, handed to the guest.
const GUEST_STATUS = { RECEIVED: 'In wash', WASHING: 'In wash', READY: 'Received', DELIVERED: 'Handed over', CANCELLED: 'Cancelled' };
const guestRow = (o) => [
  o.tagNumber, o.guestName || '', o.roomNumber || 'Walk-in',
  o.items.map((i) => `${i.name} ×${i.quantity}`).join(', '), o.pieces, GUEST_STATUS[o.status] || o.status,
  `${sheetDate(o.receivedAt)} ${sheetTime(o.receivedAt)}`.trim(),
  `${sheetDate(o.deliveredAt)} ${sheetTime(o.deliveredAt)}`.trim(), Number(o.total), o.washedBy || '', o.vendorPhone || '', o.washCharge ?? '', o.note || '',
];

// A date cell shows "08 Oct 2026", which does not sort as a date; these are
// what the date and time columns sort on instead.
const timeOfDay = (value) => {
  if (!value) return -1;
  const d = new Date(value);
  return d.getHours() * 60 + d.getMinutes();
};
const linenSortRow = (m) => {
  const row = linenRow(m);
  row[0] = String(m.createdAt ?? '');
  row[1] = timeOfDay(m.createdAt);
  return row;
};
const guestSortRow = (o) => {
  const row = guestRow(o);
  row[6] = String(o.receivedAt ?? '');
  row[7] = String(o.deliveredAt ?? '');
  return row;
};

// A spreadsheet-style grid, shared by the linen and guest laundry views. A
// heading sorts by its column; clicking it again turns it round. sortRows gives
// what each cell sorts on where that is not what it shows.
function SheetTable({ columns, rows, sortRows = rows, numericCols = [], actions }) {
  const [sort, setSort] = useState({ col: null, dir: 1 });
  const toggleSort = (col) => setSort((cur) => (cur.col === col ? { col, dir: -cur.dir } : { col, dir: 1 }));
  // Sorted by index, so actions(i) still gets the row's place in `rows`.
  const order = rows.map((_, i) => i);
  if (sort.col != null) {
    order.sort((a, b) => {
      const x = sortRows[a][sort.col];
      const y = sortRows[b][sort.col];
      const cmp =
        typeof x === 'number' && typeof y === 'number'
          ? x - y
          : String(x).localeCompare(String(y), undefined, { numeric: true, sensitivity: 'base' });
      return cmp * sort.dir;
    });
  }
  return (
    <div className="hk-sheet-wrap">
      <table className="hk-sheet">
        <thead>
          <tr>
            {columns.map((h, c) => (
              <th key={h} aria-sort={sort.col === c ? (sort.dir === 1 ? 'ascending' : 'descending') : undefined}>
                <button type="button" className="hk-sort" onClick={() => toggleSort(c)} title={`Sort by ${h}`}>
                  {h}
                  <span className="hk-sort__icon" aria-hidden="true">
                    {sort.col === c ? (sort.dir === 1 ? '▲' : '▼') : '⇅'}
                  </span>
                </button>
              </th>
            ))}
            {actions && <th>Actions</th>}
          </tr>
        </thead>
        <tbody>
          {order.map((i) => (
            <tr key={i}>
              {rows[i].map((v, c) => (
                <td key={c} className={numericCols.includes(c) ? 'hk-sheet__num' : undefined}>{v}</td>
              ))}
              {actions && <td className="hk-sheet__actions">{actions(i)}</td>}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// What happened to the linen, newest first, one row per item moved. Filterable
// and downloadable.
function LinenActivity({ movements }) {
  const [filter, setFilter] = useState('ALL');
  const kinds = MOVE_FILTERS.find((f) => f.key === filter).kinds;
  const filtered = (movements ?? []).filter((m) => !kinds || kinds.includes(m.kind));

  return (
    <section className="hk-activity" aria-label="Recent linen activity">
      <div className="hk-section-head">
        <div className="hk-tabs hk-tabs--status" role="tablist" aria-label="Filter activity">
          {MOVE_FILTERS.map((f) => (
            <button
              key={f.key}
              type="button"
              role="tab"
              aria-selected={filter === f.key}
              className="hk-tab"
              onClick={() => setFilter(f.key)}
            >
              {f.label}
            </button>
          ))}
          <button
            type="button"
            className="hk-action hk-action--ghost hk-tab--end"
            disabled={filtered.length === 0}
            onClick={() => downloadSheet('Linen activity', 'linen-activity', LINEN_COLS, filtered.map(linenRow), [14, 10, 20, 8, 22, 8, 22, 12, 20, 30])}
          >
            Download Excel
          </button>
        </div>
      </div>

      {filtered.length > 0 ? (
        <SheetTable columns={LINEN_COLS} rows={filtered.map(linenRow)} sortRows={filtered.map(linenSortRow)} numericCols={[5, 7]} />
      ) : (
        <p className="hk-hint">
          {(movements ?? []).length === 0
            ? 'Nothing yet. When linen is changed in a room, sent out or received, it shows here.'
            : 'Nothing of this kind yet.'}
        </p>
      )}
    </section>
  );
}

function LinenTab({ token }) {
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [modal, setModal] = useState(null); // { kind: 'item'|'send'|'receive'|'loss', ... }
  const [busy, setBusy] = useState(false);
  const [formError, setFormError] = useState('');
  const [menuId, setMenuId] = useState(null); // the item whose "⋯" menu is open

  const load = () =>
    apiGet('/housekeeping/linen', { token })
      .then((d) => {
        setData(d);
        setError('');
      })
      .catch((err) => setError(errorText(err, 'Could not load linen.')));
  // "Waiting 20 min" needs a clock; it ticks with the refresh.
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    load();
    // Linen a cleaner has just changed shows up to be received without a refresh.
    const timer = setInterval(() => {
      load();
      setNow(Date.now());
    }, 30000);
    return () => clearInterval(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Linen changed in rooms that housekeeping has not handed over yet.
  const handovers = data?.handovers ?? [];
  const receiveHandover = async (movementIds) => {
    setBusy(true);
    try {
      await apiPost('/housekeeping/linen/handovers/receive', { movementIds }, { token });
      setError('');
      await load();
    } catch (err) {
      setError(errorText(err, 'Could not receive the linen.'));
      load();
    } finally {
      setBusy(false);
    }
  };

  // Where Asset Inventory holds the linen, it is only read here: adding an
  // item or changing its name or count happens there.
  const managed = Boolean(data?.managedInAssets);
  const items = (data?.items ?? []).filter((i) => i.isActive);
  // Hidden types keep their history and can be brought back; they just stop
  // taking up a row.
  const hidden = (data?.items ?? []).filter((i) => !i.isActive);
  const atLaundry = items.filter((i) => i.inLaundry > 0);
  const total = (key) => items.reduce((n, i) => n + Math.max(0, i[key]), 0);
  const totals = { withHousekeeping: total('withHousekeeping'), dirty: total('dirty'), inLaundry: total('inLaundry'), clean: total('clean') };

  const open = (m) => {
    setFormError('');
    setModal(m);
  };

  // Send and Receive open already filled in with what the stock says is dirty or
  // in the wash, and with whoever washed the last batch, so the usual batch is
  // one tap and only a difference needs fixing.
  const washer = washerFrom(data?.lastWashedBy);
  const openSend = () =>
    open({
      kind: 'send',
      lines: Object.fromEntries(items.map((i) => [i.id, { quantity: Math.max(0, i.dirty) }])),
      note: '',
      ...washer,
      // Only what is dirty is listed to begin with. With nothing dirty the
      // whole list shows, since then it can only be clean linen going out.
      showAll: totals.dirty === 0,
    });
  const openReceive = () =>
    open({
      kind: 'receive',
      lines: Object.fromEntries(atLaundry.map((i) => [i.id, { received: i.inLaundry, lost: 0, damaged: 0 }])),
      note: '',
      ...washer,
    });
  const openLoss = (item) => open({ kind: 'loss', linenItemId: String(item.id), lossKind: 'LOST', quantity: 1, note: '' });

  const setActive = async (item, isActive) => {
    setBusy(true);
    setFormError('');
    try {
      await apiPatch(`/housekeeping/linen/items/${item.id}`, { isActive }, { token });
      setModal(null);
      await load();
    } catch (err) {
      const message = errorText(err, 'Could not update the linen type.');
      setFormError(message);
      setError(message);
    } finally {
      setBusy(false);
    }
  };
  // Hiding removes a row, not its history. Linen still out would vanish from the
  // board while it is away, so that has to come back first.
  const hideItem = (item) => {
    const away = item.withHousekeeping + item.dirty + item.inLaundry;
    if (away > 0) {
      setError(`${item.name} still has ${away} with housekeeping, dirty or in the wash. Receive and wash those first, then hide it.`);
      return;
    }
    if (window.confirm(`Hide ${item.name}? Its history is kept, and you can bring it back from “Add item”.`)) setActive(item, false);
  };

  const save = async (path, body, method = apiPost) => {
    setBusy(true);
    setFormError('');
    try {
      await method(path, body, { token });
      setModal(null);
      load();
    } catch (err) {
      setFormError(errorText(err, 'Could not save.'));
    } finally {
      setBusy(false);
    }
  };

  const setLine = (id, patch) => setModal({ ...modal, lines: { ...modal.lines, [id]: { ...(modal.lines[id] ?? {}), ...patch } } });

  const submitModal = () => {
    if (modal.kind === 'item') {
      if (!modal.name.trim()) return setFormError('Enter a name.');
      const body = { name: modal.name.trim(), totalOwned: Number(modal.owned) || 0 };
      return modal.id ? save(`/housekeeping/linen/items/${modal.id}`, body, apiPatch) : save('/housekeeping/linen/items', body);
    }
    if (modal.kind === 'send') {
      const rows = items
        .map((i) => ({ linenItemId: i.id, quantity: modal.lines[i.id]?.quantity ?? 0 }))
        .filter((l) => l.quantity > 0);
      if (rows.length === 0) return setFormError('Tap the counts you are sending.');
      if (washerError(modal)) return setFormError(washerError(modal));
      return save('/housekeeping/linen/send', { lines: rows, note: modal.note, ...washerBody(modal) });
    }
    if (modal.kind === 'receive') {
      const rows = atLaundry
        .map((i) => {
          const l = modal.lines[i.id] ?? {};
          return { linenItemId: i.id, received: l.received ?? 0, lost: l.lost ?? 0, damaged: l.damaged ?? 0 };
        })
        .filter((l) => l.received + l.lost + l.damaged > 0);
      if (rows.length === 0) return setFormError('Tap the counts that came back.');
      if (washerError(modal)) return setFormError(washerError(modal));
      return save('/housekeeping/linen/receive', { lines: rows, note: modal.note, ...washerBody(modal) });
    }
    if (!modal.linenItemId) return setFormError('Choose the item.');
    return save('/housekeeping/linen/loss', {
      linenItemId: Number(modal.linenItemId),
      kind: modal.lossKind,
      quantity: modal.quantity,
      note: modal.note,
    });
  };

  const TITLES = {
    item: modal?.id ? 'Edit linen item' : 'Add linen item',
    send: 'Send for washing',
    receive: 'Receive washed',
    loss: 'Lost or damaged linen',
  };
  const STARTERS = ['Bedsheet', 'Pillow cover', 'Towel', 'Bath towel', 'Blanket'];

  // Several cleaners change linen through the day and each brings their own to
  // the laundry, so what is waiting is grouped by who has it. Receiving is per
  // person: one tap for everything they are handing over, never for someone
  // else's linen that has not arrived.
  const staffGroups = [];
  for (const h of handovers) {
    const key = String(h.changedById ?? 'unknown');
    let group = staffGroups.find((g) => g.key === key);
    if (!group) {
      group = { key, name: h.changedBy || 'Staff not recorded', handovers: [], movementIds: [], pieces: 0, byItem: new Map() };
      staffGroups.push(group);
    }
    group.handovers.push(h);
    group.movementIds.push(...h.movementIds);
    for (const l of h.lines) {
      group.pieces += l.quantity;
      group.byItem.set(l.name, (group.byItem.get(l.name) ?? 0) + l.quantity);
    }
  }
  const itemsOf = (group) => [...group.byItem].map(([name, quantity]) => `${quantity} ${name}`).join(', ');

  // "4 Bedsheet, 2 Towel" — what a step's number is made of.
  // The three biggest and a count of the rest: with fifteen linen items a full
  // list would turn each card into a paragraph. The table below has every item.
  const breakdown = (key) => {
    const parts = items.filter((i) => i[key] > 0).sort((a, b) => b[key] - a[key]);
    const shown = parts.slice(0, 3).map((i) => `${i[key]} ${i.name}`).join(', ');
    return parts.length > 3 ? `${shown} +${parts.length - 3} more` : shown;
  };
  // A 0 steps back so the numbers that need attention are the ones that show.
  const zero = (n) => (n === 0 ? 'hk-matrix__zero' : undefined);
  const steps = [
    {
      key: 'withHousekeeping',
      tone: 'occupied',
      title: 'With housekeeping',
      total: totals.withHousekeeping,
      empty: 'Nothing waiting to be received.',
      // With one person waiting the card can do it; with several, the list
      // below is where each is received, so the card only says who has what.
      detail: staffGroups.length > 1 ? staffGroups.map((g) => `${g.name}: ${g.pieces}`).join(' · ') : null,
      action: staffGroups.length === 1 ? `Receive from ${staffGroups[0].name}` : staffGroups.length > 1 ? null : 'Receive',
      note: staffGroups.length > 1 ? 'Receive from each person below.' : null,
      disabled: staffGroups.length === 0,
      run: () => receiveHandover(staffGroups[0].movementIds),
    },
    {
      key: 'dirty',
      tone: 'dirty',
      title: 'Dirty',
      total: totals.dirty,
      empty: 'Nothing waiting to be washed.',
      action: 'Send for washing',
      disabled: totals.dirty + totals.clean === 0,
      run: openSend,
    },
    {
      key: 'inLaundry',
      tone: 'cleaning',
      title: 'In wash',
      total: totals.inLaundry,
      empty: 'Nothing is in the wash.',
      action: 'Receive washed',
      disabled: atLaundry.length === 0,
      run: openReceive,
    },
    { key: 'clean', tone: 'ready', title: 'Clean', total: totals.clean, empty: 'No clean linen left.' },
  ];

  return (
    <div className="chart-section hk-board">
      {error && <div className="form-banner form-banner--error">{error}</div>}
      {!data && !error && <PageLoader inline label="Loading" />}

      {data && items.length === 0 && (
        <div className="hk-empty">
          <span className="hk-empty__icon">
            <StatusIcon tone="dirty" size={22} />
          </span>
          {managed ? (
            <>
              <p className="hk-empty__title">No linen registered yet</p>
              <p className="hk-empty__text">
                Add your linen in Asset Inventory: choose the category “Bedsheets & Towels”, give the item a name such as Bedsheet, and enter how many you own.
                It appears here as soon as it is saved.
              </p>
            </>
          ) : (
            <>
              <p className="hk-empty__title">Add the linen you count</p>
              <p className="hk-empty__text">Add each item once, with how many you own. Then track it through the wash.</p>
              <div className="hk-starters">
                {STARTERS.map((name) => (
                  <button key={name} type="button" className="hk-tab" onClick={() => open({ kind: 'item', name, owned: '' })}>
                    + {name}
                  </button>
                ))}
              </div>
              <button type="button" className="btn-secondary" onClick={() => open({ kind: 'item', name: '', owned: '' })}>
                Add another type
              </button>
            </>
          )}
        </div>
      )}

      {items.length > 0 && (
        <div className="hk-linen">
          {/* The four places linen can be, left to right, each with the one thing
              to do there. The numbers answer "what is waiting on me?" at a glance. */}
          <ol className="hk-steps" aria-label="Where the linen is now">
            {steps.map((step, n) => (
              <li className={`hk-step hk-step--${step.tone}`} key={step.key}>
                <div className="hk-step__head">
                  <span className="hk-step__n">{n + 1}</span>
                  <span className="hk-step__title">{step.title}</span>
                </div>
                <div className="hk-step__count">
                  <strong>{step.total}</strong>
                  {step.total === 1 ? 'piece' : 'pieces'}
                </div>
                <p className="hk-step__detail">{step.total > 0 ? step.detail || breakdown(step.key) : step.empty}</p>
                {step.note && <p className="hk-step__note">{step.note}</p>}
                {step.action && (
                  <button type="button" className="hk-action hk-step__btn" disabled={busy || step.disabled} onClick={step.run}>
                    {step.action}
                  </button>
                )}
              </li>
            ))}
          </ol>

          {/* One block per cleaner: their total and one button, then their rooms,
              for the day someone hands over only part of what they changed. */}
          {staffGroups.length > 0 && (
            <section className="hk-panel" aria-label="Linen waiting with housekeeping">
              <div className="hk-panel__head">
                <h4>Waiting with housekeeping</h4>
                <span className="hk-panel__sub">Receive from each person when they hand their linen to you.</span>
              </div>
              <div className="hk-staff-list">
                {staffGroups.map((g) => (
                  <div className="hk-staff" key={g.key}>
                    <div className="hk-staff__head">
                      <span className="hk-staff__avatar" aria-hidden="true">
                        {g.name.charAt(0).toUpperCase()}
                      </span>
                      <span className="hk-handover__body">
                        <span className="hk-staff__name">{g.name}</span>
                        <span className="hk-sub">
                          {g.handovers.length} {g.handovers.length === 1 ? 'place' : 'places'} · {g.pieces} {g.pieces === 1 ? 'piece' : 'pieces'} · {itemsOf(g)}
                        </span>
                      </span>
                      <button type="button" className="hk-action" disabled={busy} onClick={() => receiveHandover(g.movementIds)}>
                        Receive {g.pieces} {g.pieces === 1 ? 'piece' : 'pieces'}
                      </button>
                    </div>
                    <ul className="hk-handover__list hk-staff__rooms">
                      {g.handovers.map((h) => (
                        <li className="hk-handover__row" key={h.key}>
                          {/* A room by its number; a venue by its name, which needs the wider tile. */}
                          <span className={`hk-handover__room${h.venueName && !h.roomNumber ? ' hk-handover__room--venue' : ''}`}>
                            {h.roomNumber ?? h.venueName ?? '—'}
                          </span>
                          <span className="hk-handover__body">
                            <span className="hk-handover__items">{h.lines.map((l) => `${l.quantity} ${l.name}`).join(', ')}</span>
                            <span className="hk-sub">Changed {ago(h.changedAt, now)} ago</span>
                          </span>
                          {g.handovers.length > 1 && (
                            <button type="button" className="hk-link" disabled={busy} onClick={() => receiveHandover(h.movementIds)}>
                              Receive this one only
                            </button>
                          )}
                        </li>
                      ))}
                    </ul>
                  </div>
                ))}
              </div>
            </section>
          )}

          <section className="hk-panel" aria-label="Your linen">
            <div className="hk-panel__head">
              <h4>Your linen</h4>
              {managed ? (
                <span className="hk-panel__sub">From Asset Inventory → Bedsheets & Towels. Add items or change a count there.</span>
              ) : (
                <button type="button" className="hk-action hk-action--ghost" onClick={() => open({ kind: 'item', name: '', owned: '' })}>
                  + Add item
                </button>
              )}
            </div>
            <table className={`hk-matrix${items.length > 8 ? ' hk-matrix--dense' : ''}`}>
              <caption className="sr-only">Linen count by stage</caption>
              <thead>
                <tr>
                  <th scope="col" className="hk-matrix__item">
                    Linen
                  </th>
                  <th scope="col">
                    <span className="hk-dot hk-dot--occupied" aria-hidden="true" />
                    To receive
                  </th>
                  <th scope="col">
                    <span className="hk-dot hk-dot--dirty" aria-hidden="true" />
                    Dirty
                  </th>
                  <th scope="col">
                    <span className="hk-dot hk-dot--cleaning" aria-hidden="true" />
                    In wash
                  </th>
                  <th scope="col">
                    <span className="hk-dot hk-dot--ready" aria-hidden="true" />
                    Clean
                  </th>
                  <th scope="col" className="hk-matrix__menu">
                    <span className="sr-only">Actions</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {items.map((i) => (
                  <tr key={i.id}>
                    <th scope="row" className="hk-matrix__item">
                      <span className="hk-matrix__name">{i.name}</span>
                      {i.short ? (
                        <span className="hk-matrix__owned hk-matrix__owned--warn">More is out than you own. Check the count.</span>
                      ) : (
                        <span className="hk-matrix__owned">{i.owned} owned</span>
                      )}
                    </th>
                    <td className={zero(i.withHousekeeping)}>{i.withHousekeeping}</td>
                    <td className={zero(i.dirty)}>{i.dirty}</td>
                    <td className={zero(i.inLaundry)}>{i.inLaundry}</td>
                    <td className={i.clean <= 0 ? 'hk-matrix__low' : undefined}>{i.clean}</td>
                    <td className="hk-matrix__menu">
                      <span className="hk-menu">
                        <button
                          type="button"
                          className="hk-more"
                          aria-label={`More actions for ${i.name}`}
                          aria-expanded={menuId === i.id}
                          onClick={() => setMenuId(menuId === i.id ? null : i.id)}
                        >
                          ⋯
                        </button>
                        {menuId === i.id && (
                          <>
                            <button type="button" className="hk-menu__backdrop" aria-label="Close menu" onClick={() => setMenuId(null)} />
                            <span className="hk-menu__list" role="menu">
                              {!managed && (
                                <button
                                  type="button"
                                  role="menuitem"
                                  onClick={() => {
                                    setMenuId(null);
                                    open({ kind: 'item', id: i.id, name: i.name, owned: String(i.totalOwned) });
                                  }}
                                >
                                  Edit name or count
                                </button>
                              )}
                              <button
                                type="button"
                                role="menuitem"
                                onClick={() => {
                                  setMenuId(null);
                                  openLoss(i);
                                }}
                              >
                                Lost or damaged
                              </button>
                              {!managed && (
                                <button
                                  type="button"
                                  role="menuitem"
                                  onClick={() => {
                                    setMenuId(null);
                                    hideItem(i);
                                  }}
                                >
                                  Hide from list
                                </button>
                              )}
                            </span>
                          </>
                        )}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr>
                  <th scope="row" className="hk-matrix__item">
                    All linen
                  </th>
                  <td>{totals.withHousekeeping}</td>
                  <td>{totals.dirty}</td>
                  <td>{totals.inLaundry}</td>
                  <td>{totals.clean}</td>
                  <td />
                </tr>
              </tfoot>
            </table>
            {!managed && hidden.length > 0 && <p className="hk-hint">{hidden.length} hidden. Bring back from Add item.</p>}
          </section>

          {/* Looked at when something does not add up, not every day. */}
          <details className="hk-panel hk-history">
            <summary>History</summary>
            <LinenActivity movements={data.movements} />
          </details>
        </div>
      )}

      {modal && (
        <Modal
          title={TITLES[modal.kind]}
          sub={
            modal.kind === 'send'
              ? 'Already filled in with what is dirty. Change a count if you send less.'
              : modal.kind === 'receive'
                ? 'Already filled in with what is in the wash. Lower a count if something has not come back.'
                : undefined
          }
          busy={busy}
          onClose={() => setModal(null)}
          footer={
            <>
              <button type="button" className="btn-secondary" onClick={() => setModal(null)} disabled={busy}>
                Cancel
              </button>
              <button type="button" className="btn-accent" onClick={submitModal} disabled={busy}>
                {busy ? 'Saving…' : modal.kind === 'send' ? 'Send' : modal.kind === 'receive' ? 'Receive' : 'Save'}
              </button>
            </>
          }
        >
          {formError && <div className="form-banner form-banner--error">{formError}</div>}

          {modal.kind === 'item' && (
            <>
              {/* Adding is mostly the same few things, so offer them. Types that were
                  hidden come back with their history instead of starting again. */}
              {!modal.id && hidden.length > 0 && (
                <div className="hk-suggest">
                  <span className="hk-suggest__label">Bring back</span>
                  {hidden.map((h) => (
                    <button key={h.id} type="button" className="hk-tab hk-tab--small" disabled={busy} onClick={() => setActive(h, true)}>
                      {h.name}
                    </button>
                  ))}
                </div>
              )}
              {!modal.id &&
                STARTERS.filter((s) => !(data?.items ?? []).some((i) => i.name.toLowerCase() === s.toLowerCase())).length > 0 && (
                  <div className="hk-suggest">
                    <span className="hk-suggest__label">Common types</span>
                    {STARTERS.filter((s) => !(data?.items ?? []).some((i) => i.name.toLowerCase() === s.toLowerCase())).map((s) => (
                      <button key={s} type="button" className="hk-tab hk-tab--small" onClick={() => setModal({ ...modal, name: s })}>
                        {s}
                      </button>
                    ))}
                  </div>
                )}
              <div className="field">
                <label htmlFor="liName">
                  Name
                  <Req />
                </label>
                <input id="liName" value={modal.name} onChange={(e) => setModal({ ...modal, name: e.target.value })} placeholder="Bedsheet" autoFocus />
              </div>
              <div className="field">
                <label htmlFor="liOwned">How many do you own in total?</label>
                <input id="liOwned" type="number" min="0" value={modal.owned} onChange={(e) => setModal({ ...modal, owned: e.target.value })} />
                <small className="hk-sub">Count everything: in rooms, in the store and in the wash.</small>
              </div>
            </>
          )}

          {modal.kind === 'send' &&
            items
              .filter((i) => modal.showAll || i.dirty > 0)
              .map((i) => (
                <div className="hk-row" key={i.id}>
                  <span>
                    {i.name}
                    <small className="hk-sub"> {i.dirty} dirty</small>
                  </span>
                  <Stepper label={i.name} max={i.dirty + i.clean} value={modal.lines[i.id]?.quantity ?? 0} onChange={(n) => setLine(i.id, { quantity: n })} />
                </div>
              ))}
          {modal.kind === 'send' && !modal.showAll && items.some((i) => i.dirty === 0) && (
            <button type="button" className="hk-link" onClick={() => setModal({ ...modal, showAll: true })}>
              Show all {items.length} items, to send clean linen too
            </button>
          )}

          {modal.kind === 'receive' &&
            (atLaundry.length === 0 ? (
              <p className="hk-hint">Nothing is in the wash right now.</p>
            ) : (
              atLaundry.map((i) => {
                const l = modal.lines[i.id] ?? {};
                const missing = i.inLaundry - (l.received ?? 0);
                const accounted = (l.lost ?? 0) + (l.damaged ?? 0);
                return (
                  <div className="hk-receive" key={i.id}>
                    <div className="hk-row">
                      <span>
                        {i.name}
                        <small className="hk-sub"> {i.inLaundry} in wash</small>
                      </span>
                      <Stepper label={`${i.name} came back`} max={i.inLaundry} value={l.received ?? 0} onChange={(n) => setLine(i.id, { received: n })} />
                    </div>
                    {/* Only when something is short: the common case stays one stepper. */}
                    {(missing > 0 || accounted > 0) && (
                      <div className="hk-receive__missing">
                        <span className="hk-sub hk-sub--warn">
                          {Math.max(0, missing - accounted)} not back yet. Mark any that are gone:
                        </span>
                        <span className="hk-row__steppers">
                          <label>
                            Lost <Stepper label={`${i.name} lost`} max={i.inLaundry} value={l.lost ?? 0} onChange={(n) => setLine(i.id, { lost: n })} />
                          </label>
                          <label>
                            Damaged <Stepper label={`${i.name} damaged`} max={i.inLaundry} value={l.damaged ?? 0} onChange={(n) => setLine(i.id, { damaged: n })} />
                          </label>
                        </span>
                      </div>
                    )}
                  </div>
                );
              })
            ))}

          {modal.kind === 'loss' && (
            <>
              <div className="field">
                <label htmlFor="lossItem">Item</label>
                <select id="lossItem" value={modal.linenItemId} onChange={(e) => setModal({ ...modal, linenItemId: e.target.value })}>
                  <option value="">Choose…</option>
                  {items.map((i) => (
                    <option key={i.id} value={i.id}>
                      {i.name}
                    </option>
                  ))}
                </select>
              </div>
              <div className="toggle-group">
                <button type="button" aria-pressed={modal.lossKind === 'LOST'} onClick={() => setModal({ ...modal, lossKind: 'LOST' })}>
                  Lost
                </button>
                <button type="button" aria-pressed={modal.lossKind === 'DAMAGED'} onClick={() => setModal({ ...modal, lossKind: 'DAMAGED' })}>
                  Damaged
                </button>
              </div>
              <div className="hk-row">
                <span>How many</span>
                <Stepper label="quantity" value={modal.quantity} onChange={(n) => setModal({ ...modal, quantity: Math.max(1, n) })} />
              </div>
            </>
          )}

          {(modal.kind === 'send' || modal.kind === 'receive') && (
            <WasherFields value={modal} onChange={(patch) => setModal({ ...modal, ...patch })} priceLabel="Price for this batch, ₹" />
          )}

          {modal.kind !== 'item' && (
            <div className="field">
              <label htmlFor="hkNote">Note (optional)</label>
              <input id="hkNote" value={modal.note} onChange={(e) => setModal({ ...modal, note: e.target.value })} placeholder="e.g. bag number" />
            </div>
          )}
        </Modal>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Guest laundry
// ---------------------------------------------------------------------------

// Sent to wash, received back, handed to the guest. What the "Show" menu offers.
const LAUNDRY_FILTERS = [
  { key: 'WASH', label: 'In wash' },
  { key: 'BACK', label: 'Received' },
  { key: 'DELIVERED', label: 'Handed over' },
  { key: 'ALL', label: 'All' },
];
const isOpenOrder = (o) => o.status !== 'DELIVERED' && o.status !== 'CANCELLED';

// Shown as one-tap starters when a garment has not been used before. Never a price
// list: the price is typed on every entry.
const COMMON_GARMENTS = ['Shirt', 'T-shirt', 'Trousers', 'Jeans', 'Saree', 'Kurta', 'Towel', 'Bedsheet'];

function GuestLaundryTab({ token }) {
  const [orders, setOrders] = useState(null);
  const [recent, setRecent] = useState([]); // garments and prices used on earlier orders
  const [guests, setGuests] = useState([]);
  // Opens on what is still out; the rest is one choice away under Show.
  const [filter, setFilter] = useState('WASH');
  const [search, setSearch] = useState('');
  const [error, setError] = useState('');
  const [form, setForm] = useState(null); // new order
  const [formError, setFormError] = useState('');
  const [busy, setBusy] = useState(false);
  const [formErrors, setFormErrors] = useState({}); // the washer fields, per field
  const [created, setCreated] = useState(null); // the order just taken in
  const [confirm, setConfirm] = useState(null); // { order, kind: 'deliver' | 'cancel' }

  const load = () =>
    apiGet('/housekeeping/laundry/orders?scope=all', { token })
      .then((d) => {
        setOrders(d.orders);
        setError('');
      })
      .catch((err) => setError(errorText(err, 'Could not load laundry.')));

  const loadRecent = () =>
    apiGet('/housekeeping/laundry/garments', { token })
      .then((d) => setRecent(d.garments))
      .catch(() => {});

  useEffect(() => {
    load();
    loadRecent();
    apiGet('/housekeeping/laundry/in-house', { token })
      .then((d) => setGuests(d.guests))
      .catch(() => {});
    // A hand-over at the desk shows up here without a refresh.
    const timer = setInterval(() => {
      load();
    }, 30000);
    return () => clearInterval(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const inFilter = (o, key) =>
    key === 'ALL' ? true : key === 'WASH' ? o.status === 'RECEIVED' || o.status === 'WASHING' : key === 'BACK' ? o.status === 'READY' : o.status === 'DELIVERED';
  const countOf = (key) => (orders ?? []).filter((o) => inFilter(o, key)).length;

  const query = search.trim().toLowerCase();
  const shown = (orders ?? []).filter(
    (o) => inFilter(o, filter) && (!query || String(o.tagNumber).includes(query.replace('#', '')) || (o.guestName ?? '').toLowerCase().includes(query))
  );

  const move = async (order, status) => {
    setBusy(true);
    try {
      await apiPost(`/housekeeping/laundry/orders/${order.id}/status`, { status }, { token });
      setConfirm(null);
      await load();
    } catch (err) {
      setConfirm(null);
      setError(errorText(err, 'Could not update the order.'));
    } finally {
      setBusy(false);
    }
  };

  // Receiving the clothes back from the wash. The popup opens on everything the
  // order was sent with — the guest, each garment at its price, who is washing
  // it — and is where an outside vendor's name and price are settled.
  const [receive, setReceive] = useState(null); // { order, washer, washedBy, vendorPhone, charge, errors, error }
  const openReceive = (order) => {
    const own = String(order.washedBy ?? '').trim().toLowerCase() === OWN_LAUNDRY.toLowerCase();
    setReceive({
      order,
      washer: own ? 'OWN' : 'VENDOR',
      washedBy: own ? '' : order.washedBy ?? '',
      vendorPhone: own ? '' : order.vendorPhone ?? '',
      charge: order.washCharge == null ? '' : String(order.washCharge),
      // Each garment's price as it was set at sending, open to correction.
      prices: Object.fromEntries(order.items.map((item) => [item.id, String(item.unitPrice)])),
      errors: {},
      error: '',
    });
  };
  // What the guest pays, from the prices as they stand in the popup.
  const receiveAmount = (item) => (Number(receive.prices[item.id]) || 0) * item.quantity;
  const receiveTotal = receive ? receive.order.items.reduce((n, item) => n + receiveAmount(item), 0) : 0;
  const RECEIVE_RULES = { needName: true, needPrice: true };
  const submitReceive = async () => {
    const badPrice = receive.order.items.find((item) => receive.prices[item.id] === '' || !(Number(receive.prices[item.id]) >= 0));
    if (badPrice) {
      setReceive({ ...receive, error: `Enter the price for ${badPrice.name}.` });
      document.getElementById(`lgPrice-${badPrice.id}`)?.focus();
      return;
    }
    const errors = washerErrors(receive, RECEIVE_RULES);
    if (Object.keys(errors).length > 0) {
      setReceive({ ...receive, errors, error: '' });
      document.getElementById({ washedBy: 'hkWashedBy', vendorPhone: 'hkVendorPhone', charge: 'hkWashCharge' }[Object.keys(errors)[0]])?.focus();
      return;
    }
    setBusy(true);
    try {
      await apiPost(`/housekeeping/laundry/orders/${receive.order.id}/status`, {
          status: 'READY',
          ...washerBody(receive),
          items: receive.order.items.map((item) => ({ id: item.id, price: Number(receive.prices[item.id]) })),
        },
        { token }
      );
      setReceive(null);
      // Follow the order to where it now is, so Hand over is the next thing seen.
      setFilter('BACK');
      await load();
    } catch (err) {
      setReceive({ ...receive, errors: {}, error: errorText(err, 'Could not mark the order received.') });
    } finally {
      setBusy(false);
    }
  };

  // ---- the entry form: every garment is a row with its own price -----------

  const priceOf = new Map(recent.map((g) => [g.name.toLowerCase(), g.price]));
  const starters = [...new Set([...recent.map((g) => g.name), ...COMMON_GARMENTS])].slice(0, 10);

  const lines = form?.lines ?? [];
  const pieces = lines.reduce((n, l) => n + l.qty, 0);
  const total = lines.reduce((n, l) => n + (Number(l.price) || 0) * l.qty, 0);

  const openForm = () => {
    setFormError('');
    // Whoever washed the most recent order is who washes this one, usually.
    const last = (orders ?? []).find((o) => o.washedBy);
    setFormErrors({});
    setForm({
      mode: guests.length > 0 ? 'stay' : 'walkin',
      stay: '',
      guestName: '',
      guestPhone: '',
      note: '',
      lines: [],
      nextKey: 1,
      ...washerFrom(last?.washedBy, last?.vendorPhone),
    });
  };

  // Tapping a garment adds a row at the price it was last charged. Tapping the
  // same one again adds a piece instead of a second row.
  const addLine = (name = '') =>
    setForm((f) => {
      const same = name && f.lines.find((l) => l.name.toLowerCase() === name.toLowerCase());
      if (same) return { ...f, lines: f.lines.map((l) => (l === same ? { ...l, qty: l.qty + 1 } : l)) };
      const price = name && priceOf.has(name.toLowerCase()) ? String(priceOf.get(name.toLowerCase())) : '';
      return { ...f, nextKey: f.nextKey + 1, lines: [...f.lines, { key: f.nextKey, name, price, qty: 1 }] };
    });
  const patchLine = (key, patch) => setForm((f) => ({ ...f, lines: f.lines.map((l) => (l.key === key ? { ...l, ...patch } : l)) }));
  const removeLine = (key) => setForm((f) => ({ ...f, lines: f.lines.filter((l) => l.key !== key) }));
  // Typing a name that was used before offers its last price, only if none is set.
  const renameLine = (line, name) =>
    patchLine(line.key, { name, ...(line.price === '' && priceOf.has(name.trim().toLowerCase()) ? { price: String(priceOf.get(name.trim().toLowerCase())) } : {}) });

  const create = async () => {
    setFormError('');
    // A row with nothing typed in it is just a row someone added and left.
    const used = lines.filter((l) => l.name.trim() || l.price !== '');
    if (used.length === 0) return setFormError('Add the garments being handed in.');
    for (const l of used) {
      if (!l.name.trim()) return setFormError('Enter the garment name on every row.');
      if (l.price === '' || !(Number(l.price) >= 0)) return setFormError(`Enter the price for ${l.name.trim()}.`);
    }
    const stay = form.mode === 'stay' ? guests.find((g) => `${g.bookingId}:${g.roomId}` === form.stay) : null;
    if (form.mode === 'stay' && !stay) return setFormError('Choose the guest.');
    if (form.mode === 'walkin' && !form.guestName.trim()) return setFormError('Enter the customer’s name.');
    // Sending to an outside vendor needs to say which one. The price can wait
    // until the clothes are back; it is asked for then.
    const washerErrs = washerErrors(form, { needName: true });
    setFormErrors(washerErrs);
    if (Object.keys(washerErrs).length > 0) {
      document.getElementById({ washedBy: 'hkWashedBy', vendorPhone: 'hkVendorPhone', charge: 'hkWashCharge' }[Object.keys(washerErrs)[0]])?.focus();
      return;
    }
    setBusy(true);
    try {
      const d = await apiPost(
        '/housekeeping/laundry/orders',
        {
          bookingId: stay?.bookingId ?? null,
          roomId: stay?.roomId ?? null,
          guestName: stay ? '' : form.guestName,
          guestPhone: stay ? '' : form.guestPhone,
          note: form.note,
          items: used.map((l) => ({ name: l.name.trim(), price: Number(l.price), quantity: l.qty })),
          ...washerBody(form),
        },
        { token }
      );
      setForm(null);
      setCreated(d.order);
      setFilter('WASH');
      load();
      loadRecent();
    } catch (err) {
      setFormError(errorText(err, 'Could not save the order.'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="chart-section hk-board">
      <div className="hk-toolbar">
        <button type="button" className="hk-action" onClick={openForm}>
          + New laundry
        </button>
        {(orders ?? []).length > 5 && (
          <input
            type="search"
            className="hk-search"
            placeholder="Find by tag or name"
            aria-label="Find laundry by tag number or name"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        )}
        {orders && (
          <span className="hk-toolbar__end">
            <label className="hk-show">
              <span>Show:</span>
              <select value={filter} onChange={(e) => setFilter(e.target.value)} aria-label="Show laundry orders">
                {LAUNDRY_FILTERS.map((f) => (
                  <option key={f.key} value={f.key}>
                    {f.label} ({countOf(f.key)})
                  </option>
                ))}
              </select>
            </label>
            <button
              type="button"
              className="hk-action hk-action--ghost"
              disabled={shown.length === 0}
              onClick={() => downloadSheet('Guest laundry', 'guest-laundry', GUEST_COLS, shown.map(guestRow), [8, 20, 10, 40, 8, 14, 20, 20, 12, 20, 16, 16, 24])}
            >
              Download Excel
            </button>
          </span>
        )}
      </div>

      {error && <div className="form-banner form-banner--error">{error}</div>}
      {!orders && !error && <PageLoader inline label="Loading" />}

      {orders && shown.length > 0 && (
        <SheetTable
          columns={GUEST_COLS}
          rows={shown.map(guestRow)}
          sortRows={shown.map(guestSortRow)}
          numericCols={[0, 4, 8, 11]}
          actions={(i) => {
            const o = shown[i];
            if (!isOpenOrder(o)) return null;
            return (
              <>
                {o.status === 'READY' ? (
                  <button type="button" className="hk-action" disabled={busy} onClick={() => setConfirm({ order: o, kind: 'deliver' })}>
                    Hand over
                  </button>
                ) : (
                  <button type="button" className="hk-action" disabled={busy} onClick={() => openReceive(o)}>
                    Receive
                  </button>
                )}
                <button type="button" className="hk-link" onClick={() => setConfirm({ order: o, kind: 'cancel' })}>
                  Cancel
                </button>
              </>
            );
          }}
        />
      )}

      {orders && shown.length === 0 && (
        <div className="hk-empty">
          <p className="hk-empty__title">{query ? 'No match' : filter === 'WASH' ? 'Nothing in the wash' : filter === 'BACK' ? 'Nothing waiting to be handed over' : filter === 'DELIVERED' ? 'Nothing handed over yet' : 'No laundry yet'}</p>
          <p className="hk-empty__text">
            {query
              ? 'Check the tag number or the name.'
              : filter === 'BACK'
                ? 'Orders move here when you receive them from the wash.'
                : filter === 'DELIVERED'
                  ? 'Orders move here when you hand the clothes back.'
                  : 'Tap + New laundry when a guest hands in clothes.'}
          </p>
        </div>
      )}

      {filter === 'WASH' && shown.length > 0 && <p className="hk-hint">Tap Receive when the clothes come back from the wash.</p>}
      {filter === 'BACK' && shown.length > 0 && (
        <p className="hk-hint">Hand over when the guest collects. It adds the charge to Room billing → Services to bill.</p>
      )}

      {created && (
        <Modal
          title="Sent to wash"
          busy={false}
          onClose={() => setCreated(null)}
          footer={
            <>
              <button type="button" className="btn-secondary" onClick={() => { setCreated(null); openForm(); }}>
                Take in more
              </button>
              <button type="button" className="hk-action" onClick={() => setCreated(null)}>
                Done
              </button>
            </>
          }
        >
          <div className="hk-tagbig">
            <small>Write this tag on the bag</small>
            <strong>{created.tagNumber}</strong>
          </div>
          <p className="hk-hint hk-hint--center">
            {created.guestName}, {created.pieces} {created.pieces === 1 ? 'piece' : 'pieces'}, {formatPrice(created.total)}
          </p>
        </Modal>
      )}

      {receive && (
        <Modal
          title={`Receive from wash · tag ${receive.order.tagNumber}`}
          sub="Check the clothes against the list, confirm who washed them, then mark the order received."
          busy={busy}
          onClose={() => setReceive(null)}
          footer={
            <>
              <button type="button" className="btn-secondary" onClick={() => setReceive(null)} disabled={busy}>
                Not yet
              </button>
              <button type="button" className="hk-action" onClick={submitReceive} disabled={busy}>
                {busy ? 'Saving…' : 'Mark received'}
              </button>
            </>
          }
        >
          {receive.error && <div className="form-banner form-banner--error">{receive.error}</div>}

          <section className="hk-finish__section">
            <div className="hk-finish__head">
              <h4 className="hk-finish__title">Order</h4>
              <span className="hk-finish__meta">Sent {sheetDate(receive.order.receivedAt)} {sheetTime(receive.order.receivedAt)}</span>
            </div>
            <dl className="hk-facts">
              <div>
                <dt>Guest</dt>
                <dd>{receive.order.guestName || '—'}</dd>
              </div>
              <div>
                <dt>Room</dt>
                <dd>{receive.order.roomNumber || 'Walk-in'}</dd>
              </div>
              {receive.order.note && (
                <div>
                  <dt>Note</dt>
                  <dd>{receive.order.note}</dd>
                </div>
              )}
            </dl>
          </section>

          <section className="hk-finish__section">
            <div className="hk-finish__head">
              <h4 className="hk-finish__title">Clothes</h4>
              <span className="hk-finish__meta">
                {receive.order.pieces} {receive.order.pieces === 1 ? 'piece' : 'pieces'} · prices can be changed
              </span>
            </div>
            <table className="hk-receipt">
              <thead>
                <tr>
                  <th scope="col">Garment</th>
                  <th scope="col">Qty</th>
                  <th scope="col">Price</th>
                  <th scope="col">Amount</th>
                </tr>
              </thead>
              <tbody>
                {receive.order.items.map((item) => (
                  <tr key={item.id}>
                    <td>{item.name}</td>
                    <td>{item.quantity}</td>
                    <td>
                      <label className="hk-receipt__price">
                        <span aria-hidden="true">₹</span>
                        <input
                          id={`lgPrice-${item.id}`}
                          type="number"
                          inputMode="decimal"
                          min="0"
                          step="0.5"
                          aria-label={`Price per piece for ${item.name}`}
                          value={receive.prices[item.id]}
                          onChange={(e) => setReceive({ ...receive, prices: { ...receive.prices, [item.id]: e.target.value }, error: '' })}
                        />
                      </label>
                    </td>
                    <td>{formatPrice(receiveAmount(item))}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr>
                  <td colSpan={3}>Guest pays</td>
                  <td>{formatPrice(receiveTotal)}</td>
                </tr>
              </tfoot>
            </table>
          </section>

          <section className="hk-finish__section">
            <div className="hk-finish__head">
              <h4 className="hk-finish__title">Washed by</h4>
            </div>
            <WasherFields
              hideLabel
              withPhone
              needName
              needPrice
              errors={receive.errors}
              value={receive}
              onChange={(patch) =>
                setReceive({ ...receive, ...patch, errors: Object.fromEntries(Object.entries(receive.errors).filter(([key]) => !(key in patch))), error: '' })
              }
              priceLabel="Vendor’s total price, ₹"
            />
          </section>
        </Modal>
      )}

      {confirm && (
        <Modal
          title={confirm.kind === 'deliver' ? `Hand over tag ${confirm.order.tagNumber}?` : `Cancel tag ${confirm.order.tagNumber}?`}
          busy={busy}
          onClose={() => setConfirm(null)}
          footer={
            <>
              <button type="button" className="btn-secondary" onClick={() => setConfirm(null)} disabled={busy}>
                {confirm.kind === 'deliver' ? 'Not yet' : 'Keep order'}
              </button>
              <button
                type="button"
                className="hk-action"
                disabled={busy}
                onClick={() => move(confirm.order, confirm.kind === 'deliver' ? 'DELIVERED' : 'CANCELLED')}
              >
                {busy ? 'Saving…' : confirm.kind === 'deliver' ? 'Hand over' : 'Cancel order'}
              </button>
            </>
          }
        >
          <p className="hk-confirm">
            {confirm.kind === 'deliver' ? (
              <>
                <strong>{confirm.order.guestName}</strong>
                {confirm.order.roomNumber ? `, room ${confirm.order.roomNumber}` : ''}. {confirm.order.pieces}{' '}
                {confirm.order.pieces === 1 ? 'piece' : 'pieces'}. <strong>{formatPrice(confirm.order.total)}</strong> will be added to Services to
                bill, so it can go on the room bill or be billed on its own.
              </>
            ) : (
              <>The clothes are not charged. This cannot be undone.</>
            )}
          </p>
        </Modal>
      )}

      {form && (
        <Modal
          title="New laundry"
          sub="Choose the guest, add the clothes, then send them to wash."
          busy={busy}
          onClose={() => setForm(null)}
          footer={
            <>
              <span className="hk-total">
                {pieces} {pieces === 1 ? 'piece' : 'pieces'}, {formatPrice(total)}
              </span>
              <button type="button" className="btn-secondary" onClick={() => setForm(null)} disabled={busy}>
                Cancel
              </button>
              <button type="button" className="hk-action" onClick={create} disabled={busy}>
                {busy ? 'Saving…' : 'Send to wash'}
              </button>
            </>
          }
        >
          {formError && <div className="form-banner form-banner--error">{formError}</div>}

          <section className="hk-finish__section">
          <div className="hk-finish__head">
            <h4 className="hk-finish__title">1. Guest</h4>
          </div>
          {guests.length > 0 && (
            <div className="toggle-group hk-step-gap">
              <button type="button" aria-pressed={form.mode === 'stay'} onClick={() => setForm({ ...form, mode: 'stay' })}>
                Staying guest
              </button>
              <button type="button" aria-pressed={form.mode === 'walkin'} onClick={() => setForm({ ...form, mode: 'walkin' })}>
                Walk-in
              </button>
            </div>
          )}
          {form.mode === 'stay' ? (
            <div className="field">
              <label htmlFor="lgGuest">Guest</label>
              <select id="lgGuest" value={form.stay} onChange={(e) => setForm({ ...form, stay: e.target.value })}>
                <option value="">Choose…</option>
                {guests.map((g) => (
                  <option key={`${g.bookingId}:${g.roomId}`} value={`${g.bookingId}:${g.roomId}`}>
                    Room {g.roomNumber}, {g.guestName}
                  </option>
                ))}
              </select>
            </div>
          ) : (
            <div className="field-row">
              <div className="field">
                <label htmlFor="lgName">Name</label>
                <input id="lgName" value={form.guestName} onChange={(e) => setForm({ ...form, guestName: e.target.value })} />
              </div>
              <div className="field">
                <label htmlFor="lgPhone">Phone</label>
                <input id="lgPhone" value={form.guestPhone} onChange={(e) => setForm({ ...form, guestPhone: e.target.value })} />
              </div>
            </div>
          )}

          </section>

          <section className="hk-finish__section">
          <div className="hk-finish__head">
            <h4 className="hk-finish__title">2. Clothes</h4>
            <span className="hk-finish__meta">Price per piece, GST included</span>
          </div>
          <div className="hk-suggest">
            <span className="hk-suggest__label">Tap to add</span>
            {starters.map((n) => (
              <button key={n} type="button" className="hk-tab hk-tab--small" onClick={() => addLine(n)}>
                + {n}
              </button>
            ))}
            <button type="button" className="hk-tab hk-tab--small" onClick={() => addLine('')}>
              + Other
            </button>
          </div>

          <datalist id="hk-garment-names">
            {recent.map((g) => (
              <option key={g.name} value={g.name} />
            ))}
          </datalist>

          {lines.length === 0 ? (
            <p className="hk-hint">Tap a garment above, or choose Other to type its name.</p>
          ) : (
            <div className="hk-lines">
              {lines.map((l) => (
                <div className="hk-line" key={l.key}>
                  <input
                    className="hk-line__name"
                    list="hk-garment-names"
                    placeholder="Garment"
                    aria-label="Garment name"
                    value={l.name}
                    onChange={(e) => renameLine(l, e.target.value)}
                  />
                  <label className="hk-line__price">
                    <span aria-hidden="true">₹</span>
                    <input
                      type="number"
                      inputMode="decimal"
                      min="0"
                      step="0.5"
                      placeholder="Price"
                      aria-label={`Price per piece for ${l.name || 'garment'}`}
                      value={l.price}
                      onChange={(e) => patchLine(l.key, { price: e.target.value })}
                    />
                  </label>
                  <Stepper
                    label={l.name || 'garment'}
                    value={l.qty}
                    onChange={(n) => (n <= 0 ? removeLine(l.key) : patchLine(l.key, { qty: n }))}
                  />
                  <span className="hk-line__total">{formatPrice((Number(l.price) || 0) * l.qty)}</span>
                  <button type="button" className="hk-line__x" aria-label={`Remove ${l.name || 'row'}`} onClick={() => removeLine(l.key)}>
                    ×
                  </button>
                </div>
              ))}
            </div>
          )}

          <div className="field">
            <label htmlFor="lgNote">Note (stains, fragile …)</label>
            <input id="lgNote" value={form.note} onChange={(e) => setForm({ ...form, note: e.target.value })} />
          </div>
          </section>

          <section className="hk-finish__section">
          <div className="hk-finish__head">
            <h4 className="hk-finish__title">3. Send to wash</h4>
          </div>
          <WasherFields
            hideLabel
            withPhone
            needName
            errors={formErrors}
            value={form}
            onChange={(patch) => {
              setForm({ ...form, ...patch });
              setFormErrors((errs) => Object.fromEntries(Object.entries(errs).filter(([key]) => !(key in patch))));
            }}
            priceLabel="Vendor’s total price, ₹"
          />
          {form.washer === 'VENDOR' && (
            <p className="hk-hint hk-hint--inline">
              The vendor’s price is what the lodge pays, and can be filled in when the clothes come back. The guest pays {formatPrice(total)}.
            </p>
          )}
          </section>
        </Modal>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------

// Laundry is its own section, switched on per property: the hotel's linen
// through the wash, and guests' clothes. Guest laundry is billed through Other
// services, so its tab only shows where that add-on is on too.
export default function LaundryPanel({ lodge }) {
  const token = getSession()?.token;
  const guestLaundry = Boolean(lodge?.hasOtherServices);
  const tabs = [{ key: 'linen', label: 'Hotel Laundry' }, ...(guestLaundry ? [{ key: 'laundry', label: 'Guest laundry' }] : [])];
  const [tab, setTab] = useState('linen');

  return (
    <div>
      {tabs.length > 1 && (
        <div className="subtabs">
          {tabs.map((t) => (
            <button key={t.key} type="button" className="subtabs__item" aria-current={tab === t.key ? 'page' : undefined} onClick={() => setTab(t.key)}>
              {t.label}
            </button>
          ))}
        </div>
      )}
      {tab === 'linen' && <LinenTab token={token} />}
      {tab === 'laundry' && guestLaundry && <GuestLaundryTab token={token} />}
    </div>
  );
}
