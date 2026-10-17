import { useEffect, useRef, useState } from 'react';
import { apiGet, apiPost, apiPatch, apiPostForm, apiPatchForm, ApiError, API_BASE } from '../../lib/api';
import { getSession } from '../../lib/auth';
import { formatPrice } from './priceFormat';
import { triggerDownload } from './bookingReportFile';
import PageLoader from '../../components/PageLoader';
import Req from '../../components/RequiredMark';
import './forms.css';
import './chartSections.css';
import './MenuPanel.css';
import './RoomsPanel.css';
import './RoomsAndRates.css';
import './OrdersPanel.css';
import './Billing.css';
import './ServicesPanel.css';

const emptyService = {
  name: '',
  unitLabel: 'use',
  price: '',
  gstRatePercent: '18',
  imageFile: null,
  currentImage: null,
  removeImage: false,
};
// What a service is usually charged per. Anything else is typed under "Other".
// "person" isn't offered here: a group sharing one service is handled as a
// head count at use time (see the use modal below), not a catalogue unit.
const UNIT_SUGGESTIONS = ['use', 'hour', 'day', 'session', 'game', 'trip', 'km'];
const emptyUse = { serviceId: '', quantity: '1', headcount: '1', bookingId: '', guestName: '', guestPhone: '', note: '' };

// The unit's own word as the field's label ("Hour", "Km", "Session") rather
// than a generic "Quantity" — the unit already says what's being counted.
const capitalize = (s) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s);

// The table's own badge reads "Completed" — the filter chip beside "Active"
// below reads "History" instead, since that chip stands for completed and
// cancelled together.
const STATUS_LABEL = { IN_USE: 'Active', COMPLETED: 'Completed', CANCELLED: 'Cancelled' };
// The status chips above the usage table — "active" is a use still open, and
// everything else is its history. ALL is handled separately, since it isn't
// a status any row actually carries.
const USAGE_STATUS_FILTERS = [
  { key: 'IN_USE', label: 'Active' },
  { key: 'COMPLETED', label: 'History' },
  { key: 'CANCELLED', label: 'Cancelled' },
];

// Only a completed use ever reaches billing — an open or cancelled one has
// nothing to say here, so the column and its sort both read it as blank.
const billingLabel = (u) =>
  u.status === 'COMPLETED' ? (u.billed ? 'Billed' : u.onRoomBill ? 'On room bill' : 'Ready to bill') : '';

// Day and clock time together — the table only has room for the status, not
// when it happened, so the detail view is where "started" and "completed"
// actually get said.
function formatDateTime(value) {
  if (!value) return null;
  const d = new Date(value);
  return `${d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })} · ${d.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })}`;
}

// The usage table's columns, and what each sorts on. A number sorts as a
// number; everything else as text, with digits read as numbers so quantity 9
// comes before 10.
const USAGE_COLUMNS = [
  { key: 'service', label: 'Service', value: (u) => u.serviceName ?? '' },
  // "Qty" reads as a count of things sold — wrong the moment a service is
  // priced per person rather than per use. "Units" covers both, since a unit
  // is just whatever the service's own unitLabel says it is.
  {
    key: 'qty',
    label: 'Units',
    value: (u) => Number(u.quantity) || 0,
    className: 'history-table__num svc-usage__qty-col',
  },
  {
    key: 'headcount',
    label: 'Head count',
    value: (u) => Number(u.headcount) || 1,
    className: 'history-table__num svc-usage__qty-col',
  },
  { key: 'entryType', label: 'Entry Type', value: (u) => (u.roomNumber ? `Room guest ${u.roomNumber}` : 'Walk-in') },
  { key: 'name', label: 'Customer Name', value: (u) => u.guestName ?? '' },
  { key: 'phone', label: 'Phone', value: (u) => u.guestPhone ?? '' },
  { key: 'status', label: 'Status', value: (u) => STATUS_LABEL[u.status] ?? '' },
  { key: 'billing', label: 'Billing', value: billingLabel },
  { key: 'amount', label: 'Amount', value: (u) => Number(u.lineTotal) || 0, className: 'history-table__num' },
];

// The rows on screen as a spreadsheet — same cut the search box and status
// chips left in place, so the file matches whatever the desk was actually
// looking at when they asked for it. Room gets its own column here: the
// table folds it into Entry Type as a second line, which a spreadsheet cell
// can't do without the type and the number running together.
const USAGE_SHEET_COLS = [
  { label: 'Service', value: (u) => u.serviceName || '' },
  // Split from the figure next to it so Units can stay a real, summable
  // number — "2 person" as one string would total nothing in Excel.
  { label: 'Units', value: (u) => Number(u.quantity) || 0, numeric: true },
  { label: 'Unit', value: (u) => u.unitLabel || '' },
  { label: 'Head count', value: (u) => Number(u.headcount) || 1, numeric: true },
  { label: 'Entry type', value: (u) => (u.roomNumber ? 'Room guest' : 'Walk-in') },
  { label: 'Room', value: (u) => u.roomNumber || '' },
  { label: 'Customer name', value: (u) => u.guestName || '' },
  { label: 'Phone', value: (u) => u.guestPhone || '' },
  { label: 'Status', value: (u) => STATUS_LABEL[u.status] ?? u.status },
  { label: 'Billing', value: billingLabel },
  { label: 'Amount', value: (u) => Number(u.lineTotal) || 0, numeric: true },
];

// What the property is, printed at the top of both documents the same way:
// name, then the address/phone/GSTIN it actually has on file. Blank facts
// are left out rather than printed empty — a document with "GSTIN:" and
// nothing after it looks like a field that failed to load, not one that was
// never filled in.
function letterheadFacts(lodge) {
  const location = [lodge?.address, lodge?.city, lodge?.state].filter(Boolean).join(', ');
  return [
    location ? ['Address', location] : null,
    lodge?.phone ? ['Phone', lodge.phone] : null,
    lodge?.isGstRegistered && lodge?.gstin ? ['GSTIN', lodge.gstin] : null,
  ].filter(Boolean);
}

function generatedStamp() {
  return `Generated ${new Date().toLocaleString('en-IN', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })}`;
}

async function downloadUsagesExcel(rows, lodge, scopeLabel) {
  const { default: writeXlsxFile } = await import('write-excel-file/browser');
  const bold = (value, extra = {}) => ({ value, fontWeight: 'bold', ...extra });
  const text = (value) => ({ value: value === '' || value == null ? null : value });

  const letterhead = [
    [bold(lodge?.name || 'Service use report', { fontSize: 14 })],
    [bold('Service use'), text(scopeLabel)],
    ...letterheadFacts(lodge).map(([label, value]) => [bold(label), text(value)]),
    [bold('Generated'), text(generatedStamp())],
    [],
  ];
  const head = USAGE_SHEET_COLS.map((c) => ({ value: c.label, fontWeight: 'bold', backgroundColor: '#e8e6f5' }));
  const data = rows.map((u) =>
    USAGE_SHEET_COLS.map((c) =>
      c.numeric ? { value: c.value(u), type: Number, align: 'right' } : { value: c.value(u) || null }
    )
  );

  const workbook = await writeXlsxFile(
    [
      {
        data: [...letterhead, head, ...data],
        sheet: 'Service use',
        // Freezes through the column header, not the letterhead above it —
        // the property's details only need reading once, not kept on screen
        // while scrolling past a hundred rows of usage.
        stickyRowsCount: letterhead.length + 1,
        columns: [22, 6, 8, 10, 14, 10, 20, 16, 12, 16, 12].map((width) => ({ width })),
      },
    ],
    { fontFamily: 'Calibri', fontSize: 11 }
  );
  triggerDownload(await workbook.toBlob(), `service-use-${new Date().toISOString().slice(0, 10)}.xlsx`);
}

// Column widths for the PDF table only — the same cells as the Excel sheet,
// laid out on an A4 landscape page (792pt wide, minus two 36pt margins).
const USAGE_PDF_WIDTHS = [94, 30, 40, 40, 60, 40, 88, 70, 54, 68, 54];
const PDF_INK = '#16212E';
const PDF_MUTED = '#78859A';
const PDF_BRAND = '#0A3A6B';
const PDF_HEAD_FILL = '#F1EEFC';
const PDF_ZEBRA_FILL = '#FAFAFC';

// jsPDF's bundled fonts have no ₹ glyph (see bookingReportFile.js), so the
// sheet's own amount formatter — ₹ and all — isn't safe to reuse here. Plain
// digits instead, with the currency said once in the footer.
function pdfAmount(n) {
  return Number(n || 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

async function downloadUsagesPdf(rows, lodge, scopeLabel) {
  const { jsPDF } = await import('jspdf');
  const pdf = new jsPDF({ unit: 'pt', format: 'a4', orientation: 'landscape' });
  const MARGIN = 36;
  const pageWidth = pdf.internal.pageSize.getWidth();
  const pageHeight = pdf.internal.pageSize.getHeight();
  const right = pageWidth - MARGIN;
  const bottom = pageHeight - MARGIN - 18;
  const rowHeight = 16;
  const fontSize = 8;
  const tableWidth = USAGE_PDF_WIDTHS.reduce((s, w) => s + w, 0);
  const runningHead = lodge?.name ? `${lodge.name} — service use` : 'Service use';

  // Clips a cell to its column rather than letting jsPDF overflow into the
  // next one — a long service name or guest name is common enough here that
  // leaving it unclipped would run two columns into each other.
  const clip = (text, width) => {
    const full = String(text ?? '');
    if (pdf.getTextWidth(full) <= width) return full;
    let t = full;
    while (t.length > 1 && pdf.getTextWidth(`${t}…`) > width) t = t.slice(0, -1);
    return `${t}…`;
  };

  const paintRow = (cells, { bold = false, fill = null } = {}) => {
    if (fill) {
      pdf.setFillColor(fill);
      pdf.rect(MARGIN, y - rowHeight + 4, tableWidth, rowHeight, 'F');
    }
    pdf.setFont('helvetica', bold ? 'bold' : 'normal').setFontSize(fontSize).setTextColor(bold ? PDF_BRAND : PDF_INK);
    let x = MARGIN;
    cells.forEach((cell, i) => {
      const w = USAGE_PDF_WIDTHS[i];
      const col = USAGE_SHEET_COLS[i];
      const t = clip(cell, w - 6);
      if (col.numeric) pdf.text(t, x + w - 3, y, { align: 'right' });
      else pdf.text(t, x + 3, y);
      x += w;
    });
  };

  let y = MARGIN;
  const tableHeader = () => {
    pdf.setFillColor(PDF_HEAD_FILL);
    pdf.rect(MARGIN, y - rowHeight + 4, tableWidth, rowHeight, 'F');
    paintRow(USAGE_SHEET_COLS.map((c) => c.label), { bold: true });
    y += rowHeight;
  };
  // A page added mid-table gets the property's name back at its top, the way
  // a printed register's running head repeats on every sheet — a page found
  // loose from the rest shouldn't need the first page to say whose it is.
  const newPage = () => {
    pdf.addPage();
    y = MARGIN;
    pdf.setFont('helvetica', 'normal').setFontSize(7.5).setTextColor(PDF_MUTED);
    pdf.text(runningHead, MARGIN, y);
    y += 16;
    tableHeader();
  };

  // Masthead: the property on the left — name, address, phone, GSTIN — the
  // document and when it was built on the right, same split every report in
  // the app uses.
  pdf.setFont('helvetica', 'bold').setFontSize(16).setTextColor(PDF_INK);
  pdf.text(clip(lodge?.name || 'Service use report', tableWidth - 220), MARGIN, y);
  const facts = letterheadFacts(lodge);
  pdf.setFont('helvetica', 'normal').setFontSize(8).setTextColor(PDF_MUTED);
  facts.forEach(([label, value], i) => {
    pdf.text(`${label}  ${value}`, MARGIN, y + 13 + i * 11);
  });

  pdf.setFont('helvetica', 'bold').setFontSize(11).setTextColor(PDF_INK);
  pdf.text('SERVICE USE', right, y, { align: 'right' });
  pdf.setFont('helvetica', 'normal').setFontSize(8).setTextColor(PDF_MUTED);
  pdf.text(scopeLabel, right, y + 13, { align: 'right' });
  pdf.text(generatedStamp(), right, y + 24, { align: 'right' });

  y += Math.max(34, 24 + facts.length * 11);
  pdf.setDrawColor(PDF_INK).setLineWidth(1.2);
  pdf.line(MARGIN, y, right, y);
  y += 20;

  tableHeader();
  rows.forEach((u, i) => {
    if (y > bottom) newPage();
    paintRow(
      USAGE_SHEET_COLS.map((c) => (c.numeric ? pdfAmount(c.value(u)) : c.value(u))),
      { fill: i % 2 === 1 ? PDF_ZEBRA_FILL : null }
    );
    y += rowHeight;
  });

  const pageCount = pdf.internal.getNumberOfPages();
  for (let page = 1; page <= pageCount; page += 1) {
    pdf.setPage(page);
    pdf.setDrawColor('#e3e8f0').setLineWidth(0.5);
    pdf.line(MARGIN, pageHeight - MARGIN - 4, right, pageHeight - MARGIN - 4);
    pdf.setFont('helvetica', 'normal').setFontSize(7.5).setTextColor(PDF_MUTED);
    pdf.text(`${rows.length} use${rows.length === 1 ? '' : 's'} · all amounts in Rs.`, MARGIN, pageHeight - MARGIN + 8);
    pdf.text(`Page ${page} of ${pageCount}`, right, pageHeight - MARGIN + 8, { align: 'right' });
  }

  triggerDownload(pdf.output('blob'), `service-use-${new Date().toISOString().slice(0, 10)}.pdf`);
}

// Other services a lodge sells per use — a private pool, a gaming
// area. Two views: the catalogue (what is offered and at what price) and the
// usage list (who is using what, through to "ready to bill"). Billing itself
// happens in Billing > Services to bill, the way food does.
export default function ServicesPanel({ lodge }) {
  const token = getSession()?.token;
  const [view, setView] = useState('usage');
  const [services, setServices] = useState(null);
  // The catalogue's own search, separate from the usage table's — a lodge
  // with a long price list shouldn't have to scroll every card to find one.
  const [catalogueSearch, setCatalogueSearch] = useState('');
  const [usages, setUsages] = useState(null);
  const [guests, setGuests] = useState([]);
  const [error, setError] = useState('');
  const [form, setForm] = useState(null); // { id?, ...fields } while the service modal is open
  const [useForm, setUseForm] = useState(null); // fields while the "start use" modal is open
  const [formError, setFormError] = useState('');
  const [busy, setBusy] = useState(false);
  // The use "View details" opens — every field the row itself has no room
  // for, not a second fetch, since the list already carries all of it.
  const [detailUsage, setDetailUsage] = useState(null);
  // The usage table's own cuts: free-text and the status chips above it.
  const [usageSearch, setUsageSearch] = useState('');
  const [usageStatus, setUsageStatus] = useState('ALL');
  // No column sorted until a heading is clicked — the list opens in the
  // order the server sent it. Clicking the sorted heading again turns it
  // round, the same as the bills table.
  const [usageSort, setUsageSort] = useState({ key: null, dir: 1 });
  const toggleUsageSort = (key) =>
    setUsageSort((cur) => (cur.key === key ? { key, dir: -cur.dir } : { key, dir: 1 }));

  // The Download button's own menu — which format it's offered to build, and
  // which one it's building right now (disables both choices mid-export
  // rather than letting a second click start a second file).
  const [downloadOpen, setDownloadOpen] = useState(false);
  const [downloadBusy, setDownloadBusy] = useState('');
  const downloadMenuRef = useRef(null);
  useEffect(() => {
    if (!downloadOpen) return undefined;
    const onClickAway = (e) => {
      if (downloadMenuRef.current && !downloadMenuRef.current.contains(e.target)) setDownloadOpen(false);
    };
    document.addEventListener('mousedown', onClickAway);
    return () => document.removeEventListener('mousedown', onClickAway);
  }, [downloadOpen]);
  const runUsageDownload = async (format, rows, scopeLabel) => {
    setDownloadOpen(false);
    setDownloadBusy(format);
    try {
      if (format === 'excel') await downloadUsagesExcel(rows, lodge, scopeLabel);
      else await downloadUsagesPdf(rows, lodge, scopeLabel);
    } catch (err) {
      fail(err, `Could not build the ${format.toUpperCase()} file.`);
    } finally {
      setDownloadBusy('');
    }
  };

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
    const body = new FormData();
    body.append('name', form.name.trim());
    body.append('unitLabel', form.unitLabel.trim() || 'use');
    body.append('price', String(Number(form.price)));
    body.append('gstRatePercent', String(Number(form.gstRatePercent) || 0));
    if (form.imageFile) body.append('image', form.imageFile);
    else if (form.removeImage) body.append('removeImage', 'true');
    setBusy(true);
    try {
      if (form.id) await apiPatchForm(`/lodge-services/${form.id}`, body, { token });
      else await apiPostForm('/lodge-services', body, { token });
      setForm(null);
      loadServices();
    } catch (err) {
      setFormError(err instanceof ApiError ? err.message : 'Could not save the service.');
    } finally {
      setBusy(false);
    }
  };

  // What the photo slot shows: the file just picked, else whatever is on the
  // service already, else nothing. A freshly picked file wins because it is
  // what saving would put there.
  const servicePhotoPreview = form?.imageFile
    ? URL.createObjectURL(form.imageFile)
    : !form?.removeImage && form?.currentImage
      ? `${API_BASE}/service-images/${form.currentImage}`
      : null;

  // Removing clears a pending file first — one click should undo the last
  // thing done, not skip past it to the saved photo underneath.
  const clearServicePhoto = () => {
    setForm((f) => (f.imageFile ? { ...f, imageFile: null } : { ...f, removeImage: true, imageFile: null }));
  };

  const toggleActive = (s) => {
    const verb = s.isActive ? 'Deactivate' : 'Activate';
    if (!window.confirm(`${verb} “${s.name}”?`)) return;
    apiPatch(`/lodge-services/${s.id}`, { isActive: !s.isActive }, { token })
      .then(loadServices)
      .catch((err) => fail(err, 'Could not update the service.'));
  };

  // One form, two destinations: a fresh use starts here (POST), an existing
  // one still open and unbilled is corrected in place (PATCH) — see editUse,
  // which is what puts an id on useForm to switch this into edit mode.
  const submitUse = async (e) => {
    e.preventDefault();
    setFormError('');
    const editing = !!useForm.id;
    if (!editing && !useForm.serviceId) return setFormError('Choose a service.');
    if (!(Number(useForm.quantity) > 0)) return setFormError('Quantity must be more than 0.');
    if (!(Number.isInteger(Number(useForm.headcount)) && Number(useForm.headcount) >= 1)) {
      return setFormError('Head count must be at least 1.');
    }
    setBusy(true);
    try {
      const body = {
        quantity: Number(useForm.quantity),
        headcount: Number(useForm.headcount),
        bookingId: useForm.bookingId,
        guestName: useForm.guestName,
        guestPhone: useForm.guestPhone,
      };
      if (editing) {
        await apiPatch(`/lodge-services/usages/${useForm.id}`, body, { token });
      } else {
        await apiPost('/lodge-services/usages', { ...body, serviceId: Number(useForm.serviceId), note: useForm.note }, { token });
      }
      setUseForm(null);
      loadUsages();
    } catch (err) {
      setFormError(err instanceof ApiError ? err.message : `Could not ${editing ? 'save this' : 'start this'} service.`);
    } finally {
      setBusy(false);
    }
  };

  // Prefills the same modal from an existing, still-editable use. The
  // service, its rate and unit travel along read-only (unitPrice/unitLabel)
  // so the amount preview matches what editing will actually charge — the
  // snapshot a use was started with, not whatever the catalogue says today.
  const editUse = (u) => {
    setFormError('');
    setUseForm({
      id: u.id,
      serviceId: String(u.serviceId),
      serviceName: u.serviceName,
      unitLabel: u.unitLabel,
      unitPrice: u.unitPrice,
      quantity: String(u.quantity),
      headcount: String(u.headcount),
      bookingId: u.bookingId ? String(u.bookingId) : '',
      guestName: u.guestName || '',
      guestPhone: u.guestPhone || '',
      note: '',
    });
  };

  const act = (usage, action) =>
    apiPost(`/lodge-services/usages/${usage.id}/${action}`, {}, { token })
      .then(loadUsages)
      .catch((err) => fail(err, 'Could not update this service.'));

  const active = (services ?? []).filter((s) => s.isActive);
  const picked = active.find((s) => String(s.id) === String(useForm?.serviceId));
  const editingUse = !!useForm?.id;
  // Editing prices off the use's own snapshot (what it actually charges),
  // not the live catalogue — the service there may since have been
  // repriced, renamed, or deactivated, none of which should be able to
  // retroactively change what an existing use is worth.
  const useUnitLabel = editingUse ? useForm.unitLabel : picked?.unitLabel;
  const useUnitPrice = editingUse ? Number(useForm.unitPrice) : picked?.price;
  // The unit's own word, not a generic "Quantity" — it already says what's
  // being counted (hours, km, sessions...). Head count is its own field,
  // always shown, for however many people shared this use.
  const qtyLabel = useUnitLabel ? capitalize(useUnitLabel) : 'Quantity';

  const catalogueQuery = catalogueSearch.trim().toLowerCase();
  const filteredServices = (services ?? []).filter(
    (s) => !catalogueQuery || s.name.toLowerCase().includes(catalogueQuery)
  );

  // Search runs across who it's for, not just what was used — a desk looking
  // a use up usually has the guest or the room in hand, not the service name.
  const usageQuery = usageSearch.trim().toLowerCase();
  const matchesUsageSearch = (u) =>
    !usageQuery ||
    [u.serviceName, u.guestName, u.roomNumber, u.guestPhone]
      .filter(Boolean)
      .some((v) => String(v).toLowerCase().includes(usageQuery));
  const usageCounts = {
    ALL: (usages ?? []).filter(matchesUsageSearch).length,
    ...Object.fromEntries(
      USAGE_STATUS_FILTERS.map((f) => [
        f.key,
        (usages ?? []).filter((u) => u.status === f.key && matchesUsageSearch(u)).length,
      ])
    ),
  };
  const visibleUsages = (usages ?? []).filter(
    (u) => (usageStatus === 'ALL' || u.status === usageStatus) && matchesUsageSearch(u)
  );
  const sortedUsages = !usageSort.key
    ? visibleUsages
    : [...visibleUsages].sort((a, b) => {
        const column = USAGE_COLUMNS.find((c) => c.key === usageSort.key);
        const x = column.value(a);
        const y = column.value(b);
        const order =
          typeof x === 'number'
            ? x - y
            : String(x).localeCompare(String(y), undefined, { numeric: true, sensitivity: 'base' });
        return order * usageSort.dir;
      });
  const usageFiltered = Boolean(usageQuery) || usageStatus !== 'ALL';
  const clearUsageFilters = () => {
    setUsageSearch('');
    setUsageStatus('ALL');
  };
  // Says on the document itself which cut of the list it is — "All" read
  // alone could mean the filters were never touched or that a desk cleared
  // them on purpose, and a search term narrows the file the same way it
  // narrows the screen.
  const usageScopeLabel = `${
    usageStatus === 'ALL' ? 'All' : USAGE_STATUS_FILTERS.find((f) => f.key === usageStatus)?.label || usageStatus
  }${usageQuery ? ` · search "${usageSearch.trim()}"` : ''}`;

  return (
    <div className="tables-panel">
      {/* The same underlined strip as every other section, with the view's one
          action at its right-hand end. */}
      <div className="subtabs">
        <button type="button" className="subtabs__item" aria-current={view === 'usage' ? 'page' : undefined} onClick={() => setView('usage')}>
          Service use
        </button>
        <button type="button" className="subtabs__item" aria-current={view === 'catalogue' ? 'page' : undefined} onClick={() => setView('catalogue')}>
          Services &amp; prices
        </button>
        <div className="subtabs__tools">
        {view === 'usage' ? (
          <button
            type="button"
            className="btn-accent"
            onClick={() => {
              setFormError('');
              setUseForm(emptyUse);
            }}
          >
            + New service use
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
      </div>

      {error && <div className="form-banner form-banner--error">{error}</div>}

      {view === 'catalogue' && (
        <div className="chart-section">
          {!services && <PageLoader inline label="Loading" />}
          {services && services.length === 0 && (
            <div className="dash-state">
              No services yet. Add what the lodge offers — private pool, gaming, spa — with a price per use.
            </div>
          )}
          {services && services.length > 0 && (
            <div className="field billing-panel__bill-search svc-catalogue__search">
              <svg
                className="billing-panel__bill-search-icon"
                width="16"
                height="16"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                aria-hidden="true"
              >
                <circle cx="11" cy="11" r="7" />
                <path d="m20 20-3.5-3.5" />
              </svg>
              <input
                aria-label="Search services"
                value={catalogueSearch}
                onChange={(e) => setCatalogueSearch(e.target.value)}
                placeholder="Search by service name"
              />
              {catalogueSearch && (
                <button
                  type="button"
                  className="billing-panel__bill-search-clear"
                  onClick={() => setCatalogueSearch('')}
                  aria-label="Clear search"
                >
                  ×
                </button>
              )}
            </div>
          )}
          {services && services.length > 0 && filteredServices.length === 0 && (
            <div className="dash-state">
              No service matches “{catalogueSearch}”.{' '}
              <button type="button" className="billing-panel__bill-clear" onClick={() => setCatalogueSearch('')}>
                Clear search
              </button>
            </div>
          )}
          {filteredServices.length > 0 && (
            <ul className="svc-card-grid">
              {filteredServices.map((s) => (
                <li className={`svc-card${s.isActive ? '' : ' svc-card--inactive'}`} key={s.id}>
                  {s.image ? (
                    <img
                      className="svc-card__photo"
                      src={`${API_BASE}/service-images/${s.image}`}
                      alt=""
                      loading="lazy"
                      decoding="async"
                    />
                  ) : (
                    <div className="svc-card__photo svc-card__photo--empty" aria-hidden="true">
                      No photo
                    </div>
                  )}
                  <div className="svc-card__main">
                    <div className="svc-card__head">
                      <span className="svc-card__name">{s.name}</span>
                      <span
                        className={`history-table__status${
                          s.isActive ? ' history-table__status--delivered' : ''
                        }`}
                      >
                        {s.isActive ? 'Active' : 'Inactive'}
                      </span>
                    </div>
                    <div className="svc-card__facts">
                      <span className="svc-card__price">
                        {formatPrice(s.price)}
                        <span className="svc-catalogue__unit">/ {s.unitLabel}</span>
                      </span>
                      {s.gstRatePercent > 0 && <span className="svc-card__gst">GST {s.gstRatePercent}%</span>}
                    </div>
                    <div className="svc-card__actions">
                      <button
                        type="button"
                        className="svc-card__btn"
                        onClick={() => {
                          setFormError('');
                          setForm({
                            id: s.id,
                            name: s.name,
                            unitLabel: s.unitLabel,
                            price: String(s.price),
                            gstRatePercent: String(s.gstRatePercent),
                            currentImage: s.image,
                            imageFile: null,
                            removeImage: false,
                          });
                        }}
                      >
                        Edit
                      </button>
                      <button
                        type="button"
                        className={`svc-card__btn${s.isActive ? ' svc-card__btn--danger' : ' svc-card__btn--primary'}`}
                        onClick={() => toggleActive(s)}
                      >
                        {s.isActive ? 'Deactivate' : 'Activate'}
                      </button>
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {view === 'usage' && (
        <div className="chart-section">
          {!usages && <PageLoader inline label="Loading" />}
          {usages && usages.length === 0 && <div className="dash-state">Nothing yet.</div>}
          {usages && usages.length > 0 && (
            <>
              <div className="billing-panel__bill-tools">
                <div className="field billing-panel__bill-search svc-usage__search">
                  <svg
                    className="billing-panel__bill-search-icon"
                    width="16"
                    height="16"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    aria-hidden="true"
                  >
                    <circle cx="11" cy="11" r="7" />
                    <path d="m20 20-3.5-3.5" />
                  </svg>
                  <input
                    aria-label="Search service use"
                    value={usageSearch}
                    onChange={(e) => setUsageSearch(e.target.value)}
                    placeholder="Guest, room or phone"
                  />
                  {usageSearch && (
                    <button
                      type="button"
                      className="billing-panel__bill-search-clear"
                      onClick={() => setUsageSearch('')}
                      aria-label="Clear search"
                    >
                      ×
                    </button>
                  )}
                </div>
                {/* In use is the active cut; Completed and Cancelled are the
                    history a desk checks back against once the guest has
                    moved on. */}
                <div className="billing-panel__filters svc-usage__filters">
                  <button
                    type="button"
                    className="billing-panel__filter"
                    aria-pressed={usageStatus === 'ALL'}
                    onClick={() => setUsageStatus('ALL')}
                  >
                    All
                    <span className="billing-panel__filter-count">{usageCounts.ALL}</span>
                  </button>
                  {USAGE_STATUS_FILTERS.map((f) => (
                    <button
                      type="button"
                      key={f.key}
                      className="billing-panel__filter"
                      aria-pressed={usageStatus === f.key}
                      onClick={() => setUsageStatus(f.key)}
                    >
                      {f.label}
                      <span className="billing-panel__filter-count">{usageCounts[f.key]}</span>
                    </button>
                  ))}
                </div>

                {usageFiltered && (
                  <span className="billing-panel__bill-count">
                    {visibleUsages.length} of {usages.length}
                    <button type="button" className="billing-panel__bill-clear" onClick={clearUsageFilters}>
                      Clear
                    </button>
                  </span>
                )}

                <div className="svc-usage__download" ref={downloadMenuRef}>
                  <button
                    type="button"
                    className="btn-secondary"
                    disabled={sortedUsages.length === 0 || Boolean(downloadBusy)}
                    aria-haspopup="menu"
                    aria-expanded={downloadOpen}
                    onClick={() => setDownloadOpen((open) => !open)}
                  >
                    {downloadBusy ? 'Preparing…' : 'Download'}
                    <span className="svc-usage__download-caret" aria-hidden="true">▾</span>
                  </button>
                  {downloadOpen && (
                    <div className="svc-usage__download-menu" role="menu">
                      <button
                        type="button"
                        role="menuitem"
                        className="svc-usage__download-item"
                        onClick={() => runUsageDownload('excel', sortedUsages, usageScopeLabel)}
                      >
                        Excel (.xlsx)
                      </button>
                      <button
                        type="button"
                        role="menuitem"
                        className="svc-usage__download-item"
                        onClick={() => runUsageDownload('pdf', sortedUsages, usageScopeLabel)}
                      >
                        PDF
                      </button>
                    </div>
                  )}
                </div>
              </div>

              {visibleUsages.length === 0 ? (
                <div className="dash-state">
                  No service use matches these filters.{' '}
                  <button type="button" className="billing-panel__bill-clear" onClick={clearUsageFilters}>
                    Clear filters
                  </button>
                </div>
              ) : (
                <section className="history-sheet billing-sheet">
                  <div className="history-table-wrap">
                    <table className="history-table svc-usage__table">
                      <thead>
                        <tr>
                          {USAGE_COLUMNS.map((column) => (
                            <th
                              key={column.key}
                              className={column.className}
                              aria-sort={
                                usageSort.key === column.key
                                  ? usageSort.dir === 1
                                    ? 'ascending'
                                    : 'descending'
                                  : undefined
                              }
                            >
                              <button
                                type="button"
                                className="billing-sheet__sort"
                                onClick={() => toggleUsageSort(column.key)}
                                title={`Sort by ${column.label}`}
                              >
                                {column.label}
                                <span className="billing-sheet__sort-icon" aria-hidden="true">
                                  {usageSort.key === column.key ? (usageSort.dir === 1 ? '▲' : '▼') : '⇅'}
                                </span>
                              </button>
                            </th>
                          ))}
                          <th aria-label="Actions" />
                        </tr>
                      </thead>
                      <tbody>
                        {sortedUsages.map((u) => (
                          <tr key={u.id} className="history-table__row">
                            <td className="history-table__strong" title={u.serviceName}>{u.serviceName}</td>
                            <td className="history-table__num svc-usage__qty-col">{u.quantity}</td>
                            <td>
                              <div className="svc-usage__entry">
                                <span className="history-table__where">
                                  {u.roomNumber ? 'Room guest' : 'Walk-in'}
                                </span>
                                {u.roomNumber && <span className="history-table__note">Room {u.roomNumber}</span>}
                              </div>
                            </td>
                            <td title={u.guestName || undefined}>{u.guestName || <span className="history-table__note">—</span>}</td>
                            <td>{u.guestPhone || <span className="history-table__note">—</span>}</td>
                            <td>
                              <span
                                className={`history-table__status${
                                  u.status === 'IN_USE'
                                    ? ' history-table__status--delivered'
                                    : ' history-table__status--cancelled'
                                }`}
                              >
                                {STATUS_LABEL[u.status]}
                              </span>
                            </td>
                            <td>
                              {u.status === 'COMPLETED' ? (
                                <span
                                  className={`history-table__status history-table__status--${
                                    u.billed ? 'billed' : u.onRoomBill ? 'room' : 'ready'
                                  }`}
                                >
                                  {billingLabel(u)}
                                </span>
                              ) : (
                                <span className="history-table__note">—</span>
                              )}
                            </td>
                            <td className="history-table__num history-table__strong">{formatPrice(u.lineTotal)}</td>
                            <td className="history-table__actions">
                              <div className="history-table__actions-inner">
                                <button type="button" className="history-table__btn" onClick={() => setDetailUsage(u)}>
                                  View
                                </button>
                                {u.status === 'IN_USE' && (
                                  <button
                                    type="button"
                                    className="history-table__btn history-table__btn--primary"
                                    onClick={() => act(u, 'complete')}
                                  >
                                    Complete
                                  </button>
                                )}
                                {u.status === 'IN_USE' && (
                                  <button
                                    type="button"
                                    className="history-table__btn history-table__btn--danger"
                                    onClick={() => {
                                      if (window.confirm(`Cancel ${u.serviceName} for ${u.guestName || 'this guest'}?`)) {
                                        act(u, 'cancel');
                                      }
                                    }}
                                  >
                                    Cancel
                                  </button>
                                )}
                              </div>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </section>
              )}
            </>
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
                    placeholder="Private pool"
                    autoFocus
                  />
                </div>
                <div className="field">
                  <label>Photo</label>
                  <div className="menu-photo">
                    {servicePhotoPreview ? (
                      <div className="menu-photo__preview">
                        <img src={servicePhotoPreview} alt={form.name || 'Service photo'} />
                        <button
                          type="button"
                          className="menu-photo__remove"
                          onClick={clearServicePhoto}
                          aria-label="Remove photo"
                        >
                          ×
                        </button>
                      </div>
                    ) : (
                      <div className="menu-photo__empty" aria-hidden="true">
                        No photo
                      </div>
                    )}
                    <div className="menu-photo__pick">
                      <input
                        id="svcImage"
                        type="file"
                        accept="image/jpeg,image/png,image/webp"
                        onChange={(e) => {
                          const file = e.target.files[0] || null;
                          e.target.value = '';
                          if (file) setForm((f) => ({ ...f, imageFile: file, removeImage: false }));
                        }}
                      />
                    </div>
                  </div>
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
                    {/* A unit saved earlier that is not in the list opens as "Other",
                        with its own words in the box. */}
                    <select
                      id="svcUnit"
                      value={form.unitOther || !UNIT_SUGGESTIONS.includes(form.unitLabel) ? '__other' : form.unitLabel}
                      onChange={(e) =>
                        setForm(
                          e.target.value === '__other'
                            ? { ...form, unitOther: true, unitLabel: '' }
                            : { ...form, unitOther: false, unitLabel: e.target.value }
                        )
                      }
                    >
                      {UNIT_SUGGESTIONS.map((unit) => (
                        <option key={unit} value={unit}>
                          {unit}
                        </option>
                      ))}
                      <option value="__other">Other…</option>
                    </select>
                    {(form.unitOther || !UNIT_SUGGESTIONS.includes(form.unitLabel)) && (
                      <input
                        className="svc-unit-other"
                        aria-label="Your own unit"
                        maxLength={30}
                        value={form.unitLabel}
                        onChange={(e) => setForm({ ...form, unitOther: true, unitLabel: e.target.value })}
                        placeholder="Type your own"
                        autoFocus
                      />
                    )}
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
            <form className="modal-form" onSubmit={submitUse} noValidate>
              <div className="modal-form__head">
                <div className="modal-form__head-row">
                  <h3>{editingUse ? 'Edit service use' : 'New service use'}</h3>
                  <button type="button" className="modal-form__close" onClick={() => setUseForm(null)} aria-label="Close">
                    ×
                  </button>
                </div>
                <p className="modal-form__sub">
                  {editingUse
                    ? 'Correcting what was already started — the service itself can’t change here.'
                    : 'Pick a guest staying in-house, or type a walk-in’s name.'}
                </p>
              </div>
              <div className="modal-form__body">
                {formError && <div className="form-banner form-banner--error">{formError}</div>}
                {!editingUse && active.length === 0 && (
                  <div className="form-banner form-banner--error">Add a service under “Services &amp; prices” first.</div>
                )}
                <div className="field">
                  <label htmlFor="useService">
                    Service
                    {!editingUse && <Req />}
                  </label>
                  {editingUse ? (
                    <input id="useService" value={`${useForm.serviceName} — ${formatPrice(useForm.unitPrice)} per ${useForm.unitLabel}`} disabled />
                  ) : (
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
                  )}
                </div>
                <div className="field-row">
                  <div className="field">
                    <label htmlFor="useQty">{qtyLabel}</label>
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
                    <label htmlFor="useHeadcount">Head count</label>
                    <input
                      id="useHeadcount"
                      type="number"
                      min="1"
                      step="1"
                      value={useForm.headcount}
                      onChange={(e) => setUseForm({ ...useForm, headcount: e.target.value })}
                    />
                  </div>
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
                    {useUnitPrice != null
                      ? formatPrice(useUnitPrice * (Number(useForm.quantity) || 0) * (Number(useForm.headcount) || 1))
                      : '—'}
                  </span>
                </div>
                <div className="modal-form__foot-actions">
                  <button type="button" className="btn-secondary" onClick={() => setUseForm(null)} disabled={busy}>
                    Cancel
                  </button>
                  <button type="submit" className="btn-accent" disabled={busy}>
                    {editingUse ? (busy ? 'Saving…' : 'Save') : busy ? 'Starting…' : 'Start'}
                  </button>
                </div>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Every field the row itself has no room for — nothing left out, down
          to the record's own ids, since this is the one place a desk can
          check the full data behind a use rather than just its summary. */}
      {detailUsage && (
        <div className="glass-backdrop billing-panel__backdrop" onClick={() => setDetailUsage(null)}>
          <div
            className="glass-panel billing-panel__modal billing-panel__modal--usage-detail"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="billing-panel__detail-header">
              <h3>{detailUsage.serviceName}</h3>
              <span className="billing-panel__detail-tags">
                <span
                  className={`history-table__status${
                    detailUsage.status === 'IN_USE'
                      ? ' history-table__status--delivered'
                      : ' history-table__status--cancelled'
                  }`}
                >
                  {STATUS_LABEL[detailUsage.status]}
                </span>
                <button type="button" className="bill-close" onClick={() => setDetailUsage(null)} aria-label="Close">
                  ×
                </button>
              </span>
            </div>

            <div className="svc-detail__summary">
              <span className="svc-detail__summary-label">Amount</span>
              <span className="svc-detail__summary-value">{formatPrice(detailUsage.lineTotal)}</span>
              <div className="svc-detail__summary-breakdown">
                <div className="svc-detail__summary-stat">
                  <span className="svc-detail__summary-stat-label">Units</span>
                  <span className="svc-detail__summary-stat-value">
                    {detailUsage.quantity} {detailUsage.unitLabel}
                  </span>
                </div>
                <div className="svc-detail__summary-stat">
                  <span className="svc-detail__summary-stat-label">Rate</span>
                  <span className="svc-detail__summary-stat-value">
                    {formatPrice(detailUsage.unitPrice)} / {detailUsage.unitLabel}
                  </span>
                </div>
                <div className="svc-detail__summary-stat">
                  <span className="svc-detail__summary-stat-label">GST</span>
                  <span className="svc-detail__summary-stat-value">{detailUsage.gstRatePercent}%</span>
                </div>
              </div>
            </div>

            <div className="form-section">
              <div className="form-section__title">Guest details</div>
              <div className="chart-list">
                <div className="chart-row">
                  <span className="chart-row__name">Entry</span>
                  <span className="chart-row__value">
                    {detailUsage.roomNumber ? `Room guest · Room ${detailUsage.roomNumber}` : 'Walk-in'}
                  </span>
                </div>
                <div className="chart-row">
                  <span className="chart-row__name">Customer name</span>
                  <span className="chart-row__value">{detailUsage.guestName || '—'}</span>
                </div>
                <div className="chart-row">
                  <span className="chart-row__name">Phone</span>
                  <span className="chart-row__value">{detailUsage.guestPhone || '—'}</span>
                </div>
                <div className="chart-row">
                  <span className="chart-row__name">Note</span>
                  <span className="chart-row__value">{detailUsage.note || '—'}</span>
                </div>
              </div>
            </div>

            <div className="form-section">
              <div className="form-section__title">Timing</div>
              <div className="chart-list">
                <div className="chart-row">
                  <span className="chart-row__name">Started</span>
                  <span className="chart-row__value">{formatDateTime(detailUsage.startedAt) || '—'}</span>
                </div>
                <div className="chart-row">
                  <span className="chart-row__name">Completed</span>
                  <span className="chart-row__value">{formatDateTime(detailUsage.completedAt) || '—'}</span>
                </div>
              </div>
            </div>

            <div className="form-section">
              <div className="form-section__title">Billing</div>
              <div className="chart-list">
                <div className="chart-row">
                  <span className="chart-row__name">Status</span>
                  <span className="chart-row__value">
                    {detailUsage.status === 'COMPLETED' ? (
                      <span
                        className={`history-table__status history-table__status--${
                          detailUsage.billed ? 'billed' : detailUsage.onRoomBill ? 'room' : 'ready'
                        }`}
                      >
                        {billingLabel(detailUsage)}
                      </span>
                    ) : (
                      '—'
                    )}
                  </span>
                </div>
                <div className="chart-row">
                  <span className="chart-row__name">Billed</span>
                  <span className="chart-row__value">{detailUsage.billed ? 'Yes' : 'No'}</span>
                </div>
              </div>
            </div>

            {/* Editing lives here rather than as its own row button — once a
                use is billed or cancelled there's nothing left to correct, so
                the action only makes sense next to the detail that explains
                why it's still available (or isn't). */}
            {detailUsage.status !== 'CANCELLED' && !detailUsage.billed && (
              <div className="modal-form__foot-actions">
                <button
                  type="button"
                  className="btn-accent"
                  onClick={() => {
                    editUse(detailUsage);
                    setDetailUsage(null);
                  }}
                >
                  Edit
                </button>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
