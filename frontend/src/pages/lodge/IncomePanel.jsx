import { useEffect, useMemo, useRef, useState } from 'react';
import PageLoader from '../../components/PageLoader';
import {
  apiGet,
  apiPost,
  apiPatch,
  apiDelete,
  apiPostForm,
  apiPatchForm,
  apiGetBlob,
  ApiError,
} from '../../lib/api';
import { getSession } from '../../lib/auth';
import { readCache, writeCache } from '../../lib/dataCache';
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
import './AnalyticsCharts.css';

const FREQUENCY_LABEL = { MONTHLY: 'Monthly', QUARTERLY: 'Quarterly', YEARLY: 'Yearly' };

// Same rule as typedMobile in ExpensesPanel.jsx/Bookings.jsx — duplicated
// rather than shared, but the two must agree with income.schema.js's own
// phone check.
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

const PAYMENT_STATUS_LABEL = { PAID: 'Received', PARTIAL: 'Partially received', PENDING: 'Pending' };
const PAYMENT_STATUS_TAG_CLASS = { PAID: 'inv-tag--good', PARTIAL: 'inv-tag--low', PENDING: 'inv-tag--bad' };

const TABLE_SORT_ACCESSORS = {
  date: (e) => (e.incomeDate ? new Date(e.incomeDate).getTime() : 0),
  title: (e) => e.title || '',
  category: (e) => e.categoryName || '',
  payer: (e) => e.payerName || '',
  amount: (e) => Number(e.amount || 0),
  method: (e) => e.paymentMethod || '',
  status: (e) => e.paymentStatus || '',
};

// Offered as suggestions, not a fixed list — same idea as
// SUGGESTED_CATEGORIES in ExpensesPanel.jsx.
const INTEREST_CATEGORY = 'Interest Earned';
const SUGGESTED_CATEGORIES = [
  INTEREST_CATEGORY,
  'Scrap Sale',
  'Rent Received',
  'Commission Received',
  'Refund Received',
  'Miscellaneous',
];

// Maps a field's key in an errors object to the DOM id its input actually
// carries, then focuses and scrolls to the first one that has a message —
// same pattern as ExpensesPanel/AssetsPanel/InventoryPanel's focusFirstError.
function focusFirstError(errors, fieldIds) {
  const first = Object.keys(fieldIds).find((key) => errors[key]);
  if (!first) return;
  const el = document.getElementById(fieldIds[first]);
  if (!el) return;
  el.focus({ preventScroll: true });
  el.scrollIntoView({ block: 'center', behavior: 'smooth' });
}

function formatDate(value) {
  if (!value) return '';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return value;
  return d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
}

function todayIso() {
  return new Date().toISOString().slice(0, 10);
}

// A styled stand-in for a native <datalist> — same component as
// CategoryField in ExpensesPanel.jsx/AssetsPanel.jsx, kept as its own copy
// here for the same reason: the panels' forms don't share a module today.
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
        placeholder="Interest, Scrap sale, Rent received…"
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

// Same shape as CategoryField, but matches across name/phone/email and hands
// back the whole payer object on pick — same component as VendorField in
// ExpensesPanel.jsx, reused for the payer side of an income entry (payers
// and vendors share dbo.vendors as one generic contacts directory).
function PayerField({ id, value, payers, onChange, onPick }) {
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
    ? (payers || []).filter(
        (v) =>
          v.name.toLowerCase().includes(needle) ||
          (v.phone || '').toLowerCase().includes(needle) ||
          (v.altPhone || '').toLowerCase().includes(needle) ||
          (v.email || '').toLowerCase().includes(needle)
      )
    : payers || [];
  const activeIndex = active < matches.length ? active : -1;

  const take = (payer) => {
    setOpen(false);
    onPick(payer);
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
        placeholder="Payer name or phone…"
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
          {matches.map((payer, i) => (
            <li key={payer.id} role="option" aria-selected={i === activeIndex} id={`${id}-suggestion-${i}`}>
              <button
                type="button"
                className={`asset-suggest__option${i === activeIndex ? ' asset-suggest__option--active' : ''}`}
                onMouseDown={(e) => {
                  e.preventDefault();
                  take(payer);
                }}
                onMouseEnter={() => setActive(i)}
              >
                {payer.name}
                {(payer.phone || payer.specialty) && (
                  <span className="asset-suggest__option-meta">
                    {[payer.phone, payer.specialty].filter(Boolean).join(' · ')}
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

const emptyIncomeForm = {
  categoryName: '',
  payerId: '',
  payerName: '',
  payerContactPerson: '',
  payerPhone: '',
  payerAltPhone: '',
  payerEmail: '',
  payerSpecialty: '',
  title: '',
  description: '',
  amount: '',
  paymentMethod: 'CASH',
  paymentStatus: 'PAID',
  amountReceived: '',
  referenceNumber: '',
  incomeDate: todayIso(),
  // Read-only in the form itself — set from the entry on open, only used to
  // offer "View receipt" in the view-mode summary.
  hasReceiptDocument: false,
};

// A repeat schedule only — no amount or payer. Those aren't known until the
// desk actually logs an occurrence (see emptyOccurrenceForm equivalent
// below), since a template covers receipts whose amount varies cycle to
// cycle as often as ones that don't.
const emptyTemplateForm = {
  categoryName: '',
  title: '',
  frequency: 'MONTHLY',
  nextDueDate: todayIso(),
};

const emptyPayerForm = { name: '', contactPerson: '', phone: '', altPhone: '', email: '', specialty: '', notes: '' };

export default function IncomePanel({ onViewReport }) {
  const session = getSession();
  const [tab, setTab] = useState('income');

  const [income, setIncome] = useState(() => readCache('/income') || []);
  const [categories, setCategories] = useState(() => readCache('/income/categories') || []);
  const [payers, setPayers] = useState(() => readCache('/income/payers') || []);
  const [templates, setTemplates] = useState(() => readCache('/income/recurring') || []);
  const [summary, setSummary] = useState(() => readCache('/income/summary') || null);

  const [error, setError] = useState('');

  // Filters
  const [query, setQuery] = useState('');
  const [categoryFilter, setCategoryFilter] = useState('');
  const [paymentMethodFilter, setPaymentMethodFilter] = useState('');
  const [paymentStatusFilter, setPaymentStatusFilter] = useState('');
  const [fromDate, setFromDate] = useState('');
  const [toDate, setToDate] = useState('');
  const [showDateRange, setShowDateRange] = useState(false);

  // Card vs table view, same toggle as ExpensesPanel's register.
  const [incomeView, setIncomeView] = useState('table');
  const [tableSort, setTableSort] = useState({ key: 'date', dir: 'desc' });

  // Income form
  const [showIncomeForm, setShowIncomeForm] = useState(false);
  const [editingIncomeId, setEditingIncomeId] = useState(null);
  const [incomeForm, setIncomeForm] = useState(emptyIncomeForm);
  const [incomeReceiptFile, setIncomeReceiptFile] = useState(null);
  const [formError, setFormError] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [incomeFieldErrors, setIncomeFieldErrors] = useState({});
  // A row click opens this modal read-only — "Edit details" flips it into
  // the form. Always false for a brand-new entry.
  const [viewMode, setViewMode] = useState(false);

  // Receipts against the income entry being edited — not always received in
  // one go, so this is a running list, not a single field on the form.
  const [receipts, setReceipts] = useState([]);
  const [newReceipt, setNewReceipt] = useState({ amount: '', paymentMethod: 'CASH', referenceNumber: '', receivedDate: todayIso() });
  const [receiptError, setReceiptError] = useState('');
  const [addingReceipt, setAddingReceipt] = useState(false);

  // The receipt/proof document preview, shown in its own small modal.
  const [documentPreviewUrl, setDocumentPreviewUrl] = useState('');

  // Set while the income form is open for "Log this month" rather than a
  // plain new/edit entry — routes the submit to POST
  // /income/recurring/:id/log instead of POST /income.
  const [loggingTemplate, setLoggingTemplate] = useState(null);

  // Template form
  const [showTemplateForm, setShowTemplateForm] = useState(false);
  const [editingTemplateId, setEditingTemplateId] = useState(null);
  const [templateForm, setTemplateForm] = useState(emptyTemplateForm);
  const [templateFieldErrors, setTemplateFieldErrors] = useState({});

  // Occurrence history — every income entry a recurring template has
  // generated so far.
  const [templateHistory, setTemplateHistory] = useState(null);
  const [templateHistoryLoading, setTemplateHistoryLoading] = useState(false);

  // Payer form
  const [showPayerForm, setShowPayerForm] = useState(false);
  const [editingPayerId, setEditingPayerId] = useState(null);
  const [payerForm, setPayerForm] = useState(emptyPayerForm);
  const [payerFieldErrors, setPayerFieldErrors] = useState({});

  const loadIncome = () =>
    apiGet('/income', { token: session?.token })
      .then((data) => setIncome(writeCache('/income', data.income)))
      .catch((err) => setError(err instanceof ApiError ? err.message : 'Could not load income.'));

  const loadCategories = () =>
    apiGet('/income/categories', { token: session?.token })
      .then((data) => setCategories(writeCache('/income/categories', data.categories)))
      .catch(() => {});

  const loadPayers = () =>
    apiGet('/income/payers', { token: session?.token })
      .then((data) => {
        const list = writeCache('/income/payers', data.payers);
        setPayers(list);
        return list;
      })
      .catch(() => payers);

  const loadTemplates = () =>
    apiGet('/income/recurring', { token: session?.token })
      .then((data) => setTemplates(writeCache('/income/recurring', data.templates)))
      .catch(() => {});

  const loadSummary = () =>
    apiGet('/income/summary', { token: session?.token })
      .then((data) => setSummary(writeCache('/income/summary', data.summary)))
      .catch(() => {});

  useEffect(() => {
    loadIncome();
    loadTemplates();
    loadCategories();
    loadPayers();
    loadSummary();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const filteredIncome = useMemo(() => {
    const q = query.trim().toLowerCase();
    return (income || []).filter((e) => {
      if (categoryFilter && String(e.categoryId) !== String(categoryFilter)) return false;
      if (paymentMethodFilter && e.paymentMethod !== paymentMethodFilter) return false;
      if (paymentStatusFilter && (e.paymentStatus || 'PAID') !== paymentStatusFilter) return false;
      if (fromDate && e.incomeDate < fromDate) return false;
      if (toDate && e.incomeDate > toDate) return false;
      if (q) {
        const haystack = `${e.title} ${e.description || ''} ${e.categoryName || ''} ${e.payerName || ''}`.toLowerCase();
        if (!haystack.includes(q)) return false;
      }
      return true;
    });
  }, [income, query, categoryFilter, paymentMethodFilter, paymentStatusFilter, fromDate, toDate]);

  const filteredTotal = useMemo(
    () => filteredIncome.reduce((sum, e) => sum + Number(e.amount || 0), 0),
    [filteredIncome]
  );

  const sortedIncome = useMemo(() => {
    if (!tableSort.key) return filteredIncome;
    const accessor = TABLE_SORT_ACCESSORS[tableSort.key];
    if (!accessor) return filteredIncome;
    const dir = tableSort.dir === 'desc' ? -1 : 1;
    return [...filteredIncome].sort((a, b) => {
      const av = accessor(a);
      const bv = accessor(b);
      if (typeof av === 'number' && typeof bv === 'number') return (av - bv) * dir;
      return String(av).localeCompare(String(bv)) * dir;
    });
  }, [filteredIncome, tableSort]);

  const toggleTableSort = (key) => {
    setTableSort((prev) => {
      if (prev.key !== key) return { key, dir: 'asc' };
      if (prev.dir === 'asc') return { key, dir: 'desc' };
      return { key: null, dir: 'asc' };
    });
  };

  // Only categories an income entry is actually filed under.
  const categoriesWithSpend = useMemo(() => {
    const usedIds = new Set((income || []).map((e) => e.categoryId));
    return (categories || []).filter((c) => usedIds.has(c.id));
  }, [categories, income]);

  const categoryOptions = useMemo(
    () => [...new Set([...categories.map((c) => c.name), ...SUGGESTED_CATEGORIES])].sort((a, b) => a.localeCompare(b)),
    [categories]
  );

  // Resolves the typed category name to an id, creating the category first
  // if nothing on file matches it — same as resolveCategoryId in
  // ExpensesPanel.jsx.
  const resolveCategoryId = async (name) => {
    const trimmed = name.trim();
    const existing = categories.find((c) => c.name.toLowerCase() === trimmed.toLowerCase());
    if (existing) return existing.id;

    const created = await apiPost('/income/categories', { name: trimmed }, { token: session?.token });
    await loadCategories();
    return created.category.id;
  };

  // Same idea as resolveCategoryId: a payer picked from the suggestion list
  // already has an id (form.payerId), so this only reaches the network for
  // a name typed fresh. Payers are written through the shared vendor
  // directory (POST /expenses/vendors is the one write endpoint dbo.vendors
  // has) so a payer added here shows up as a vendor everywhere else too.
  const resolvePayerId = async (form) => {
    if (!form.payerName.trim()) return null;
    if (form.payerId) return Number(form.payerId);

    const trimmed = form.payerName.trim();
    const existing = (payers || []).find((v) => v.name.toLowerCase() === trimmed.toLowerCase());
    if (existing) return existing.id;

    const created = await apiPost(
      '/expenses/vendors',
      {
        name: trimmed,
        contactPerson: form.payerContactPerson,
        phone: form.payerPhone,
        altPhone: form.payerAltPhone,
        email: form.payerEmail,
        specialty: form.payerSpecialty,
      },
      { token: session?.token }
    );
    await loadPayers();
    return created.vendor.id;
  };

  // ---------------------------------------------------------------------
  // Income form
  // ---------------------------------------------------------------------

  const loadReceipts = (incomeId) =>
    apiGet(`/income/${incomeId}/receipts`, { token: session?.token })
      .then((data) => setReceipts(data.receipts))
      .catch(() => setReceipts([]));

  const openIncomeForm = async (entry, mode = 'edit') => {
    setFormError('');
    setIncomeFieldErrors({});
    setReceiptError('');
    setIncomeReceiptFile(null);
    setNewReceipt({ amount: '', paymentMethod: 'CASH', referenceNumber: '', receivedDate: todayIso() });
    setViewMode(entry ? mode === 'view' : false);
    setLoggingTemplate(null);
    if (entry) {
      setEditingIncomeId(entry.id);
      const freshPayers = await loadPayers();
      const payer = entry.payerId ? (freshPayers || []).find((v) => v.id === entry.payerId) : null;
      setIncomeForm({
        categoryName: entry.categoryName || '',
        payerId: entry.payerId ? String(entry.payerId) : '',
        payerName: entry.payerName || '',
        payerContactPerson: payer?.contactPerson || '',
        payerPhone: payer?.phone || '',
        payerAltPhone: payer?.altPhone || '',
        payerEmail: payer?.email || '',
        payerSpecialty: payer?.specialty || '',
        title: entry.title,
        description: entry.description || '',
        amount: String(entry.amount),
        paymentMethod: entry.paymentMethod,
        paymentStatus: entry.paymentStatus || 'PAID',
        amountReceived: entry.amountReceived != null ? String(entry.amountReceived) : '',
        referenceNumber: '',
        incomeDate: entry.incomeDate?.slice(0, 10) || todayIso(),
        hasReceiptDocument: !!entry.hasReceiptDocument,
      });
      loadReceipts(entry.id);
    } else {
      setEditingIncomeId(null);
      setIncomeForm(emptyIncomeForm);
      setReceipts([]);
    }
    setShowIncomeForm(true);
  };

  // "Log this month" — opens the same income form pre-filled from the
  // template (category, title, next due date), amount left blank. Submitting
  // posts to /income/recurring/:id/log instead of the plain create endpoint,
  // which is what actually advances the template's next_due_date.
  const openOccurrenceForm = (template) => {
    setFormError('');
    setReceiptError('');
    setIncomeReceiptFile(null);
    setNewReceipt({ amount: '', paymentMethod: 'CASH', referenceNumber: '', receivedDate: todayIso() });
    setViewMode(false);
    setEditingIncomeId(null);
    setLoggingTemplate(template);
    setIncomeForm({
      ...emptyIncomeForm,
      categoryName: template.categoryName || '',
      payerId: template.payerId ? String(template.payerId) : '',
      payerName: template.payerName || '',
      title: template.title,
      incomeDate: template.nextDueDate?.slice(0, 10) || todayIso(),
    });
    setReceipts([]);
    setShowIncomeForm(true);
  };

  // An income entry can be settled in more than one instalment, so once it
  // exists this is the way new money against it gets logged.
  const handleAddReceipt = async (e) => {
    e.preventDefault();
    if (!newReceipt.amount || Number(newReceipt.amount) <= 0) return setReceiptError('Enter a valid amount.');
    if (!newReceipt.receivedDate) return setReceiptError('Enter when this was received.');

    setAddingReceipt(true);
    setReceiptError('');
    try {
      const { income: updated } = await apiPost(`/income/${editingIncomeId}/receipts`, newReceipt, { token: session?.token });
      setIncomeForm((f) => ({ ...f, amountReceived: String(updated.amountReceived), paymentStatus: updated.paymentStatus }));
      setNewReceipt({ amount: '', paymentMethod: 'CASH', referenceNumber: '', receivedDate: todayIso() });
      await Promise.all([loadReceipts(editingIncomeId), loadIncome(), loadSummary()]);
    } catch (err) {
      setReceiptError(err instanceof ApiError ? err.message : 'Could not add that receipt.');
    } finally {
      setAddingReceipt(false);
    }
  };

  const handleDeleteReceipt = async (receipt) => {
    if (!window.confirm(`Remove this ₹${receipt.amount} receipt?`)) return;
    try {
      const { income: updated } = await apiDelete(`/income/${editingIncomeId}/receipts/${receipt.id}`, { token: session?.token });
      setIncomeForm((f) => ({ ...f, amountReceived: String(updated.amountReceived), paymentStatus: updated.paymentStatus }));
      await Promise.all([loadReceipts(editingIncomeId), loadIncome(), loadSummary()]);
    } catch (err) {
      setReceiptError(err instanceof ApiError ? err.message : 'Could not remove that receipt.');
    }
  };

  const handleIncomeSubmit = async (e) => {
    e.preventDefault();
    const errors = {};
    if (!incomeForm.title.trim()) errors.title = 'Give this income a title.';
    if (!incomeForm.categoryName.trim()) errors.categoryName = 'Enter or choose a category.';
    if (!incomeForm.amount || Number(incomeForm.amount) < 0) errors.amount = 'Enter a valid amount.';
    if (!incomeForm.incomeDate) errors.incomeDate = 'Enter the income date.';
    else if (incomeForm.incomeDate > todayIso()) errors.incomeDate = 'Income date cannot be in the future.';
    if (incomeForm.payerPhone && !/^[6-9]\d{9}$/.test(incomeForm.payerPhone)) {
      errors.payerPhone = 'Enter a valid 10-digit mobile number.';
    }
    if (incomeForm.payerAltPhone && !/^[6-9]\d{9}$/.test(incomeForm.payerAltPhone)) {
      errors.payerAltPhone = 'Enter a valid 10-digit mobile number.';
    }
    setIncomeFieldErrors(errors);
    if (Object.keys(errors).length > 0) {
      focusFirstError(errors, {
        title: 'incomeTitle',
        categoryName: 'incomeCategory',
        amount: 'incomeAmount',
        incomeDate: 'incomeDate',
        payerPhone: 'incomePayerPhone',
        payerAltPhone: 'incomePayerAltPhone',
      });
      return;
    }

    setSubmitting(true);
    setFormError('');
    try {
      const categoryId = await resolveCategoryId(incomeForm.categoryName);
      const payerId = await resolvePayerId(incomeForm);
      const payload = {
        categoryId,
        payerId: payerId ?? '',
        title: incomeForm.title,
        description: incomeForm.description,
        amount: incomeForm.amount,
        paymentMethod: incomeForm.paymentMethod,
        paymentStatus: incomeForm.paymentStatus,
        amountReceived: incomeForm.paymentStatus === 'PARTIAL' ? incomeForm.amountReceived : '',
        referenceNumber: incomeForm.paymentStatus !== 'PENDING' ? incomeForm.referenceNumber : '',
        incomeDate: incomeForm.incomeDate,
      };

      const logUrl = loggingTemplate ? `/income/recurring/${loggingTemplate.id}/log` : null;

      if (incomeReceiptFile) {
        const fd = new FormData();
        Object.entries(payload).forEach(([key, value]) => fd.append(key, value));
        fd.append('receiptDocument', incomeReceiptFile);
        if (editingIncomeId) {
          await apiPatchForm(`/income/${editingIncomeId}`, fd, { token: session?.token });
        } else {
          await apiPostForm(logUrl || '/income', fd, { token: session?.token });
        }
      } else if (editingIncomeId) {
        await apiPatch(`/income/${editingIncomeId}`, payload, { token: session?.token });
      } else {
        await apiPost(logUrl || '/income', payload, { token: session?.token });
      }
      setShowIncomeForm(false);
      setLoggingTemplate(null);
      await Promise.all([loadIncome(), loadSummary(), ...(logUrl ? [loadTemplates()] : [])]);
    } catch (err) {
      setFormError(err instanceof ApiError ? err.message : 'Could not save this income entry.');
    } finally {
      setSubmitting(false);
    }
  };

  const deleteIncomeEntry = async (entry) => {
    if (!window.confirm(`Delete "${entry.title}"? This can't be undone.`)) return;
    try {
      await apiDelete(`/income/${entry.id}`, { token: session?.token });
      await Promise.all([loadIncome(), loadSummary()]);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not delete that income entry.');
    }
  };

  const viewDocument = async (entry) => {
    try {
      const blob = await apiGetBlob(`/income/${entry.id}/receipt`, { token: session?.token });
      setDocumentPreviewUrl((prev) => {
        if (prev) URL.revokeObjectURL(prev);
        return URL.createObjectURL(blob);
      });
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not open that receipt.');
    }
  };

  const closeDocumentPreview = () => {
    setDocumentPreviewUrl((prev) => {
      if (prev) URL.revokeObjectURL(prev);
      return '';
    });
  };

  // ---------------------------------------------------------------------
  // Recurring templates
  // ---------------------------------------------------------------------

  const openTemplateForm = (template) => {
    if (template) {
      setEditingTemplateId(template.id);
      setTemplateForm({
        categoryName: template.categoryName || '',
        title: template.title,
        frequency: template.frequency,
        nextDueDate: template.nextDueDate?.slice(0, 10) || todayIso(),
      });
    } else {
      setEditingTemplateId(null);
      setTemplateForm(emptyTemplateForm);
    }
    setFormError('');
    setTemplateFieldErrors({});
    setShowTemplateForm(true);
  };

  const handleTemplateSubmit = async (e) => {
    e.preventDefault();
    if (!templateForm.categoryName.trim()) return setFormError('Enter or choose a category.');
    if (!templateForm.title.trim()) return setFormError('Give this recurring income a title.');
    if (!templateForm.nextDueDate) return setFormError('Enter the next due date.');

    setSubmitting(true);
    setFormError('');
    try {
      const categoryId = await resolveCategoryId(templateForm.categoryName);
      const payload = {
        categoryId,
        title: templateForm.title,
        frequency: templateForm.frequency,
        nextDueDate: templateForm.nextDueDate,
      };

      if (editingTemplateId) {
        await apiPatch(`/income/recurring/${editingTemplateId}`, payload, { token: session?.token });
      } else {
        await apiPost('/income/recurring', payload, { token: session?.token });
      }
      setShowTemplateForm(false);
      await loadTemplates();
    } catch (err) {
      setFormError(err instanceof ApiError ? err.message : 'Could not save this recurring income.');
    } finally {
      setSubmitting(false);
    }
  };

  const toggleTemplateActive = async (template) => {
    try {
      await apiPatch(`/income/recurring/${template.id}`, { isActive: !template.isActive }, { token: session?.token });
      await loadTemplates();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not update that recurring income.');
    }
  };

  const openTemplateHistory = async (template) => {
    setTemplateHistory({ template, income: [] });
    setTemplateHistoryLoading(true);
    try {
      const data = await apiGet(`/income?recurringTemplateId=${template.id}`, { token: session?.token });
      setTemplateHistory({ template, income: data.income });
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not load this recurring income’s history.');
    } finally {
      setTemplateHistoryLoading(false);
    }
  };

  // ---------------------------------------------------------------------
  // Payers
  // ---------------------------------------------------------------------

  const openPayerForm = (payer) => {
    setFormError('');
    if (payer) {
      setEditingPayerId(payer.id);
      setPayerForm({
        name: payer.name,
        contactPerson: payer.contactPerson || '',
        phone: payer.phone || '',
        altPhone: payer.altPhone || '',
        email: payer.email || '',
        specialty: payer.specialty || '',
        notes: payer.notes || '',
      });
    } else {
      setEditingPayerId(null);
      setPayerForm(emptyPayerForm);
    }
    setPayerFieldErrors({});
    setShowPayerForm(true);
  };

  const handlePayerSubmit = async (e) => {
    e.preventDefault();
    const errors = {};
    if (!payerForm.name.trim()) errors.name = 'Payer name is required.';
    if (payerForm.phone && !/^[6-9]\d{9}$/.test(payerForm.phone)) {
      errors.phone = 'Enter a valid 10-digit mobile number.';
    } else if (payerForm.phone) {
      const clash = (payers || []).find(
        (v) => v.id !== editingPayerId && (v.phone || '') === payerForm.phone
      );
      if (clash) errors.phone = `This number is already used by "${clash.name}".`;
    }
    if (payerForm.altPhone && !/^[6-9]\d{9}$/.test(payerForm.altPhone)) {
      errors.altPhone = 'Enter a valid 10-digit mobile number.';
    } else if (payerForm.altPhone) {
      if (payerForm.altPhone === payerForm.phone) {
        errors.altPhone = 'Alternate number is the same as the primary number.';
      } else {
        const clash = (payers || []).find(
          (v) =>
            v.id !== editingPayerId &&
            ((v.phone || '') === payerForm.altPhone || (v.altPhone || '') === payerForm.altPhone)
        );
        if (clash) errors.altPhone = `This number is already used by "${clash.name}".`;
      }
    }
    setPayerFieldErrors(errors);
    if (Object.keys(errors).length > 0) {
      focusFirstError(errors, { name: 'incPayerName', phone: 'incPayerPhone', altPhone: 'incPayerAltPhone' });
      return;
    }
    setSubmitting(true);
    setFormError('');
    try {
      if (editingPayerId) {
        await apiPatch(`/income/payers/${editingPayerId}`, payerForm, { token: session?.token });
      } else {
        await apiPost('/income/payers', payerForm, { token: session?.token });
      }
      setShowPayerForm(false);
      await loadPayers();
    } catch (err) {
      setFormError(err instanceof ApiError ? err.message : 'Could not save this payer.');
    } finally {
      setSubmitting(false);
    }
  };

  // Bank-interest vouchers are ordinary income entries under one category, so
  // the P&L's Other Income picks them up with no report change.
  const interestEntries = income.filter((e) => (e.categoryName || '').toLowerCase() === INTEREST_CATEGORY.toLowerCase());
  const interestTotal = interestEntries.reduce((sum, e) => sum + Number(e.amount || 0), 0);

  const openInterestVoucher = async () => {
    await openIncomeForm(null);
    setIncomeForm({
      ...emptyIncomeForm,
      categoryName: INTEREST_CATEGORY,
      title: 'Bank interest',
      paymentMethod: 'BANK_TRANSFER',
    });
  };

  const tabs = [
    { id: 'income', name: 'Income', count: income.length },
    { id: 'interest', name: 'Interest', count: interestEntries.length },
    { id: 'recurring', name: 'Recurring', count: templates.length },
    { id: 'payers', name: 'Payers', count: payers.length },
  ];

  return (
    <div>
      {error && <div className="form-banner form-banner--error">{error}</div>}

      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
        <SectionTabs ariaLabel="Income sections" activeId={tab} onChange={setTab} tabs={tabs} />
        <button type="button" className="btn-secondary" onClick={onViewReport}>
          View Report
        </button>
      </div>

      {tab === 'income' && (
        <div>
          {summary && (
            <div className="kpi-row" style={{ marginBottom: 16 }}>
              <div className="kpi-card kpi-card--primary">
                <span className="kpi-label">Earned this year</span>
                <span className="kpi-value">{formatPrice(summary.byMonth.reduce((s, m) => s + m.total, 0))}</span>
                <span className="kpi-sub">Across every category and payer</span>
              </div>
              <div className="kpi-card">
                <span className="kpi-label">This month</span>
                <span className="kpi-value">{formatPrice(summary.byMonth.find((m) => m.month === new Date().getMonth() + 1)?.total || 0)}</span>
                <span className="kpi-sub">{new Date().toLocaleDateString('en-IN', { month: 'long' })} so far</span>
              </div>
              <div className="kpi-card">
                <span className="kpi-label">Top category</span>
                <span className="kpi-value" style={{ fontSize: 18 }}>{summary.byCategory[0]?.categoryName || '—'}</span>
                <span className="kpi-sub">{summary.byCategory[0] ? formatPrice(summary.byCategory[0].total) : 'No income logged yet'}</span>
              </div>
              <div className="kpi-card">
                <span className="kpi-label">Filtered total</span>
                <span className="kpi-value">{formatPrice(filteredTotal)}</span>
                <span className="kpi-sub">{filteredIncome.length} entr{filteredIncome.length === 1 ? 'y' : 'ies'} in view</span>
              </div>
            </div>
          )}

          <div className="inv-bar">
            <div className="inv-bar__row asset-toolbar-row">
              <div className="asset-toolbar-row__filters">
                <div className="inv-search">
                  <span className="inv-search__icon" />
                  <input placeholder="Search income…" value={query} onChange={(e) => setQuery(e.target.value)} />
                </div>
                {categoriesWithSpend.length > 0 && (
                  <select
                    className="asset-category-filter"
                    value={categoryFilter}
                    onChange={(e) => setCategoryFilter(e.target.value)}
                    aria-label="Filter by category"
                  >
                    <option value="">All categories</option>
                    {categoriesWithSpend.map((c) => (
                      <option key={c.id} value={c.id}>{c.name}</option>
                    ))}
                  </select>
                )}
                <select
                  className="asset-category-filter"
                  value={paymentMethodFilter}
                  onChange={(e) => setPaymentMethodFilter(e.target.value)}
                  aria-label="Filter by received via"
                >
                  <option value="">All payment methods</option>
                  {PAYMENT_METHOD_OPTIONS.map(([key, label]) => (
                    <option key={key} value={key}>{label}</option>
                  ))}
                </select>
                <select
                  className="asset-category-filter"
                  value={paymentStatusFilter}
                  onChange={(e) => setPaymentStatusFilter(e.target.value)}
                  aria-label="Filter by payment status"
                >
                  <option value="">All payment statuses</option>
                  {Object.entries(PAYMENT_STATUS_LABEL).map(([key, label]) => (
                    <option key={key} value={key}>{label}</option>
                  ))}
                </select>
                {showDateRange ? (
                  <div className="asset-toolbar-row__date-pair">
                    <input
                      type="date"
                      value={fromDate}
                      max={toDate || undefined}
                      onChange={(e) => setFromDate(e.target.value)}
                      aria-label="From date"
                    />
                    <input
                      type="date"
                      value={toDate}
                      min={fromDate || undefined}
                      onChange={(e) => setToDate(e.target.value)}
                      aria-label="To date"
                    />
                  </div>
                ) : (
                  <button type="button" className="inv-linkbtn" onClick={() => setShowDateRange(true)}>
                    + Date range
                  </button>
                )}
                {(query || categoryFilter || paymentMethodFilter || paymentStatusFilter || fromDate || toDate) && (
                  <button
                    type="button"
                    className="inv-linkbtn"
                    onClick={() => {
                      setQuery('');
                      setCategoryFilter('');
                      setPaymentMethodFilter('');
                      setPaymentStatusFilter('');
                      setFromDate('');
                      setToDate('');
                      setShowDateRange(false);
                    }}
                  >
                    Clear filters
                  </button>
                )}
              </div>
              <div className="asset-toolbar-row__end">
                <div className="toggle-group asset-view-toggle" role="group" aria-label="Income list view">
                  <button
                    type="button"
                    className="asset-view-toggle__btn"
                    aria-pressed={incomeView === 'cards'}
                    aria-label="Cards view"
                    title="Cards view"
                    onClick={() => setIncomeView('cards')}
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
                    aria-pressed={incomeView === 'table'}
                    aria-label="Table view"
                    title="Table view"
                    onClick={() => setIncomeView('table')}
                  >
                    <svg viewBox="0 0 20 20" width="16" height="16" fill="none" aria-hidden="true">
                      <rect x="2.5" y="3.5" width="15" height="13" rx="1.4" stroke="currentColor" strokeWidth="1.6" />
                      <line x1="2.5" y1="8" x2="17.5" y2="8" stroke="currentColor" strokeWidth="1.6" />
                      <line x1="2.5" y1="12.3" x2="17.5" y2="12.3" stroke="currentColor" strokeWidth="1.6" />
                      <line x1="7.3" y1="3.5" x2="7.3" y2="16.5" stroke="currentColor" strokeWidth="1.6" />
                    </svg>
                  </button>
                </div>
                <button type="button" className="btn-accent" onClick={() => openIncomeForm(null)}>
                  + New income
                </button>
              </div>
            </div>
          </div>

          {filteredIncome.length === 0 ? (
            <p className="inv-panel__hint">
              {income.length === 0
                ? 'Nothing logged yet. Log the first entry — interest, a scrap sale, rent received — and it starts showing up here.'
                : 'No income entry matches these filters.'}
            </p>
          ) : incomeView === 'table' ? (
            <div className="asset-table-wrap">
              <table className="asset-table">
                <thead>
                  <tr>
                    {[
                      ['date', 'Date'],
                      ['title', 'Title'],
                      ['category', 'Category'],
                      ['payer', 'Payer'],
                      ['method', 'Received via'],
                      ['status', 'Status'],
                      ['amount', 'Amount'],
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
                  {sortedIncome.map((entry) => (
                    <tr key={entry.id} onClick={() => openIncomeForm(entry, 'view')}>
                      <td className="asset-table__muted">{formatDate(entry.incomeDate)}</td>
                      <td className="asset-table__name">
                        {entry.title}
                        {entry.description && (
                          <div className="asset-table__muted" style={{ fontSize: 12 }}>{entry.description}</div>
                        )}
                      </td>
                      <td>{entry.categoryName}</td>
                      <td className={entry.payerName ? '' : 'asset-table__muted'}>{entry.payerName || '—'}</td>
                      <td>
                        {entry.paymentStatus !== 'PENDING' && (
                          <span className={`inv-tag ${PAYMENT_TAG_CLASS[entry.paymentMethod]}`}>
                            {PAYMENT_LABEL[entry.paymentMethod]}
                          </span>
                        )}
                      </td>
                      <td>
                        <span className={`inv-tag ${PAYMENT_STATUS_TAG_CLASS[entry.paymentStatus]}`}>
                          {PAYMENT_STATUS_LABEL[entry.paymentStatus]}
                        </span>
                      </td>
                      <td className="asset-table__mono">{formatPrice(entry.amount)}</td>
                      <td className="asset-table__actions" onClick={(e) => e.stopPropagation()}>
                        <RowMenu label={`More actions for ${entry.title}`}>
                          <button type="button" onClick={() => openIncomeForm(entry)}>
                            Edit income
                          </button>
                          {entry.hasReceiptDocument && (
                            <button type="button" onClick={() => viewDocument(entry)}>
                              View receipt
                            </button>
                          )}
                          <button type="button" className="inv-danger" onClick={() => deleteIncomeEntry(entry)}>
                            Delete income
                          </button>
                        </RowMenu>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <ul className="inv-list">
              {sortedIncome.map((entry) => (
                <li key={entry.id} className="inv-item">
                  <div className="inv-item__body" onClick={() => openIncomeForm(entry, 'view')} style={{ cursor: 'pointer' }}>
                    <div className="inv-item__name">
                      {entry.title}
                      <span className="inv-tag">{entry.categoryName}</span>
                      {entry.paymentStatus !== 'PENDING' && (
                        <span className={`inv-tag ${PAYMENT_TAG_CLASS[entry.paymentMethod]}`}>
                          {PAYMENT_LABEL[entry.paymentMethod]}
                        </span>
                      )}
                      {entry.paymentStatus !== 'PAID' && (
                        <span className={`inv-tag ${PAYMENT_STATUS_TAG_CLASS[entry.paymentStatus]}`}>
                          {PAYMENT_STATUS_LABEL[entry.paymentStatus]}
                        </span>
                      )}
                    </div>
                    <div className="inv-item__meta">
                      {formatDate(entry.incomeDate)} · {formatPrice(entry.amount)}
                      {entry.payerName && ` · ${entry.payerName}`}
                      {entry.description && ` · ${entry.description}`}
                    </div>
                  </div>
                  <div className="inv-item__actions">
                    {entry.hasReceiptDocument && (
                      <button type="button" className="inv-linkbtn" onClick={() => viewDocument(entry)}>
                        Receipt
                      </button>
                    )}
                    <button type="button" className="inv-danger" onClick={() => deleteIncomeEntry(entry)}>
                      Delete
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {tab === 'interest' && (
        <div>
          <div className="inv-bar">
            <div className="inv-bar__row inv-bar__row--stats">
              <div className="inc-total">
                <span className="inc-total__label">Bank interest earned</span>
                <strong className="inc-total__value">{formatPrice(interestTotal)}</strong>
              </div>
              <div className="inv-bar__actions">
                <button type="button" className="btn-accent" onClick={openInterestVoucher}>
                  + Add interest voucher
                </button>
              </div>
            </div>
          </div>
          {interestEntries.length === 0 ? (
            <div className="inc-empty">
              <div className="inc-empty__title">No interest vouchers yet</div>
              <div className="inc-empty__text">Add one when the bank credits interest.</div>
            </div>
          ) : (
            <ul className="inv-list">
              {interestEntries.map((entry) => (
                <li key={entry.id} className="inv-item">
                  <div className="inv-item__body" onClick={() => openIncomeForm(entry, 'view')} style={{ cursor: 'pointer' }}>
                    <div className="inv-item__name">{entry.title}</div>
                    <div className="inv-item__meta">
                      {formatDate(entry.incomeDate)} · {formatPrice(entry.amount)}
                      {entry.payerName && ` · ${entry.payerName}`}
                      {entry.description && ` · ${entry.description}`}
                    </div>
                  </div>
                  <div className="inv-item__actions">
                    <button type="button" className="inv-danger" onClick={() => deleteIncomeEntry(entry)}>
                      Delete
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {tab === 'recurring' && (
        <div>
          <div className="inv-bar">
            <div className="inv-bar__row">
              <div />
              <div className="inv-bar__actions">
                <button type="button" className="btn-accent" onClick={() => openTemplateForm(null)}>
                  + New recurring income
                </button>
              </div>
            </div>
          </div>

          {(templates || []).length === 0 ? (
            <p className="inv-panel__hint">
              No recurring income set up. Add a shop's monthly rent or any other receipt that repeats on a
              schedule — "Log this month" records each occurrence by hand, with its own amount and payer,
              once it's actually due.
            </p>
          ) : (
            <ul className="inv-list">
              {templates.map((template) => {
                const daysUntilDue = template.nextDueDate
                  ? Math.ceil((new Date(template.nextDueDate) - new Date()) / (1000 * 60 * 60 * 24))
                  : null;
                const dueTagClass = daysUntilDue == null ? '' : daysUntilDue < 0 ? 'inv-tag--bad' : daysUntilDue <= 7 ? 'inv-tag--low' : 'inv-tag--good';
                const dueLabel =
                  daysUntilDue == null
                    ? formatDate(template.nextDueDate)
                    : daysUntilDue < 0
                      ? `Overdue since ${formatDate(template.nextDueDate)}`
                      : daysUntilDue === 0
                        ? 'Due today'
                        : `Due in ${daysUntilDue} day${daysUntilDue === 1 ? '' : 's'}`;
                return (
                  <li key={template.id} className="inv-item">
                    <div className="inv-item__body" onClick={() => openTemplateHistory(template)} style={{ cursor: 'pointer' }}>
                      <div className="inv-item__name">
                        {template.title}
                        <span className="inv-tag">{template.categoryName}</span>
                        <span className="inv-tag inv-tag--info">{FREQUENCY_LABEL[template.frequency]}</span>
                        {!template.isActive && <span className="inv-tag inv-tag--off">Paused</span>}
                      </div>
                      <div className="inv-item__meta">
                        <span className={`inv-tag ${dueTagClass}`}>{dueLabel}</span>
                      </div>
                    </div>
                    <div className="inv-item__actions">
                      {template.isActive && (
                        <button
                          type="button"
                          className="btn-secondary"
                          onClick={(e) => {
                            e.stopPropagation();
                            openOccurrenceForm(template);
                          }}
                        >
                          Log this month
                        </button>
                      )}
                      <button
                        type="button"
                        className="inv-linkbtn"
                        onClick={(e) => {
                          e.stopPropagation();
                          openTemplateForm(template);
                        }}
                      >
                        Edit
                      </button>
                      <button
                        type="button"
                        className="inv-linkbtn"
                        onClick={(e) => {
                          e.stopPropagation();
                          toggleTemplateActive(template);
                        }}
                      >
                        {template.isActive ? 'Pause' : 'Resume'}
                      </button>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      )}

      {tab === 'payers' && (
        <div>
          <div className="inv-bar">
            <div className="inv-bar__row">
              <div />
              <div className="inv-bar__actions">
                <button type="button" className="btn-accent" onClick={() => openPayerForm(null)}>
                  Add payer
                </button>
              </div>
            </div>
          </div>

          {(payers || []).length === 0 ? (
            <p className="inv-panel__hint">No payers yet. Add anyone who regularly pays the property.</p>
          ) : (
            <ul className="inv-list">
              {payers.map((payer) => (
                <li key={payer.id} className="inv-item">
                  <div className="inv-item__body" onClick={() => openPayerForm(payer)} style={{ cursor: 'pointer' }}>
                    <div className="inv-item__name">{payer.name}</div>
                    <div className="inv-item__meta">
                      {payer.specialty || 'No specialty set'}
                      {payer.phone && ` · ${payer.phone}`}
                      {payer.altPhone && ` / ${payer.altPhone}`}
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {/* New / edit income entry */}
      {showIncomeForm && (
        <div className="glass-backdrop inv-panel__backdrop">
          <div
            className="glass-panel inv-panel__modal inv-panel__modal--wide modal-form__panel"
            role="dialog"
            aria-modal="true"
            aria-labelledby="incomeModalTitle"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Not a <form onSubmit> — same reasoning as ExpensesPanel's
                expense modal: this also holds the read-only summary view
                and the inline "add receipt" fields, and Save is called
                directly from its own button to avoid an accidental Enter
                submit. */}
            <div className="modal-form">
              <div className="modal-form__head">
                <div className="modal-form__head-row">
                  <h3 id="incomeModalTitle">
                    {viewMode
                      ? incomeForm.title
                      : loggingTemplate
                        ? `Log: ${loggingTemplate.title}`
                        : editingIncomeId
                          ? 'Edit income'
                          : 'New income'}
                  </h3>
                  <button
                    type="button"
                    className="modal-form__close"
                    onClick={() => setShowIncomeForm(false)}
                    disabled={submitting}
                    aria-label="Close"
                  >
                    ×
                  </button>
                </div>
              </div>

              <div className="modal-form__body modal-form__body--asset">
                {formError && <div className="form-banner form-banner--error form-banner--flash">{formError}</div>}

                {viewMode ? (
                  <dl className="asset-detail__grid field--span2" style={{ marginBottom: 16 }}>
                    <div>
                      <dt>Category</dt>
                      <dd>{incomeForm.categoryName || '—'}</dd>
                    </div>
                    {incomeForm.payerName && (
                      <div>
                        <dt>Payer</dt>
                        <dd>{incomeForm.payerName}</dd>
                      </div>
                    )}
                    <div>
                      <dt>Amount</dt>
                      <dd>{formatPrice(incomeForm.amount)}</dd>
                    </div>
                    <div>
                      <dt>Date</dt>
                      <dd>{formatDate(incomeForm.incomeDate)}</dd>
                    </div>
                    {incomeForm.description && (
                      <div>
                        <dt>Notes</dt>
                        <dd>{incomeForm.description}</dd>
                      </div>
                    )}
                    {incomeForm.hasReceiptDocument && (
                      <div>
                        <dt>Receipt</dt>
                        <dd>
                          <button
                            type="button"
                            className="inv-linkbtn"
                            onClick={() => viewDocument({ id: editingIncomeId })}
                          >
                            View receipt
                          </button>
                        </dd>
                      </div>
                    )}
                  </dl>
                ) : (
                  <>
                    <div className="field field--span2">
                      <label htmlFor="incomeTitle">
                        Title <Req />
                      </label>
                      <input
                        id="incomeTitle"
                        aria-invalid={Boolean(incomeFieldErrors.title)}
                        value={incomeForm.title}
                        onChange={(e) => {
                          setIncomeForm((f) => ({ ...f, title: e.target.value }));
                          if (incomeFieldErrors.title) setIncomeFieldErrors((f) => ({ ...f, title: undefined }));
                        }}
                        placeholder="Interest credited, scrap sale, shop rent…"
                        autoFocus={!editingIncomeId}
                      />
                      {incomeFieldErrors.title ? (
                        <span className="field__error">{incomeFieldErrors.title}</span>
                      ) : null}
                    </div>

                    <div className="field">
                      <label htmlFor="incomeCategory">
                        Category <Req />
                      </label>
                      <CategoryField
                        id="incomeCategory"
                        value={incomeForm.categoryName}
                        onChange={(name) => {
                          setIncomeForm((f) => ({ ...f, categoryName: name }));
                          if (incomeFieldErrors.categoryName) setIncomeFieldErrors((f) => ({ ...f, categoryName: undefined }));
                        }}
                        options={categoryOptions}
                      />
                      {incomeFieldErrors.categoryName ? (
                        <span className="field__error">{incomeFieldErrors.categoryName}</span>
                      ) : (
                        <span className="field__hint">Pick from the list or type a new one — it's added the first time it's used.</span>
                      )}
                    </div>

                    <div className="field">
                      <label htmlFor="incomePayer">Payer</label>
                      <PayerField
                        id="incomePayer"
                        value={incomeForm.payerName}
                        payers={payers}
                        onChange={(name) => setIncomeForm((f) => ({ ...f, payerName: name, payerId: '' }))}
                        onPick={(payer) =>
                          setIncomeForm((f) => ({
                            ...f,
                            payerId: String(payer.id),
                            payerName: payer.name,
                            payerContactPerson: payer.contactPerson || '',
                            payerPhone: payer.phone || '',
                            payerAltPhone: payer.altPhone || '',
                            payerEmail: payer.email || '',
                            payerSpecialty: payer.specialty || '',
                          }))
                        }
                      />
                      <span className="field__hint">
                        {incomeForm.payerId
                          ? 'Existing payer — details below are theirs on file.'
                          : incomeForm.payerName.trim()
                            ? 'No match — this will be added as a new payer.'
                            : 'Search by name or phone, or type a new payer.'}
                      </span>
                    </div>

                    <div className="field">
                      <label htmlFor="incomePayerContact">Payer contact person</label>
                      <input
                        id="incomePayerContact"
                        value={incomeForm.payerContactPerson}
                        onChange={(e) => setIncomeForm((f) => ({ ...f, payerContactPerson: e.target.value }))}
                      />
                    </div>
                    <div className="field">
                      <label htmlFor="incomePayerPhone">Payer phone</label>
                      <input
                        id="incomePayerPhone"
                        aria-invalid={Boolean(incomeFieldErrors.payerPhone)}
                        value={incomeForm.payerPhone}
                        onChange={(e) => {
                          setIncomeForm((f) => ({ ...f, payerPhone: typedMobile(e.target.value) }));
                          if (incomeFieldErrors.payerPhone) setIncomeFieldErrors((f) => ({ ...f, payerPhone: undefined }));
                        }}
                        type="tel"
                        inputMode="numeric"
                        maxLength={10}
                        placeholder="10-digit mobile"
                      />
                      {incomeFieldErrors.payerPhone ? (
                        <span className="field__error">{incomeFieldErrors.payerPhone}</span>
                      ) : null}
                    </div>
                    <div className="field">
                      <label htmlFor="incomePayerAltPhone">Payer alternate phone</label>
                      <input
                        id="incomePayerAltPhone"
                        aria-invalid={Boolean(incomeFieldErrors.payerAltPhone)}
                        value={incomeForm.payerAltPhone}
                        onChange={(e) => {
                          setIncomeForm((f) => ({ ...f, payerAltPhone: typedMobile(e.target.value) }));
                          if (incomeFieldErrors.payerAltPhone) setIncomeFieldErrors((f) => ({ ...f, payerAltPhone: undefined }));
                        }}
                        type="tel"
                        inputMode="numeric"
                        maxLength={10}
                        placeholder="10-digit mobile (optional)"
                      />
                      {incomeFieldErrors.payerAltPhone ? (
                        <span className="field__error">{incomeFieldErrors.payerAltPhone}</span>
                      ) : null}
                    </div>
                    <div className="field">
                      <label htmlFor="incomePayerEmail">Payer email</label>
                      <input
                        id="incomePayerEmail"
                        value={incomeForm.payerEmail}
                        onChange={(e) => setIncomeForm((f) => ({ ...f, payerEmail: e.target.value }))}
                      />
                    </div>
                    <div className="field">
                      <label htmlFor="incomePayerSpecialty">Payer specialty</label>
                      <input
                        id="incomePayerSpecialty"
                        value={incomeForm.payerSpecialty}
                        onChange={(e) => setIncomeForm((f) => ({ ...f, payerSpecialty: e.target.value }))}
                        placeholder="Shop tenant, service partner…"
                      />
                    </div>

                    <div className="field">
                      <label htmlFor="incomeAmount">
                        Amount <Req />
                      </label>
                      <input
                        id="incomeAmount"
                        type="number"
                        min="0"
                        step="0.01"
                        aria-invalid={Boolean(incomeFieldErrors.amount)}
                        value={incomeForm.amount}
                        onChange={(e) => {
                          setIncomeForm((f) => ({ ...f, amount: e.target.value }));
                          if (incomeFieldErrors.amount) setIncomeFieldErrors((f) => ({ ...f, amount: undefined }));
                        }}
                      />
                      {incomeFieldErrors.amount ? (
                        <span className="field__error">{incomeFieldErrors.amount}</span>
                      ) : null}
                    </div>

                    {!editingIncomeId && (
                      <>
                        <div className="field">
                          <label htmlFor="incomePaymentStatus">
                            Payment status <Req />
                          </label>
                          <select
                            id="incomePaymentStatus"
                            value={incomeForm.paymentStatus}
                            onChange={(e) => setIncomeForm((f) => ({ ...f, paymentStatus: e.target.value }))}
                          >
                            <option value="PAID">Received</option>
                            <option value="PARTIAL">Partially received</option>
                            <option value="PENDING">Pending</option>
                          </select>
                        </div>

                        {incomeForm.paymentStatus !== 'PENDING' && (
                          <div className="field">
                            <label htmlFor="incomePaymentMethod">
                              Received via <Req />
                            </label>
                            <select
                              id="incomePaymentMethod"
                              value={incomeForm.paymentMethod}
                              onChange={(e) => setIncomeForm((f) => ({ ...f, paymentMethod: e.target.value }))}
                            >
                              {PAYMENT_METHOD_OPTIONS.map(([value, label]) => (
                                <option key={value} value={value}>
                                  {label}
                                </option>
                              ))}
                            </select>
                          </div>
                        )}

                        {incomeForm.paymentStatus !== 'PENDING' && PAYMENT_REFERENCE_LABEL[incomeForm.paymentMethod] && (
                          <div className="field">
                            <label htmlFor="incomeReferenceNumber">{PAYMENT_REFERENCE_LABEL[incomeForm.paymentMethod]}</label>
                            <input
                              id="incomeReferenceNumber"
                              value={incomeForm.referenceNumber}
                              onChange={(e) => setIncomeForm((f) => ({ ...f, referenceNumber: e.target.value }))}
                            />
                          </div>
                        )}

                        {incomeForm.paymentStatus === 'PARTIAL' && (
                          <div className="field">
                            <label htmlFor="incomeAmountReceived">Amount received so far</label>
                            <input
                              id="incomeAmountReceived"
                              type="number"
                              min="0"
                              step="0.01"
                              max={incomeForm.amount || undefined}
                              value={incomeForm.amountReceived}
                              onChange={(e) => setIncomeForm((f) => ({ ...f, amountReceived: e.target.value }))}
                            />
                          </div>
                        )}
                      </>
                    )}

                    <div className="field">
                      <label htmlFor="incomeDate">
                        Date <Req />
                      </label>
                      <input
                        id="incomeDate"
                        type="date"
                        max={todayIso()}
                        aria-invalid={Boolean(incomeFieldErrors.incomeDate)}
                        value={incomeForm.incomeDate}
                        onChange={(e) => {
                          setIncomeForm((f) => ({ ...f, incomeDate: e.target.value }));
                          if (incomeFieldErrors.incomeDate) setIncomeFieldErrors((f) => ({ ...f, incomeDate: undefined }));
                        }}
                      />
                      {incomeFieldErrors.incomeDate ? (
                        <span className="field__error">{incomeFieldErrors.incomeDate}</span>
                      ) : null}
                    </div>

                    <div className="field">
                      <label htmlFor="incomeDescription">Notes</label>
                      <input
                        id="incomeDescription"
                        value={incomeForm.description}
                        onChange={(e) => setIncomeForm((f) => ({ ...f, description: e.target.value }))}
                      />
                    </div>

                    <div className="field">
                      <label htmlFor="incomeReceipt">Receipt / proof (image or PDF)</label>
                      <input
                        id="incomeReceipt"
                        type="file"
                        accept="image/jpeg,image/png,image/webp,application/pdf"
                        onChange={(e) => setIncomeReceiptFile(e.target.files?.[0] || null)}
                      />
                    </div>
                  </>
                )}

                {editingIncomeId && (
                  <div className="field field--span2">
                    <span className="field__group-label">Receipts</span>
                    <p className="field__hint" style={{ marginTop: -2, marginBottom: 8 }}>
                      {formatPrice(incomeForm.amountReceived || 0)} of {formatPrice(incomeForm.amount || 0)} received
                      {Number(incomeForm.amount) > Number(incomeForm.amountReceived || 0) &&
                        ` · ₹${(Number(incomeForm.amount) - Number(incomeForm.amountReceived || 0)).toFixed(2)} left`}
                    </p>

                    {receipts.length > 0 && (
                      <ul className="inv-list" style={{ marginBottom: 10 }}>
                        {receipts.map((p) => (
                          <li key={p.id} className="inv-item">
                            <div className="inv-item__body">
                              <div className="inv-item__name">
                                {formatPrice(p.amount)}
                                <span className={`inv-tag ${PAYMENT_TAG_CLASS[p.paymentMethod]}`}>
                                  {PAYMENT_LABEL[p.paymentMethod]}
                                </span>
                              </div>
                              <div className="inv-item__meta">
                                {formatDate(p.receivedDate)}
                                {p.referenceNumber && ` · ${PAYMENT_REFERENCE_LABEL[p.paymentMethod] || 'Ref'}: ${p.referenceNumber}`}
                              </div>
                            </div>
                            <div className="inv-item__actions">
                              <button type="button" className="inv-danger" onClick={() => handleDeleteReceipt(p)}>
                                Remove
                              </button>
                            </div>
                          </li>
                        ))}
                      </ul>
                    )}

                    {receiptError && <div className="form-banner form-banner--error form-banner--flash">{receiptError}</div>}

                    {Number(incomeForm.amountReceived || 0) < Number(incomeForm.amount || 0) && (
                      <div
                        className="field-row field-row--triple"
                        onKeyDown={(e) => {
                          if (e.key !== 'Enter') return;
                          e.preventDefault();
                          if (!addingReceipt) handleAddReceipt(e);
                        }}
                      >
                        <div className="field">
                          <label htmlFor="newReceiptAmount">Amount</label>
                          <input
                            id="newReceiptAmount"
                            type="number"
                            min="0"
                            step="0.01"
                            max={Number(incomeForm.amount) - Number(incomeForm.amountReceived || 0)}
                            value={newReceipt.amount}
                            onChange={(e) => setNewReceipt((f) => ({ ...f, amount: e.target.value }))}
                          />
                        </div>
                        <div className="field">
                          <label htmlFor="newReceiptMethod">Received via</label>
                          <select
                            id="newReceiptMethod"
                            value={newReceipt.paymentMethod}
                            onChange={(e) => setNewReceipt((f) => ({ ...f, paymentMethod: e.target.value }))}
                          >
                            {PAYMENT_METHOD_OPTIONS.map(([value, label]) => (
                              <option key={value} value={value}>
                                {label}
                              </option>
                            ))}
                          </select>
                        </div>
                        <div className="field">
                          <label htmlFor="newReceiptDate">Date</label>
                          <input
                            id="newReceiptDate"
                            type="date"
                            value={newReceipt.receivedDate}
                            onChange={(e) => setNewReceipt((f) => ({ ...f, receivedDate: e.target.value }))}
                          />
                        </div>
                        {PAYMENT_REFERENCE_LABEL[newReceipt.paymentMethod] && (
                          <div className="field" style={{ gridColumn: '1 / -1' }}>
                            <label htmlFor="newReceiptReference">{PAYMENT_REFERENCE_LABEL[newReceipt.paymentMethod]}</label>
                            <input
                              id="newReceiptReference"
                              value={newReceipt.referenceNumber}
                              onChange={(e) => setNewReceipt((f) => ({ ...f, referenceNumber: e.target.value }))}
                            />
                          </div>
                        )}
                        <div style={{ gridColumn: '1 / -1' }}>
                          <button
                            type="button"
                            className="btn-accent"
                            disabled={addingReceipt}
                            onClick={(e) => handleAddReceipt(e)}
                          >
                            {addingReceipt ? 'Adding…' : 'Add receipt'}
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </div>

              <div className="modal-form__foot">
                <div className="modal-form__foot-actions">
                  {viewMode ? (
                    <>
                      <button type="button" className="btn-secondary" onClick={() => setShowIncomeForm(false)}>
                        Close
                      </button>
                      <button type="button" className="btn-accent" onClick={() => setViewMode(false)}>
                        Edit details
                      </button>
                    </>
                  ) : (
                    <>
                      <button type="button" className="btn-secondary" onClick={() => setShowIncomeForm(false)} disabled={submitting}>
                        Cancel
                      </button>
                      <button type="button" className="btn-accent" disabled={submitting} onClick={handleIncomeSubmit}>
                        {submitting ? 'Saving…' : 'Save'}
                      </button>
                    </>
                  )}
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* New / edit recurring template */}
      {showTemplateForm && (
        <div className="glass-backdrop inv-panel__backdrop">
          <div
            className="glass-panel inv-panel__modal inv-panel__modal--wide modal-form__panel"
            role="dialog"
            aria-modal="true"
            aria-labelledby="incTemplateModalTitle"
            onClick={(e) => e.stopPropagation()}
          >
            <form className="modal-form" onSubmit={handleTemplateSubmit} noValidate>
              <div className="modal-form__head">
                <div className="modal-form__head-row">
                  <h3 id="incTemplateModalTitle">{editingTemplateId ? 'Edit recurring income' : 'New recurring income'}</h3>
                  <button
                    type="button"
                    className="modal-form__close"
                    onClick={() => setShowTemplateForm(false)}
                    disabled={submitting}
                    aria-label="Close"
                  >
                    ×
                  </button>
                </div>
              </div>

              <div className="modal-form__body modal-form__body--asset">
                {formError && <div className="form-banner form-banner--error form-banner--flash">{formError}</div>}

                <div className="field field--span2">
                  <label htmlFor="incTemplateTitle">
                    Title <Req />
                  </label>
                  <input
                    id="incTemplateTitle"
                    aria-invalid={Boolean(templateFieldErrors.title)}
                    value={templateForm.title}
                    onChange={(e) => {
                      setTemplateForm((f) => ({ ...f, title: e.target.value }));
                      if (templateFieldErrors.title) setTemplateFieldErrors((f) => ({ ...f, title: undefined }));
                    }}
                    placeholder="Shop rent, service fee…"
                    autoFocus
                  />
                  {templateFieldErrors.title ? (
                    <span className="field__error">{templateFieldErrors.title}</span>
                  ) : null}
                </div>

                <div className="field">
                  <label htmlFor="incTemplateCategory">
                    Category <Req />
                  </label>
                  <CategoryField
                    id="incTemplateCategory"
                    value={templateForm.categoryName}
                    onChange={(name) => {
                      setTemplateForm((f) => ({ ...f, categoryName: name }));
                      if (templateFieldErrors.categoryName) setTemplateFieldErrors((f) => ({ ...f, categoryName: undefined }));
                    }}
                    options={categoryOptions}
                  />
                  {templateFieldErrors.categoryName ? (
                    <span className="field__error">{templateFieldErrors.categoryName}</span>
                  ) : (
                    <span className="field__hint">Pick from the list or type a new one — it's added the first time it's used.</span>
                  )}
                </div>

                <div className="field">
                  <label htmlFor="incTemplateFrequency">
                    Repeats <Req />
                  </label>
                  <select
                    id="incTemplateFrequency"
                    value={templateForm.frequency}
                    onChange={(e) => setTemplateForm((f) => ({ ...f, frequency: e.target.value }))}
                  >
                    <option value="MONTHLY">Monthly</option>
                    <option value="QUARTERLY">Quarterly</option>
                    <option value="YEARLY">Yearly</option>
                  </select>
                </div>

                <div className="field">
                  <label htmlFor="incTemplateNextDue">
                    Next due date <Req />
                  </label>
                  <input
                    id="incTemplateNextDue"
                    type="date"
                    aria-invalid={Boolean(templateFieldErrors.nextDueDate)}
                    value={templateForm.nextDueDate}
                    onChange={(e) => {
                      setTemplateForm((f) => ({ ...f, nextDueDate: e.target.value }));
                      if (templateFieldErrors.nextDueDate) setTemplateFieldErrors((f) => ({ ...f, nextDueDate: undefined }));
                    }}
                  />
                  {templateFieldErrors.nextDueDate ? (
                    <span className="field__error">{templateFieldErrors.nextDueDate}</span>
                  ) : null}
                </div>
              </div>

              <div className="modal-form__foot">
                <div className="modal-form__foot-actions">
                  <button type="button" className="btn-secondary" onClick={() => setShowTemplateForm(false)} disabled={submitting}>
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

      {/* Recurring template's occurrence history */}
      {templateHistory && (
        <div className="glass-backdrop inv-panel__backdrop">
          <div
            className="glass-panel inv-panel__modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="incTemplateHistoryTitle"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="inv-modal__head">
              <div>
                <h3 id="incTemplateHistoryTitle">{templateHistory.template.title}</h3>
                <p className="inv-modal__sub">
                  {templateHistory.template.categoryName} · {FREQUENCY_LABEL[templateHistory.template.frequency]}
                </p>
              </div>
              <button
                type="button"
                className="inv-modal__close"
                onClick={() => setTemplateHistory(null)}
                aria-label="Close"
              >
                ×
              </button>
            </div>

            <div className="inv-modal__body">
              {templateHistoryLoading ? (
                <PageLoader inline label="Loading" />
              ) : templateHistory.income.length === 0 ? (
                <p className="inv-panel__hint">
                  Nothing generated yet — the first one lands here once "Next due date" arrives.
                </p>
              ) : (
                <ul className="inv-list">
                  {templateHistory.income.map((entry) => (
                    <li key={entry.id} className="inv-item">
                      <div
                        className="inv-item__body"
                        style={{ cursor: 'pointer' }}
                        onClick={() => {
                          setTemplateHistory(null);
                          openIncomeForm(entry, 'view');
                        }}
                      >
                        <div className="inv-item__name">
                          {formatDate(entry.incomeDate)}
                          {entry.paymentStatus !== 'PAID' && (
                            <span className={`inv-tag ${PAYMENT_STATUS_TAG_CLASS[entry.paymentStatus]}`}>
                              {PAYMENT_STATUS_LABEL[entry.paymentStatus]}
                            </span>
                          )}
                        </div>
                        <div className="inv-item__meta">
                          {formatPrice(entry.amount)}
                          {entry.amountReceived < entry.amount &&
                            ` · ${formatPrice(entry.amountReceived || 0)} received so far`}
                        </div>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        </div>
      )}

      {/* New / edit payer — same shared directory Assets/Expenses use. */}
      {showPayerForm && (
        <div className="glass-backdrop inv-panel__backdrop">
          <div
            className="glass-panel inv-panel__modal modal-form__panel"
            role="dialog"
            aria-modal="true"
            aria-labelledby="incPayerModalTitle"
            onClick={(e) => e.stopPropagation()}
          >
            <form className="modal-form" onSubmit={handlePayerSubmit} noValidate>
              <div className="modal-form__head">
                <div className="modal-form__head-row">
                  <h3 id="incPayerModalTitle">{editingPayerId ? 'Edit payer' : 'Add payer'}</h3>
                  <button
                    type="button"
                    className="modal-form__close"
                    onClick={() => setShowPayerForm(false)}
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
                  <label htmlFor="incPayerName">
                    Name <Req />
                  </label>
                  <input
                    id="incPayerName"
                    aria-invalid={Boolean(payerFieldErrors.name)}
                    value={payerForm.name}
                    onChange={(e) => {
                      setPayerForm((f) => ({ ...f, name: e.target.value }));
                      if (payerFieldErrors.name) setPayerFieldErrors((f) => ({ ...f, name: undefined }));
                    }}
                    autoFocus
                  />
                  {payerFieldErrors.name ? <span className="field__error">{payerFieldErrors.name}</span> : null}
                </div>
                <div className="field">
                  <label htmlFor="incPayerContact">Contact person</label>
                  <input
                    id="incPayerContact"
                    value={payerForm.contactPerson}
                    onChange={(e) => setPayerForm((f) => ({ ...f, contactPerson: e.target.value }))}
                  />
                </div>
                <div className="field">
                  <label htmlFor="incPayerPhone">Phone</label>
                  <input
                    id="incPayerPhone"
                    aria-invalid={Boolean(payerFieldErrors.phone)}
                    value={payerForm.phone}
                    onChange={(e) => {
                      setPayerForm((f) => ({ ...f, phone: typedMobile(e.target.value) }));
                      if (payerFieldErrors.phone) setPayerFieldErrors((f) => ({ ...f, phone: undefined }));
                    }}
                    type="tel"
                    inputMode="numeric"
                    maxLength={10}
                    placeholder="10-digit mobile"
                  />
                  {payerFieldErrors.phone ? <span className="field__error">{payerFieldErrors.phone}</span> : null}
                </div>
                <div className="field">
                  <label htmlFor="incPayerAltPhone">Alternate phone</label>
                  <input
                    id="incPayerAltPhone"
                    aria-invalid={Boolean(payerFieldErrors.altPhone)}
                    value={payerForm.altPhone}
                    onChange={(e) => {
                      setPayerForm((f) => ({ ...f, altPhone: typedMobile(e.target.value) }));
                      if (payerFieldErrors.altPhone) setPayerFieldErrors((f) => ({ ...f, altPhone: undefined }));
                    }}
                    type="tel"
                    inputMode="numeric"
                    maxLength={10}
                    placeholder="10-digit mobile (optional)"
                  />
                  {payerFieldErrors.altPhone ? (
                    <span className="field__error">{payerFieldErrors.altPhone}</span>
                  ) : null}
                </div>
                <div className="field">
                  <label htmlFor="incPayerEmail">Email</label>
                  <input
                    id="incPayerEmail"
                    value={payerForm.email}
                    onChange={(e) => setPayerForm((f) => ({ ...f, email: e.target.value }))}
                  />
                </div>
                <div className="field">
                  <label htmlFor="incPayerSpecialty">Specialty</label>
                  <input
                    id="incPayerSpecialty"
                    value={payerForm.specialty}
                    onChange={(e) => setPayerForm((f) => ({ ...f, specialty: e.target.value }))}
                  />
                </div>
                <div className="field">
                  <label htmlFor="incPayerNotes">Notes</label>
                  <input
                    id="incPayerNotes"
                    value={payerForm.notes}
                    onChange={(e) => setPayerForm((f) => ({ ...f, notes: e.target.value }))}
                  />
                </div>
              </div>

              <div className="modal-form__foot">
                <div className="modal-form__foot-actions">
                  <button type="button" className="btn-secondary" onClick={() => setShowPayerForm(false)} disabled={submitting}>
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

      {documentPreviewUrl && (
        <div className="glass-backdrop inv-panel__backdrop" onClick={closeDocumentPreview}>
          <div
            className="glass-panel inv-panel__modal inv-panel__modal--wide modal-form__panel"
            role="dialog"
            aria-modal="true"
            aria-label="Receipt preview"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="modal-form">
              <div className="modal-form__head">
                <div className="modal-form__head-row">
                  <h3>Receipt</h3>
                  <button type="button" className="btn-secondary" onClick={closeDocumentPreview}>
                    Close
                  </button>
                </div>
              </div>
              <iframe className="document-preview__frame" src={documentPreviewUrl} title="Receipt" />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
