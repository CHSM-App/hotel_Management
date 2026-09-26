import { useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { apiGet, apiPost, apiPatch, apiDelete, apiPostForm, apiPatchForm, apiGetBlob, ApiError } from '../../lib/api';
import { getSession } from '../../lib/auth';
import { readCache, writeCache } from '../../lib/dataCache';
import { toQrDataUrl, assetUrl } from '../../lib/qr';
import { formatPrice } from './priceFormat';
import SectionTabs from './SectionTabs';
import RowMenu from './RowMenu';
import Req from '../../components/RequiredMark';
import {
  PAYMENT_METHOD_LABEL as PAYMENT_LABEL,
  PAYMENT_METHOD_TAG_CLASS as PAYMENT_TAG_CLASS,
  PAYMENT_METHOD_OPTIONS,
  PAYMENT_REFERENCE_LABEL,
} from './paymentMethods';
import './forms.css';
import './InventoryPanel.css';

const STATUS_LABEL = {
  IN_USE: 'In use',
  UNDER_REPAIR: 'Under repair',
  RETIRED: 'Retired',
};

// Same rule as mobileDigits/typedMobile in Bookings.jsx — duplicated rather
// than shared, but the two must agree: a vendor phone this form accepts and
// the backend's TEN_DIGITS check in assets.schema.js rejects is a round trip
// spent on a red banner.
function typedMobile(value) {
  const digits = String(value ?? '').replace(/\D/g, '');
  const normalised =
    digits.length === 12 && digits.startsWith('91')
      ? digits.slice(2)
      : digits.length === 11 && digits.startsWith('0')
        ? digits.slice(1)
        : digits;
  return normalised.slice(0, 10);
}

// A neutral pill for every status read the same at a glance as "nothing to
// see here" — the one status that actually needs attention (Under repair)
// looked no different from Retired or In use. Same colour language as the
// warranty/AMC chips: green for normal, amber for "someone's on it",
// blue for a neutral fact, grey for inactive.
const STATUS_TAG_CLASS = {
  IN_USE: 'inv-tag--good',
  UNDER_REPAIR: 'inv-tag--low',
  RETIRED: 'inv-tag--off',
};

const WO_STATUS_LABEL = { OPEN: 'Open', IN_PROGRESS: 'In progress', CLOSED: 'Closed' };

const TABLE_SORT_ACCESSORS = {
  tag: (a) => a.assetTag || '',
  name: (a) => a.name || '',
  category: (a) => a.categoryName || '',
  location: (a) => (a.roomNumber ? `Room ${a.roomNumber}` : a.department || (a.floor ? `Floor ${a.floor}` : '')),
  status: (a) => STATUS_LABEL[a.status] || '',
  warranty: (a) => (a.warrantyExpiry ? new Date(a.warrantyExpiry).getTime() : null),
  amc: (a) => (a.amcExpiry ? new Date(a.amcExpiry).getTime() : null),
  openWorkOrders: (a) => a.openWorkOrders || 0,
};

const emptyAssetForm = {
  name: '',
  categoryName: '',
  brand: '',
  model: '',
  serialNumber: '',
  purchaseDate: '',
  purchaseCost: '',
  paymentMethod: 'CASH',
  paymentStatus: 'PAID',
  amountPaid: '',
  referenceNumber: '',
  roomId: '',
  floor: '',
  department: '',
  locationNote: '',
  // vendorId is only ever set by picking a suggestion — see resolveVendorId.
  // A typed name with no matching id means "this is a new vendor" and the
  // detail fields below are what gets saved for it.
  vendorId: '',
  vendorName: '',
  vendorContactPerson: '',
  vendorPhone: '',
  vendorAltPhone: '',
  vendorEmail: '',
  vendorSpecialty: '',
  // Only ever sent at registration — see the note above the field in the
  // form. Editing an existing asset never touches this.
  warrantyExpiry: '',
};

const emptyWorkOrderForm = {
  assetId: '',
  issueType: 'BREAKDOWN',
  description: '',
  assignedToName: '',
  vendorId: '',
  paymentMethod: 'CASH',
  paymentStatus: 'PAID',
  amountPaid: '',
  referenceNumber: '',
};

// One work order per active asset in a category, from a single form — "the
// AC contractor is servicing every split AC today" shouldn't mean filing the
// same work order a dozen times by hand.
const emptyBulkWoForm = {
  categoryId: '',
  issueType: 'ROUTINE_SERVICE',
  description: '',
  assignedToName: '',
  vendorId: '',
};

// One warranty or AMC period, recorded on an asset. "Renew" pre-fills this
// from the vendor/type of whatever period is ending, so extending an AMC is
// two date fields, not re-entering the vendor and terms again.
const emptyCoverageForm = {
  coverageType: 'AMC',
  vendorId: '',
  vendorName: '',
  vendorContactPerson: '',
  vendorPhone: '',
  vendorAltPhone: '',
  vendorEmail: '',
  vendorSpecialty: '',
  startDate: '',
  endDate: '',
  cost: '',
  paymentMethod: 'CASH',
  paymentStatus: 'PAID',
  amountPaid: '',
  referenceNumber: '',
  coverageNote: '',
};

// Bulk register: everything one purchase shares across every unit — the
// same fields as emptyAssetForm minus what only makes sense per unit
// (name, room, floor, location).
const emptyBulkForm = {
  categoryName: '',
  brand: '',
  model: '',
  purchaseDate: '',
  purchaseCost: '',
  paymentMethod: 'CASH',
  paymentStatus: 'PAID',
  amountPaid: '',
  referenceNumber: '',
  vendorId: '',
  vendorName: '',
  vendorContactPerson: '',
  vendorPhone: '',
  vendorAltPhone: '',
  vendorEmail: '',
  vendorSpecialty: '',
  warrantyExpiry: '',
};

// One row of the bulk unit list — id is a local-only key for React and the
// CSV import, never sent to the server. Serial number lives here rather than
// in the shared fields above it: it's the one thing that's never the same
// across fifty identical ACs bought on the same bill.
let bulkUnitSeq = 0;
function emptyBulkUnit() {
  bulkUnitSeq += 1;
  return { key: bulkUnitSeq, name: '', serialNumber: '', roomId: '', floor: '', department: '', locationNote: '' };
}

const BULK_TEMPLATE_HEADERS = ['Name (optional)', 'Serial number', 'Room number', 'Floor', 'Location description'];

const emptyVendorForm = { name: '', contactPerson: '', phone: '', altPhone: '', email: '', specialty: '', notes: '' };

// Maps a field's key in an errors object to the DOM id its input actually
// carries, then focuses and scrolls to the first one that has a message —
// same pattern as InventoryPanel's focusFirstError, so a failure lands the
// hand on the field it's about instead of a banner the desk has to go
// looking for.
function focusFirstError(errors, fieldIds) {
  const first = Object.keys(fieldIds).find((key) => errors[key]);
  if (!first) return;
  const el = document.getElementById(fieldIds[first]);
  if (!el) return;
  el.focus({ preventScroll: true });
  el.scrollIntoView({ block: 'center', behavior: 'smooth' });
}

// Offered as suggestions, not a fixed list — a hotel-specific category (a
// resort's pool pump, a dormitory's bunk frames) is still just a typed name.
// Covers the equipment named in the PDF plus the categories most hotels reach
// for first, so the common case needs no typing at all.
const SUGGESTED_CATEGORIES = [
  'Air Conditioner',
  'Lift / Elevator',
  'Bed',
  'Television',
  'Geyser / Water Heater',
  'Generator',
  'Furniture',
  'Kitchen Equipment',
  'Plumbing',
  'Electrical',
  'Fire Safety',
  'CCTV / Security',
  'Laundry Equipment',
  'Housekeeping Equipment',
];

// A warranty/AMC date reads as "expiring soon" inside 30 days, and "expired"
// once it's past — the only reminder v1 gives is this badge, computed fresh
// each render rather than stored, so it's never stale.
function expiryFlag(dateStr) {
  if (!dateStr) return null;
  const days = Math.ceil((new Date(dateStr) - new Date()) / (1000 * 60 * 60 * 24));
  if (days < 0) return 'expired';
  if (days <= 30) return 'soon';
  return null;
}

function formatDate(dateStr) {
  if (!dateStr) return '—';
  return new Date(dateStr).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
}

function todayIso() {
  return new Date().toISOString().slice(0, 10);
}

// A styled stand-in for a native <datalist>, which every browser renders with
// its own chrome (dark on Chrome, light on Firefox) that CSS can't reach —
// it looked like a different app bolted onto this form. Same shape as
// SectionNameField in MenuPanel.jsx: opens on focus, narrows as you type,
// arrow keys move the highlight, Enter/click picks. Unlike that one, the
// list here is filtered rather than shown whole — existing categories plus
// fourteen suggestions is too long to scan unnarrowed.
function CategoryField({ id, value, options, onChange }) {
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const boxRef = useRef(null);

  useEffect(() => {
    if (!open) return undefined;
    const onDocumentDown = (e) => {
      if (!boxRef.current?.contains(e.target)) setOpen(false);
    };
    document.addEventListener('mousedown', onDocumentDown);
    return () => document.removeEventListener('mousedown', onDocumentDown);
  }, [open]);

  const needle = value.trim().toLowerCase();
  const matches = needle ? options.filter((name) => name.toLowerCase().includes(needle)) : options;
  const activeIndex = active < matches.length ? active : -1;

  const take = (name) => {
    setOpen(false);
    onChange(name);
  };

  const onKeyDown = (e) => {
    if (e.key === 'ArrowDown' && !open) {
      setOpen(true);
      return;
    }
    if (!open || matches.length === 0) return;

    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      const step = e.key === 'ArrowDown' ? 1 : -1;
      setActive((activeIndex + step + matches.length) % matches.length);
    } else if (e.key === 'Enter' && activeIndex >= 0) {
      e.preventDefault();
      take(matches[activeIndex]);
    } else if (e.key === 'Escape') {
      setOpen(false);
    }
  };

  return (
    <div className="asset-suggest" ref={boxRef}>
      <input
        id={id}
        value={value}
        placeholder="AC, Lift, Generator…"
        role="combobox"
        aria-expanded={open}
        aria-controls={`${id}-suggestions`}
        aria-autocomplete="list"
        aria-activedescendant={activeIndex >= 0 ? `${id}-suggestion-${activeIndex}` : undefined}
        autoComplete="off"
        onChange={(e) => {
          onChange(e.target.value);
          setActive(-1);
        }}
        onKeyDown={onKeyDown}
        onFocus={() => setOpen(true)}
        onClick={() => setOpen(true)}
      />
      {open && matches.length > 0 && (
        <ul className="asset-suggest__list" id={`${id}-suggestions`} role="listbox">
          {matches.map((name, i) => (
            <li key={name} role="option" aria-selected={i === activeIndex} id={`${id}-suggestion-${i}`}>
              <button
                type="button"
                className={`asset-suggest__option${i === activeIndex ? ' asset-suggest__option--active' : ''}`}
                onMouseDown={(e) => {
                  e.preventDefault();
                  take(name);
                }}
                onMouseEnter={() => setActive(i)}
              >
                {name}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

// Same shape as CategoryField, but matches across name/phone/email — a
// vendor is more often looked up by phone number than typed by name — and
// hands back the whole vendor object on pick rather than a bare string, so
// the caller can fill every detail field in one go.
function VendorField({ id, value, vendors, onChange, onPick }) {
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const boxRef = useRef(null);

  useEffect(() => {
    if (!open) return undefined;
    const onDocumentDown = (e) => {
      if (!boxRef.current?.contains(e.target)) setOpen(false);
    };
    document.addEventListener('mousedown', onDocumentDown);
    return () => document.removeEventListener('mousedown', onDocumentDown);
  }, [open]);

  const needle = value.trim().toLowerCase();
  const matches = needle
    ? (vendors || []).filter(
        (v) =>
          v.name.toLowerCase().includes(needle) ||
          (v.phone || '').toLowerCase().includes(needle) ||
          (v.altPhone || '').toLowerCase().includes(needle) ||
          (v.email || '').toLowerCase().includes(needle)
      )
    : vendors || [];
  const activeIndex = active < matches.length ? active : -1;

  const take = (vendor) => {
    setOpen(false);
    onPick(vendor);
  };

  const onKeyDown = (e) => {
    if (e.key === 'ArrowDown' && !open) {
      setOpen(true);
      return;
    }
    if (!open || matches.length === 0) return;

    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      const step = e.key === 'ArrowDown' ? 1 : -1;
      setActive((activeIndex + step + matches.length) % matches.length);
    } else if (e.key === 'Enter' && activeIndex >= 0) {
      e.preventDefault();
      take(matches[activeIndex]);
    } else if (e.key === 'Escape') {
      setOpen(false);
    }
  };

  return (
    <div className="asset-suggest" ref={boxRef}>
      <input
        id={id}
        value={value}
        placeholder="Shop / company name or phone…"
        role="combobox"
        aria-expanded={open}
        aria-controls={`${id}-suggestions`}
        aria-autocomplete="list"
        aria-activedescendant={activeIndex >= 0 ? `${id}-suggestion-${activeIndex}` : undefined}
        autoComplete="off"
        onChange={(e) => {
          onChange(e.target.value);
          setActive(-1);
        }}
        onKeyDown={onKeyDown}
        onFocus={() => setOpen(true)}
        onClick={() => setOpen(true)}
      />
      {open && matches.length > 0 && (
        <ul className="asset-suggest__list" id={`${id}-suggestions`} role="listbox">
          {matches.map((vendor, i) => (
            <li key={vendor.id} role="option" aria-selected={i === activeIndex} id={`${id}-suggestion-${i}`}>
              <button
                type="button"
                className={`asset-suggest__option${i === activeIndex ? ' asset-suggest__option--active' : ''}`}
                onMouseDown={(e) => {
                  e.preventDefault();
                  take(vendor);
                }}
                onMouseEnter={() => setActive(i)}
              >
                {vendor.name}
                {(vendor.phone || vendor.specialty) && (
                  <span className="asset-suggest__option-meta">
                    {[vendor.phone, vendor.specialty].filter(Boolean).join(' · ')}
                  </span>
                )}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

// A searchable stand-in for the plain <select> a Work Order used to pick its
// asset from — a hotel with a hundred identically-named "Air Conditioner"
// rows made that dropdown useless for finding the one that broke. Matches
// against name, asset tag and room number, and shows the tag + location
// under each suggestion so two same-named assets are told apart before
// picking either. Unlike CategoryField/VendorField there's no "type a new
// one" path — a work order can only ever point at an asset that already
// exists, so this is a pure picker: the box shows the selected asset's own
// label, and typing searches without changing what's selected until
// something in the list is actually chosen.
function AssetPickerField({ id, assets, selectedId, onPick, disabled }) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(-1);
  const boxRef = useRef(null);

  const selected = assets.find((a) => String(a.id) === String(selectedId)) || null;

  const assetLabel = (asset) =>
    [asset.roomNumber ? `Room ${asset.roomNumber}` : asset.department || asset.floor, asset.assetTag]
      .filter(Boolean)
      .join(' · ');

  useEffect(() => {
    if (!open) return undefined;
    const onDocumentDown = (e) => {
      if (!boxRef.current?.contains(e.target)) {
        setOpen(false);
        setQuery('');
      }
    };
    document.addEventListener('mousedown', onDocumentDown);
    return () => document.removeEventListener('mousedown', onDocumentDown);
  }, [open]);

  const needle = query.trim().toLowerCase();
  const matches = needle
    ? assets.filter(
        (a) =>
          a.name.toLowerCase().includes(needle) ||
          (a.assetTag || '').toLowerCase().includes(needle) ||
          (a.roomNumber || '').toLowerCase().includes(needle)
      )
    : assets;
  const activeIndex = active < matches.length ? active : -1;

  const take = (asset) => {
    setOpen(false);
    setQuery('');
    onPick(asset);
  };

  const onKeyDown = (e) => {
    if (e.key === 'ArrowDown' && !open) {
      setOpen(true);
      return;
    }
    if (!open || matches.length === 0) return;

    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      const step = e.key === 'ArrowDown' ? 1 : -1;
      setActive((activeIndex + step + matches.length) % matches.length);
    } else if (e.key === 'Enter' && activeIndex >= 0) {
      e.preventDefault();
      take(matches[activeIndex]);
    } else if (e.key === 'Escape') {
      setOpen(false);
      setQuery('');
    }
  };

  return (
    <div className="asset-suggest" ref={boxRef}>
      <input
        id={id}
        // The selected asset's own label shows once nothing is being typed —
        // this is what makes the box readable as "here's what's picked"
        // rather than reverting to blank the moment the list closes.
        value={open ? query : selected ? `${selected.name}${selected.assetTag ? ` (${selected.assetTag})` : ''}` : ''}
        placeholder="Search by name, tag or room…"
        role="combobox"
        aria-expanded={open}
        aria-controls={`${id}-suggestions`}
        aria-autocomplete="list"
        aria-activedescendant={activeIndex >= 0 ? `${id}-suggestion-${activeIndex}` : undefined}
        autoComplete="off"
        disabled={disabled}
        onChange={(e) => {
          setQuery(e.target.value);
          setActive(-1);
        }}
        onKeyDown={onKeyDown}
        onFocus={() => setOpen(true)}
        onClick={() => setOpen(true)}
      />
      {open && matches.length > 0 && (
        <ul className="asset-suggest__list" id={`${id}-suggestions`} role="listbox">
          {matches.map((asset, i) => (
            <li key={asset.id} role="option" aria-selected={i === activeIndex} id={`${id}-suggestion-${i}`}>
              <button
                type="button"
                className={`asset-suggest__option${i === activeIndex ? ' asset-suggest__option--active' : ''}`}
                onMouseDown={(e) => {
                  e.preventDefault();
                  take(asset);
                }}
                onMouseEnter={() => setActive(i)}
              >
                {asset.name}
                {assetLabel(asset) && <span className="asset-suggest__option-meta">{assetLabel(asset)}</span>}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

// A styled stand-in for a raw <input type="file">, which every browser
// renders as its own "Choose File" button glued to a text box that ignores
// the app's own field styling entirely. The native input still does the
// picking — it's just visually hidden and triggered by a button that looks
// like every other button in this form — so drag-and-drop, keyboard access
// and the file picker itself are untouched.
function FileField({ id, file, accept, onChange, existingLabel }) {
  const inputRef = useRef(null);
  return (
    <div className="asset-file">
      <input
        ref={inputRef}
        id={id}
        type="file"
        accept={accept}
        className="asset-file__input"
        onChange={(e) => onChange(e.target.files?.[0] || null)}
      />
      <button type="button" className="btn-outline" onClick={() => inputRef.current?.click()}>
        Choose file
      </button>
      <span className={`asset-file__name${file ? '' : ' asset-file__name--empty'}`}>
        {file ? file.name : existingLabel || 'No file chosen'}
      </span>
      {file && (
        <button
          type="button"
          className="asset-file__clear"
          onClick={() => {
            onChange(null);
            if (inputRef.current) inputRef.current.value = '';
          }}
          aria-label="Remove chosen file"
          title="Remove chosen file"
        >
          ×
        </button>
      )}
    </div>
  );
}

export default function AssetsPanel({ onViewReport }) {
  const session = getSession();
  const [searchParams] = useSearchParams();
  const [tab, setTab] = useState('register');

  const [assets, setAssets] = useState(() => readCache('/assets'));
  const [categories, setCategories] = useState(() => readCache('/assets/categories'));
  const [vendors, setVendors] = useState(() => readCache('/assets/vendors'));
  const [rooms, setRooms] = useState(() => readCache('/rooms'));
  const [workOrders, setWorkOrders] = useState(() => readCache('/assets/work-orders'));

  const [error, setError] = useState('');
  const [query, setQuery] = useState('');
  // '' means "every category" — only categories with at least one asset are
  // offered (see categoryFilterOptions), so this never ends up pointed at
  // an empty result on its own.
  const [categoryFilter, setCategoryFilter] = useState('');
  // '' means "every status" — same convention as categoryFilter.
  const [statusFilter, setStatusFilter] = useState('');
  // Retiring an asset drops it from the everyday list (see setAssetStatus on
  // the backend) — this is the escape hatch to find one again, e.g. to
  // un-retire it or check its old service history.
  const [showRetired, setShowRetired] = useState(false);
  // 'cards' is the everyday view — one asset at a time is easy to read on a
  // phone. 'table' is the sheet-style view for someone who wants every
  // asset's warranty/AMC/location on screen at once to scan or compare, the
  // way they'd open a spreadsheet to do the same job.
  const [assetView, setAssetView] = useState('table');
  const [tableSort, setTableSort] = useState({ key: null, dir: 'asc' });
  const [selectedAssetId, setSelectedAssetId] = useState(null);
  // { assetId, workOrders } — keyed by asset so a stale list from the
  // previously open asset never renders as this one's history.
  const [assetHistory, setAssetHistory] = useState(null);
  // { assetId, periods } — same keying, for the warranty/AMC coverage list.
  const [coveragePeriods, setCoveragePeriods] = useState(null);
  // { assetId, expenses } — every expense this asset's purchase/repairs/AMC
  // auto-generated (see asset_id on dbo.expenses, migration 078), so the
  // detail view can show payment status/history without a trip to the
  // Expenses tab. Same load-on-open keying as work orders and coverage.
  const [assetExpenses, setAssetExpenses] = useState(null);
  const [newAssetPayment, setNewAssetPayment] = useState({ amount: '', paymentMethod: 'CASH', referenceNumber: '', paidDate: todayIso() });
  const [assetPaymentError, setAssetPaymentError] = useState('');
  const [addingAssetPayment, setAddingAssetPayment] = useState(false);
  // A scanned QR lands here as ?assetToken=... — read once as the initial
  // selection rather than applied from an effect, so opening the detail view
  // for it doesn't need a setState synchronized against the assets list.
  const [consumedAssetToken, setConsumedAssetToken] = useState(null);

  // One "Register asset" button opens whichever of the two register forms
  // this points at; the toggle in each form's own header switches it (and
  // swaps which form is showing) without closing the dialog first — reads
  // as one modal with two tabs, same pattern as Add room's Single/Bulk
  // range toggle, even though single and bulk stay two separately-rendered
  // forms underneath (they diverge too much past the shared fields — a unit
  // table vs. one set of fields — to merge into one without either mode
  // dragging the other's fields along).
  const [registerMode, setRegisterMode] = useState('single');
  const [showAssetForm, setShowAssetForm] = useState(false);
  const [editingAssetId, setEditingAssetId] = useState(null);
  const [assetForm, setAssetForm] = useState(emptyAssetForm);
  // True while Name still holds what the category/room auto-fill put there —
  // "AC" typed a hundred times is what happens when every asset defaults to
  // its bare category name. Whichever of category or room is picked last
  // fills Name with something already telling that AC apart from the other
  // ninety-nine; typing over it (or opening an existing asset) claims the
  // field and auto-fill stops touching it.
  const [nameAutoFilled, setNameAutoFilled] = useState(true);
  // The chosen bill file for this open/edit of the form — never populated
  // from an existing asset (the server never sends a file back, only
  // hasBillDocument), so it starts null every time the form opens.
  const [billFile, setBillFile] = useState(null);
  // Per-field messages, shown under the offending input rather than in a
  // banner at the top — a banner says something is wrong, a message under
  // the field says what and where, so a hand doesn't have to scan the whole
  // form to find it.
  const [fieldErrors, setFieldErrors] = useState({});

  // --- Bulk register: one purchase, several units --------------------
  const [showBulkForm, setShowBulkForm] = useState(false);
  const [bulkForm, setBulkForm] = useState(emptyBulkForm);
  const [bulkUnits, setBulkUnits] = useState([emptyBulkUnit()]);
  const [bulkBillFile, setBulkBillFile] = useState(null);
  const [bulkError, setBulkError] = useState('');
  const [bulkSubmitting, setBulkSubmitting] = useState(false);
  const [bulkImportError, setBulkImportError] = useState('');
  const [bulkFieldErrors, setBulkFieldErrors] = useState({});
  // Keyed by unit.key rather than index — a row removed mid-form must not
  // leave a stale error pinned to whatever row now sits at that index.
  const [bulkUnitErrors, setBulkUnitErrors] = useState({});

  const [showWoForm, setShowWoForm] = useState(false);
  const [woMode, setWoMode] = useState('single');
  const [editingWoId, setEditingWoId] = useState(null);
  const [woForm, setWoForm] = useState(emptyWorkOrderForm);
  const [woStatusFilter, setWoStatusFilter] = useState('OPEN');
  const [woFieldErrors, setWoFieldErrors] = useState({});

  const [bulkWoForm, setBulkWoForm] = useState(emptyBulkWoForm);
  const [bulkWoSubmitting, setBulkWoSubmitting] = useState(false);
  const [bulkWoError, setBulkWoError] = useState('');
  const [bulkWoFieldErrors, setBulkWoFieldErrors] = useState({});

  const [showVendorForm, setShowVendorForm] = useState(false);
  const [editingVendorId, setEditingVendorId] = useState(null);
  const [vendorForm, setVendorForm] = useState(emptyVendorForm);
  const [vendorFieldErrors, setVendorFieldErrors] = useState({});

  const [showCoverageForm, setShowCoverageForm] = useState(false);
  const [coverageForm, setCoverageForm] = useState(emptyCoverageForm);
  const [coverageSubmitting, setCoverageSubmitting] = useState(false);
  const [coverageError, setCoverageError] = useState('');
  const [coverageFieldErrors, setCoverageFieldErrors] = useState({});
  // Set only when the form opened on an existing period ("Edit"), not a
  // fresh add or a renewal — those two still create a new row.
  const [editingCoveragePeriodId, setEditingCoveragePeriodId] = useState(null);

  const [formError, setFormError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const loadAssets = () =>
    apiGet(`/assets${showRetired ? '?includeInactive=true' : ''}`, { token: session?.token })
      .then((data) => setAssets(writeCache('/assets', data.assets)))
      .catch((err) => setError(err instanceof ApiError ? err.message : 'Could not load assets.'));

  const loadCategories = () =>
    apiGet('/assets/categories', { token: session?.token })
      .then((data) => setCategories(writeCache('/assets/categories', data.categories)))
      .catch(() => {});

  const loadVendors = () =>
    apiGet('/assets/vendors', { token: session?.token })
      .then((data) => setVendors(writeCache('/assets/vendors', data.vendors)))
      .catch(() => {});

  const loadRooms = () =>
    apiGet('/rooms', { token: session?.token })
      .then((data) => setRooms(writeCache('/rooms', data.rooms)))
      .catch(() => {});

  const loadWorkOrders = () =>
    apiGet('/assets/work-orders', { token: session?.token })
      .then((data) => setWorkOrders(writeCache('/assets/work-orders', data.workOrders)))
      .catch((err) => setError(err instanceof ApiError ? err.message : 'Could not load work orders.'));

  useEffect(() => {
    loadAssets();
    loadCategories();
    loadVendors();
    loadRooms();
    loadWorkOrders();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    loadAssets();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showRetired]);

  // Resolved at render rather than in an effect: the token names an asset
  // that may not have loaded yet, and re-deriving here needs no setState.
  const scannedToken = searchParams.get('assetToken');
  const selectedAsset =
    (scannedToken &&
      scannedToken !== consumedAssetToken &&
      assets?.find((a) => a.qrToken === scannedToken)) ||
    assets?.find((a) => a.id === selectedAssetId) ||
    null;

  // Only categories an asset is actually filed under, each with how many —
  // a lodge that created "Fire Safety" while trying out the picker but never
  // registered one has no reason to see it clutter this list.
  const categoryFilterOptions = useMemo(() => {
    if (!assets) return [];
    const counts = new Map();
    for (const a of assets) {
      counts.set(a.categoryId, { name: a.categoryName, count: (counts.get(a.categoryId)?.count || 0) + 1 });
    }
    return Array.from(counts.entries())
      .map(([id, { name, count }]) => ({ id, name, count }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [assets]);

  const visibleAssets = useMemo(() => {
    if (!assets) return [];
    const needle = query.trim().toLowerCase();
    return assets.filter((a) => {
      if (categoryFilter && String(a.categoryId) !== categoryFilter) return false;
      if (statusFilter && a.status !== statusFilter) return false;
      if (!needle) return true;
      return (
        a.name.toLowerCase().includes(needle) ||
        (a.assetTag || '').toLowerCase().includes(needle) ||
        (a.roomNumber || '').toLowerCase().includes(needle) ||
        (a.department || '').toLowerCase().includes(needle)
      );
    });
  }, [assets, query, categoryFilter, statusFilter]);

  const sortedAssets = useMemo(() => {
    if (!tableSort.key) return visibleAssets;
    const accessor = TABLE_SORT_ACCESSORS[tableSort.key];
    if (!accessor) return visibleAssets;
    const dir = tableSort.dir === 'desc' ? -1 : 1;
    return [...visibleAssets].sort((a, b) => {
      const av = accessor(a);
      const bv = accessor(b);
      // Null/empty dates and text sink to the bottom regardless of direction —
      // "no warranty on file" isn't meaningfully before or after a real date.
      const aEmpty = av === null || av === '';
      const bEmpty = bv === null || bv === '';
      if (aEmpty && bEmpty) return 0;
      if (aEmpty) return 1;
      if (bEmpty) return -1;
      if (typeof av === 'number' && typeof bv === 'number') return (av - bv) * dir;
      return String(av).localeCompare(String(bv)) * dir;
    });
  }, [visibleAssets, tableSort]);

  const toggleTableSort = (key) => {
    setTableSort((prev) => {
      if (prev.key !== key) return { key, dir: 'asc' };
      if (prev.dir === 'asc') return { key, dir: 'desc' };
      return { key: null, dir: 'asc' };
    });
  };

  const visibleWorkOrders = useMemo(() => {
    if (!workOrders) return [];
    if (!woStatusFilter) return workOrders;
    return workOrders.filter((w) => w.status === woStatusFilter);
  }, [workOrders, woStatusFilter]);

  const openWoCount = (workOrders || []).filter((w) => w.status !== 'CLOSED').length;

  // ---------------------------------------------------------------------
  // Asset form
  // ---------------------------------------------------------------------

  const openAssetForm = (asset) => {
    setEditingAssetId(asset?.id ?? null);
    // The asset's own vendor summary (name only) doesn't carry contact
    // details, so they're looked up from the loaded vendor list — the same
    // list VendorField itself suggests from.
    const vendor = asset?.vendorId ? (vendors || []).find((v) => v.id === asset.vendorId) : null;
    setAssetForm(
      asset
        ? {
            name: asset.name,
            categoryName: asset.categoryName || '',
            brand: asset.brand || '',
            model: asset.model || '',
            serialNumber: asset.serialNumber || '',
            purchaseDate: asset.purchaseDate ? asset.purchaseDate.slice(0, 10) : '',
            purchaseCost: asset.purchaseCost ?? '',
            // Not stored on the asset itself (see assets.schema.js's
            // paymentMethodSchema note) and not read back from it either —
            // editing an asset's purchase details never had a payment
            // record to restore, so this always resets to the same default
            // a fresh registration starts with rather than being left
            // undefined, which the "Paid via" <select> can't represent.
            paymentMethod: 'CASH',
            paymentStatus: 'PAID',
            amountPaid: '',
            referenceNumber: '',
            roomId: asset.roomId ? String(asset.roomId) : '',
            floor: asset.floor || '',
            department: asset.department || '',
            locationNote: asset.locationNote || '',
            vendorId: asset.vendorId ? String(asset.vendorId) : '',
            vendorName: asset.vendorName || '',
            vendorContactPerson: vendor?.contactPerson || '',
            vendorPhone: vendor?.phone || '',
            vendorAltPhone: vendor?.altPhone || '',
            vendorEmail: vendor?.email || '',
            vendorSpecialty: vendor?.specialty || '',
            // Not read back for editing — warrantyExpiry only means
            // anything on a fresh Register form (see the field above);
            // this key stays on the object shape so emptyAssetForm and an
            // asset-derived form always have the same fields.
            warrantyExpiry: '',
          }
        : emptyAssetForm
    );
    // Editing a saved asset always keeps its own name; a fresh form starts
    // auto-filled until the person types into Name themselves.
    setNameAutoFilled(!asset);
    setBillFile(null);
    setFormError('');
    setFieldErrors({});
    setRegisterMode('single');
    setShowBulkForm(false);
    setShowAssetForm(true);
  };

  // No algorithm turns "Installed at the middle Lobby of 2nd floor" into a
  // good short name — it has no way to know "Lobby" is the word that
  // matters. The field's own hint asks for a short label rather than a
  // sentence, so this only has to handle the case where a sentence shows up
  // anyway: past AUTO_NAME_LOCATION_MAX, the location is left out of the
  // name entirely (Name falls back to the category alone) rather than
  // shown as a truncated fragment nobody could use to tell two assets
  // apart in the register list — short and true beats short and wrong.
  const AUTO_NAME_LOCATION_MAX = 24;
  const clipForName = (text) => (text.length <= AUTO_NAME_LOCATION_MAX ? text : '');

  // Room number if the asset is room-bound, otherwise whatever location text
  // is filled in — the same fallback order the register list itself uses.
  const autoLocationLabel = (form) => {
    if (form.roomId) {
      const room = (rooms || []).find((r) => String(r.id) === String(form.roomId));
      return room ? `Room ${room.roomNumber}` : '';
    }
    const location = form.department.trim() || (form.floor.trim() ? `Floor ${form.floor.trim()}` : '');
    return clipForName(location);
  };

  // Name from category + location, recomputed at render rather than synced
  // into state — this is what stops a hundred ACs from all being named "AC":
  // the moment a room is picked, the field reads "Air Conditioner – Room
  // 204" without anyone having to type it. Category leads because that's
  // what the asset *is*; the location is a qualifier after it, the way a
  // label reads rather than a sentence — "In the kitchen Air Conditioner"
  // is location-first prose, "Air Conditioner – In the kitchen" is a name.
  // Used only while nameAutoFilled is true; typing into Name claims the
  // field (see the input below) and this stops applying.
  const autoAssetName = (form) => {
    const location = autoLocationLabel(form);
    const category = form.categoryName.trim();
    return location ? `${category} – ${location}` : category;
  };
  const displayedAssetName = nameAutoFilled ? autoAssetName(assetForm) || assetForm.name : assetForm.name;

  // Resolves the typed category name to an id, creating the category first if
  // nothing on file matches it — the register form is the only place a
  // category gets named, so naming a new one here has to be as cheap as
  // picking an existing one.
  const resolveCategoryId = async (name) => {
    const trimmed = name.trim();
    const existing = categories.find((c) => c.name.toLowerCase() === trimmed.toLowerCase());
    if (existing) return existing.id;

    const created = await apiPost('/assets/categories', { name: trimmed }, { token: session?.token });
    await loadCategories();
    return created.category.id;
  };

  // Same idea as resolveCategoryId: a vendor picked from the suggestion list
  // already has an id (assetForm.vendorId), so this only reaches the network
  // for a name typed fresh — matched by name first in case it was typed
  // exactly rather than picked, then created from whatever detail fields
  // were filled in.
  const resolveVendorId = async (form) => {
    if (!form.vendorName.trim()) return null;
    if (form.vendorId) return Number(form.vendorId);

    const trimmed = form.vendorName.trim();
    const existing = (vendors || []).find((v) => v.name.toLowerCase() === trimmed.toLowerCase());
    if (existing) return existing.id;

    const created = await apiPost(
      '/assets/vendors',
      {
        name: trimmed,
        contactPerson: form.vendorContactPerson,
        phone: form.vendorPhone,
        altPhone: form.vendorAltPhone,
        email: form.vendorEmail,
        specialty: form.vendorSpecialty,
      },
      { token: session?.token }
    );
    await loadVendors();
    return created.vendor.id;
  };

  const handleAssetSubmit = async (e) => {
    e.preventDefault();
    const name = displayedAssetName.trim();
    const errors = {};
    if (!name) errors.name = 'Asset name is required.';
    if (!assetForm.categoryName.trim()) errors.categoryName = 'Enter or choose a category.';
    if (assetForm.vendorPhone && !/^[6-9]\d{9}$/.test(assetForm.vendorPhone)) {
      errors.vendorPhone = 'Enter a valid 10-digit mobile number.';
    } else if (assetForm.vendorPhone) {
      const clash = (vendors || []).find(
        (v) => String(v.id) !== assetForm.vendorId && (v.phone || '') === assetForm.vendorPhone
      );
      if (clash) errors.vendorPhone = `This number is already used by vendor "${clash.name}".`;
    }
    if (assetForm.vendorAltPhone && !/^[6-9]\d{9}$/.test(assetForm.vendorAltPhone)) {
      errors.vendorAltPhone = 'Enter a valid 10-digit mobile number.';
    }
    setFieldErrors(errors);
    if (Object.keys(errors).length > 0) {
      focusFirstError(errors, {
        categoryName: 'assetCategory',
        name: 'assetName',
        vendorPhone: 'assetVendorPhone',
        vendorAltPhone: 'assetVendorAltPhone',
      });
      return;
    }

    setSubmitting(true);
    setFormError('');
    try {
      const categoryId = await resolveCategoryId(assetForm.categoryName);
      const vendorId = await resolveVendorId(assetForm);
      // Listed explicitly rather than spreading assetForm — the inline
      // vendor-detail fields (vendorName, vendorContactPerson, …) aren't
      // asset columns, they only exist to feed resolveVendorId above.
      const body = {
        name,
        categoryId,
        brand: assetForm.brand,
        model: assetForm.model,
        serialNumber: assetForm.serialNumber,
        purchaseDate: assetForm.purchaseDate,
        purchaseCost: assetForm.purchaseCost,
        paymentMethod: assetForm.paymentMethod,
        paymentStatus: assetForm.paymentStatus,
        amountPaid: assetForm.paymentStatus === 'PARTIAL' ? assetForm.amountPaid : '',
        referenceNumber: assetForm.paymentStatus !== 'PENDING' ? assetForm.referenceNumber : '',
        roomId: assetForm.roomId || '',
        floor: assetForm.floor,
        department: assetForm.department,
        locationNote: assetForm.locationNote,
        vendorId: vendorId ?? '',
        // Only meaningful at registration — the server ignores it on an
        // edit anyway, but leaving it out here matches what the form
        // actually shows (see the field above).
        ...(editingAssetId ? {} : { warrantyExpiry: assetForm.warrantyExpiry }),
      };
      // Multipart, not JSON, so the bill file can ride along in the same
      // request — every other field goes as a plain form field and is
      // coerced from a string server-side exactly as it already was.
      const formData = new FormData();
      Object.entries(body).forEach(([key, value]) => {
        formData.append(key, value ?? '');
      });
      if (billFile) formData.append('billDocument', billFile);

      if (editingAssetId) {
        await apiPatchForm(`/assets/${editingAssetId}`, formData, { token: session?.token });
      } else {
        await apiPostForm('/assets', formData, { token: session?.token });
      }
      setShowAssetForm(false);
      await loadAssets();
    } catch (err) {
      setFormError(err instanceof ApiError ? err.message : 'Could not save that asset. Try again.');
    } finally {
      setSubmitting(false);
    }
  };

  // ---------------------------------------------------------------------
  // Bulk register: one purchase, several units
  // ---------------------------------------------------------------------

  const openBulkForm = () => {
    setBulkForm(emptyBulkForm);
    setBulkUnits([emptyBulkUnit()]);
    setBulkBillFile(null);
    setBulkError('');
    setBulkImportError('');
    setBulkFieldErrors({});
    setBulkUnitErrors({});
    setRegisterMode('bulk');
    setShowAssetForm(false);
    setShowBulkForm(true);
  };

  // The toggle in either form's header — switches which one is open without
  // the person having to close and reopen from the tab row. Each open*
  // function already resets its own form to a blank slate, so switching
  // modes never carries stale state from single into bulk or back.
  const switchRegisterMode = (mode) => {
    if (mode === 'bulk') openBulkForm();
    else openAssetForm(null);
  };

  const addBulkUnit = () => setBulkUnits((rows) => [...rows, emptyBulkUnit()]);
  const removeBulkUnit = (key) => {
    setBulkUnits((rows) => (rows.length > 1 ? rows.filter((r) => r.key !== key) : rows));
    setBulkUnitErrors((errs) => {
      if (!(key in errs)) return errs;
      const next = { ...errs };
      delete next[key];
      return next;
    });
  };
  const updateBulkUnit = (key, patch) => {
    setBulkUnits((rows) => rows.map((r) => (r.key === key ? { ...r, ...patch } : r)));
    setBulkUnitErrors((errs) => {
      if (!(key in errs)) return errs;
      const next = { ...errs };
      delete next[key];
      return next;
    });
  };

  // Same composition as autoAssetName, but the category lives on the shared
  // form while room/floor/location live on the unit — bulk splits what a
  // single asset keeps in one object.
  const bulkUnitName = (unit) => {
    if (unit.name.trim()) return unit.name.trim();
    const location = autoLocationLabel(unit);
    const category = bulkForm.categoryName.trim();
    return location ? `${category} – ${location}` : category;
  };

  // A CSV a spreadsheet actually round-trips: the room column is the number
  // typed into a cell, not a room id nobody filling the sheet would know —
  // matched back to a room by number at submit time, per unit.
  const downloadBulkTemplate = () => {
    const rows = [BULK_TEMPLATE_HEADERS, ...bulkUnits.map((u) => [u.name, u.serialNumber, '', u.floor, u.department])];
    const csv = rows
      .map((row) => row.map((cell) => `"${String(cell ?? '').replace(/"/g, '""')}"`).join(','))
      .join('\r\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = 'asset-bulk-template.csv';
    link.click();
    URL.revokeObjectURL(url);
  };

  function parseCsv(text) {
    // A small hand-rolled parser rather than a library: quoted fields with
    // escaped "" are the one thing split(',') gets wrong, and that's the
    // only CSV feature this needs.
    const rows = [];
    let row = [];
    let field = '';
    let inQuotes = false;
    for (let i = 0; i < text.length; i += 1) {
      const c = text[i];
      if (inQuotes) {
        if (c === '"' && text[i + 1] === '"') {
          field += '"';
          i += 1;
        } else if (c === '"') {
          inQuotes = false;
        } else {
          field += c;
        }
      } else if (c === '"') {
        inQuotes = true;
      } else if (c === ',') {
        row.push(field);
        field = '';
      } else if (c === '\n' || c === '\r') {
        if (c === '\r' && text[i + 1] === '\n') i += 1;
        row.push(field);
        rows.push(row);
        row = [];
        field = '';
      } else {
        field += c;
      }
    }
    if (field !== '' || row.length > 0) {
      row.push(field);
      rows.push(row);
    }
    return rows.filter((r) => r.some((cell) => cell.trim() !== ''));
  }

  const importBulkTemplate = async (file) => {
    setBulkImportError('');
    try {
      const text = await file.text();
      const rows = parseCsv(text);
      if (rows.length === 0) {
        setBulkImportError('That file has no rows.');
        return;
      }
      // The header row is skipped by position, not by matching its text —
      // asking a hotel to keep column headers byte-for-byte identical to
      // download the sheet, fill it in Excel, and upload it again is a
      // fragile promise; the column order is the actual contract.
      const dataRows = rows[0].some((cell) => /name|room|floor|location/i.test(cell)) ? rows.slice(1) : rows;
      if (dataRows.length === 0) {
        setBulkImportError('That file has a header row but no data.');
        return;
      }
      if (dataRows.length > 200) {
        setBulkImportError('That’s a lot for one batch (200 max) — split it into two files.');
        return;
      }

      const unmatchedRooms = [];
      const imported = dataRows.map(([name, serialNumber, roomNumber, floor, department], index) => {
        const trimmedRoom = (roomNumber || '').trim();
        const room = trimmedRoom ? (rooms || []).find((r) => r.roomNumber === trimmedRoom) : null;
        if (trimmedRoom && !room) unmatchedRooms.push(`row ${index + 1} (“${trimmedRoom}”)`);
        return {
          key: emptyBulkUnit().key,
          name: (name || '').trim(),
          serialNumber: (serialNumber || '').trim(),
          roomId: room ? String(room.id) : '',
          floor: (floor || '').trim(),
          department: (department || '').trim(),
          locationNote: '',
        };
      });

      setBulkUnits(imported);
      setBulkImportError(
        unmatchedRooms.length > 0
          ? `Imported ${imported.length} row${imported.length === 1 ? '' : 's'}. Room number not found for ${unmatchedRooms.join(', ')} — pick it by hand or leave it not room-bound.`
          : ''
      );
    } catch {
      setBulkImportError('Could not read that file. Make sure it’s the CSV template, unedited apart from the rows.');
    }
  };

  const handleBulkSubmit = async (e) => {
    e.preventDefault();
    const errors = {};
    if (!bulkForm.categoryName.trim()) errors.categoryName = 'Enter or choose a category.';
    setBulkFieldErrors(errors);

    const unitErrors = {};
    for (const unit of bulkUnits) {
      if (!bulkUnitName(unit).trim()) {
        unitErrors[unit.key] = 'Needs a room, a location, or a name to tell it apart from the others.';
      }
    }
    setBulkUnitErrors(unitErrors);

    if (Object.keys(errors).length > 0) {
      focusFirstError(errors, { categoryName: 'bulkCategory' });
      return;
    }
    if (Object.keys(unitErrors).length > 0) {
      // The row itself has no single input id to focus — different units
      // fail for different reasons (no room, no name) — so this scrolls to
      // the row rather than a field inside it.
      document.getElementById(`bulk-unit-row-${Object.keys(unitErrors)[0]}`)?.scrollIntoView({
        block: 'center',
        behavior: 'smooth',
      });
      return;
    }

    setBulkSubmitting(true);
    setBulkError('');
    try {
      const categoryId = await resolveCategoryId(bulkForm.categoryName);
      const vendorId = await resolveVendorId(bulkForm);
      const units = bulkUnits.map((u) => ({
        name: bulkUnitName(u),
        serialNumber: u.serialNumber,
        roomId: u.roomId || '',
        floor: u.floor,
        department: u.department,
        locationNote: u.locationNote,
      }));

      const formData = new FormData();
      formData.append('categoryId', categoryId);
      formData.append('brand', bulkForm.brand);
      formData.append('model', bulkForm.model);
      formData.append('purchaseDate', bulkForm.purchaseDate);
      formData.append('purchaseCost', bulkForm.purchaseCost ?? '');
      formData.append('paymentMethod', bulkForm.paymentMethod);
      formData.append('paymentStatus', bulkForm.paymentStatus);
      formData.append('amountPaid', bulkForm.paymentStatus === 'PARTIAL' ? bulkForm.amountPaid : '');
      formData.append('referenceNumber', bulkForm.paymentStatus !== 'PENDING' ? bulkForm.referenceNumber : '');
      formData.append('vendorId', vendorId ?? '');
      formData.append('warrantyExpiry', bulkForm.warrantyExpiry);
      formData.append('units', JSON.stringify(units));
      if (bulkBillFile) formData.append('billDocument', bulkBillFile);

      await apiPostForm('/assets/bulk', formData, { token: session?.token });
      setShowBulkForm(false);
      await loadAssets();
    } catch (err) {
      setBulkError(err instanceof ApiError ? err.message : 'Could not save these assets. Try again.');
    } finally {
      setBulkSubmitting(false);
    }
  };

  const changeAssetStatus = async (asset, status) => {
    try {
      await apiPatch(`/assets/${asset.id}/status`, { status }, { token: session?.token });
      // selectedAsset is derived from the assets list, so refetching it is
      // what updates the open detail view too.
      await loadAssets();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not update that asset.');
    }
  };

  // Soft-delete on the backend (setAssetActive false) — the row and its work
  // order history stay intact, same as retiring. This is the explicit "get
  // rid of it" action for something that was never real (a duplicate entry, a
  // typo'd registration) rather than the everyday end-of-life path, which is
  // the Retired status.
  const deleteAsset = async (asset) => {
    if (!window.confirm(`Delete "${asset.name}"? Its service history is kept, but it won't show in the register.`)) {
      return;
    }
    try {
      await apiDelete(`/assets/${asset.id}`, { token: session?.token });
      if (selectedAssetId === asset.id) setSelectedAssetId(null);
      await loadAssets();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not delete that asset.');
    }
  };

  const closeAssetDetail = () => {
    if (scannedToken) setConsumedAssetToken(scannedToken);
    setSelectedAssetId(null);
  };

  const openAssetDetail = (asset) => {
    if (scannedToken) setConsumedAssetToken(scannedToken);
    setSelectedAssetId(asset.id);
  };

  // Opened in a new tab rather than downloaded straight away — a bill is
  // read more often than it's saved, and the browser's own viewer (or its
  // save button) covers the rest without a bespoke modal for one file.
  const viewBill = async (asset) => {
    try {
      const blob = await apiGetBlob(`/assets/${asset.id}/bill`, { token: session?.token });
      const url = URL.createObjectURL(blob);
      window.open(url, '_blank');
      setTimeout(() => URL.revokeObjectURL(url), 60000);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not open that bill.');
    }
  };

  // Loads the service history whenever the open asset changes, however it was
  // opened — a row click or a scanned QR token resolved straight to it.
  useEffect(() => {
    if (!selectedAsset) return undefined;
    let ignore = false;
    const assetId = selectedAsset.id;
    apiGet(`/assets/work-orders?assetId=${assetId}`, { token: session?.token })
      .then((data) => {
        if (!ignore) setAssetHistory({ assetId, workOrders: data.workOrders });
      })
      .catch(() => {
        if (!ignore) setAssetHistory({ assetId, workOrders: [] });
      });
    return () => {
      ignore = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedAsset?.id]);

  const visibleAssetHistory =
    assetHistory && selectedAsset && assetHistory.assetId === selectedAsset.id ? assetHistory.workOrders : null;

  // Same load-on-open shape as service history, for the warranty/AMC record
  // — the two flat dates on the asset are a cache of whichever row here ends
  // latest; this is the full list behind them.
  useEffect(() => {
    if (!selectedAsset) return undefined;
    let ignore = false;
    const assetId = selectedAsset.id;
    apiGet(`/assets/${assetId}/coverage`, { token: session?.token })
      .then((data) => {
        if (!ignore) setCoveragePeriods({ assetId, periods: data.periods });
      })
      .catch(() => {
        if (!ignore) setCoveragePeriods({ assetId, periods: [] });
      });
    return () => {
      ignore = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedAsset?.id]);

  const visibleCoveragePeriods =
    coveragePeriods && selectedAsset && coveragePeriods.assetId === selectedAsset.id
      ? coveragePeriods.periods
      : null;

  // Same load-on-open shape as service history and coverage — every expense
  // this asset generated (purchase, repairs, AMC), so payment status/history
  // shows without leaving the Assets tab.
  useEffect(() => {
    if (!selectedAsset) return undefined;
    let ignore = false;
    const assetId = selectedAsset.id;
    apiGet(`/expenses?assetId=${assetId}`, { token: session?.token })
      .then((data) => {
        if (!ignore) setAssetExpenses({ assetId, expenses: data.expenses });
      })
      .catch(() => {
        if (!ignore) setAssetExpenses({ assetId, expenses: [] });
      });
    return () => {
      ignore = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedAsset?.id]);

  const visibleAssetExpenses =
    assetExpenses && selectedAsset && assetExpenses.assetId === selectedAsset.id ? assetExpenses.expenses : null;

  // The purchase expense specifically — repairs/AMC also carry asset_id, but
  // "the asset's own payment status" means what's owed on buying it, and a
  // purchase expense's title always starts "Asset purchase:" (see
  // logAssetExpense's call sites in assets.service.js).
  const purchaseExpense = visibleAssetExpenses?.find((e) => e.title.startsWith('Asset purchase:')) || null;

  // The purchase expense's own payment history — separate state from the
  // expense summary above since it needs its own fetch (GET
  // /expenses/:id/payments), keyed by the purchase expense's id rather than
  // the asset's, so switching assets never shows the previous one's list.
  const [purchasePayments, setPurchasePayments] = useState(null);

  useEffect(() => {
    if (!purchaseExpense) {
      setPurchasePayments(null);
      return undefined;
    }
    let ignore = false;
    const expenseId = purchaseExpense.id;
    apiGet(`/expenses/${expenseId}/payments`, { token: session?.token })
      .then((data) => {
        if (!ignore) setPurchasePayments({ expenseId, payments: data.payments });
      })
      .catch(() => {
        if (!ignore) setPurchasePayments({ expenseId, payments: [] });
      });
    return () => {
      ignore = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [purchaseExpense?.id]);

  const visiblePurchasePayments =
    purchasePayments && purchaseExpense && purchasePayments.expenseId === purchaseExpense.id
      ? purchasePayments.payments
      : null;

  const reloadAssetExpenses = async () => {
    if (!selectedAsset) return;
    const data = await apiGet(`/expenses?assetId=${selectedAsset.id}`, { token: session?.token }).catch(() => null);
    if (!data) return;
    setAssetExpenses({ assetId: selectedAsset.id, expenses: data.expenses });
    const nextPurchase = data.expenses.find((e) => e.title.startsWith('Asset purchase:'));
    if (nextPurchase) {
      const paymentsData = await apiGet(`/expenses/${nextPurchase.id}/payments`, { token: session?.token }).catch(() => null);
      if (paymentsData) setPurchasePayments({ expenseId: nextPurchase.id, payments: paymentsData.payments });
    }
  };

  const handleAddAssetPayment = async (e) => {
    e.preventDefault();
    if (!purchaseExpense) return;
    if (!newAssetPayment.amount || Number(newAssetPayment.amount) <= 0) {
      setAssetPaymentError('Enter a valid amount.');
      return;
    }
    if (!newAssetPayment.paidDate) {
      setAssetPaymentError('Enter when this was paid.');
      return;
    }

    setAddingAssetPayment(true);
    setAssetPaymentError('');
    try {
      await apiPost(`/expenses/${purchaseExpense.id}/payments`, newAssetPayment, { token: session?.token });
      setNewAssetPayment({ amount: '', paymentMethod: 'CASH', referenceNumber: '', paidDate: todayIso() });
      await reloadAssetExpenses();
    } catch (err) {
      setAssetPaymentError(err instanceof ApiError ? err.message : 'Could not add that payment.');
    } finally {
      setAddingAssetPayment(false);
    }
  };

  const handleDeleteAssetPayment = async (payment) => {
    if (!purchaseExpense) return;
    if (!window.confirm(`Remove this ${formatPrice(payment.amount)} payment?`)) return;
    try {
      await apiDelete(`/expenses/${purchaseExpense.id}/payments/${payment.id}`, { token: session?.token });
      await reloadAssetExpenses();
    } catch (err) {
      setAssetPaymentError(err instanceof ApiError ? err.message : 'Could not remove that payment.');
    }
  };

  // Whoever is on the hook for this asset right now — the AMC vendor if
  // there's a live one, otherwise whoever gave the warranty, otherwise
  // nobody. Coverage periods are sorted end_date DESC by the API, so the
  // first non-expired row of each type is that type's current one; AMC is
  // checked first because an asset under an active AMC is contractually
  // that vendor's problem even if the maker's warranty technically hasn't
  // lapsed yet.
  const resolveActiveCoverageVendor = async (assetId) => {
    try {
      const { periods } = await apiGet(`/assets/${assetId}/coverage`, { token: session?.token });
      const today = new Date().toISOString().slice(0, 10);
      const current = (type) =>
        periods.find((p) => p.coverageType === type && p.vendorId && p.endDate?.slice(0, 10) >= today);
      return current('AMC') || current('WARRANTY') || null;
    } catch {
      return null;
    }
  };

  const reportIssue = async (asset) => {
    const vendor = await resolveActiveCoverageVendor(asset.id);
    setWoForm({ ...emptyWorkOrderForm, assetId: String(asset.id), vendorId: vendor ? String(vendor.vendorId) : '' });
    setEditingWoId(null);
    setFormError('');
    setWoFieldErrors({});
    setShowWoForm(true);
  };

  // ---------------------------------------------------------------------
  // Coverage: warranty, then AMC, then AMC renewed
  // ---------------------------------------------------------------------

  // renewFrom, when given, is the period that's lapsing — its vendor and
  // type carry over so extending an AMC is just picking new dates, not
  // re-typing who covers it. Left out for "Add coverage" from a blank slate.
  const openCoverageForm = (renewFrom) => {
    setEditingCoveragePeriodId(null);
    setCoverageForm(
      renewFrom
        ? {
            ...emptyCoverageForm,
            coverageType: renewFrom.coverageType,
            vendorId: renewFrom.vendorId ? String(renewFrom.vendorId) : '',
            vendorName: renewFrom.vendorName || '',
            startDate: renewFrom.endDate ? renewFrom.endDate.slice(0, 10) : '',
          }
        : emptyCoverageForm
    );
    setCoverageError('');
    setCoverageFieldErrors({});
    setShowCoverageForm(true);
  };

  // Corrects a period already on file, rather than adding a new one — same
  // vendor-detail lookup openAssetForm does, since the period only carries
  // vendorId/vendorName.
  const openCoverageEditForm = (period) => {
    setEditingCoveragePeriodId(period.id);
    const vendor = period.vendorId ? (vendors || []).find((v) => v.id === period.vendorId) : null;
    setCoverageForm({
      coverageType: period.coverageType,
      vendorId: period.vendorId ? String(period.vendorId) : '',
      vendorName: period.vendorName || '',
      vendorContactPerson: vendor?.contactPerson || '',
      vendorPhone: vendor?.phone || '',
      vendorAltPhone: vendor?.altPhone || '',
      vendorEmail: vendor?.email || '',
      vendorSpecialty: vendor?.specialty || '',
      startDate: period.startDate ? period.startDate.slice(0, 10) : '',
      endDate: period.endDate ? period.endDate.slice(0, 10) : '',
      cost: period.cost ?? '',
      paymentMethod: 'CASH',
      paymentStatus: 'PAID',
      amountPaid: '',
      referenceNumber: '',
      coverageNote: period.coverageNote || '',
    });
    setCoverageError('');
    setCoverageFieldErrors({});
    setShowCoverageForm(true);
  };

  const handleCoverageSubmit = async (e) => {
    e.preventDefault();
    const errors = {};
    if (!coverageForm.endDate) errors.endDate = 'Enter when this coverage ends.';
    setCoverageFieldErrors(errors);
    if (Object.keys(errors).length > 0) {
      focusFirstError(errors, { endDate: 'coverageEnd' });
      return;
    }
    if (!selectedAsset) return;

    setCoverageSubmitting(true);
    setCoverageError('');
    try {
      const vendorId = await resolveVendorId(coverageForm);
      const body = {
        coverageType: coverageForm.coverageType,
        vendorId: vendorId ?? '',
        startDate: coverageForm.startDate,
        endDate: coverageForm.endDate,
        cost: coverageForm.cost,
        paymentMethod: coverageForm.paymentMethod,
        paymentStatus: coverageForm.paymentStatus,
        amountPaid: coverageForm.paymentStatus === 'PARTIAL' ? coverageForm.amountPaid : '',
        referenceNumber: coverageForm.paymentStatus !== 'PENDING' ? coverageForm.referenceNumber : '',
        coverageNote: coverageForm.coverageNote,
      };
      if (editingCoveragePeriodId) {
        await apiPatch(`/assets/${selectedAsset.id}/coverage/${editingCoveragePeriodId}`, body, {
          token: session?.token,
        });
      } else {
        await apiPost(`/assets/${selectedAsset.id}/coverage`, body, { token: session?.token });
      }
      setShowCoverageForm(false);
      const [periodsData] = await Promise.all([
        apiGet(`/assets/${selectedAsset.id}/coverage`, { token: session?.token }),
        loadAssets(),
      ]);
      setCoveragePeriods({ assetId: selectedAsset.id, periods: periodsData.periods });
    } catch (err) {
      setCoverageError(err instanceof ApiError ? err.message : 'Could not save that coverage period. Try again.');
    } finally {
      setCoverageSubmitting(false);
    }
  };

  const deleteCoveragePeriod = async (period) => {
    if (!selectedAsset) return;
    if (!window.confirm(`Delete this ${period.coverageType === 'AMC' ? 'AMC' : 'warranty'} record?`)) return;
    try {
      await apiDelete(`/assets/${selectedAsset.id}/coverage/${period.id}`, { token: session?.token });
      const [periodsData] = await Promise.all([
        apiGet(`/assets/${selectedAsset.id}/coverage`, { token: session?.token }),
        loadAssets(),
      ]);
      setCoveragePeriods({ assetId: selectedAsset.id, periods: periodsData.periods });
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not delete that coverage period.');
    }
  };

  // ---------------------------------------------------------------------
  // Work order form
  // ---------------------------------------------------------------------

  const openWoForm = (workOrder) => {
    setEditingWoId(workOrder?.id ?? null);
    setWoForm(
      workOrder
        ? {
            assetId: String(workOrder.assetId),
            issueType: workOrder.issueType,
            description: workOrder.description,
            assignedToName: workOrder.assignedToName || '',
            vendorId: workOrder.vendorId ? String(workOrder.vendorId) : '',
            status: workOrder.status,
            partsCost: workOrder.partsCost ?? '',
            laborCost: workOrder.laborCost ?? '',
            paymentMethod: 'CASH',
            paymentStatus: 'PAID',
            amountPaid: '',
            referenceNumber: '',
            partsUsedNote: workOrder.partsUsedNote || '',
            isWarrantyClaim: workOrder.isWarrantyClaim,
            resolutionNote: workOrder.resolutionNote || '',
          }
        : emptyWorkOrderForm
    );
    setWoMode('single');
    setFormError('');
    setWoFieldErrors({});
    setShowWoForm(true);
  };

  const openBulkWoForm = () => {
    setEditingWoId(null);
    setBulkWoForm(emptyBulkWoForm);
    setWoMode('bulk');
    setBulkWoError('');
    setBulkWoFieldErrors({});
    setShowWoForm(true);
  };

  // Same idea as switchRegisterMode on the asset form — the toggle swaps
  // which body/footer is showing without closing the modal, and each side
  // resets its own form so leftover state never crosses over.
  const switchWoMode = (mode) => {
    if (mode === 'bulk') openBulkWoForm();
    else openWoForm(null);
  };

  const handleWoSubmit = async (e) => {
    e.preventDefault();
    const errors = {};
    if (!woForm.assetId) errors.assetId = 'Choose an asset.';
    if (!woForm.description.trim()) errors.description = 'Describe the issue.';
    setWoFieldErrors(errors);
    if (Object.keys(errors).length > 0) {
      focusFirstError(errors, { assetId: 'woAsset', description: 'woDescription' });
      return;
    }

    setSubmitting(true);
    setFormError('');
    try {
      if (editingWoId) {
        await apiPatch(
          `/assets/work-orders/${editingWoId}`,
          {
            status: woForm.status,
            issueType: woForm.issueType,
            description: woForm.description,
            assignedToName: woForm.assignedToName,
            vendorId: woForm.vendorId ? Number(woForm.vendorId) : null,
            partsCost: woForm.partsCost === '' ? null : Number(woForm.partsCost),
            laborCost: woForm.laborCost === '' ? null : Number(woForm.laborCost),
            paymentMethod: woForm.paymentMethod,
            paymentStatus: woForm.paymentStatus,
            amountPaid: woForm.paymentStatus === 'PARTIAL' ? woForm.amountPaid : '',
            referenceNumber: woForm.paymentStatus !== 'PENDING' ? woForm.referenceNumber : '',
            partsUsedNote: woForm.partsUsedNote,
            isWarrantyClaim: Boolean(woForm.isWarrantyClaim),
            resolutionNote: woForm.resolutionNote,
          },
          { token: session?.token }
        );
      } else {
        await apiPost(
          '/assets/work-orders',
          {
            assetId: Number(woForm.assetId),
            issueType: woForm.issueType,
            description: woForm.description,
            assignedToName: woForm.assignedToName,
            vendorId: woForm.vendorId ? Number(woForm.vendorId) : null,
          },
          { token: session?.token }
        );
      }
      setShowWoForm(false);
      await loadWorkOrders();
      await loadAssets();
      if (selectedAsset) {
        const data = await apiGet(`/assets/work-orders?assetId=${selectedAsset.id}`, { token: session?.token });
        setAssetHistory({ assetId: selectedAsset.id, workOrders: data.workOrders });
      }
    } catch (err) {
      setFormError(err instanceof ApiError ? err.message : 'Could not save that work order. Try again.');
    } finally {
      setSubmitting(false);
    }
  };

  const handleBulkWoSubmit = async (e) => {
    e.preventDefault();
    const errors = {};
    if (!bulkWoForm.categoryId) errors.categoryId = 'Choose a category.';
    if (!bulkWoForm.description.trim()) errors.description = 'Describe the work.';
    setBulkWoFieldErrors(errors);
    if (Object.keys(errors).length > 0) {
      focusFirstError(errors, { categoryId: 'bulkWoCategory', description: 'bulkWoDescription' });
      return;
    }

    setBulkWoSubmitting(true);
    setBulkWoError('');
    try {
      const { workOrders: created } = await apiPost(
        '/assets/work-orders/bulk',
        {
          categoryId: Number(bulkWoForm.categoryId),
          issueType: bulkWoForm.issueType,
          description: bulkWoForm.description,
          assignedToName: bulkWoForm.assignedToName,
          vendorId: bulkWoForm.vendorId ? Number(bulkWoForm.vendorId) : null,
        },
        { token: session?.token }
      );
      setShowWoForm(false);
      await loadWorkOrders();
      await loadAssets();
      setWoStatusFilter('OPEN');
      window.alert(`Created ${created.length} work order${created.length === 1 ? '' : 's'}.`);
    } catch (err) {
      setBulkWoError(err instanceof ApiError ? err.message : 'Could not create those work orders. Try again.');
    } finally {
      setBulkWoSubmitting(false);
    }
  };

  // ---------------------------------------------------------------------
  // Vendor form
  // ---------------------------------------------------------------------

  const openVendorForm = (vendor) => {
    setEditingVendorId(vendor?.id ?? null);
    setVendorForm(
      vendor
        ? {
            name: vendor.name,
            contactPerson: vendor.contactPerson || '',
            phone: vendor.phone || '',
            altPhone: vendor.altPhone || '',
            email: vendor.email || '',
            specialty: vendor.specialty || '',
            notes: vendor.notes || '',
          }
        : emptyVendorForm
    );
    setFormError('');
    setVendorFieldErrors({});
    setShowVendorForm(true);
  };

  const handleVendorSubmit = async (e) => {
    e.preventDefault();
    const errors = {};
    if (!vendorForm.name.trim()) errors.name = 'Vendor name is required.';
    if (vendorForm.phone && !/^[6-9]\d{9}$/.test(vendorForm.phone)) {
      errors.phone = 'Enter a valid 10-digit mobile number.';
    } else if (vendorForm.phone) {
      const clash = (vendors || []).find(
        (v) => v.id !== editingVendorId && (v.phone || '') === vendorForm.phone
      );
      if (clash) errors.phone = `This number is already used by vendor "${clash.name}".`;
    }
    if (vendorForm.altPhone && !/^[6-9]\d{9}$/.test(vendorForm.altPhone)) {
      errors.altPhone = 'Enter a valid 10-digit mobile number.';
    } else if (vendorForm.altPhone) {
      if (vendorForm.altPhone === vendorForm.phone) {
        errors.altPhone = 'Alternate number is the same as the primary number.';
      } else {
        const clash = (vendors || []).find(
          (v) =>
            v.id !== editingVendorId &&
            ((v.phone || '') === vendorForm.altPhone || (v.altPhone || '') === vendorForm.altPhone)
        );
        if (clash) errors.altPhone = `This number is already used by vendor "${clash.name}".`;
      }
    }
    setVendorFieldErrors(errors);
    if (Object.keys(errors).length > 0) {
      focusFirstError(errors, { name: 'vendorName', phone: 'vendorPhone', altPhone: 'vendorAltPhone' });
      return;
    }

    setSubmitting(true);
    setFormError('');
    try {
      if (editingVendorId) {
        await apiPatch(`/assets/vendors/${editingVendorId}`, vendorForm, { token: session?.token });
      } else {
        await apiPost('/assets/vendors', vendorForm, { token: session?.token });
      }
      setShowVendorForm(false);
      await loadVendors();
    } catch (err) {
      setFormError(err instanceof ApiError ? err.message : 'Could not save that vendor. Try again.');
    } finally {
      setSubmitting(false);
    }
  };

  // ---------------------------------------------------------------------
  // QR
  // ---------------------------------------------------------------------

  const [qrDataUrl, setQrDataUrl] = useState(null);
  useEffect(() => {
    if (!selectedAsset) return undefined;
    let ignore = false;
    toQrDataUrl(assetUrl(window.location.origin, selectedAsset.qrToken)).then((url) => {
      if (!ignore) setQrDataUrl(url);
    });
    return () => {
      ignore = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedAsset?.qrToken]);

  // The data URL is already sitting in memory — saving it is just handing
  // the browser a filename, not a second network round trip.
  //
  // The link has to actually sit in the DOM before .click() — some mobile
  // browsers (Android Chrome included) ignore the download attribute on a
  // detached <a> and just navigate to the data: URL instead, opening the QR
  // image in a new tab rather than saving it.
  const downloadQr = () => {
    if (!qrDataUrl || !selectedAsset) return;
    const link = document.createElement('a');
    link.href = qrDataUrl;
    link.download = `${selectedAsset.assetTag || selectedAsset.name}-qr.png`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  if (error && !assets) {
    return <div className="form-banner form-banner--error">{error}</div>;
  }

  if (!assets || !categories) {
    return <p className="inv-panel__hint">Loading assets…</p>;
  }

  return (
    <div>
      {error && <div className="form-banner form-banner--error">{error}</div>}

      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
        <SectionTabs
          ariaLabel="Assets sections"
          activeId={tab}
          onChange={setTab}
          tabs={[
            { id: 'register', name: 'Asset Register', count: assets.length },
            {
              id: 'workOrders',
              name: 'Work Orders',
              count: openWoCount,
              flagged: openWoCount > 0,
              flagTitle: `${openWoCount} open work order${openWoCount === 1 ? '' : 's'}`,
            },
            { id: 'vendors', name: 'Vendors', count: (vendors || []).length },
          ]}
        />
        <button type="button" className="btn-secondary" onClick={onViewReport}>
          View Report
        </button>
      </div>

      {tab === 'register' && (
        <div>
          <div className="inv-bar">
            <div className="inv-bar__row asset-toolbar-row">
              <div className="asset-toolbar-row__filters">
                <div className="inv-search">
                  <span className="inv-search__icon" />
                  <input
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    placeholder="Search assets, tag, room, location"
                    aria-label="Search assets"
                  />
                </div>
                {categoryFilterOptions.length > 0 && (
                  <select
                    className="asset-category-filter"
                    value={categoryFilter}
                    onChange={(e) => setCategoryFilter(e.target.value)}
                    aria-label="Filter by category"
                  >
                    <option value="">All categories ({assets.length})</option>
                    {categoryFilterOptions.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name} ({c.count})
                      </option>
                    ))}
                  </select>
                )}
                <select
                  className="asset-category-filter"
                  value={statusFilter}
                  onChange={(e) => setStatusFilter(e.target.value)}
                  aria-label="Filter by status"
                >
                  <option value="">All statuses</option>
                  {Object.entries(STATUS_LABEL).map(([key, label]) => (
                    <option key={key} value={key}>{label}</option>
                  ))}
                </select>
                <label className="asset-show-retired">
                  <input
                    type="checkbox"
                    checked={showRetired}
                    onChange={(e) => setShowRetired(e.target.checked)}
                  />
                  Show retired
                </label>
              </div>
              <div className="asset-toolbar-row__end">
                <div className="toggle-group asset-view-toggle" role="group" aria-label="Asset list view">
                  <button
                    type="button"
                    className="asset-view-toggle__btn"
                    aria-pressed={assetView === 'cards'}
                    aria-label="Cards view"
                    title="Cards view"
                    onClick={() => setAssetView('cards')}
                  >
                    <svg viewBox="0 0 20 20" width="16" height="16" fill="none" aria-hidden="true">
                      <rect x="2.5" y="2.5" width="6.5" height="6.5" rx="1.4" stroke="currentColor" strokeWidth="1.6" />
                      <rect x="11" y="2.5" width="6.5" height="6.5" rx="1.4" stroke="currentColor" strokeWidth="1.6" />
                      <rect x="2.5" y="11" width="6.5" height="6.5" rx="1.4" stroke="currentColor" strokeWidth="1.6" />
                      <rect x="11" y="11" width="6.5" height="6.5" rx="1.4" stroke="currentColor" strokeWidth="1.6" />
                    </svg>
                  </button>
                  <button
                    type="button"
                    className="asset-view-toggle__btn"
                    aria-pressed={assetView === 'table'}
                    aria-label="Table view"
                    title="Table view"
                    onClick={() => setAssetView('table')}
                  >
                    <svg viewBox="0 0 20 20" width="16" height="16" fill="none" aria-hidden="true">
                      <rect x="2.5" y="3.5" width="15" height="13" rx="1.4" stroke="currentColor" strokeWidth="1.6" />
                      <line x1="2.5" y1="8" x2="17.5" y2="8" stroke="currentColor" strokeWidth="1.6" />
                      <line x1="2.5" y1="12.3" x2="17.5" y2="12.3" stroke="currentColor" strokeWidth="1.6" />
                      <line x1="7.3" y1="3.5" x2="7.3" y2="16.5" stroke="currentColor" strokeWidth="1.6" />
                    </svg>
                  </button>
                </div>
                <button type="button" className="btn-accent" onClick={() => openAssetForm(null)}>
                  Register asset
                </button>
              </div>
            </div>
          </div>

          {visibleAssets.length === 0 ? (
            <p className="inv-panel__hint">
              {assets.length === 0
                ? 'Nothing registered yet. Add the equipment you want to track — an AC, a lift, a geyser — with its warranty and AMC dates.'
                : 'No asset matches that.'}
            </p>
          ) : assetView === 'table' ? (
            <div className="asset-table-wrap">
              <table className="asset-table">
                <thead>
                  <tr>
                    {[
                      ['tag', 'Tag'],
                      ['name', 'Name'],
                      ['category', 'Category'],
                      ['location', 'Location'],
                      ['status', 'Status'],
                      ['warranty', 'Warranty'],
                      ['amc', 'AMC'],
                      ['openWorkOrders', 'Open WOs'],
                    ].map(([key, label]) => (
                      <th key={key}>
                        <button
                          type="button"
                          className="asset-table__sort-btn"
                          aria-sort={tableSort.key === key ? (tableSort.dir === 'desc' ? 'descending' : 'ascending') : 'none'}
                          onClick={() => toggleTableSort(key)}
                        >
                          {label}
                          <span className="asset-table__sort-icon" aria-hidden="true">
                            {tableSort.key === key ? (tableSort.dir === 'desc' ? '▼' : '▲') : '⇅'}
                          </span>
                        </button>
                      </th>
                    ))}
                    <th aria-label="Actions" />
                  </tr>
                </thead>
                <tbody>
                  {sortedAssets.map((asset) => {
                    const wFlag = expiryFlag(asset.warrantyExpiry);
                    const aFlag = expiryFlag(asset.amcExpiry);
                    const location = asset.roomNumber
                      ? `Room ${asset.roomNumber}`
                      : asset.department || (asset.floor ? `Floor ${asset.floor}` : '');
                    const dateCell = (value, flag) =>
                      flag === 'expired' || flag === 'soon' ? (
                        <span className={`asset-table__date-chip asset-table__date-chip--${flag === 'expired' ? 'bad' : 'low'}`}>
                          {formatDate(value)}
                        </span>
                      ) : (
                        <span className="asset-table__muted">{formatDate(value)}</span>
                      );
                    return (
                      <tr key={asset.id} onClick={() => openAssetDetail(asset)}>
                        <td className="asset-table__mono">{asset.assetTag}</td>
                        <td className="asset-table__name">{asset.name}</td>
                        <td>{asset.categoryName}</td>
                        <td className={location ? '' : 'asset-table__muted'}>{location || '—'}</td>
                        <td>
                          <span className={`inv-tag ${STATUS_TAG_CLASS[asset.status]}`}>
                            {STATUS_LABEL[asset.status]}
                          </span>
                        </td>
                        <td>{dateCell(asset.warrantyExpiry, wFlag)}</td>
                        <td>{dateCell(asset.amcExpiry, aFlag)}</td>
                        <td className={asset.openWorkOrders > 0 ? '' : 'asset-table__muted'}>
                          {asset.openWorkOrders > 0 ? asset.openWorkOrders : '—'}
                        </td>
                        <td className="asset-table__actions" onClick={(e) => e.stopPropagation()}>
                          <RowMenu label={`More actions for ${asset.name}`}>
                            <button type="button" onClick={() => openAssetDetail(asset)}>
                              View details
                            </button>
                            <button type="button" onClick={() => openAssetForm(asset)}>
                              Edit asset
                            </button>
                            <button type="button" onClick={() => reportIssue(asset)}>
                              Report issue
                            </button>
                            <button type="button" className="inv-danger" onClick={() => deleteAsset(asset)}>
                              Delete asset
                            </button>
                          </RowMenu>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          ) : (
            <ul className="inv-list">
              {visibleAssets.map((asset) => {
                const wFlag = expiryFlag(asset.warrantyExpiry);
                const aFlag = expiryFlag(asset.amcExpiry);
                const badFlag = wFlag === 'expired' || aFlag === 'expired' ? 'expired' : wFlag || aFlag;
                // Named rather than a generic "Warranty/AMC" — a hotel with
                // both on file needs to know which one to act on without
                // opening the asset to check, and "AMC expired" reads as
                // more urgent (someone to call) than "Warranty expired"
                // (nothing to do, it just lapsed).
                const expiredNames = [wFlag === 'expired' && 'Warranty', aFlag === 'expired' && 'AMC'].filter(Boolean);
                const soonNames = [wFlag === 'soon' && 'Warranty', aFlag === 'soon' && 'AMC'].filter(Boolean);
                return (
                  <li
                    key={asset.id}
                    className={`inv-item${badFlag === 'expired' ? ' inv-item--bad' : badFlag === 'soon' ? ' inv-item--low' : ''}`}
                  >
                    <div className="inv-item__body" onClick={() => openAssetDetail(asset)} style={{ cursor: 'pointer' }}>
                      <div className="inv-item__name">
                        {asset.name}
                        <span className={`inv-tag ${STATUS_TAG_CLASS[asset.status]}`}>{STATUS_LABEL[asset.status]}</span>
                        {badFlag === 'expired' && (
                          <span className="inv-tag inv-tag--bad">{expiredNames.join(' & ')} expired</span>
                        )}
                        {badFlag === 'soon' && (
                          <span className="inv-tag inv-tag--low">{soonNames.join(' & ')} expiring soon</span>
                        )}
                        {asset.openWorkOrders > 0 && (
                          <span className="inv-tag inv-tag--low">
                            {asset.openWorkOrders} open work order{asset.openWorkOrders === 1 ? '' : 's'}
                          </span>
                        )}
                      </div>
                      <div className="inv-item__meta">
                        {asset.assetTag} · {asset.categoryName}
                        {asset.roomNumber && ` · Room ${asset.roomNumber}`}
                        {!asset.roomNumber && asset.department && ` · ${asset.department}`}
                        {!asset.roomNumber && !asset.department && asset.floor && ` · Floor ${asset.floor}`}
                      </div>
                    </div>
                    <div className="inv-item__actions">
                      <button type="button" className="btn-secondary" onClick={() => reportIssue(asset)}>
                        Report issue
                      </button>
                      <RowMenu label={`More actions for ${asset.name}`}>
                        <button type="button" onClick={() => openAssetDetail(asset)}>
                          View details
                        </button>
                        <button type="button" onClick={() => openAssetForm(asset)}>
                          Edit asset
                        </button>
                        <button type="button" className="inv-danger" onClick={() => deleteAsset(asset)}>
                          Delete asset
                        </button>
                      </RowMenu>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      )}

      {tab === 'workOrders' && (
        <div>
          <div className="inv-bar">
            <div className="inv-bar__row asset-wo-toolbar">
              <div className="asset-wo-toolbar__tabs">
                <SectionTabs
                  ariaLabel="Work order status"
                  activeId={woStatusFilter}
                  onChange={setWoStatusFilter}
                  tabs={[
                    { id: '', name: 'All', count: (workOrders || []).length },
                    { id: 'OPEN', name: 'Open', count: (workOrders || []).filter((w) => w.status === 'OPEN').length },
                    {
                      id: 'IN_PROGRESS',
                      name: 'In progress',
                      count: (workOrders || []).filter((w) => w.status === 'IN_PROGRESS').length,
                    },
                    {
                      id: 'CLOSED',
                      name: 'Closed',
                      count: (workOrders || []).filter((w) => w.status === 'CLOSED').length,
                    },
                  ]}
                />
              </div>
              <div className="inv-bar__actions asset-wo-toolbar__actions">
                <button type="button" className="btn-accent" onClick={() => openWoForm(null)}>
                  New work order
                </button>
              </div>
            </div>
          </div>

          {visibleWorkOrders.length === 0 ? (
            <p className="inv-panel__hint">No work orders here.</p>
          ) : (
            <ul className="inv-list">
              {visibleWorkOrders.map((wo) => (
                <li key={wo.id} className="inv-item">
                  <div className="inv-item__body" onClick={() => openWoForm(wo)} style={{ cursor: 'pointer' }}>
                    <div className="inv-item__name">
                      {wo.assetName}
                      <span className="inv-tag">{WO_STATUS_LABEL[wo.status]}</span>
                      {wo.isWarrantyClaim && <span className="inv-tag">Warranty claim</span>}
                    </div>
                    <div className="inv-item__meta">
                      {wo.description}
                      {wo.assignedToName && ` · Assigned: ${wo.assignedToName}`}
                      {wo.vendorName && ` · Vendor: ${wo.vendorName}`}
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {tab === 'vendors' && (
        <div>
          <div className="inv-bar">
            <div className="inv-bar__row">
              <div />
              <div className="inv-bar__actions">
                <button type="button" className="btn-accent" onClick={() => openVendorForm(null)}>
                  Add vendor
                </button>
              </div>
            </div>
          </div>

          {(vendors || []).length === 0 ? (
            <p className="inv-panel__hint">No vendors yet. Add the AC contractor, lift AMC firm, or electrician you call for repairs.</p>
          ) : (
            <ul className="inv-list">
              {vendors.map((vendor) => (
                <li key={vendor.id} className="inv-item">
                  <div className="inv-item__body" onClick={() => openVendorForm(vendor)} style={{ cursor: 'pointer' }}>
                    <div className="inv-item__name">{vendor.name}</div>
                    <div className="inv-item__meta">
                      {vendor.specialty || 'No specialty set'}
                      {vendor.phone && ` · ${vendor.phone}`}
                      {vendor.altPhone && ` / ${vendor.altPhone}`}
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {/* Asset detail: fields, QR, service history */}
      {selectedAsset && (
        <div className="glass-backdrop inv-panel__backdrop">
          <div
            className="glass-panel inv-panel__modal inv-panel__modal--asset-detail"
            role="dialog"
            aria-modal="true"
            aria-labelledby="assetDetailTitle"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="inv-modal__head">
              <div>
                <h3 id="assetDetailTitle">{selectedAsset.name}</h3>
                <p className="inv-modal__sub">
                  {selectedAsset.assetTag} · {selectedAsset.categoryName}
                </p>
              </div>
              <button type="button" className="inv-modal__close" onClick={closeAssetDetail} aria-label="Close">
                ×
              </button>
            </div>

            <div className="inv-modal__body">
              <div className="asset-detail__top">
                <div className="asset-detail__facts">
                  <div className="asset-detail__status">
                    <label htmlFor="assetDetailStatus">Status</label>
                    <select
                      id="assetDetailStatus"
                      value={selectedAsset.status}
                      onChange={(e) => changeAssetStatus(selectedAsset, e.target.value)}
                    >
                      {Object.entries(STATUS_LABEL).map(([key, label]) => (
                        <option key={key} value={key}>
                          {label}
                        </option>
                      ))}
                    </select>
                  </div>

                  <h4>Asset Details</h4>
                  <dl className="asset-detail__grid">
                    <div>
                      <dt>Location</dt>
                      <dd>
                        {selectedAsset.roomNumber
                          ? `Room ${selectedAsset.roomNumber}`
                          : [selectedAsset.floor && `Floor ${selectedAsset.floor}`, selectedAsset.department]
                              .filter(Boolean)
                              .join(' · ') || 'Not set'}
                      </dd>
                    </div>
                    {selectedAsset.brand && (
                      <div>
                        <dt>Brand</dt>
                        <dd>{selectedAsset.brand}</dd>
                      </div>
                    )}
                    {selectedAsset.model && (
                      <div>
                        <dt>Model</dt>
                        <dd>{selectedAsset.model}</dd>
                      </div>
                    )}
                    {selectedAsset.serialNumber && (
                      <div>
                        <dt>Serial number</dt>
                        <dd>{selectedAsset.serialNumber}</dd>
                      </div>
                    )}
                    {selectedAsset.purchaseDate && (
                      <div>
                        <dt>Purchased</dt>
                        <dd>
                          {formatDate(selectedAsset.purchaseDate)}
                          {selectedAsset.purchaseCost != null && ` · ₹${selectedAsset.purchaseCost}`}
                        </dd>
                      </div>
                    )}
                    <div>
                      <dt>Warranty</dt>
                      <dd>{formatDate(selectedAsset.warrantyExpiry)}</dd>
                    </div>
                    <div>
                      <dt>AMC</dt>
                      <dd>{formatDate(selectedAsset.amcExpiry)}</dd>
                    </div>
                    {selectedAsset.vendorName && (
                      <div>
                        <dt>Vendor</dt>
                        <dd>{selectedAsset.vendorName}</dd>
                      </div>
                    )}
                    <div>
                      <dt>Purchase bill</dt>
                      <dd>
                        {selectedAsset.hasBillDocument ? (
                          <button type="button" className="asset-bill-link" onClick={() => viewBill(selectedAsset)}>
                            <svg viewBox="0 0 20 20" width="14" height="14" fill="none" aria-hidden="true">
                              <path
                                d="M5 2.5h7l3 3v12a.5.5 0 0 1-.5.5h-9.5a.5.5 0 0 1-.5-.5v-14a.5.5 0 0 1 .5-.5Z"
                                stroke="currentColor"
                                strokeWidth="1.4"
                                strokeLinejoin="round"
                              />
                              <path d="M12 2.5V5.5a.5.5 0 0 0 .5.5H15.5" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round" />
                              <path d="M6.5 10.5h7M6.5 13.5h5" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
                            </svg>
                            View bill
                          </button>
                        ) : (
                          <span className="asset-detail__muted-fact">Not uploaded</span>
                        )}
                      </dd>
                    </div>
                  </dl>
                </div>

                {qrDataUrl && (
                  <div className="asset-detail__qr">
                    <img src={qrDataUrl} alt={`QR code for ${selectedAsset.name}`} width={132} height={132} />
                    <p>Scan to open this asset</p>
                    <button type="button" className="inv-linkbtn" onClick={downloadQr}>
                      Download QR
                    </button>
                  </div>
                )}
              </div>

              <div className="modal-form__foot-actions asset-detail__actions">
                <button type="button" className="btn-accent" onClick={() => reportIssue(selectedAsset)}>
                  Report an issue
                </button>
                <button type="button" className="btn-outline" onClick={() => openCoverageForm(null)}>
                  Add coverage
                </button>
                <button type="button" className="btn-outline" onClick={() => openAssetForm(selectedAsset)}>
                  Edit asset
                </button>
                <button type="button" className="btn-danger" onClick={() => deleteAsset(selectedAsset)}>
                  Delete asset
                </button>
              </div>

              <h4>Coverage details</h4>
              {visibleCoveragePeriods === null ? (
                <p className="inv-panel__hint">Loading…</p>
              ) : visibleCoveragePeriods.length === 0 ? (
                <p className="inv-panel__hint">
                  No warranty or AMC on record yet. "Add coverage" logs the maker's warranty at purchase,
                  then each AMC as it starts — so who covered a repair, and when the cover ran out, stays
                  answerable after it's renewed a few times.
                </p>
              ) : (
                <ul className="asset-coverage-list">
                  {visibleCoveragePeriods.map((period) => {
                    const flag = expiryFlag(period.endDate);
                    const isLatestOfType =
                      period.id ===
                      visibleCoveragePeriods.find((p) => p.coverageType === period.coverageType)?.id;
                    const vendor = period.vendorId ? (vendors || []).find((v) => v.id === period.vendorId) : null;
                    return (
                      <li key={period.id} className="asset-coverage-card">
                        <div className="asset-coverage-card__head">
                          <span className="inv-tag">{period.coverageType === 'AMC' ? 'AMC' : 'Warranty'}</span>
                          <span
                            className={`asset-coverage-card__dates${
                              flag === 'expired' ? ' inv-tag--bad' : flag === 'soon' ? ' inv-tag--low' : ''
                            }`}
                          >
                            {period.startDate ? `${formatDate(period.startDate)} – ` : 'Until '}
                            {formatDate(period.endDate)}
                          </span>
                          <div className="asset-coverage-card__actions">
                            {isLatestOfType && (
                              <button type="button" className="inv-linkbtn" onClick={() => openCoverageForm(period)}>
                                Renew
                              </button>
                            )}
                            <button type="button" className="inv-linkbtn" onClick={() => openCoverageEditForm(period)}>
                              Edit
                            </button>
                            <button type="button" className="inv-linkbtn" onClick={() => deleteCoveragePeriod(period)}>
                              Delete
                            </button>
                          </div>
                        </div>

                        {vendor ? (
                          <div className="asset-coverage-card__vendor">
                            <strong>{vendor.name}</strong>
                            {vendor.specialty && <span> · {vendor.specialty}</span>}
                            {(vendor.contactPerson || vendor.phone || vendor.email) && (
                              <div className="asset-coverage-card__vendor-contact">
                                {[vendor.contactPerson, vendor.phone, vendor.email].filter(Boolean).join(' · ')}
                              </div>
                            )}
                          </div>
                        ) : (
                          period.vendorName && (
                            <div className="asset-coverage-card__vendor">
                              <strong>{period.vendorName}</strong>
                            </div>
                          )
                        )}

                        {period.cost != null && (
                          <div className="asset-coverage-card__line">
                            <strong>Cost:</strong> ₹{period.cost}
                          </div>
                        )}
                        {period.coverageNote && (
                          <div className="asset-coverage-card__line">
                            <strong>Covers:</strong> {period.coverageNote}
                          </div>
                        )}
                      </li>
                    );
                  })}
                </ul>
              )}

              <h4>Service history</h4>
              {visibleAssetHistory === null ? (
                <p className="inv-panel__hint">Loading…</p>
              ) : visibleAssetHistory.length === 0 ? (
                <p className="inv-panel__hint">No work orders yet.</p>
              ) : (
                <ul className="inv-ledger">
                  {visibleAssetHistory.map((wo) => (
                    <li key={wo.id} className="inv-ledger__row" onClick={() => openWoForm(wo)} style={{ cursor: 'pointer' }}>
                      <div className="inv-ledger__what">
                        <span className="inv-ledger__reason">{WO_STATUS_LABEL[wo.status]}</span>
                        <span className="inv-ledger__detail">{wo.description}</span>
                      </div>
                      <div className="inv-ledger__when">{formatDate(wo.openedAt)}</div>
                    </li>
                  ))}
                </ul>
              )}

              {purchaseExpense && (
                <>
                  <h4>Purchase payments</h4>
                  <p className="inv-panel__hint" style={{ marginTop: -8 }}>
                    {formatPrice(purchaseExpense.amountPaid || 0)} of {formatPrice(purchaseExpense.amount)} paid
                    {purchaseExpense.amount > (purchaseExpense.amountPaid || 0) &&
                      ` · ${formatPrice(purchaseExpense.amount - (purchaseExpense.amountPaid || 0))} left`}
                  </p>

                  {visiblePurchasePayments === null ? (
                    <p className="inv-panel__hint">Loading…</p>
                  ) : (
                    visiblePurchasePayments.length > 0 && (
                      <ul className="inv-list" style={{ marginBottom: 10 }}>
                        {visiblePurchasePayments.map((p) => (
                          <li key={p.id} className="inv-item">
                            <div className="inv-item__body">
                              <div className="inv-item__name">
                                {formatPrice(p.amount)}
                                <span className={`inv-tag ${PAYMENT_TAG_CLASS[p.paymentMethod]}`}>
                                  {PAYMENT_LABEL[p.paymentMethod]}
                                </span>
                              </div>
                              <div className="inv-item__meta">
                                {formatDate(p.paidDate)}
                                {p.referenceNumber && ` · ${PAYMENT_REFERENCE_LABEL[p.paymentMethod] || 'Ref'}: ${p.referenceNumber}`}
                              </div>
                            </div>
                            <div className="inv-item__actions">
                              <button type="button" className="inv-danger" onClick={() => handleDeleteAssetPayment(p)}>
                                Remove
                              </button>
                            </div>
                          </li>
                        ))}
                      </ul>
                    )
                  )}

                  {assetPaymentError && (
                    <div className="form-banner form-banner--error form-banner--flash">{assetPaymentError}</div>
                  )}

                  {/* No separate "Add payment" button — Enter in any of
                      these three fields submits the payment directly. */}
                  {purchaseExpense.amount > (purchaseExpense.amountPaid || 0) && (
                    <div
                      className="field-row field-row--triple"
                      onKeyDown={(e) => {
                        if (e.key !== 'Enter') return;
                        e.preventDefault();
                        if (!addingAssetPayment) handleAddAssetPayment(e);
                      }}
                    >
                      <div className="field">
                        <label htmlFor="assetNewPaymentAmount">Amount</label>
                        <input
                          id="assetNewPaymentAmount"
                          type="number"
                          min="0"
                          step="0.01"
                          max={purchaseExpense.amount - (purchaseExpense.amountPaid || 0)}
                          value={newAssetPayment.amount}
                          onChange={(e) => setNewAssetPayment((f) => ({ ...f, amount: e.target.value }))}
                        />
                      </div>
                      <div className="field">
                        <label htmlFor="assetNewPaymentMethod">Paid via</label>
                        <select
                          id="assetNewPaymentMethod"
                          value={newAssetPayment.paymentMethod}
                          onChange={(e) => setNewAssetPayment((f) => ({ ...f, paymentMethod: e.target.value }))}
                        >
                          {PAYMENT_METHOD_OPTIONS.map(([value, label]) => (
                            <option key={value} value={value}>
                              {label}
                            </option>
                          ))}
                        </select>
                      </div>
                      <div className="field">
                        <label htmlFor="assetNewPaymentDate">Date</label>
                        <input
                          id="assetNewPaymentDate"
                          type="date"
                          value={newAssetPayment.paidDate}
                          onChange={(e) => setNewAssetPayment((f) => ({ ...f, paidDate: e.target.value }))}
                        />
                      </div>
                      {PAYMENT_REFERENCE_LABEL[newAssetPayment.paymentMethod] && (
                        <div className="field" style={{ gridColumn: '1 / -1' }}>
                          <label htmlFor="assetNewPaymentReference">
                            {PAYMENT_REFERENCE_LABEL[newAssetPayment.paymentMethod]}
                          </label>
                          <input
                            id="assetNewPaymentReference"
                            value={newAssetPayment.referenceNumber}
                            onChange={(e) => setNewAssetPayment((f) => ({ ...f, referenceNumber: e.target.value }))}
                          />
                        </div>
                      )}
                      <span className="field__hint" style={{ gridColumn: '1 / -1' }}>
                        {addingAssetPayment ? 'Adding…' : 'Press Enter to add this payment.'}
                      </span>
                    </div>
                  )}
                </>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Asset register/edit form. Deliberately no close-on-backdrop-click —
          this form is long enough that a misplaced tap outside the panel
          shouldn't discard what's been filled in; Cancel or the × are the
          only way out. */}
      {showAssetForm && (
        <div className="glass-backdrop inv-panel__backdrop">
          <div
            className="glass-panel inv-panel__modal inv-panel__modal--asset modal-form__panel"
            role="dialog"
            aria-modal="true"
            aria-labelledby="assetModalTitle"
          >
            <form className="modal-form" onSubmit={handleAssetSubmit} noValidate>
              <div className="modal-form__head">
                <div className="modal-form__head-row">
                  <h3 id="assetModalTitle">{editingAssetId ? 'Edit asset' : 'Register asset'}</h3>
                  {/* Editing is always one asset — there's nothing to range
                      over — so the toggle only appears when starting fresh,
                      same as Add room hiding it once a room is being edited. */}
                  {!editingAssetId && (
                    <div className="toggle-group">
                      <button type="button" aria-pressed={registerMode === 'single'} onClick={() => switchRegisterMode('single')}>
                        Single
                      </button>
                      <button type="button" aria-pressed={registerMode === 'bulk'} onClick={() => switchRegisterMode('bulk')}>
                        Bulk register
                      </button>
                    </div>
                  )}
                  <button
                    type="button"
                    className="modal-form__close"
                    onClick={() => setShowAssetForm(false)}
                    disabled={submitting}
                    aria-label="Close"
                  >
                    ×
                  </button>
                </div>
              </div>

              <div className="modal-form__body modal-form__body--asset">
                {formError && (
                  <div className="form-banner form-banner--error form-banner--flash field--span2">{formError}</div>
                )}

                <div className="field field--span2">
                  <label htmlFor="assetCategory">
                    Category <Req />
                  </label>
                  <CategoryField
                    id="assetCategory"
                    value={assetForm.categoryName}
                    onChange={(name) => {
                      setAssetForm((f) => ({ ...f, categoryName: name }));
                      if (fieldErrors.categoryName) setFieldErrors((f) => ({ ...f, categoryName: undefined }));
                    }}
                    options={[...new Set([...categories.map((c) => c.name), ...SUGGESTED_CATEGORIES])].sort((a, b) =>
                      a.localeCompare(b)
                    )}
                  />
                  {fieldErrors.categoryName ? (
                    <span className="field__error">{fieldErrors.categoryName}</span>
                  ) : (
                    <span className="field__hint">
                      Pick from the list or type a new one — it's added the first time it's used.
                    </span>
                  )}
                </div>

                <h4 className="form-section__title">Purchase details</h4>

                <div className="field-row field-row--triple field--span2">
                  <div className="field">
                    <label htmlFor="assetBrand">Brand</label>
                    <input
                      id="assetBrand"
                      value={assetForm.brand}
                      onChange={(e) => setAssetForm((f) => ({ ...f, brand: e.target.value }))}
                    />
                  </div>

                  <div className="field">
                    <label htmlFor="assetModel">Model</label>
                    <input
                      id="assetModel"
                      value={assetForm.model}
                      onChange={(e) => setAssetForm((f) => ({ ...f, model: e.target.value }))}
                    />
                  </div>

                  <div className="field">
                    <label htmlFor="assetSerial">Serial number</label>
                    <input
                      id="assetSerial"
                      value={assetForm.serialNumber}
                      onChange={(e) => setAssetForm((f) => ({ ...f, serialNumber: e.target.value }))}
                    />
                  </div>
                </div>

                <div className="field-row field-row--triple field--span2" style={{ marginTop: 12 }}>
                  <div className="field">
                    <label htmlFor="assetPurchaseDate">Purchase date</label>
                    <input
                      id="assetPurchaseDate"
                      type="date"
                      value={assetForm.purchaseDate}
                      onChange={(e) => setAssetForm((f) => ({ ...f, purchaseDate: e.target.value }))}
                    />
                  </div>

                  <div className="field">
                    <label htmlFor="assetPurchaseCost">Purchase cost</label>
                    <input
                      id="assetPurchaseCost"
                      type="number"
                      step="0.01"
                      value={assetForm.purchaseCost}
                      onChange={(e) => setAssetForm((f) => ({ ...f, purchaseCost: e.target.value }))}
                    />
                  </div>

                  <div className="field">
                    <label htmlFor="assetPaymentStatus">Payment status</label>
                    <select
                      id="assetPaymentStatus"
                      value={assetForm.paymentStatus}
                      onChange={(e) => setAssetForm((f) => ({ ...f, paymentStatus: e.target.value }))}
                    >
                      <option value="PAID">Paid</option>
                      <option value="PARTIAL">Partially paid</option>
                      <option value="PENDING">Pending</option>
                    </select>
                  </div>
                </div>

                {assetForm.paymentStatus !== 'PENDING' && (
                  <div className="field-row field--span2" style={{ marginTop: 12 }}>
                    <div className="field">
                      <label htmlFor="assetPaymentMethod">Paid via</label>
                      <select
                        id="assetPaymentMethod"
                        value={assetForm.paymentMethod}
                        onChange={(e) => setAssetForm((f) => ({ ...f, paymentMethod: e.target.value }))}
                      >
                        {PAYMENT_METHOD_OPTIONS.map(([value, label]) => (
                          <option key={value} value={value}>
                            {label}
                          </option>
                        ))}
                      </select>
                    </div>
                    {PAYMENT_REFERENCE_LABEL[assetForm.paymentMethod] && (
                      <div className="field">
                        <label htmlFor="assetReferenceNumber">{PAYMENT_REFERENCE_LABEL[assetForm.paymentMethod]}</label>
                        <input
                          id="assetReferenceNumber"
                          value={assetForm.referenceNumber}
                          onChange={(e) => setAssetForm((f) => ({ ...f, referenceNumber: e.target.value }))}
                        />
                      </div>
                    )}
                    {assetForm.paymentStatus === 'PARTIAL' && (
                      <div className="field">
                        <label htmlFor="assetAmountPaid">Amount paid so far</label>
                        <input
                          id="assetAmountPaid"
                          type="number"
                          min="0"
                          step="0.01"
                          max={assetForm.purchaseCost || undefined}
                          value={assetForm.amountPaid}
                          onChange={(e) => setAssetForm((f) => ({ ...f, amountPaid: e.target.value }))}
                        />
                      </div>
                    )}
                  </div>
                )}

                <div className="field field--span2">
                  <label htmlFor="assetVendor">Vendor (shop / company name)</label>
                  <VendorField
                    id="assetVendor"
                    value={assetForm.vendorName}
                    vendors={vendors}
                    onChange={(name) =>
                      // Typing over a picked vendor's name un-picks it —
                      // the id would otherwise point at a vendor whose name
                      // no longer matches what's on screen.
                      setAssetForm((f) => ({ ...f, vendorName: name, vendorId: '' }))
                    }
                    onPick={(vendor) =>
                      setAssetForm((f) => ({
                        ...f,
                        vendorId: String(vendor.id),
                        vendorName: vendor.name,
                        vendorContactPerson: vendor.contactPerson || '',
                        vendorPhone: vendor.phone || '',
                        vendorAltPhone: vendor.altPhone || '',
                        vendorEmail: vendor.email || '',
                        vendorSpecialty: vendor.specialty || '',
                      }))
                    }
                  />
                  <span className="field__hint">
                    {assetForm.vendorId
                      ? 'Existing vendor — details below are theirs on file.'
                      : assetForm.vendorName.trim()
                        ? 'No match — this will be added as a new vendor.'
                        : 'Search by name or phone, or type a new vendor.'}
                  </span>
                </div>

                <div className="field">
                  <label htmlFor="assetVendorContact">Vendor contact person</label>
                  <input
                    id="assetVendorContact"
                    value={assetForm.vendorContactPerson}
                    onChange={(e) => setAssetForm((f) => ({ ...f, vendorContactPerson: e.target.value }))}
                  />
                </div>

                <div className="field">
                  <label htmlFor="assetVendorPhone">Vendor phone</label>
                  <input
                    id="assetVendorPhone"
                    aria-invalid={Boolean(fieldErrors.vendorPhone)}
                    value={assetForm.vendorPhone}
                    onChange={(e) => {
                      setAssetForm((f) => ({ ...f, vendorPhone: typedMobile(e.target.value) }));
                      if (fieldErrors.vendorPhone) setFieldErrors((f) => ({ ...f, vendorPhone: undefined }));
                    }}
                    type="tel"
                    inputMode="numeric"
                    maxLength={10}
                    placeholder="10-digit mobile"
                  />
                  {fieldErrors.vendorPhone ? <span className="field__error">{fieldErrors.vendorPhone}</span> : null}
                </div>

                <div className="field">
                  <label htmlFor="assetVendorAltPhone">Vendor alternate phone</label>
                  <input
                    id="assetVendorAltPhone"
                    aria-invalid={Boolean(fieldErrors.vendorAltPhone)}
                    value={assetForm.vendorAltPhone}
                    onChange={(e) => {
                      setAssetForm((f) => ({ ...f, vendorAltPhone: typedMobile(e.target.value) }));
                      if (fieldErrors.vendorAltPhone) setFieldErrors((f) => ({ ...f, vendorAltPhone: undefined }));
                    }}
                    type="tel"
                    inputMode="numeric"
                    maxLength={10}
                    placeholder="10-digit mobile (optional)"
                  />
                  {fieldErrors.vendorAltPhone ? (
                    <span className="field__error">{fieldErrors.vendorAltPhone}</span>
                  ) : null}
                </div>

                <div className="field">
                  <label htmlFor="assetVendorEmail">Vendor email</label>
                  <input
                    id="assetVendorEmail"
                    value={assetForm.vendorEmail}
                    onChange={(e) => setAssetForm((f) => ({ ...f, vendorEmail: e.target.value }))}
                  />
                </div>

                <div className="field">
                  <label htmlFor="assetVendorSpecialty">Vendor specialty</label>
                  <input
                    id="assetVendorSpecialty"
                    value={assetForm.vendorSpecialty}
                    onChange={(e) => setAssetForm((f) => ({ ...f, vendorSpecialty: e.target.value }))}
                    placeholder="AC service, Electrical, Lift AMC…"
                  />
                </div>

                <div className="field field--span2">
                  <label htmlFor="assetBill">Purchase bill</label>
                  <FileField
                    id="assetBill"
                    file={billFile}
                    accept="image/jpeg,image/png,image/webp,application/pdf"
                    onChange={setBillFile}
                    existingLabel={
                      editingAssetId && assets.find((a) => a.id === editingAssetId)?.hasBillDocument
                        ? 'A bill is already on file'
                        : undefined
                    }
                  />
                  {billFile ? (
                    <span className="field__hint">Replaces the bill on file when saved.</span>
                  ) : editingAssetId && assets.find((a) => a.id === editingAssetId)?.hasBillDocument ? (
                    <span className="field__hint">Choose a file to replace it, or leave this empty to keep it.</span>
                  ) : (
                    <span className="field__hint">A photo or PDF of the purchase bill — JPG, PNG or PDF, up to 5MB.</span>
                  )}
                </div>

                {/* Warranty only at registration — it's the maker's cover
                    starting at purchase, so it belongs here once. After
                    that, extending it, or adding the AMC that follows once
                    it lapses, happens from the asset's own "Coverage
                    history" (Add coverage / Renew) rather than by editing
                    the asset — one place manages coverage, not two. */}
                {!editingAssetId && (
                  <div className="field">
                    <label htmlFor="assetWarranty">Company warranty until</label>
                    <input
                      id="assetWarranty"
                      type="date"
                      value={assetForm.warrantyExpiry}
                      onChange={(e) => setAssetForm((f) => ({ ...f, warrantyExpiry: e.target.value }))}
                    />
                    <span className="field__hint">
                      Leave blank if there's no maker's warranty. Once this expires, add the AMC from the
                      asset's Coverage history instead of editing it here.
                    </span>
                  </div>
                )}

                <h4 className="form-section__title">Installation details</h4>

                <div className="field">
                  <label htmlFor="assetRoom">Room</label>
                  <select
                    id="assetRoom"
                    value={assetForm.roomId}
                    onChange={(e) => {
                      const roomId = e.target.value;
                      const room = (rooms || []).find((r) => String(r.id) === roomId);
                      setAssetForm((f) => ({ ...f, roomId, floor: room?.floor || f.floor }));
                    }}
                  >
                    <option value="">Not room-bound</option>
                    {(rooms || []).map((r) => (
                      <option key={r.id} value={r.id}>
                        Room {r.roomNumber}
                      </option>
                    ))}
                  </select>
                  <span className="field__hint">Leave unset for lobby, kitchen or common-area equipment.</span>
                </div>

                <div className="field">
                  <label htmlFor="assetFloor">Floor</label>
                  <input
                    id="assetFloor"
                    value={assetForm.floor}
                    onChange={(e) => setAssetForm((f) => ({ ...f, floor: e.target.value }))}
                    placeholder="2"
                    readOnly={!!assetForm.roomId}
                  />
                  {assetForm.roomId && (
                    <span className="field__hint">Set by the room — clear the room above to edit this by hand.</span>
                  )}
                </div>

                <div className="field field--span2">
                  <label htmlFor="assetDepartment">Location description</label>
                  <input
                    id="assetDepartment"
                    value={assetForm.department}
                    onChange={(e) => setAssetForm((f) => ({ ...f, department: e.target.value }))}
                    placeholder="Kitchen, Lobby, Reception, Poolside…"
                    autoComplete="off"
                  />
                  <span className="field__hint">
                    A short label, not a sentence — it's also used to build the asset's name below.
                  </span>
                </div>

                <div className="field field--span2">
                  <label htmlFor="assetName">
                    Name <Req />
                  </label>
                  <input
                    id="assetName"
                    value={displayedAssetName}
                    aria-invalid={Boolean(fieldErrors.name)}
                    onChange={(e) => {
                      // Typing here claims the field — auto-fill from
                      // category/room stops touching it from this point on.
                      setNameAutoFilled(false);
                      setAssetForm((f) => ({ ...f, name: e.target.value }));
                      if (fieldErrors.name) setFieldErrors((f) => ({ ...f, name: undefined }));
                    }}
                    placeholder="Filled in from category and room above — edit freely"
                  />
                  {fieldErrors.name ? (
                    <span className="field__error">{fieldErrors.name}</span>
                  ) : (
                    <span className="field__hint">
                      Filled in from the category and room above. Two hundred split ACs still need two
                      hundred different names — edit this if the location alone doesn't tell them apart.
                    </span>
                  )}
                </div>

                {editingAssetId && (
                  <div className="field">
                    <label>Asset tag</label>
                    <p className="field__hint" style={{ marginTop: 4 }}>
                      {assets.find((a) => a.id === editingAssetId)?.assetTag}
                      {' — generated automatically, can’t be changed.'}
                    </p>
                  </div>
                )}
              </div>

              <div className="modal-form__foot">
                <div className="modal-form__foot-actions">
                  <button type="button" className="btn-secondary" onClick={() => setShowAssetForm(false)} disabled={submitting}>
                    Cancel
                  </button>
                  <button type="submit" className="btn-accent" disabled={submitting}>
                    {submitting ? 'Saving…' : 'Save'}
                  </button>
                </div>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Bulk register: one purchase, several units. No close-on-backdrop-click
          for the same reason as the single-asset form — a form with a whole
          unit table shouldn't be discarded by a stray tap. */}
      {showBulkForm && (
        <div className="glass-backdrop inv-panel__backdrop">
          <div
            className="glass-panel inv-panel__modal inv-panel__modal--asset modal-form__panel"
            role="dialog"
            aria-modal="true"
            aria-labelledby="bulkModalTitle"
          >
            <form className="modal-form" onSubmit={handleBulkSubmit} noValidate>
              <div className="modal-form__head">
                <div className="modal-form__head-row">
                  <h3 id="bulkModalTitle">Register asset</h3>
                  <div className="toggle-group">
                    <button type="button" aria-pressed={registerMode === 'single'} onClick={() => switchRegisterMode('single')}>
                      Single
                    </button>
                    <button type="button" aria-pressed={registerMode === 'bulk'} onClick={() => switchRegisterMode('bulk')}>
                      Bulk register
                    </button>
                  </div>
                  <button
                    type="button"
                    className="modal-form__close"
                    onClick={() => setShowBulkForm(false)}
                    disabled={bulkSubmitting}
                    aria-label="Close"
                  >
                    ×
                  </button>
                </div>
                <p className="modal-form__sub">
                  One purchase, several units — fifty ACs from one vendor, one bill. Fill this in once;
                  only the room or location below needs to be different for each.
                </p>
              </div>

              <div className="modal-form__body modal-form__body--asset">
                {bulkError && (
                  <div className="form-banner form-banner--error form-banner--flash field--span2">{bulkError}</div>
                )}

                <div className="field field--span2">
                  <label htmlFor="bulkCategory">
                    Category <Req />
                  </label>
                  <CategoryField
                    id="bulkCategory"
                    value={bulkForm.categoryName}
                    onChange={(name) => {
                      setBulkForm((f) => ({ ...f, categoryName: name }));
                      if (bulkFieldErrors.categoryName) setBulkFieldErrors((f) => ({ ...f, categoryName: undefined }));
                    }}
                    options={[...new Set([...categories.map((c) => c.name), ...SUGGESTED_CATEGORIES])].sort((a, b) =>
                      a.localeCompare(b)
                    )}
                  />
                  {bulkFieldErrors.categoryName ? (
                    <span className="field__error">{bulkFieldErrors.categoryName}</span>
                  ) : (
                    <span className="field__hint">Every unit in this batch shares one category.</span>
                  )}
                </div>

                <div className="field">
                  <label htmlFor="bulkBrand">Brand / model</label>
                  <input
                    id="bulkBrand"
                    value={bulkForm.brand}
                    onChange={(e) => setBulkForm((f) => ({ ...f, brand: e.target.value }))}
                    placeholder="Brand"
                    style={{ marginBottom: 8 }}
                  />
                  <input
                    value={bulkForm.model}
                    onChange={(e) => setBulkForm((f) => ({ ...f, model: e.target.value }))}
                    placeholder="Model"
                  />
                </div>

                <div className="field">
                  <label htmlFor="bulkPurchaseDate">Purchase date</label>
                  <input
                    id="bulkPurchaseDate"
                    type="date"
                    value={bulkForm.purchaseDate}
                    onChange={(e) => setBulkForm((f) => ({ ...f, purchaseDate: e.target.value }))}
                  />
                </div>

                <div className="field">
                  <label htmlFor="bulkPurchaseCost">Cost per unit</label>
                  <input
                    id="bulkPurchaseCost"
                    type="number"
                    step="0.01"
                    value={bulkForm.purchaseCost}
                    onChange={(e) => setBulkForm((f) => ({ ...f, purchaseCost: e.target.value }))}
                  />
                </div>

                <div className="field">
                  <label htmlFor="bulkPaymentStatus">Payment status</label>
                  <select
                    id="bulkPaymentStatus"
                    value={bulkForm.paymentStatus}
                    onChange={(e) => setBulkForm((f) => ({ ...f, paymentStatus: e.target.value }))}
                  >
                    <option value="PAID">Paid</option>
                    <option value="PARTIAL">Partially paid</option>
                    <option value="PENDING">Pending</option>
                  </select>
                </div>

                {bulkForm.paymentStatus !== 'PENDING' && (
                  <div className="field">
                    <label htmlFor="bulkPaymentMethod">Paid via</label>
                    <select
                      id="bulkPaymentMethod"
                      value={bulkForm.paymentMethod}
                      onChange={(e) => setBulkForm((f) => ({ ...f, paymentMethod: e.target.value }))}
                    >
                      {PAYMENT_METHOD_OPTIONS.map(([value, label]) => (
                        <option key={value} value={value}>
                          {label}
                        </option>
                      ))}
                    </select>
                  </div>
                )}

                {PAYMENT_REFERENCE_LABEL[bulkForm.paymentMethod] && bulkForm.paymentStatus !== 'PENDING' && (
                  <div className="field">
                    <label htmlFor="bulkReferenceNumber">{PAYMENT_REFERENCE_LABEL[bulkForm.paymentMethod]}</label>
                    <input
                      id="bulkReferenceNumber"
                      value={bulkForm.referenceNumber}
                      onChange={(e) => setBulkForm((f) => ({ ...f, referenceNumber: e.target.value }))}
                    />
                  </div>
                )}

                {bulkForm.paymentStatus === 'PARTIAL' && (
                  <div className="field">
                    <label htmlFor="bulkAmountPaid">Amount paid so far (per unit)</label>
                    <input
                      id="bulkAmountPaid"
                      type="number"
                      min="0"
                      step="0.01"
                      max={bulkForm.purchaseCost || undefined}
                      value={bulkForm.amountPaid}
                      onChange={(e) => setBulkForm((f) => ({ ...f, amountPaid: e.target.value }))}
                    />
                  </div>
                )}

                <div className="field field--span2">
                  <label htmlFor="bulkVendor">Vendor (shop / company name)</label>
                  <VendorField
                    id="bulkVendor"
                    value={bulkForm.vendorName}
                    vendors={vendors}
                    onChange={(name) => setBulkForm((f) => ({ ...f, vendorName: name, vendorId: '' }))}
                    onPick={(vendor) =>
                      setBulkForm((f) => ({
                        ...f,
                        vendorId: String(vendor.id),
                        vendorName: vendor.name,
                        vendorContactPerson: vendor.contactPerson || '',
                        vendorPhone: vendor.phone || '',
                        vendorAltPhone: vendor.altPhone || '',
                        vendorEmail: vendor.email || '',
                        vendorSpecialty: vendor.specialty || '',
                      }))
                    }
                  />
                  <span className="field__hint">
                    {bulkForm.vendorId
                      ? 'Existing vendor — details below are theirs on file.'
                      : bulkForm.vendorName.trim()
                        ? 'No match — this will be added as a new vendor.'
                        : 'Search by name or phone, or type a new vendor.'}
                  </span>
                </div>

                <div className="field">
                  <label htmlFor="bulkVendorContact">Vendor contact person</label>
                  <input
                    id="bulkVendorContact"
                    value={bulkForm.vendorContactPerson}
                    onChange={(e) => setBulkForm((f) => ({ ...f, vendorContactPerson: e.target.value }))}
                  />
                </div>

                <div className="field">
                  <label htmlFor="bulkVendorPhone">Vendor phone</label>
                  <input
                    id="bulkVendorPhone"
                    value={bulkForm.vendorPhone}
                    onChange={(e) => setBulkForm((f) => ({ ...f, vendorPhone: typedMobile(e.target.value) }))}
                    type="tel"
                    inputMode="numeric"
                    maxLength={10}
                    placeholder="10-digit mobile"
                  />
                </div>

                <div className="field">
                  <label htmlFor="bulkVendorAltPhone">Vendor alternate phone</label>
                  <input
                    id="bulkVendorAltPhone"
                    value={bulkForm.vendorAltPhone}
                    onChange={(e) => setBulkForm((f) => ({ ...f, vendorAltPhone: typedMobile(e.target.value) }))}
                    type="tel"
                    inputMode="numeric"
                    maxLength={10}
                    placeholder="10-digit mobile (optional)"
                  />
                </div>

                <div className="field">
                  <label htmlFor="bulkVendorEmail">Vendor email</label>
                  <input
                    id="bulkVendorEmail"
                    value={bulkForm.vendorEmail}
                    onChange={(e) => setBulkForm((f) => ({ ...f, vendorEmail: e.target.value }))}
                  />
                </div>

                <div className="field">
                  <label htmlFor="bulkVendorSpecialty">Vendor specialty</label>
                  <input
                    id="bulkVendorSpecialty"
                    value={bulkForm.vendorSpecialty}
                    onChange={(e) => setBulkForm((f) => ({ ...f, vendorSpecialty: e.target.value }))}
                    placeholder="AC service, Electrical, Lift AMC…"
                  />
                </div>

                <div className="field field--span2">
                  <label htmlFor="bulkBill">Purchase bill</label>
                  <FileField
                    id="bulkBill"
                    file={bulkBillFile}
                    accept="image/jpeg,image/png,image/webp,application/pdf"
                    onChange={setBulkBillFile}
                  />
                  <span className="field__hint">
                    {bulkBillFile
                      ? 'Attached to every unit in this batch.'
                      : 'One bill covers the whole purchase — JPG, PNG or PDF, up to 5MB.'}
                  </span>
                </div>

                {/* Warranty only, same reasoning as the single-asset form —
                    AMC starts later, once this lapses, and from then on is
                    managed per-asset from its own Coverage history
                    (Add coverage / Renew), not here. Every unit in this
                    batch gets the same warranty end date and vendor. */}
                <div className="field field--span2">
                  <label htmlFor="bulkWarranty">Company warranty until</label>
                  <input
                    id="bulkWarranty"
                    type="date"
                    value={bulkForm.warrantyExpiry}
                    onChange={(e) => setBulkForm((f) => ({ ...f, warrantyExpiry: e.target.value }))}
                  />
                  <span className="field__hint">Leave blank if there's no maker's warranty on this batch.</span>
                </div>

                <h4 style={{ marginTop: 14 }}>
                  Units <span className="field__optional">{bulkUnits.length} so far</span>
                </h4>

                <div className="field field--span2">
                  <div className="inv-bar__actions" style={{ marginBottom: 10 }}>
                    <button type="button" className="btn-outline" onClick={downloadBulkTemplate}>
                      Download template
                    </button>
                    <label className="btn-outline" style={{ cursor: 'pointer', margin: 0 }}>
                      Upload filled template
                      <input
                        type="file"
                        accept=".csv,text/csv"
                        style={{ display: 'none' }}
                        onChange={(e) => {
                          const file = e.target.files?.[0];
                          if (file) importBulkTemplate(file);
                          e.target.value = '';
                        }}
                      />
                    </label>
                  </div>
                  <span className="field__hint">
                    Download the template, fill in a room number (or floor / location) per row in
                    Excel or Sheets, save as CSV, and upload it back — or just add rows by hand below.
                  </span>
                  {bulkImportError && (
                    <div className="form-banner form-banner--error" style={{ marginTop: 8 }}>
                      {bulkImportError}
                    </div>
                  )}
                </div>

                <div className="field field--span2">
                  <div className="asset-bulk-row__head" aria-hidden="true">
                    <span />
                    <span>Room</span>
                    <span>Floor</span>
                    <span>Location</span>
                    <span>Name</span>
                    <span>Serial number</span>
                    <span />
                  </div>
                  {bulkUnits.map((unit, index) => (
                    <div key={unit.key} id={`bulk-unit-row-${unit.key}`}>
                      <div className={`asset-bulk-row${bulkUnitErrors[unit.key] ? ' asset-bulk-row--error' : ''}`}>
                        <span className="asset-bulk-row__index">{index + 1}</span>
                        <select
                          aria-label={`Room for unit ${index + 1}`}
                          aria-invalid={Boolean(bulkUnitErrors[unit.key])}
                          value={unit.roomId}
                          onChange={(e) => {
                            const roomId = e.target.value;
                            const room = (rooms || []).find((r) => String(r.id) === roomId);
                            updateBulkUnit(unit.key, { roomId, floor: room?.floor || unit.floor });
                          }}
                        >
                          <option value="">Not room-bound</option>
                          {(rooms || []).map((r) => (
                            <option key={r.id} value={r.id}>
                              Room {r.roomNumber}
                            </option>
                          ))}
                        </select>
                        <input
                          aria-label={`Floor for unit ${index + 1}`}
                          value={unit.floor}
                          onChange={(e) => updateBulkUnit(unit.key, { floor: e.target.value })}
                          placeholder="Floor"
                          readOnly={!!unit.roomId}
                        />
                        <input
                          aria-label={`Location for unit ${index + 1}`}
                          value={unit.department}
                          onChange={(e) => updateBulkUnit(unit.key, { department: e.target.value })}
                          placeholder="Location description"
                          autoComplete="off"
                        />
                        <input
                          aria-label={`Name for unit ${index + 1}`}
                          value={unit.name}
                          onChange={(e) => updateBulkUnit(unit.key, { name: e.target.value })}
                          placeholder={bulkUnitName(unit) || 'Name (auto-filled)'}
                        />
                        <input
                          aria-label={`Serial number for unit ${index + 1}`}
                          value={unit.serialNumber}
                          onChange={(e) => updateBulkUnit(unit.key, { serialNumber: e.target.value })}
                          placeholder="Serial number"
                        />
                        <button
                          type="button"
                          className="asset-bulk-row__remove"
                          onClick={() => removeBulkUnit(unit.key)}
                          disabled={bulkUnits.length === 1}
                          aria-label={`Remove unit ${index + 1}`}
                        >
                          ×
                        </button>
                      </div>
                      {bulkUnitErrors[unit.key] && (
                        <span className="field__error asset-bulk-row__error">
                          Unit {index + 1}: {bulkUnitErrors[unit.key]}
                        </span>
                      )}
                    </div>
                  ))}
                  <button type="button" className="btn-outline" onClick={addBulkUnit} style={{ marginTop: 8 }}>
                    + Add unit
                  </button>
                </div>
              </div>

              <div className="modal-form__foot">
                <div className="modal-form__foot-actions">
                  <button
                    type="button"
                    className="btn-secondary"
                    onClick={() => setShowBulkForm(false)}
                    disabled={bulkSubmitting}
                  >
                    Cancel
                  </button>
                  <button type="submit" className="btn-accent" disabled={bulkSubmitting}>
                    {bulkSubmitting ? 'Saving…' : `Save ${bulkUnits.length} asset${bulkUnits.length === 1 ? '' : 's'}`}
                  </button>
                </div>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Work order form */}
      {showWoForm && (
        <div className="glass-backdrop inv-panel__backdrop">
          <div
            className="glass-panel inv-panel__modal inv-panel__modal--asset modal-form__panel"
            role="dialog"
            aria-modal="true"
            aria-labelledby="woModalTitle"
            onClick={(e) => e.stopPropagation()}
          >
            {woMode === 'single' ? (
              <form className="modal-form" onSubmit={handleWoSubmit} noValidate>
                <div className="modal-form__head">
                  <div className="modal-form__head-row">
                    <h3 id="woModalTitle">{editingWoId ? 'Edit work order' : 'Report an issue'}</h3>
                    {/* Editing is always one work order, same reasoning as the
                        asset form hiding its toggle while editing. */}
                    {!editingWoId && (
                      <div className="toggle-group">
                        <button type="button" aria-pressed={woMode === 'single'} onClick={() => switchWoMode('single')}>
                          Single
                        </button>
                        <button type="button" aria-pressed={woMode === 'bulk'} onClick={() => switchWoMode('bulk')}>
                          Bulk by category
                        </button>
                      </div>
                    )}
                    <button
                      type="button"
                      className="modal-form__close"
                      onClick={() => setShowWoForm(false)}
                      disabled={submitting}
                      aria-label="Close"
                    >
                      ×
                    </button>
                  </div>
                </div>

                <div className="modal-form__body">
                  {formError && <div className="form-banner form-banner--error form-banner--flash">{formError}</div>}

                  <div className="field">
                    <label htmlFor="woAsset">
                      Asset <Req />
                    </label>
                    <AssetPickerField
                      id="woAsset"
                      assets={assets}
                      selectedId={woForm.assetId}
                      onPick={(asset) => {
                        setWoForm((f) => ({ ...f, assetId: String(asset.id) }));
                        if (woFieldErrors.assetId) setWoFieldErrors((f) => ({ ...f, assetId: undefined }));
                        resolveActiveCoverageVendor(asset.id).then((vendor) => {
                          if (vendor) setWoForm((f) => ({ ...f, vendorId: String(vendor.vendorId) }));
                        });
                      }}
                      disabled={Boolean(editingWoId)}
                    />
                    {woFieldErrors.assetId ? (
                      <span className="field__error">{woFieldErrors.assetId}</span>
                    ) : null}
                  </div>

                  <div className="field">
                    <label htmlFor="woType">Type</label>
                    <select
                      id="woType"
                      value={woForm.issueType}
                      onChange={(e) => setWoForm((f) => ({ ...f, issueType: e.target.value }))}
                    >
                      <option value="BREAKDOWN">Breakdown</option>
                      <option value="ROUTINE_SERVICE">Routine service</option>
                    </select>
                  </div>

                  <div className="field">
                    <label htmlFor="woDescription">
                      Description <Req />
                    </label>
                    <input
                      id="woDescription"
                      aria-invalid={Boolean(woFieldErrors.description)}
                      value={woForm.description}
                      onChange={(e) => {
                        setWoForm((f) => ({ ...f, description: e.target.value }));
                        if (woFieldErrors.description) setWoFieldErrors((f) => ({ ...f, description: undefined }));
                      }}
                      placeholder="What's wrong, or what needs doing"
                    />
                    {woFieldErrors.description ? (
                      <span className="field__error">{woFieldErrors.description}</span>
                    ) : null}
                  </div>

                  {editingWoId && (
                    <div className="field">
                      <label htmlFor="woStatus">Status</label>
                      <select
                        id="woStatus"
                        value={woForm.status}
                        onChange={(e) => setWoForm((f) => ({ ...f, status: e.target.value }))}
                      >
                        {Object.entries(WO_STATUS_LABEL).map(([key, label]) => (
                          <option key={key} value={key}>
                            {label}
                          </option>
                        ))}
                      </select>
                    </div>
                  )}

                  <div className="field">
                    <label htmlFor="woAssignee">Assigned to</label>
                    <input
                      id="woAssignee"
                      value={woForm.assignedToName}
                      onChange={(e) => setWoForm((f) => ({ ...f, assignedToName: e.target.value }))}
                      placeholder="In-house handyman name"
                    />
                  </div>

                  <div className="field">
                    <label htmlFor="woVendor">Vendor</label>
                    <select
                      id="woVendor"
                      value={woForm.vendorId}
                      onChange={(e) => setWoForm((f) => ({ ...f, vendorId: e.target.value }))}
                    >
                      <option value="">None</option>
                      {(vendors || []).map((v) => (
                        <option key={v.id} value={v.id}>
                          {v.name}
                        </option>
                      ))}
                    </select>
                    <span className="field__hint">
                      Filled in from the asset's current AMC or warranty, if it has one on file — change it if
                      someone else is doing this repair.
                    </span>
                  </div>

                  {editingWoId && (
                    <>
                      <div className="field">
                        <label htmlFor="woPartsCost">Parts cost</label>
                        <input
                          id="woPartsCost"
                          type="number"
                          step="0.01"
                          value={woForm.partsCost}
                          onChange={(e) => setWoForm((f) => ({ ...f, partsCost: e.target.value }))}
                        />
                      </div>
                      <div className="field">
                        <label htmlFor="woLaborCost">Labor cost</label>
                        <input
                          id="woLaborCost"
                          type="number"
                          step="0.01"
                          value={woForm.laborCost}
                          onChange={(e) => setWoForm((f) => ({ ...f, laborCost: e.target.value }))}
                        />
                      </div>
                      <div className="field">
                        <label htmlFor="woPaymentStatus">Payment status</label>
                        <select
                          id="woPaymentStatus"
                          value={woForm.paymentStatus}
                          onChange={(e) => setWoForm((f) => ({ ...f, paymentStatus: e.target.value }))}
                        >
                          <option value="PAID">Paid</option>
                          <option value="PARTIAL">Partially paid</option>
                          <option value="PENDING">Pending</option>
                        </select>
                      </div>
                      {woForm.paymentStatus !== 'PENDING' && (
                        <div className="field">
                          <label htmlFor="woPaymentMethod">Paid via</label>
                          <select
                            id="woPaymentMethod"
                            value={woForm.paymentMethod}
                            onChange={(e) => setWoForm((f) => ({ ...f, paymentMethod: e.target.value }))}
                          >
                            {PAYMENT_METHOD_OPTIONS.map(([value, label]) => (
                              <option key={value} value={value}>
                                {label}
                              </option>
                            ))}
                          </select>
                        </div>
                      )}
                      {woForm.paymentStatus !== 'PENDING' && PAYMENT_REFERENCE_LABEL[woForm.paymentMethod] && (
                        <div className="field">
                          <label htmlFor="woReferenceNumber">{PAYMENT_REFERENCE_LABEL[woForm.paymentMethod]}</label>
                          <input
                            id="woReferenceNumber"
                            value={woForm.referenceNumber}
                            onChange={(e) => setWoForm((f) => ({ ...f, referenceNumber: e.target.value }))}
                          />
                        </div>
                      )}
                      {woForm.paymentStatus === 'PARTIAL' && (
                        <div className="field">
                          <label htmlFor="woAmountPaid">Amount paid so far</label>
                          <input
                            id="woAmountPaid"
                            type="number"
                            min="0"
                            step="0.01"
                            value={woForm.amountPaid}
                            onChange={(e) => setWoForm((f) => ({ ...f, amountPaid: e.target.value }))}
                          />
                        </div>
                      )}
                      <div className="field">
                        <label htmlFor="woPartsNote">Parts used</label>
                        <input
                          id="woPartsNote"
                          value={woForm.partsUsedNote}
                          onChange={(e) => setWoForm((f) => ({ ...f, partsUsedNote: e.target.value }))}
                        />
                      </div>
                      <label className="checkbox-inline">
                        <input
                          type="checkbox"
                          checked={Boolean(woForm.isWarrantyClaim)}
                          onChange={(e) => setWoForm((f) => ({ ...f, isWarrantyClaim: e.target.checked }))}
                        />
                        This repair is a warranty claim
                      </label>
                      <div className="field">
                        <label htmlFor="woResolution">Resolution note</label>
                        <input
                          id="woResolution"
                          value={woForm.resolutionNote}
                          onChange={(e) => setWoForm((f) => ({ ...f, resolutionNote: e.target.value }))}
                          placeholder="What was done"
                        />
                      </div>
                    </>
                  )}
                </div>

                <div className="modal-form__foot">
                  <div className="modal-form__foot-actions">
                    <button
                      type="button"
                      className="btn-secondary"
                      onClick={() => setShowWoForm(false)}
                      disabled={submitting}
                    >
                      Cancel
                    </button>
                    <button type="submit" className="btn-accent" disabled={submitting}>
                      {submitting ? 'Saving…' : 'Save'}
                    </button>
                  </div>
                </div>
              </form>
            ) : (
              <form className="modal-form" onSubmit={handleBulkWoSubmit} noValidate>
                <div className="modal-form__head">
                  <div className="modal-form__head-row">
                    <h3 id="woModalTitle">Bulk work order</h3>
                    <div className="toggle-group">
                      <button type="button" aria-pressed={woMode === 'single'} onClick={() => switchWoMode('single')}>
                        Single
                      </button>
                      <button type="button" aria-pressed={woMode === 'bulk'} onClick={() => switchWoMode('bulk')}>
                        Bulk by category
                      </button>
                    </div>
                    <button
                      type="button"
                      className="modal-form__close"
                      onClick={() => setShowWoForm(false)}
                      disabled={bulkWoSubmitting}
                      aria-label="Close"
                    >
                      ×
                    </button>
                  </div>
                </div>

                <div className="modal-form__body">
                  {bulkWoError && <div className="form-banner form-banner--error form-banner--flash">{bulkWoError}</div>}
                  <p className="field__hint">
                    Opens one work order for every active asset in the category you pick — e.g. every split AC, all
                    at once, for a contractor's routine visit.
                  </p>

                  <div className="field">
                    <label htmlFor="bulkWoCategory">
                      Category <Req />
                    </label>
                    <select
                      id="bulkWoCategory"
                      aria-invalid={Boolean(bulkWoFieldErrors.categoryId)}
                      value={bulkWoForm.categoryId}
                      onChange={(e) => {
                        setBulkWoForm((f) => ({ ...f, categoryId: e.target.value }));
                        if (bulkWoFieldErrors.categoryId) setBulkWoFieldErrors((f) => ({ ...f, categoryId: undefined }));
                      }}
                    >
                      <option value="">Choose a category</option>
                      {categoryFilterOptions.map((c) => (
                        <option key={c.id} value={c.id}>
                          {c.name} ({c.count})
                        </option>
                      ))}
                    </select>
                    {bulkWoFieldErrors.categoryId ? (
                      <span className="field__error">{bulkWoFieldErrors.categoryId}</span>
                    ) : null}
                  </div>

                  <div className="field">
                    <label htmlFor="bulkWoType">Type</label>
                    <select
                      id="bulkWoType"
                      value={bulkWoForm.issueType}
                      onChange={(e) => setBulkWoForm((f) => ({ ...f, issueType: e.target.value }))}
                    >
                      <option value="ROUTINE_SERVICE">Routine service</option>
                      <option value="BREAKDOWN">Breakdown</option>
                    </select>
                  </div>

                  <div className="field">
                    <label htmlFor="bulkWoDescription">
                      Description <Req />
                    </label>
                    <input
                      id="bulkWoDescription"
                      aria-invalid={Boolean(bulkWoFieldErrors.description)}
                      value={bulkWoForm.description}
                      onChange={(e) => {
                        setBulkWoForm((f) => ({ ...f, description: e.target.value }));
                        if (bulkWoFieldErrors.description) setBulkWoFieldErrors((f) => ({ ...f, description: undefined }));
                      }}
                      placeholder="e.g. Quarterly AMC service visit"
                    />
                    {bulkWoFieldErrors.description ? (
                      <span className="field__error">{bulkWoFieldErrors.description}</span>
                    ) : null}
                  </div>

                  <div className="field">
                    <label htmlFor="bulkWoAssignee">Assigned to</label>
                    <input
                      id="bulkWoAssignee"
                      value={bulkWoForm.assignedToName}
                      onChange={(e) => setBulkWoForm((f) => ({ ...f, assignedToName: e.target.value }))}
                      placeholder="In-house handyman name"
                    />
                  </div>

                  <div className="field">
                    <label htmlFor="bulkWoVendor">Vendor</label>
                    <select
                      id="bulkWoVendor"
                      value={bulkWoForm.vendorId}
                      onChange={(e) => setBulkWoForm((f) => ({ ...f, vendorId: e.target.value }))}
                    >
                      <option value="">None</option>
                      {(vendors || []).map((v) => (
                        <option key={v.id} value={v.id}>
                          {v.name}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>

                <div className="modal-form__foot">
                  <div className="modal-form__foot-actions">
                    <button
                      type="button"
                      className="btn-secondary"
                      onClick={() => setShowWoForm(false)}
                      disabled={bulkWoSubmitting}
                    >
                      Cancel
                    </button>
                    <button type="submit" className="btn-accent" disabled={bulkWoSubmitting}>
                      {bulkWoSubmitting ? 'Creating…' : 'Create work orders'}
                    </button>
                  </div>
                </div>
              </form>
            )}
          </div>
        </div>
      )}

      {/* Vendor form */}
      {showVendorForm && (
        <div className="glass-backdrop inv-panel__backdrop">
          <div
            className="glass-panel inv-panel__modal modal-form__panel"
            role="dialog"
            aria-modal="true"
            aria-labelledby="vendorModalTitle"
            onClick={(e) => e.stopPropagation()}
          >
            <form className="modal-form" onSubmit={handleVendorSubmit} noValidate>
              <div className="modal-form__head">
                <div className="modal-form__head-row">
                  <h3 id="vendorModalTitle">{editingVendorId ? 'Edit vendor' : 'Add vendor'}</h3>
                  <button
                    type="button"
                    className="modal-form__close"
                    onClick={() => setShowVendorForm(false)}
                    disabled={submitting}
                    aria-label="Close"
                  >
                    ×
                  </button>
                </div>
              </div>

              <div className="modal-form__body">
                {formError && <div className="form-banner form-banner--error form-banner--flash">{formError}</div>}

                <div className="field">
                  <label htmlFor="vendorName">
                    Name <Req />
                  </label>
                  <input
                    id="vendorName"
                    aria-invalid={Boolean(vendorFieldErrors.name)}
                    value={vendorForm.name}
                    onChange={(e) => {
                      setVendorForm((f) => ({ ...f, name: e.target.value }));
                      if (vendorFieldErrors.name) setVendorFieldErrors((f) => ({ ...f, name: undefined }));
                    }}
                    autoFocus
                  />
                  {vendorFieldErrors.name ? <span className="field__error">{vendorFieldErrors.name}</span> : null}
                </div>
                <div className="field">
                  <label htmlFor="vendorContact">Contact person</label>
                  <input
                    id="vendorContact"
                    value={vendorForm.contactPerson}
                    onChange={(e) => setVendorForm((f) => ({ ...f, contactPerson: e.target.value }))}
                  />
                </div>
                <div className="field">
                  <label htmlFor="vendorPhone">Phone</label>
                  <input
                    id="vendorPhone"
                    aria-invalid={Boolean(vendorFieldErrors.phone)}
                    value={vendorForm.phone}
                    onChange={(e) => {
                      setVendorForm((f) => ({ ...f, phone: typedMobile(e.target.value) }));
                      if (vendorFieldErrors.phone) setVendorFieldErrors((f) => ({ ...f, phone: undefined }));
                    }}
                    type="tel"
                    inputMode="numeric"
                    maxLength={10}
                    placeholder="10-digit mobile"
                  />
                  {vendorFieldErrors.phone ? <span className="field__error">{vendorFieldErrors.phone}</span> : null}
                </div>
                <div className="field">
                  <label htmlFor="vendorAltPhone">Alternate phone</label>
                  <input
                    id="vendorAltPhone"
                    aria-invalid={Boolean(vendorFieldErrors.altPhone)}
                    value={vendorForm.altPhone}
                    onChange={(e) => {
                      setVendorForm((f) => ({ ...f, altPhone: typedMobile(e.target.value) }));
                      if (vendorFieldErrors.altPhone) setVendorFieldErrors((f) => ({ ...f, altPhone: undefined }));
                    }}
                    type="tel"
                    inputMode="numeric"
                    maxLength={10}
                    placeholder="10-digit mobile (optional)"
                  />
                  {vendorFieldErrors.altPhone ? (
                    <span className="field__error">{vendorFieldErrors.altPhone}</span>
                  ) : null}
                </div>
                <div className="field">
                  <label htmlFor="vendorEmail">Email</label>
                  <input
                    id="vendorEmail"
                    value={vendorForm.email}
                    onChange={(e) => setVendorForm((f) => ({ ...f, email: e.target.value }))}
                  />
                </div>
                <div className="field">
                  <label htmlFor="vendorSpecialty">Specialty</label>
                  <input
                    id="vendorSpecialty"
                    value={vendorForm.specialty}
                    onChange={(e) => setVendorForm((f) => ({ ...f, specialty: e.target.value }))}
                    placeholder="AC service, Electrical, Lift AMC…"
                  />
                </div>
                <div className="field">
                  <label htmlFor="vendorNotes">Notes</label>
                  <input
                    id="vendorNotes"
                    value={vendorForm.notes}
                    onChange={(e) => setVendorForm((f) => ({ ...f, notes: e.target.value }))}
                  />
                </div>
              </div>

              <div className="modal-form__foot">
                <div className="modal-form__foot-actions">
                  <button type="button" className="btn-secondary" onClick={() => setShowVendorForm(false)} disabled={submitting}>
                    Cancel
                  </button>
                  <button type="submit" className="btn-accent" disabled={submitting}>
                    {submitting ? 'Saving…' : 'Save'}
                  </button>
                </div>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Add / renew coverage — a warranty or AMC period on the open asset. */}
      {showCoverageForm && (
        <div className="glass-backdrop inv-panel__backdrop">
          <div
            className="glass-panel inv-panel__modal modal-form__panel"
            role="dialog"
            aria-modal="true"
            aria-labelledby="coverageModalTitle"
            onClick={(e) => e.stopPropagation()}
          >
            <form className="modal-form" onSubmit={handleCoverageSubmit} noValidate>
              <div className="modal-form__head">
                <div className="modal-form__head-row">
                  <h3 id="coverageModalTitle">{editingCoveragePeriodId ? 'Edit coverage' : 'Add coverage'}</h3>
                  <button
                    type="button"
                    className="modal-form__close"
                    onClick={() => setShowCoverageForm(false)}
                    disabled={coverageSubmitting}
                    aria-label="Close"
                  >
                    ×
                  </button>
                </div>
              </div>

              <div className="modal-form__body">
                {coverageError && <div className="form-banner form-banner--error form-banner--flash">{coverageError}</div>}

                <div className="field">
                  <label htmlFor="coverageType">Type</label>
                  <select
                    id="coverageType"
                    value={coverageForm.coverageType}
                    onChange={(e) => setCoverageForm((f) => ({ ...f, coverageType: e.target.value }))}
                  >
                    <option value="WARRANTY">Warranty</option>
                    <option value="AMC">AMC</option>
                  </select>
                </div>

                <div className="field">
                  <label htmlFor="coverageVendor">Vendor</label>
                  <VendorField
                    id="coverageVendor"
                    value={coverageForm.vendorName}
                    vendors={vendors}
                    onChange={(name) => setCoverageForm((f) => ({ ...f, vendorName: name, vendorId: '' }))}
                    onPick={(vendor) =>
                      setCoverageForm((f) => ({
                        ...f,
                        vendorId: String(vendor.id),
                        vendorName: vendor.name,
                        vendorContactPerson: vendor.contactPerson || '',
                        vendorPhone: vendor.phone || '',
                        vendorAltPhone: vendor.altPhone || '',
                        vendorEmail: vendor.email || '',
                        vendorSpecialty: vendor.specialty || '',
                      }))
                    }
                  />
                </div>

                <div className="field">
                  <label htmlFor="coverageStart">Start date</label>
                  <input
                    id="coverageStart"
                    type="date"
                    value={coverageForm.startDate}
                    onChange={(e) => setCoverageForm((f) => ({ ...f, startDate: e.target.value }))}
                  />
                </div>

                <div className="field">
                  <label htmlFor="coverageEnd">
                    End date <Req />
                  </label>
                  <input
                    id="coverageEnd"
                    type="date"
                    aria-invalid={Boolean(coverageFieldErrors.endDate)}
                    value={coverageForm.endDate}
                    onChange={(e) => {
                      setCoverageForm((f) => ({ ...f, endDate: e.target.value }));
                      if (coverageFieldErrors.endDate) setCoverageFieldErrors((f) => ({ ...f, endDate: undefined }));
                    }}
                  />
                  {coverageFieldErrors.endDate ? (
                    <span className="field__error">{coverageFieldErrors.endDate}</span>
                  ) : null}
                </div>

                <div className="field">
                  <label htmlFor="coverageCost">Cost</label>
                  <input
                    id="coverageCost"
                    type="number"
                    step="0.01"
                    value={coverageForm.cost}
                    onChange={(e) => setCoverageForm((f) => ({ ...f, cost: e.target.value }))}
                  />
                </div>

                <div className="field">
                  <label htmlFor="coveragePaymentStatus">Payment status</label>
                  <select
                    id="coveragePaymentStatus"
                    value={coverageForm.paymentStatus}
                    onChange={(e) => setCoverageForm((f) => ({ ...f, paymentStatus: e.target.value }))}
                  >
                    <option value="PAID">Paid</option>
                    <option value="PARTIAL">Partially paid</option>
                    <option value="PENDING">Pending</option>
                  </select>
                </div>

                {coverageForm.paymentStatus !== 'PENDING' && (
                  <div className="field">
                    <label htmlFor="coveragePaymentMethod">Paid via</label>
                    <select
                      id="coveragePaymentMethod"
                      value={coverageForm.paymentMethod}
                      onChange={(e) => setCoverageForm((f) => ({ ...f, paymentMethod: e.target.value }))}
                    >
                      {PAYMENT_METHOD_OPTIONS.map(([value, label]) => (
                        <option key={value} value={value}>
                          {label}
                        </option>
                      ))}
                    </select>
                  </div>
                )}

                {coverageForm.paymentStatus !== 'PENDING' && PAYMENT_REFERENCE_LABEL[coverageForm.paymentMethod] && (
                  <div className="field">
                    <label htmlFor="coverageReferenceNumber">{PAYMENT_REFERENCE_LABEL[coverageForm.paymentMethod]}</label>
                    <input
                      id="coverageReferenceNumber"
                      value={coverageForm.referenceNumber}
                      onChange={(e) => setCoverageForm((f) => ({ ...f, referenceNumber: e.target.value }))}
                    />
                  </div>
                )}

                {coverageForm.paymentStatus === 'PARTIAL' && (
                  <div className="field">
                    <label htmlFor="coverageAmountPaid">Amount paid so far</label>
                    <input
                      id="coverageAmountPaid"
                      type="number"
                      min="0"
                      step="0.01"
                      max={coverageForm.cost || undefined}
                      value={coverageForm.amountPaid}
                      onChange={(e) => setCoverageForm((f) => ({ ...f, amountPaid: e.target.value }))}
                    />
                  </div>
                )}

                <div className="field">
                  <label htmlFor="coverageNote">Coverage note</label>
                  <input
                    id="coverageNote"
                    value={coverageForm.coverageNote}
                    onChange={(e) => setCoverageForm((f) => ({ ...f, coverageNote: e.target.value }))}
                    placeholder="What this covers"
                  />
                </div>
              </div>

              <div className="modal-form__foot">
                <div className="modal-form__foot-actions">
                  <button
                    type="button"
                    className="btn-secondary"
                    onClick={() => setShowCoverageForm(false)}
                    disabled={coverageSubmitting}
                  >
                    Cancel
                  </button>
                  <button type="submit" className="btn-accent" disabled={coverageSubmitting}>
                    {coverageSubmitting ? 'Saving…' : 'Save'}
                  </button>
                </div>
              </div>
            </form>
          </div>
        </div>
      )}

    </div>
  );
}
