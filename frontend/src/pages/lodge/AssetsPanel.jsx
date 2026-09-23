import { useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { apiGet, apiPost, apiPatch, apiDelete, apiPostForm, apiPatchForm, apiGetBlob, ApiError } from '../../lib/api';
import { getSession } from '../../lib/auth';
import { readCache, writeCache } from '../../lib/dataCache';
import { toQrDataUrl, assetUrl } from '../../lib/qr';
import SectionTabs from './SectionTabs';
import RowMenu from './RowMenu';
import Req from '../../components/RequiredMark';
import './forms.css';
import './InventoryPanel.css';

const STATUS_LABEL = {
  IN_USE: 'In use',
  UNDER_REPAIR: 'Under repair',
  TRANSFERRED: 'Transferred',
  RETIRED: 'Retired',
};

const WO_STATUS_LABEL = { OPEN: 'Open', IN_PROGRESS: 'In progress', CLOSED: 'Closed' };

const emptyAssetForm = {
  name: '',
  categoryName: '',
  brand: '',
  model: '',
  serialNumber: '',
  purchaseDate: '',
  purchaseCost: '',
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
  vendorEmail: '',
  vendorSpecialty: '',
  startDate: '',
  endDate: '',
  cost: '',
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
  vendorId: '',
  vendorName: '',
  vendorContactPerson: '',
  vendorPhone: '',
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

const emptyVendorForm = { name: '', contactPerson: '', phone: '', email: '', specialty: '', notes: '' };

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
        placeholder="Vendor name or phone…"
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

export default function AssetsPanel() {
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
  const [selectedAssetId, setSelectedAssetId] = useState(null);
  // { assetId, workOrders } — keyed by asset so a stale list from the
  // previously open asset never renders as this one's history.
  const [assetHistory, setAssetHistory] = useState(null);
  // { assetId, periods } — same keying, for the warranty/AMC coverage list.
  const [coveragePeriods, setCoveragePeriods] = useState(null);
  // A scanned QR lands here as ?assetToken=... — read once as the initial
  // selection rather than applied from an effect, so opening the detail view
  // for it doesn't need a setState synchronized against the assets list.
  const [consumedAssetToken, setConsumedAssetToken] = useState(null);

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
  const [editingWoId, setEditingWoId] = useState(null);
  const [woForm, setWoForm] = useState(emptyWorkOrderForm);
  const [woStatusFilter, setWoStatusFilter] = useState('OPEN');

  const [showVendorForm, setShowVendorForm] = useState(false);
  const [editingVendorId, setEditingVendorId] = useState(null);
  const [vendorForm, setVendorForm] = useState(emptyVendorForm);

  const [showCoverageForm, setShowCoverageForm] = useState(false);
  const [coverageForm, setCoverageForm] = useState(emptyCoverageForm);
  const [coverageSubmitting, setCoverageSubmitting] = useState(false);
  const [coverageError, setCoverageError] = useState('');

  const [formError, setFormError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const loadAssets = () =>
    apiGet('/assets', { token: session?.token })
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
      if (!needle) return true;
      return (
        a.name.toLowerCase().includes(needle) ||
        (a.assetTag || '').toLowerCase().includes(needle) ||
        (a.roomNumber || '').toLowerCase().includes(needle) ||
        (a.department || '').toLowerCase().includes(needle)
      );
    });
  }, [assets, query, categoryFilter]);

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
            roomId: asset.roomId ? String(asset.roomId) : '',
            floor: asset.floor || '',
            department: asset.department || '',
            locationNote: asset.locationNote || '',
            vendorId: asset.vendorId ? String(asset.vendorId) : '',
            vendorName: asset.vendorName || '',
            vendorContactPerson: vendor?.contactPerson || '',
            vendorPhone: vendor?.phone || '',
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
    setFieldErrors(errors);
    if (Object.keys(errors).length > 0) {
      focusFirstError(errors, { categoryName: 'assetCategory', name: 'assetName' });
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
    setShowBulkForm(true);
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

  const reportIssue = (asset) => {
    setWoForm({ ...emptyWorkOrderForm, assetId: String(asset.id) });
    setEditingWoId(null);
    setFormError('');
    setShowWoForm(true);
  };

  // ---------------------------------------------------------------------
  // Coverage: warranty, then AMC, then AMC renewed
  // ---------------------------------------------------------------------

  // renewFrom, when given, is the period that's lapsing — its vendor and
  // type carry over so extending an AMC is just picking new dates, not
  // re-typing who covers it. Left out for "Add coverage" from a blank slate.
  const openCoverageForm = (renewFrom) => {
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
    setShowCoverageForm(true);
  };

  const handleCoverageSubmit = async (e) => {
    e.preventDefault();
    if (!coverageForm.endDate) {
      setCoverageError('Enter when this coverage ends.');
      return;
    }
    if (!selectedAsset) return;

    setCoverageSubmitting(true);
    setCoverageError('');
    try {
      const vendorId = await resolveVendorId(coverageForm);
      await apiPost(
        `/assets/${selectedAsset.id}/coverage`,
        {
          coverageType: coverageForm.coverageType,
          vendorId: vendorId ?? '',
          startDate: coverageForm.startDate,
          endDate: coverageForm.endDate,
          cost: coverageForm.cost,
          coverageNote: coverageForm.coverageNote,
        },
        { token: session?.token }
      );
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
            partsUsedNote: workOrder.partsUsedNote || '',
            isWarrantyClaim: workOrder.isWarrantyClaim,
            resolutionNote: workOrder.resolutionNote || '',
          }
        : emptyWorkOrderForm
    );
    setFormError('');
    setShowWoForm(true);
  };

  const handleWoSubmit = async (e) => {
    e.preventDefault();
    if (!woForm.assetId) {
      setFormError('Choose an asset.');
      return;
    }
    if (!woForm.description.trim()) {
      setFormError('Describe the issue.');
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
            email: vendor.email || '',
            specialty: vendor.specialty || '',
            notes: vendor.notes || '',
          }
        : emptyVendorForm
    );
    setFormError('');
    setShowVendorForm(true);
  };

  const handleVendorSubmit = async (e) => {
    e.preventDefault();
    if (!vendorForm.name.trim()) {
      setFormError('Vendor name is required.');
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

  if (error && !assets) {
    return <div className="form-banner form-banner--error">{error}</div>;
  }

  if (!assets || !categories) {
    return <p className="inv-panel__hint">Loading assets…</p>;
  }

  return (
    <div>
      {error && <div className="form-banner form-banner--error">{error}</div>}

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

      {tab === 'register' && (
        <div>
          <div className="inv-bar">
            <div className="inv-bar__row">
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
              <div className="inv-bar__actions">
                <button type="button" className="btn-secondary" onClick={openBulkForm}>
                  Bulk register
                </button>
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
          ) : (
            <ul className="inv-list">
              {visibleAssets.map((asset) => {
                const wFlag = expiryFlag(asset.warrantyExpiry);
                const aFlag = expiryFlag(asset.amcExpiry);
                const badFlag = wFlag === 'expired' || aFlag === 'expired' ? 'expired' : wFlag || aFlag;
                return (
                  <li
                    key={asset.id}
                    className={`inv-item${badFlag === 'expired' ? ' inv-item--bad' : badFlag === 'soon' ? ' inv-item--low' : ''}`}
                  >
                    <div className="inv-item__body" onClick={() => openAssetDetail(asset)} style={{ cursor: 'pointer' }}>
                      <div className="inv-item__name">
                        {asset.name}
                        <span className="inv-tag">{STATUS_LABEL[asset.status]}</span>
                        {badFlag === 'expired' && <span className="inv-tag inv-tag--bad">Warranty/AMC expired</span>}
                        {badFlag === 'soon' && <span className="inv-tag inv-tag--low">Expiring soon</span>}
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
            <div className="inv-bar__row">
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
              <div className="inv-bar__actions">
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
        <div className="glass-backdrop inv-panel__backdrop" onClick={closeAssetDetail}>
          <div
            className="glass-panel inv-panel__modal inv-panel__modal--wide"
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
              <div className="field">
                <label>Status</label>
                <select value={selectedAsset.status} onChange={(e) => changeAssetStatus(selectedAsset, e.target.value)}>
                  {Object.entries(STATUS_LABEL).map(([key, label]) => (
                    <option key={key} value={key}>
                      {label}
                    </option>
                  ))}
                </select>
              </div>

              <p>
                <strong>Location:</strong>{' '}
                {selectedAsset.roomNumber
                  ? `Room ${selectedAsset.roomNumber}`
                  : [selectedAsset.floor && `Floor ${selectedAsset.floor}`, selectedAsset.department]
                      .filter(Boolean)
                      .join(' · ') || 'Not set'}
              </p>
              {selectedAsset.brand && (
                <p>
                  <strong>Brand/model:</strong> {selectedAsset.brand} {selectedAsset.model}
                </p>
              )}
              {selectedAsset.serialNumber && (
                <p>
                  <strong>Serial number:</strong> {selectedAsset.serialNumber}
                </p>
              )}
              {selectedAsset.purchaseDate && (
                <p>
                  <strong>Purchased:</strong> {formatDate(selectedAsset.purchaseDate)}
                  {selectedAsset.purchaseCost != null && ` · ₹${selectedAsset.purchaseCost}`}
                </p>
              )}
              <p>
                <strong>Warranty:</strong> {formatDate(selectedAsset.warrantyExpiry)}
                {' · '}
                <strong>AMC:</strong> {formatDate(selectedAsset.amcExpiry)}
              </p>
              {selectedAsset.vendorName && (
                <p>
                  <strong>Vendor:</strong> {selectedAsset.vendorName}
                </p>
              )}
              <p>
                <strong>Purchase bill:</strong>{' '}
                {selectedAsset.hasBillDocument ? (
                  <button type="button" className="inv-linkbtn" onClick={() => viewBill(selectedAsset)}>
                    View bill
                  </button>
                ) : (
                  'Not uploaded'
                )}
              </p>

              {qrDataUrl && (
                <div style={{ textAlign: 'center', margin: '16px 0' }}>
                  <img src={qrDataUrl} alt={`QR code for ${selectedAsset.name}`} width={160} height={160} />
                  <p className="inv-panel__hint">Scan to open this asset</p>
                </div>
              )}

              <div className="modal-form__foot-actions" style={{ justifyContent: 'flex-start', marginBottom: 16 }}>
                <button type="button" className="btn-accent" onClick={() => reportIssue(selectedAsset)}>
                  Report an issue
                </button>
                <button type="button" className="btn-outline" onClick={() => openCoverageForm(null)}>
                  Add coverage
                </button>
              </div>

              <h4>Coverage history</h4>
              {visibleCoveragePeriods === null ? (
                <p className="inv-panel__hint">Loading…</p>
              ) : visibleCoveragePeriods.length === 0 ? (
                <p className="inv-panel__hint">
                  No warranty or AMC on record yet. "Add coverage" logs the maker's warranty at purchase,
                  then each AMC as it starts — so who covered a repair, and when the cover ran out, stays
                  answerable after it's renewed a few times.
                </p>
              ) : (
                <ul className="inv-ledger">
                  {visibleCoveragePeriods.map((period) => {
                    const flag = expiryFlag(period.endDate);
                    const isLatestOfType =
                      period.id ===
                      visibleCoveragePeriods.find((p) => p.coverageType === period.coverageType)?.id;
                    return (
                      <li key={period.id} className="inv-ledger__row">
                        <div className="inv-ledger__what">
                          <span className="inv-ledger__reason">
                            {period.coverageType === 'AMC' ? 'AMC' : 'Warranty'}
                          </span>
                          <span className="inv-ledger__detail">
                            {[period.vendorName, period.coverageNote].filter(Boolean).join(' · ') || '—'}
                            {period.cost != null && ` · ₹${period.cost}`}
                          </span>
                        </div>
                        <div
                          className={`inv-ledger__when${
                            flag === 'expired' ? ' inv-tag--bad' : flag === 'soon' ? ' inv-tag--low' : ''
                          }`}
                        >
                          {period.startDate ? `${formatDate(period.startDate)} – ` : 'Until '}
                          {formatDate(period.endDate)}
                        </div>
                        <div className="inv-item__actions" style={{ marginTop: 4 }}>
                          {isLatestOfType && (
                            <button
                              type="button"
                              className="inv-linkbtn"
                              onClick={() => openCoverageForm(period)}
                            >
                              Renew
                            </button>
                          )}
                          <button
                            type="button"
                            className="inv-linkbtn"
                            onClick={() => deleteCoveragePeriod(period)}
                          >
                            Delete
                          </button>
                        </div>
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

                <h4 style={{ marginTop: 14 }}>Purchase details</h4>

                <div className="field">
                  <label htmlFor="assetBrand">Brand / model</label>
                  <input
                    id="assetBrand"
                    value={assetForm.brand}
                    onChange={(e) => setAssetForm((f) => ({ ...f, brand: e.target.value }))}
                    placeholder="Brand"
                    style={{ marginBottom: 8 }}
                  />
                  <input
                    value={assetForm.model}
                    onChange={(e) => setAssetForm((f) => ({ ...f, model: e.target.value }))}
                    placeholder="Model"
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

                <div className="field field--span2">
                  <label htmlFor="assetVendor">Vendor</label>
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
                    value={assetForm.vendorPhone}
                    onChange={(e) => setAssetForm((f) => ({ ...f, vendorPhone: e.target.value }))}
                  />
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

                <h4 style={{ marginTop: 14 }}>Installation details</h4>

                <div className="field">
                  <label htmlFor="assetRoom">Room</label>
                  <select
                    id="assetRoom"
                    value={assetForm.roomId}
                    onChange={(e) => setAssetForm((f) => ({ ...f, roomId: e.target.value }))}
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
                  />
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
                  <h3 id="bulkModalTitle">Bulk register</h3>
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

                <div className="field field--span2">
                  <label htmlFor="bulkVendor">Vendor</label>
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
                    onChange={(e) => setBulkForm((f) => ({ ...f, vendorPhone: e.target.value }))}
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
                          onChange={(e) => updateBulkUnit(unit.key, { roomId: e.target.value })}
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
        <div className="glass-backdrop inv-panel__backdrop" onClick={() => !submitting && setShowWoForm(false)}>
          <div
            className="glass-panel inv-panel__modal modal-form__panel"
            role="dialog"
            aria-modal="true"
            aria-labelledby="woModalTitle"
            onClick={(e) => e.stopPropagation()}
          >
            <form className="modal-form" onSubmit={handleWoSubmit} noValidate>
              <div className="modal-form__head">
                <div className="modal-form__head-row">
                  <h3 id="woModalTitle">{editingWoId ? 'Edit work order' : 'Report an issue'}</h3>
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
                    onPick={(asset) => setWoForm((f) => ({ ...f, assetId: String(asset.id) }))}
                    disabled={Boolean(editingWoId)}
                  />
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
                    value={woForm.description}
                    onChange={(e) => setWoForm((f) => ({ ...f, description: e.target.value }))}
                    placeholder="What's wrong, or what needs doing"
                  />
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
                  <button type="button" className="btn-secondary" onClick={() => setShowWoForm(false)} disabled={submitting}>
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

      {/* Vendor form */}
      {showVendorForm && (
        <div className="glass-backdrop inv-panel__backdrop" onClick={() => !submitting && setShowVendorForm(false)}>
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
                    value={vendorForm.name}
                    onChange={(e) => setVendorForm((f) => ({ ...f, name: e.target.value }))}
                    autoFocus
                  />
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
                    value={vendorForm.phone}
                    onChange={(e) => setVendorForm((f) => ({ ...f, phone: e.target.value }))}
                  />
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
        <div className="glass-backdrop inv-panel__backdrop" onClick={() => !coverageSubmitting && setShowCoverageForm(false)}>
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
                  <h3 id="coverageModalTitle">Add coverage</h3>
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
                    value={coverageForm.endDate}
                    onChange={(e) => setCoverageForm((f) => ({ ...f, endDate: e.target.value }))}
                  />
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
