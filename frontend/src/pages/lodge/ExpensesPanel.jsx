import { useEffect, useMemo, useRef, useState } from 'react';
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
import { BarList } from './AnalyticsCharts';
import SectionTabs from './SectionTabs';
import RowMenu from './RowMenu';
import Req from '../../components/RequiredMark';
import './forms.css';
import './InventoryPanel.css';
import './AnalyticsCharts.css';

const PAYMENT_LABEL = { CASH: 'Cash', UPI: 'UPI', CARD: 'Card' };
// Same colour language as billing's PAYMENT_METHOD_COLOR in
// AnalyticsOverview.jsx and the inv-tag status pills in AssetsPanel.jsx —
// cash/UPI/card read the same way everywhere this app shows a payment
// method, not a fresh palette invented for this one list.
const PAYMENT_TAG_CLASS = { CASH: 'inv-tag--good', UPI: 'inv-tag--info', CARD: 'inv-tag--low' };
const FREQUENCY_LABEL = { MONTHLY: 'Monthly', QUARTERLY: 'Quarterly', YEARLY: 'Yearly' };

const TABLE_SORT_ACCESSORS = {
  date: (e) => (e.expenseDate ? new Date(e.expenseDate).getTime() : 0),
  title: (e) => e.title || '',
  category: (e) => e.categoryName || '',
  vendor: (e) => e.vendorName || '',
  amount: (e) => Number(e.amount || 0),
  method: (e) => e.paymentMethod || '',
};

// Offered as suggestions, not a fixed list — same idea as
// SUGGESTED_CATEGORIES in AssetsPanel.jsx. A category only exists once it's
// been typed or picked here and used to save an expense; there is no
// separate "manage categories" screen, same as Assets has none.
const SUGGESTED_CATEGORIES = [
  'Utilities',
  'Salaries & Wages',
  'Maintenance & Repairs',
  'Housekeeping & Supplies',
  'F&B / Kitchen Supplies',
  'Marketing',
  'Taxes & Licenses',
  'Miscellaneous',
];

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
// CategoryField in AssetsPanel.jsx, kept as its own copy here rather than a
// shared import because the two panels' forms don't share a module today
// and duplicating one small presentational component is cheaper than
// introducing a cross-panel dependency for it.
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
        placeholder="Utilities, Repairs, Salaries…"
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
// back the whole vendor object on pick — same component as VendorField in
// AssetsPanel.jsx.
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

const emptyExpenseForm = {
  categoryName: '',
  vendorId: '',
  vendorName: '',
  title: '',
  description: '',
  amount: '',
  paymentMethod: 'CASH',
  expenseDate: todayIso(),
};

const emptyTemplateForm = {
  categoryName: '',
  vendorId: '',
  vendorName: '',
  title: '',
  amount: '',
  frequency: 'MONTHLY',
  nextDueDate: todayIso(),
};

const emptyVendorForm = { name: '', contactPerson: '', phone: '', email: '', specialty: '', notes: '' };

export default function ExpensesPanel() {
  const session = getSession();
  const [tab, setTab] = useState('expenses');

  const [expenses, setExpenses] = useState(() => readCache('/expenses') || []);
  const [categories, setCategories] = useState(() => readCache('/expenses/categories') || []);
  const [vendors, setVendors] = useState(() => readCache('/expenses/vendors') || []);
  const [templates, setTemplates] = useState(() => readCache('/expenses/recurring') || []);
  const [summary, setSummary] = useState(() => readCache('/expenses/summary') || null);

  const [error, setError] = useState('');
  const [generatedNotice, setGeneratedNotice] = useState('');

  // Filters
  const [query, setQuery] = useState('');
  const [categoryFilter, setCategoryFilter] = useState('');
  const [fromDate, setFromDate] = useState('');
  const [toDate, setToDate] = useState('');

  // Card vs table view, same toggle as AssetsPanel's asset register.
  const [expenseView, setExpenseView] = useState('table');
  const [tableSort, setTableSort] = useState({ key: 'date', dir: 'desc' });

  // Expense form
  const [showExpenseForm, setShowExpenseForm] = useState(false);
  const [editingExpenseId, setEditingExpenseId] = useState(null);
  const [expenseForm, setExpenseForm] = useState(emptyExpenseForm);
  const [expenseBillFile, setExpenseBillFile] = useState(null);
  const [formError, setFormError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  // Template form
  const [showTemplateForm, setShowTemplateForm] = useState(false);
  const [editingTemplateId, setEditingTemplateId] = useState(null);
  const [templateForm, setTemplateForm] = useState(emptyTemplateForm);

  // Vendor form
  const [showVendorForm, setShowVendorForm] = useState(false);
  const [editingVendorId, setEditingVendorId] = useState(null);
  const [vendorForm, setVendorForm] = useState(emptyVendorForm);

  const loadExpenses = () =>
    apiGet('/expenses', { token: session?.token })
      .then((data) => setExpenses(writeCache('/expenses', data.expenses)))
      .catch((err) => setError(err instanceof ApiError ? err.message : 'Could not load expenses.'));

  const loadCategories = () =>
    apiGet('/expenses/categories', { token: session?.token })
      .then((data) => setCategories(writeCache('/expenses/categories', data.categories)))
      .catch(() => {});

  const loadVendors = () =>
    apiGet('/expenses/vendors', { token: session?.token })
      .then((data) => setVendors(writeCache('/expenses/vendors', data.vendors)))
      .catch(() => {});

  const loadTemplates = () =>
    apiGet('/expenses/recurring', { token: session?.token })
      .then((data) => setTemplates(writeCache('/expenses/recurring', data.templates)))
      .catch(() => {});

  const loadSummary = () =>
    apiGet('/expenses/summary', { token: session?.token })
      .then((data) => setSummary(writeCache('/expenses/summary', data.summary)))
      .catch(() => {});

  // Recurring templates that came due are generated into real expense rows
  // the moment the panel opens — nobody has to remember to log the monthly
  // electricity bill by hand if a template already says what it costs.
  const generateDueThenLoad = async () => {
    try {
      const result = await apiPost('/expenses/recurring/generate-due', {}, { token: session?.token });
      if (result.generated?.length > 0) {
        setGeneratedNotice(
          `${result.generated.length} recurring expense${result.generated.length === 1 ? '' : 's'} logged automatically.`
        );
      }
    } catch {
      // Silent — this is a convenience, not something worth blocking the
      // panel over if it fails once.
    } finally {
      loadExpenses();
      loadTemplates();
    }
  };

  useEffect(() => {
    generateDueThenLoad();
    loadCategories();
    loadVendors();
    loadSummary();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const filteredExpenses = useMemo(() => {
    const q = query.trim().toLowerCase();
    return (expenses || []).filter((e) => {
      if (categoryFilter && String(e.categoryId) !== String(categoryFilter)) return false;
      if (fromDate && e.expenseDate < fromDate) return false;
      if (toDate && e.expenseDate > toDate) return false;
      if (q) {
        const haystack = `${e.title} ${e.description || ''} ${e.categoryName || ''} ${e.vendorName || ''}`.toLowerCase();
        if (!haystack.includes(q)) return false;
      }
      return true;
    });
  }, [expenses, query, categoryFilter, fromDate, toDate]);

  const filteredTotal = useMemo(
    () => filteredExpenses.reduce((sum, e) => sum + Number(e.amount || 0), 0),
    [filteredExpenses]
  );

  const sortedExpenses = useMemo(() => {
    if (!tableSort.key) return filteredExpenses;
    const accessor = TABLE_SORT_ACCESSORS[tableSort.key];
    if (!accessor) return filteredExpenses;
    const dir = tableSort.dir === 'desc' ? -1 : 1;
    return [...filteredExpenses].sort((a, b) => {
      const av = accessor(a);
      const bv = accessor(b);
      if (typeof av === 'number' && typeof bv === 'number') return (av - bv) * dir;
      return String(av).localeCompare(String(bv)) * dir;
    });
  }, [filteredExpenses, tableSort]);

  const toggleTableSort = (key) => {
    setTableSort((prev) => {
      if (prev.key !== key) return { key, dir: 'asc' };
      if (prev.dir === 'asc') return { key, dir: 'desc' };
      return { key: null, dir: 'asc' };
    });
  };

  // Top categories this year, for the breakdown chart next to the KPI row —
  // same BarList component the Reports overview uses, so "what am I
  // spending the most on" reads the same visual language everywhere this
  // app answers that question.
  const categoryBarRows = useMemo(() => {
    if (!summary) return [];
    return summary.byCategory.slice(0, 6).map((c) => ({ label: c.categoryName, value: c.total }));
  }, [summary]);

  // Only categories an expense is actually filed under — same reasoning as
  // categoryFilterOptions in AssetsPanel.jsx: a category picked while trying
  // out the combobox but never used has no reason to clutter this filter.
  const categoriesWithSpend = useMemo(() => {
    const usedIds = new Set((expenses || []).map((e) => e.categoryId));
    return (categories || []).filter((c) => usedIds.has(c.id));
  }, [categories, expenses]);

  const categoryOptions = useMemo(
    () => [...new Set([...categories.map((c) => c.name), ...SUGGESTED_CATEGORIES])].sort((a, b) => a.localeCompare(b)),
    [categories]
  );

  // Resolves the typed category name to an id, creating the category first
  // if nothing on file matches it — same as resolveCategoryId in
  // AssetsPanel.jsx. The expense/recurring forms are the only place a
  // category gets named.
  const resolveCategoryId = async (name) => {
    const trimmed = name.trim();
    const existing = categories.find((c) => c.name.toLowerCase() === trimmed.toLowerCase());
    if (existing) return existing.id;

    const created = await apiPost('/expenses/categories', { name: trimmed }, { token: session?.token });
    await loadCategories();
    return created.category.id;
  };

  // Same idea as resolveCategoryId: a vendor picked from the suggestion list
  // already has an id (form.vendorId), so this only reaches the network for
  // a name typed fresh.
  const resolveVendorId = async (form) => {
    if (!form.vendorName.trim()) return null;
    if (form.vendorId) return Number(form.vendorId);

    const trimmed = form.vendorName.trim();
    const existing = (vendors || []).find((v) => v.name.toLowerCase() === trimmed.toLowerCase());
    if (existing) return existing.id;

    const created = await apiPost('/expenses/vendors', { name: trimmed }, { token: session?.token });
    await loadVendors();
    return created.vendor.id;
  };

  // ---------------------------------------------------------------------
  // Expense form
  // ---------------------------------------------------------------------

  const openExpenseForm = (expense) => {
    setFormError('');
    setExpenseBillFile(null);
    if (expense) {
      setEditingExpenseId(expense.id);
      setExpenseForm({
        categoryName: expense.categoryName || '',
        vendorId: expense.vendorId ? String(expense.vendorId) : '',
        vendorName: expense.vendorName || '',
        title: expense.title,
        description: expense.description || '',
        amount: String(expense.amount),
        paymentMethod: expense.paymentMethod,
        expenseDate: expense.expenseDate?.slice(0, 10) || todayIso(),
      });
    } else {
      setEditingExpenseId(null);
      setExpenseForm(emptyExpenseForm);
    }
    setShowExpenseForm(true);
  };

  const handleExpenseSubmit = async (e) => {
    e.preventDefault();
    if (!expenseForm.categoryName.trim()) return setFormError('Enter or choose a category.');
    if (!expenseForm.title.trim()) return setFormError('Give this expense a title.');
    if (!expenseForm.amount || Number(expenseForm.amount) < 0) return setFormError('Enter a valid amount.');
    if (!expenseForm.expenseDate) return setFormError('Enter the expense date.');

    setSubmitting(true);
    setFormError('');
    try {
      const categoryId = await resolveCategoryId(expenseForm.categoryName);
      const vendorId = await resolveVendorId(expenseForm);
      const payload = {
        categoryId,
        vendorId: vendorId ?? '',
        title: expenseForm.title,
        description: expenseForm.description,
        amount: expenseForm.amount,
        paymentMethod: expenseForm.paymentMethod,
        expenseDate: expenseForm.expenseDate,
      };

      if (expenseBillFile) {
        const fd = new FormData();
        Object.entries(payload).forEach(([key, value]) => fd.append(key, value));
        fd.append('billDocument', expenseBillFile);
        if (editingExpenseId) {
          await apiPatchForm(`/expenses/${editingExpenseId}`, fd, { token: session?.token });
        } else {
          await apiPostForm('/expenses', fd, { token: session?.token });
        }
      } else if (editingExpenseId) {
        await apiPatch(`/expenses/${editingExpenseId}`, payload, { token: session?.token });
      } else {
        await apiPost('/expenses', payload, { token: session?.token });
      }
      setShowExpenseForm(false);
      await Promise.all([loadExpenses(), loadSummary()]);
    } catch (err) {
      setFormError(err instanceof ApiError ? err.message : 'Could not save this expense.');
    } finally {
      setSubmitting(false);
    }
  };

  const deleteExpense = async (expense) => {
    if (!window.confirm(`Delete "${expense.title}"? This can't be undone.`)) return;
    try {
      await apiDelete(`/expenses/${expense.id}`, { token: session?.token });
      await Promise.all([loadExpenses(), loadSummary()]);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not delete that expense.');
    }
  };

  const viewBill = async (expense) => {
    try {
      const blob = await apiGetBlob(`/expenses/${expense.id}/bill`, { token: session?.token });
      const url = URL.createObjectURL(blob);
      window.open(url, '_blank');
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not open that receipt.');
    }
  };

  // ---------------------------------------------------------------------
  // Recurring templates
  // ---------------------------------------------------------------------

  const openTemplateForm = (template) => {
    if (template) {
      setEditingTemplateId(template.id);
      setTemplateForm({
        categoryName: template.categoryName || '',
        vendorId: template.vendorId ? String(template.vendorId) : '',
        vendorName: template.vendorName || '',
        title: template.title,
        amount: String(template.amount),
        frequency: template.frequency,
        nextDueDate: template.nextDueDate?.slice(0, 10) || todayIso(),
      });
    } else {
      setEditingTemplateId(null);
      setTemplateForm(emptyTemplateForm);
    }
    setFormError('');
    setShowTemplateForm(true);
  };

  const handleTemplateSubmit = async (e) => {
    e.preventDefault();
    if (!templateForm.categoryName.trim()) return setFormError('Enter or choose a category.');
    if (!templateForm.title.trim()) return setFormError('Give this recurring expense a title.');
    if (!templateForm.amount || Number(templateForm.amount) < 0) return setFormError('Enter a valid amount.');
    if (!templateForm.nextDueDate) return setFormError('Enter the next due date.');

    setSubmitting(true);
    setFormError('');
    try {
      const categoryId = await resolveCategoryId(templateForm.categoryName);
      const vendorId = await resolveVendorId(templateForm);
      const payload = {
        categoryId,
        vendorId: vendorId ?? '',
        title: templateForm.title,
        amount: templateForm.amount,
        frequency: templateForm.frequency,
        nextDueDate: templateForm.nextDueDate,
      };

      if (editingTemplateId) {
        await apiPatch(`/expenses/recurring/${editingTemplateId}`, payload, { token: session?.token });
      } else {
        await apiPost('/expenses/recurring', payload, { token: session?.token });
      }
      setShowTemplateForm(false);
      await loadTemplates();
    } catch (err) {
      setFormError(err instanceof ApiError ? err.message : 'Could not save this recurring expense.');
    } finally {
      setSubmitting(false);
    }
  };

  const toggleTemplateActive = async (template) => {
    try {
      await apiPatch(`/expenses/recurring/${template.id}`, { isActive: !template.isActive }, { token: session?.token });
      await loadTemplates();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not update that recurring expense.');
    }
  };

  // ---------------------------------------------------------------------
  // Vendors
  // ---------------------------------------------------------------------

  const openVendorForm = (vendor) => {
    setFormError('');
    if (vendor) {
      setEditingVendorId(vendor.id);
      setVendorForm({
        name: vendor.name,
        contactPerson: vendor.contactPerson || '',
        phone: vendor.phone || '',
        email: vendor.email || '',
        specialty: vendor.specialty || '',
        notes: vendor.notes || '',
      });
    } else {
      setEditingVendorId(null);
      setVendorForm(emptyVendorForm);
    }
    setShowVendorForm(true);
  };

  const handleVendorSubmit = async (e) => {
    e.preventDefault();
    if (!vendorForm.name.trim()) return setFormError('Vendor name is required.');
    setSubmitting(true);
    setFormError('');
    try {
      if (editingVendorId) {
        await apiPatch(`/expenses/vendors/${editingVendorId}`, vendorForm, { token: session?.token });
      } else {
        await apiPost('/expenses/vendors', vendorForm, { token: session?.token });
      }
      setShowVendorForm(false);
      await loadVendors();
    } catch (err) {
      setFormError(err instanceof ApiError ? err.message : 'Could not save this vendor.');
    } finally {
      setSubmitting(false);
    }
  };

  const tabs = [
    { id: 'expenses', name: 'Expenses', count: expenses.length },
    { id: 'recurring', name: 'Recurring', count: templates.length },
    { id: 'vendors', name: 'Vendors', count: vendors.length },
  ];

  return (
    <div>
      {error && <div className="form-banner form-banner--error">{error}</div>}
      {generatedNotice && <div className="form-banner form-banner--flash">{generatedNotice}</div>}

      <SectionTabs ariaLabel="Expenses sections" activeId={tab} onChange={setTab} tabs={tabs} />

      {tab === 'expenses' && (
        <div>
          {summary && (
            <>
              <div className="kpi-row">
                <div className="kpi-card kpi-card--primary">
                  <span className="kpi-label">Spent this year</span>
                  <span className="kpi-value">{formatPrice(summary.byMonth.reduce((s, m) => s + m.total, 0))}</span>
                  <span className="kpi-sub">Across every category and vendor</span>
                </div>
                <div className="kpi-card">
                  <span className="kpi-label">This month</span>
                  <span className="kpi-value">{formatPrice(summary.byMonth.find((m) => m.month === new Date().getMonth() + 1)?.total || 0)}</span>
                  <span className="kpi-sub">{new Date().toLocaleDateString('en-IN', { month: 'long' })} so far</span>
                </div>
                <div className="kpi-card">
                  <span className="kpi-label">Top category</span>
                  <span className="kpi-value" style={{ fontSize: 18 }}>{summary.byCategory[0]?.categoryName || '—'}</span>
                  <span className="kpi-sub">{summary.byCategory[0] ? formatPrice(summary.byCategory[0].total) : 'No expenses logged yet'}</span>
                </div>
                <div className="kpi-card">
                  <span className="kpi-label">Filtered total</span>
                  <span className="kpi-value">{formatPrice(filteredTotal)}</span>
                  <span className="kpi-sub">{filteredExpenses.length} expense{filteredExpenses.length === 1 ? '' : 's'} in view</span>
                </div>
              </div>

              {categoryBarRows.length > 0 && (
                <div className="analytics-card" style={{ marginBottom: 16 }}>
                  <div className="analytics-card-head">
                    <span className="analytics-card-title">Where it's going this year</span>
                  </div>
                  <BarList rows={categoryBarRows} formatValue={formatPrice} tone="brand" />
                </div>
              )}
            </>
          )}

          <div className="inv-bar">
            <div className="inv-bar__row asset-toolbar-row">
              <div className="asset-toolbar-row__filters">
                <div className="inv-search">
                  <span className="inv-search__icon" />
                  <input placeholder="Search expenses…" value={query} onChange={(e) => setQuery(e.target.value)} />
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
                <input type="date" value={fromDate} onChange={(e) => setFromDate(e.target.value)} aria-label="From date" />
                <input type="date" value={toDate} onChange={(e) => setToDate(e.target.value)} aria-label="To date" />
              </div>
              <div className="asset-toolbar-row__end">
                <div className="toggle-group asset-view-toggle" role="group" aria-label="Expense list view">
                  <button
                    type="button"
                    className="asset-view-toggle__btn"
                    aria-pressed={expenseView === 'cards'}
                    aria-label="Cards view"
                    title="Cards view"
                    onClick={() => setExpenseView('cards')}
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
                    aria-pressed={expenseView === 'table'}
                    aria-label="Table view"
                    title="Table view"
                    onClick={() => setExpenseView('table')}
                  >
                    <svg viewBox="0 0 20 20" width="16" height="16" fill="none" aria-hidden="true">
                      <rect x="2.5" y="3.5" width="15" height="13" rx="1.4" stroke="currentColor" strokeWidth="1.6" />
                      <line x1="2.5" y1="8" x2="17.5" y2="8" stroke="currentColor" strokeWidth="1.6" />
                      <line x1="2.5" y1="12.3" x2="17.5" y2="12.3" stroke="currentColor" strokeWidth="1.6" />
                      <line x1="7.3" y1="3.5" x2="7.3" y2="16.5" stroke="currentColor" strokeWidth="1.6" />
                    </svg>
                  </button>
                </div>
                <button type="button" className="btn-accent" onClick={() => openExpenseForm(null)}>
                  + New expense
                </button>
              </div>
            </div>
          </div>

          {filteredExpenses.length === 0 ? (
            <p className="inv-panel__hint">
              {expenses.length === 0
                ? 'Nothing logged yet. Log the first bill — electricity, salaries, a repair — and it starts showing up here.'
                : 'No expense matches these filters.'}
            </p>
          ) : expenseView === 'table' ? (
            <div className="asset-table-wrap">
              <table className="asset-table">
                <thead>
                  <tr>
                    {[
                      ['date', 'Date'],
                      ['title', 'Title'],
                      ['category', 'Category'],
                      ['vendor', 'Vendor'],
                      ['method', 'Paid via'],
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
                  {sortedExpenses.map((expense) => (
                    <tr key={expense.id} onClick={() => openExpenseForm(expense)}>
                      <td className="asset-table__muted">{formatDate(expense.expenseDate)}</td>
                      <td className="asset-table__name">
                        {expense.title}
                        {expense.description && (
                          <div className="asset-table__muted" style={{ fontSize: 12 }}>{expense.description}</div>
                        )}
                      </td>
                      <td>{expense.categoryName}</td>
                      <td className={expense.vendorName ? '' : 'asset-table__muted'}>{expense.vendorName || '—'}</td>
                      <td>
                        <span className={`inv-tag ${PAYMENT_TAG_CLASS[expense.paymentMethod]}`}>
                          {PAYMENT_LABEL[expense.paymentMethod]}
                        </span>
                      </td>
                      <td className="asset-table__mono">{formatPrice(expense.amount)}</td>
                      <td className="asset-table__actions" onClick={(e) => e.stopPropagation()}>
                        <RowMenu label={`More actions for ${expense.title}`}>
                          <button type="button" onClick={() => openExpenseForm(expense)}>
                            Edit expense
                          </button>
                          {expense.hasBillDocument && (
                            <button type="button" onClick={() => viewBill(expense)}>
                              View receipt
                            </button>
                          )}
                          <button type="button" className="inv-danger" onClick={() => deleteExpense(expense)}>
                            Delete expense
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
              {sortedExpenses.map((expense) => (
                <li key={expense.id} className="inv-item">
                  <div className="inv-item__body" onClick={() => openExpenseForm(expense)} style={{ cursor: 'pointer' }}>
                    <div className="inv-item__name">
                      {expense.title}
                      <span className="inv-tag">{expense.categoryName}</span>
                      <span className={`inv-tag ${PAYMENT_TAG_CLASS[expense.paymentMethod]}`}>
                        {PAYMENT_LABEL[expense.paymentMethod]}
                      </span>
                    </div>
                    <div className="inv-item__meta">
                      {formatDate(expense.expenseDate)} · {formatPrice(expense.amount)}
                      {expense.vendorName && ` · ${expense.vendorName}`}
                      {expense.description && ` · ${expense.description}`}
                    </div>
                  </div>
                  <div className="inv-item__actions">
                    {expense.hasBillDocument && (
                      <button type="button" className="inv-linkbtn" onClick={() => viewBill(expense)}>
                        Receipt
                      </button>
                    )}
                    <button type="button" className="inv-danger" onClick={() => deleteExpense(expense)}>
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
                  + New recurring expense
                </button>
              </div>
            </div>
          </div>

          {(templates || []).length === 0 ? (
            <p className="inv-panel__hint">
              No recurring expenses set up. Add rent, electricity or any other bill that repeats on a schedule, and
              it will be logged automatically when it's due.
            </p>
          ) : (
            <ul className="inv-list">
              {templates.map((template) => {
                const daysUntilDue = template.nextDueDate
                  ? Math.ceil((new Date(template.nextDueDate) - new Date()) / (1000 * 60 * 60 * 24))
                  : null;
                const dueTagClass = daysUntilDue == null ? '' : daysUntilDue < 0 ? 'inv-tag--bad' : daysUntilDue <= 7 ? 'inv-tag--low' : 'inv-tag--good';
                return (
                  <li key={template.id} className="inv-item">
                    <div className="inv-item__body" onClick={() => openTemplateForm(template)} style={{ cursor: 'pointer' }}>
                      <div className="inv-item__name">
                        {template.title}
                        <span className="inv-tag">{template.categoryName}</span>
                        <span className="inv-tag inv-tag--info">{FREQUENCY_LABEL[template.frequency]}</span>
                        {!template.isActive && <span className="inv-tag inv-tag--off">Paused</span>}
                      </div>
                      <div className="inv-item__meta">
                        {formatPrice(template.amount)} ·{' '}
                        <span className={`inv-tag ${dueTagClass}`}>Next due {formatDate(template.nextDueDate)}</span>
                        {template.vendorName && ` · ${template.vendorName}`}
                      </div>
                    </div>
                    <div className="inv-item__actions">
                      <button type="button" className="inv-linkbtn" onClick={() => toggleTemplateActive(template)}>
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
            <p className="inv-panel__hint">No vendors yet. Add anyone you regularly pay for supplies or services.</p>
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

      {/* New / edit expense */}
      {showExpenseForm && (
        <div className="glass-backdrop inv-panel__backdrop" onClick={() => !submitting && setShowExpenseForm(false)}>
          <div
            className="glass-panel inv-panel__modal modal-form__panel"
            role="dialog"
            aria-modal="true"
            aria-labelledby="expenseModalTitle"
            onClick={(e) => e.stopPropagation()}
          >
            <form className="modal-form" onSubmit={handleExpenseSubmit} noValidate>
              <div className="modal-form__head">
                <div className="modal-form__head-row">
                  <h3 id="expenseModalTitle">{editingExpenseId ? 'Edit expense' : 'New expense'}</h3>
                  <button
                    type="button"
                    className="modal-form__close"
                    onClick={() => setShowExpenseForm(false)}
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
                  <label htmlFor="expenseTitle">
                    Title <Req />
                  </label>
                  <input
                    id="expenseTitle"
                    value={expenseForm.title}
                    onChange={(e) => setExpenseForm((f) => ({ ...f, title: e.target.value }))}
                    placeholder="MSEB electricity bill, June salaries…"
                    autoFocus
                  />
                </div>

                <div className="field">
                  <label htmlFor="expenseCategory">
                    Category <Req />
                  </label>
                  <CategoryField
                    id="expenseCategory"
                    value={expenseForm.categoryName}
                    onChange={(name) => setExpenseForm((f) => ({ ...f, categoryName: name }))}
                    options={categoryOptions}
                  />
                  <span className="field__hint">Pick from the list or type a new one — it's added the first time it's used.</span>
                </div>

                <div className="field">
                  <label htmlFor="expenseVendor">Vendor</label>
                  <VendorField
                    id="expenseVendor"
                    value={expenseForm.vendorName}
                    vendors={vendors}
                    onChange={(name) => setExpenseForm((f) => ({ ...f, vendorName: name, vendorId: '' }))}
                    onPick={(vendor) => setExpenseForm((f) => ({ ...f, vendorName: vendor.name, vendorId: String(vendor.id) }))}
                  />
                </div>

                <div className="field">
                  <label htmlFor="expenseAmount">
                    Amount <Req />
                  </label>
                  <input
                    id="expenseAmount"
                    type="number"
                    min="0"
                    step="0.01"
                    value={expenseForm.amount}
                    onChange={(e) => setExpenseForm((f) => ({ ...f, amount: e.target.value }))}
                  />
                </div>

                <div className="field">
                  <label htmlFor="expensePaymentMethod">
                    Paid via <Req />
                  </label>
                  <select
                    id="expensePaymentMethod"
                    value={expenseForm.paymentMethod}
                    onChange={(e) => setExpenseForm((f) => ({ ...f, paymentMethod: e.target.value }))}
                  >
                    <option value="CASH">Cash</option>
                    <option value="UPI">UPI</option>
                    <option value="CARD">Card</option>
                  </select>
                </div>

                <div className="field">
                  <label htmlFor="expenseDate">
                    Date <Req />
                  </label>
                  <input
                    id="expenseDate"
                    type="date"
                    value={expenseForm.expenseDate}
                    onChange={(e) => setExpenseForm((f) => ({ ...f, expenseDate: e.target.value }))}
                  />
                </div>

                <div className="field">
                  <label htmlFor="expenseDescription">Notes</label>
                  <input
                    id="expenseDescription"
                    value={expenseForm.description}
                    onChange={(e) => setExpenseForm((f) => ({ ...f, description: e.target.value }))}
                  />
                </div>

                <div className="field">
                  <label htmlFor="expenseBill">Receipt / bill (image or PDF)</label>
                  <input
                    id="expenseBill"
                    type="file"
                    accept="image/jpeg,image/png,image/webp,application/pdf"
                    onChange={(e) => setExpenseBillFile(e.target.files?.[0] || null)}
                  />
                </div>
              </div>

              <div className="modal-form__foot">
                <div className="modal-form__foot-actions">
                  <button type="button" className="btn-secondary" onClick={() => setShowExpenseForm(false)} disabled={submitting}>
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

      {/* New / edit recurring template */}
      {showTemplateForm && (
        <div className="glass-backdrop inv-panel__backdrop" onClick={() => !submitting && setShowTemplateForm(false)}>
          <div
            className="glass-panel inv-panel__modal modal-form__panel"
            role="dialog"
            aria-modal="true"
            aria-labelledby="templateModalTitle"
            onClick={(e) => e.stopPropagation()}
          >
            <form className="modal-form" onSubmit={handleTemplateSubmit} noValidate>
              <div className="modal-form__head">
                <div className="modal-form__head-row">
                  <h3 id="templateModalTitle">{editingTemplateId ? 'Edit recurring expense' : 'New recurring expense'}</h3>
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

              <div className="modal-form__body">
                {formError && <div className="form-banner form-banner--error form-banner--flash">{formError}</div>}

                <div className="field">
                  <label htmlFor="templateTitle">
                    Title <Req />
                  </label>
                  <input
                    id="templateTitle"
                    value={templateForm.title}
                    onChange={(e) => setTemplateForm((f) => ({ ...f, title: e.target.value }))}
                    placeholder="Rent, electricity, lift AMC…"
                    autoFocus
                  />
                </div>

                <div className="field">
                  <label htmlFor="templateCategory">
                    Category <Req />
                  </label>
                  <CategoryField
                    id="templateCategory"
                    value={templateForm.categoryName}
                    onChange={(name) => setTemplateForm((f) => ({ ...f, categoryName: name }))}
                    options={categoryOptions}
                  />
                  <span className="field__hint">Pick from the list or type a new one — it's added the first time it's used.</span>
                </div>

                <div className="field">
                  <label htmlFor="templateVendor">Vendor</label>
                  <VendorField
                    id="templateVendor"
                    value={templateForm.vendorName}
                    vendors={vendors}
                    onChange={(name) => setTemplateForm((f) => ({ ...f, vendorName: name, vendorId: '' }))}
                    onPick={(vendor) => setTemplateForm((f) => ({ ...f, vendorName: vendor.name, vendorId: String(vendor.id) }))}
                  />
                </div>

                <div className="field">
                  <label htmlFor="templateAmount">
                    Amount <Req />
                  </label>
                  <input
                    id="templateAmount"
                    type="number"
                    min="0"
                    step="0.01"
                    value={templateForm.amount}
                    onChange={(e) => setTemplateForm((f) => ({ ...f, amount: e.target.value }))}
                  />
                </div>

                <div className="field">
                  <label htmlFor="templateFrequency">
                    Repeats <Req />
                  </label>
                  <select
                    id="templateFrequency"
                    value={templateForm.frequency}
                    onChange={(e) => setTemplateForm((f) => ({ ...f, frequency: e.target.value }))}
                  >
                    <option value="MONTHLY">Monthly</option>
                    <option value="QUARTERLY">Quarterly</option>
                    <option value="YEARLY">Yearly</option>
                  </select>
                </div>

                <div className="field">
                  <label htmlFor="templateNextDue">
                    Next due date <Req />
                  </label>
                  <input
                    id="templateNextDue"
                    type="date"
                    value={templateForm.nextDueDate}
                    onChange={(e) => setTemplateForm((f) => ({ ...f, nextDueDate: e.target.value }))}
                  />
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

      {/* New / edit vendor — same shared directory Assets uses. */}
      {showVendorForm && (
        <div className="glass-backdrop inv-panel__backdrop" onClick={() => !submitting && setShowVendorForm(false)}>
          <div
            className="glass-panel inv-panel__modal modal-form__panel"
            role="dialog"
            aria-modal="true"
            aria-labelledby="expVendorModalTitle"
            onClick={(e) => e.stopPropagation()}
          >
            <form className="modal-form" onSubmit={handleVendorSubmit} noValidate>
              <div className="modal-form__head">
                <div className="modal-form__head-row">
                  <h3 id="expVendorModalTitle">{editingVendorId ? 'Edit vendor' : 'Add vendor'}</h3>
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
                  <label htmlFor="expVendorName">
                    Name <Req />
                  </label>
                  <input
                    id="expVendorName"
                    value={vendorForm.name}
                    onChange={(e) => setVendorForm((f) => ({ ...f, name: e.target.value }))}
                    autoFocus
                  />
                </div>
                <div className="field">
                  <label htmlFor="expVendorContact">Contact person</label>
                  <input
                    id="expVendorContact"
                    value={vendorForm.contactPerson}
                    onChange={(e) => setVendorForm((f) => ({ ...f, contactPerson: e.target.value }))}
                  />
                </div>
                <div className="field">
                  <label htmlFor="expVendorPhone">Phone</label>
                  <input
                    id="expVendorPhone"
                    value={vendorForm.phone}
                    onChange={(e) => setVendorForm((f) => ({ ...f, phone: e.target.value }))}
                  />
                </div>
                <div className="field">
                  <label htmlFor="expVendorEmail">Email</label>
                  <input
                    id="expVendorEmail"
                    value={vendorForm.email}
                    onChange={(e) => setVendorForm((f) => ({ ...f, email: e.target.value }))}
                  />
                </div>
                <div className="field">
                  <label htmlFor="expVendorSpecialty">Specialty</label>
                  <input
                    id="expVendorSpecialty"
                    value={vendorForm.specialty}
                    onChange={(e) => setVendorForm((f) => ({ ...f, specialty: e.target.value }))}
                  />
                </div>
                <div className="field">
                  <label htmlFor="expVendorNotes">Notes</label>
                  <input
                    id="expVendorNotes"
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
    </div>
  );
}
