import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { apiGet } from '../../lib/api';
import PageLoader from '../../components/PageLoader';
import ReportDownloadMenu from '../../components/ReportDownloadMenu';
import { Note, Seg } from './BarBits';
import { downloadBarReportExcel, downloadBarReportPdf, previewBarReportPdf } from './barReportFile';
import { barToken, errText, firstOfMonthIso, stockParts, todayIso } from './barFormat';
import { formatPrice } from './priceFormat';
import './forms.css';
import './Bar.css';

const PAY_LABEL = { CASH: 'Cash', UPI: 'UPI', CARD: 'Card' };
const pct = (part, whole) => (whole > 0 ? Math.round((part / whole) * 100) : 0);
const dayLabel = (d) => new Date(`${String(d).slice(0, 10)}T00:00:00`).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });

// The bar's own report: sales, stock and bills, all from bar_* tables, so it never overlaps the
// restaurant report. On the Reports page the period comes from the page's own filter (from / to);
// the controls here only show when it is used on its own.
// viewHost / actionsHost: when the Reports page gives two slots in its top card, the Sales | Stock |
// Bills switch and the Download menu are drawn there instead of in a row of their own.
export default function BarReports({ from = null, to = null, lodgeName = '', viewHost = null, actionsHost = null }) {
  const token = barToken();
  const [own, setOwn] = useState({ from: firstOfMonthIso(), to: todayIso() });
  const range = from && to ? { from, to } : own;
  const [view, setView] = useState('overview');
  // Overview, Bar and Restaurant are three cuts of the one sales payload.
  const endpoint = view === 'stock' || view === 'bills' ? view : 'sales';
  // Keyed by what was asked for: a result for another view or range reads as "loading".
  const key = `${endpoint}|${range.from}|${range.to}`;
  const [result, setResult] = useState({ key: '', data: null, error: '' });
  const data = result.key === key ? result.data : null;
  const error = result.key === key ? result.error : '';
  const [busy, setBusy] = useState('');
  const [fileError, setFileError] = useState('');
  // One handler for preview, Excel and PDF: build the file from what is on screen.
  const makeFile = (kind, fn) => async () => {
    if (!data) return;
    setBusy(kind);
    setFileError('');
    try {
      await fn(endpoint, data, range, lodgeName);
    } catch {
      setFileError('Could not prepare the file. Try again.');
    } finally {
      setBusy('');
    }
  };

  useEffect(() => {
    let live = true;
    apiGet(`/bar/reports/${endpoint}?from=${range.from}&to=${range.to}`, { token })
      .then((d) => live && setResult({ key, data: d, error: '' }))
      .catch((e) => live && setResult({ key, data: null, error: errText(e, 'Could not load the report.') }));
    return () => {
      live = false;
    };
  }, [key, endpoint, range.from, range.to, token]);

  const embedded = Boolean(viewHost && actionsHost);
  const seg = <Seg value={view} onChange={setView} options={[['overview', 'Overview'], ['bar', 'Bar'], ['restaurant', 'Restaurant'], ['stock', 'Stock'], ['bills', 'Bills']]} />;
  const downloadMenu = data ? (
    <ReportDownloadMenu
      onPreview={makeFile('preview', previewBarReportPdf)}
      onExcel={makeFile('excel', downloadBarReportExcel)}
      onPdf={makeFile('pdf', downloadBarReportPdf)}
      previewBusy={busy === 'preview'}
      excelBusy={busy === 'excel'}
      pdfBusy={busy === 'pdf'}
    />
  ) : null;

  return (
    <div className="bar">
      {embedded ? (
        <>
          {createPortal(seg, viewHost)}
          {createPortal(downloadMenu, actionsHost)}
        </>
      ) : (
        <div className="bar-toolbar">
          {seg}
          <div className="bar-flex">
            {downloadMenu}
            <input className="bar-input bar-input--date" type="date" aria-label="From" value={own.from} max={own.to} onChange={(e) => e.target.value && setOwn({ ...own, from: e.target.value })} />
            <span className="bar-muted">to</span>
            <input className="bar-input bar-input--date" type="date" aria-label="To" value={own.to} min={own.from} onChange={(e) => e.target.value && setOwn({ ...own, to: e.target.value })} />
          </div>
        </div>
      )}
      {error && <Note kind="error">{error}</Note>}
      {fileError && <Note kind="error">{fileError}</Note>}
      {!data && !error && <PageLoader label="Loading report" />}
      {data && view === 'overview' && <Sales d={data} />}
      {data && view === 'bar' && <Items d={data} kind="DRINK" />}
      {data && view === 'restaurant' && <Items d={data} kind="FOOD" />}
      {data && view === 'stock' && <Stock d={data} />}
      {data && view === 'bills' && <Bills d={data} />}
    </div>
  );
}

const Kpi = ({ label, value, sub, hero = false }) => (
  <div className={`bar-kpi${hero ? ' bar-kpi--hero' : ''}`}>
    <span className="bar-kpi__label">{label}</span>
    <span className="bar-kpi__value">{value}</span>
    {sub && <span className="bar-kpi__sub">{sub}</span>}
  </div>
);

function DayChart({ days }) {
  const max = Math.max(1, ...days.map((d) => d.total));
  const step = days.length > 16 ? Math.ceil(days.length / 8) : 1;
  return (
    <div className="bar-chart" role="img" aria-label={`Sales by day: ${days.map((d) => `${dayLabel(d.date)} ${formatPrice(d.total)}`).join(', ')}`}>
      <div className="bar-chart__plot">
        {days.map((d) => (
          <div className="bar-chart__col" key={String(d.date)} title={`${dayLabel(d.date)} · ${formatPrice(d.total)} · ${d.bills} bill${d.bills === 1 ? '' : 's'}`}>
            <span className="bar-chart__val">{days.length <= 10 ? formatPrice(d.total) : ''}</span>
            <span className="bar-chart__bar" style={{ height: `${Math.max(4, (d.total / max) * 100)}%` }} />
          </div>
        ))}
      </div>
      <div className="bar-chart__axis">
        {days.map((d, i) => <span key={String(d.date)}>{i % step === 0 ? dayLabel(d.date) : ''}</span>)}
      </div>
    </div>
  );
}

function PayMix({ payments, total }) {
  const sorted = [...payments].sort((a, b) => b.amount - a.amount);
  return (
    <div className="bar-mix">
      <div className="bar-mix__bar" role="img" aria-label={sorted.map((p) => `${PAY_LABEL[p.method] || p.method} ${pct(p.amount, total)}%`).join(', ')}>
        {sorted.map((p) => <span key={p.method} className={`bar-mix__seg bar-mix__seg--${p.method.toLowerCase()}`} style={{ width: `${pct(p.amount, total)}%` }} />)}
      </div>
      <ul className="bar-mix__legend">
        {sorted.map((p) => (
          <li key={p.method}>
            <i className={`bar-mix__dot bar-mix__seg--${p.method.toLowerCase()}`} />
            <span>{PAY_LABEL[p.method] || p.method}</span>
            <b className="bar-num">{formatPrice(p.amount)}</b>
            <span className="bar-muted">{pct(p.amount, total)}%</span>
          </li>
        ))}
        {sorted.length === 0 && <li className="bar-muted">No payments in this period.</li>}
      </ul>
    </div>
  );
}

function Sales({ d }) {
  const paid = d.byPayment.reduce((s, p) => s + p.amount, 0);
  const catTotal = d.byCategory.reduce((s, c) => s + c.amount, 0);
  const onRoom = d.onRoomBill?.total || 0;
  return (
    <>
      <div className="bar-kpis">
        <Kpi hero label="Total sales" value={formatPrice(d.total)} sub={`${d.bills} bill${d.bills === 1 ? '' : 's'}${onRoom > 0 ? ` · ${formatPrice(onRoom)} on room bills` : ''}`} />
        <Kpi label="Drinks" value={formatPrice(d.drinks)} sub={d.tax > 0 ? `${formatPrice(d.tax)} tax incl.` : 'No bar tax'} />
        <Kpi label="Food (kitchen)" value={formatPrice(d.food)} sub={d.foodTax > 0 ? `${formatPrice(d.foodTax)} GST` : 'No GST'} />
        <Kpi label="Avg. bill" value={formatPrice(d.bills ? Math.round((d.total - onRoom) / d.bills) : 0)} sub="Bar bills only" />
      </div>

      <div className="bar-split">
        <section className="bar-card">
          <h3 className="bar-card__title">Sales by day</h3>
          {d.byDay.length === 0 ? <div className="bar-empty">No bills in this period.</div> : <DayChart days={d.byDay} />}
        </section>
        <section className="bar-card">
          <h3 className="bar-card__title">How it was paid</h3>
          <PayMix payments={d.byPayment} total={paid} />
          {onRoom > 0 && <div className="bar-muted">Orders billed to rooms are collected on the stay bill, so they are not in this split.</div>}
        </section>
      </div>

      <div className="bar-split">
        <section className="bar-card">
          <h3 className="bar-card__title">By category</h3>
          {d.byCategory.length === 0 && <div className="bar-empty">Nothing in this period.</div>}
          <ul className="bar-share">
            {d.byCategory.map((c) => (
              <li key={c.category}>
                <div className="bar-share__row"><span>{c.category}</span><b className="bar-num">{formatPrice(c.amount)}</b></div>
                <div className="bar-share__track"><span style={{ width: `${pct(c.amount, catTotal)}%` }} /></div>
                <span className="bar-muted">{pct(c.amount, catTotal)}%{c.ml > 0 ? ` · ${c.ml.toLocaleString('en-IN')} ml` : ''}</span>
              </li>
            ))}
          </ul>
        </section>
      </div>

      {d.food > 0 && (
        <p className="bar-foot">
          Food ordered on bar orders is counted here, not in the restaurant report. The Tax &amp; GST report reads normal invoices only, so the food GST ({formatPrice(d.foodTax)}) is for your GST filing.
        </p>
      )}
    </>
  );
}

// Item-wise sales for one side of the counter: drinks (DRINK) or dishes ordered on bar orders (FOOD).
function Items({ d, kind }) {
  const drinks = kind === 'DRINK';
  const items = d.byItem.filter((i) => i.kind === kind);
  const qty = items.reduce((s, i) => s + i.quantity, 0);
  const total = items.reduce((s, i) => s + i.amount, 0);
  return (
    <>
      <div className="bar-kpis">
        <Kpi hero label={drinks ? 'Drinks sales' : 'Restaurant sales'} value={formatPrice(total)} sub={drinks ? 'Before tax split' : 'Dishes ordered on bar orders'} />
        <Kpi label={drinks ? 'Units sold' : 'Dishes sold'} value={qty.toLocaleString('en-IN')} />
        <Kpi label="Items" value={items.length} />
      </div>
      <Table
        title={drinks ? 'Drinks sold' : 'Dishes sold'}
        count={items.length}
        head={['#', 'Item', drinks ? 'Size' : 'Portion', '#Qty sold', '#Sale amount', '#Share']}
        empty={drinks ? 'No drinks sold in this period.' : 'No dishes sold on bar orders in this period.'}
        rows={[
          ...items.map((i, n) => [n + 1, <span key="n" className="bar-strong">{i.name}</span>, i.size || '—', i.quantity, formatPrice(i.amount), `${pct(i.amount, total)}%`]),
          ...(items.length ? [['', <b key="t" className="bar-strong">Total</b>, '', <b key="q" className="bar-strong">{qty}</b>, <b key="a" className="bar-strong">{formatPrice(total)}</b>, '']] : []),
        ]}
      />
    </>
  );
}

function Table({ title, count, head, rows, empty = 'Nothing in this period.' }) {
  return (
    <section className="bar-card">
      <h3 className="bar-card__title">{title} {count != null && <span className="bar-oc__count">{count}</span>}</h3>
      <div className="bar-table-wrap">
        <table className="bar-table">
          <thead>
            <tr>{head.map((h) => <th key={h} className={h.startsWith('#') ? 'is-num' : undefined}>{h.replace(/^#/, '')}</th>)}</tr>
          </thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={i}>{r.map((c, j) => <td key={j} className={head[j].startsWith('#') ? 'is-num' : undefined}>{c}</td>)}</tr>
            ))}
            {rows.length === 0 && <tr><td colSpan={head.length} className="bar-empty">{empty}</td></tr>}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function Stock({ d }) {
  const low = d.products.filter((p) => p.isLow).length;
  return (
    <>
      <div className="bar-kpis">
        <Kpi hero label="Products" value={d.products.length} />
        <Kpi label="Low stock" value={low} sub={low ? 'Needs reordering' : 'All fine'} />
      </div>
      <Table
        title="Stock movement"
        head={['Product', 'Opening', 'Received', 'Sold', 'Wastage', 'Closing', 'Now']}
        empty="No bar products."
        rows={d.products.map((p) => [
          <span key="n"><span className="bar-strong">{p.name}</span>{p.isLow && <> <span className="bar-chip bar-chip--low">Low</span></>}</span>,
          stockParts(p.opening),
          stockParts(p.purchased),
          stockParts(p.sold),
          stockParts(p.wastage),
          stockParts(p.closing),
          stockParts(p.current),
        ])}
      />
    </>
  );
}

const Bills = ({ d }) => (
  <Table
    title="Bills"
    count={d.bills.length}
    head={['Bill', 'Date', 'Customer', '#Drinks tax', '#Food GST', '#Total']}
    rows={d.bills.map((b) => [<span key="n" className="bar-strong">{b.billNumber}</span>, String(b.billDate).slice(0, 10), b.customerName || '—', formatPrice(b.taxAmount), formatPrice(b.foodTaxAmount), <b key="t" className="bar-strong">{formatPrice(b.total)}</b>])}
  />
);
