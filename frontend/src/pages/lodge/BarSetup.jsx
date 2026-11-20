import { useEffect, useMemo, useState } from 'react';
import { apiGet, apiPost, apiPatch, apiDelete } from '../../lib/api';
import PageLoader from '../../components/PageLoader';
import { Modal } from './HousekeepingParts';
import { Field, Note, Seg } from './BarBits';
import { barToken, errText, stockText } from './barFormat';
import { formatPrice } from './priceFormat';
import './forms.css';
import './MenuPanel.css';
import './HousekeepingPanel.css';
import './Bar.css';

// Bar menu & stock. Stock is one number per product, in ml; every row shows ml and bottles
// together. The low-stock limit is set per product (bottles or ml), with a lodge-wide default
// under Settings.
export default function BarSetup({ onViewReport = null }) {
  const token = barToken();
  const [view, setView] = useState('stock');
  const [menu, setMenu] = useState(null);
  const [error, setError] = useState('');
  const [msg, setMsg] = useState('');
  const [version, setVersion] = useState(0);

  useEffect(() => {
    let live = true;
    apiGet('/bar/menu', { token })
      .then((m) => live && setMenu(m))
      .catch((e) => live && setError(errText(e, 'Could not load the bar menu.')));
    return () => {
      live = false;
    };
  }, [token, version]);

  // One place for every write: run it, reload, show the server's message on failure.
  const run = async (fn, ok = '') => {
    setError('');
    setMsg('');
    try {
      await fn();
      setVersion((v) => v + 1);
      setMsg(ok);
      return true;
    } catch (e) {
      setError(errText(e));
      return false;
    }
  };

  if (!menu) return error ? <Note kind="error">{error}</Note> : <PageLoader label="Loading the bar" />;

  return (
    <div className="bar">
      <div className="bar-toolbar">
        <Seg value={view} onChange={(v) => { setView(v); setMsg(''); setError(''); }} options={[['stock', 'Stock'], ['menu', 'Menu'], ['settings', 'Settings']]} />
        {onViewReport && <button type="button" className="bar-link" onClick={onViewReport}>Bar report →</button>}
      </div>
      {error && <Note kind="error">{error}</Note>}
      {msg && <Note kind="ok">✓ {msg}</Note>}
      {view === 'stock' && <StockView menu={menu} token={token} run={run} />}
      {view === 'menu' && <MenuView menu={menu} token={token} run={run} />}
      {view === 'settings' && <SettingsView menu={menu} token={token} run={run} />}
    </div>
  );
}

const asProductBody = (p, patch = {}) => ({
  name: p.name,
  brand: p.brand,
  categoryId: p.categoryId,
  bottleMl: p.bottleMl,
  lowStockMl: p.lowStockMl,
  isActive: p.isActive,
  ...patch,
});

const REASON = { PURCHASE: 'Receive stock', WASTAGE: 'Record wastage', ADJUSTMENT: 'Adjust stock' };
const blankForm = { bottles: '', ml: '', direction: 'ADD', note: '' };

const Kpi = ({ label, value, tone = '' }) => (
  <div className={`bar-st-kpi${tone ? ` bar-st-kpi--${tone}` : ''}`}>
    <span className="bar-st-kpi__label">{label}</span>
    <span className="bar-st-kpi__value">{value}</span>
  </div>
);

// How full a product is against a "par" level: three times its alert limit, or four bottles when
// it has none. Only a visual cue, the numbers beside it are the truth.
function level(p, defaultLow) {
  const limit = p.lowStockMl ?? defaultLow ?? 0;
  const par = Math.max(limit * 3, p.bottleMl * 4);
  return Math.max(0, Math.min(1, p.stockMl / par));
}
const statusOf = (p) => (p.stockMl <= 0 ? 'out' : p.isLow ? 'low' : 'ok');
const STATUS_LABEL = { out: 'Out of stock', low: 'Low stock', ok: 'In stock' };

function StockView({ menu, token, run }) {
  const [open, setOpen] = useState(null); // { id, reason }
  const [form, setForm] = useState(blankForm);
  const [limit, setLimit] = useState({}); // productId -> { value, unit }
  const [filter, setFilter] = useState('ALL');
  const [cat, setCat] = useState('ALL');
  const [query, setQuery] = useState('');
  const products = useMemo(() => menu.products.filter((p) => p.isActive), [menu.products]);
  const count = (s) => products.filter((p) => statusOf(p) === s).length;

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    return products
      .filter((p) => (filter === 'ALL' || statusOf(p) === filter) && (cat === 'ALL' || String(p.categoryId ?? 'NONE') === cat) && (!q || `${p.name} ${p.brand || ''}`.toLowerCase().includes(q)))
      .sort((a, b) => Number(statusOf(b) !== 'ok') - Number(statusOf(a) !== 'ok') || a.name.localeCompare(b.name));
  }, [products, filter, cat, query]);

  const save = async (p) => {
    const ok = await run(
      () =>
        apiPost(
          `/bar/stock/${p.id}/adjust`,
          { reason: open.reason, direction: open.reason === 'ADJUSTMENT' ? form.direction : undefined, bottles: Number(form.bottles || 0), ml: Number(form.ml || 0), note: form.note || null },
          { token }
        ),
      `${p.name}: stock updated.`
    );
    if (ok) {
      setOpen(null);
      setForm(blankForm);
    }
  };

  const saveLimit = async (p) => {
    const l = limit[p.id];
    const raw = l.value === '' ? null : Number(l.value);
    const ml = raw == null ? null : l.unit === 'btl' ? raw * p.bottleMl : raw;
    if (await run(() => apiPatch(`/bar/products/${p.id}`, asProductBody(p, { lowStockMl: ml }), { token }), `${p.name}: alert limit saved.`)) {
      setLimit((s) => ({ ...s, [p.id]: undefined }));
    }
  };

  const openPanel = (p, reason) => {
    setOpen({ id: p.id, reason });
    setForm(blankForm);
  };

  return (
    <>
      <div className="bar-st-kpis">
        <Kpi label="Products" value={products.length} />
        <Kpi label="In stock" value={count('ok')} tone="ok" />
        <Kpi label="Low stock" value={count('low')} tone={count('low') ? 'low' : ''} />
        <Kpi label="Out of stock" value={count('out')} tone={count('out') ? 'out' : ''} />
      </div>

      <section className="bar-card">
        <div className="bar-st-filters">
          <input className="bar-input bar-st-search" type="search" placeholder="Search products or brands" aria-label="Search products" value={query} onChange={(e) => setQuery(e.target.value)} />
          <div className="bar-st-pills" role="group" aria-label="Status">
            {[['ALL', 'All'], ['low', 'Low'], ['out', 'Out']].map(([k, label]) => (
              <button key={k} type="button" aria-pressed={filter === k} onClick={() => setFilter(k)}>{label}</button>
            ))}
          </div>
          <select className="bar-input bar-st-cat" aria-label="Category" value={cat} onChange={(e) => setCat(e.target.value)}>
            <option value="ALL">All categories</option>
            {menu.categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </div>

        {shown.length === 0 ? (
          <div className="bar-empty">{products.length === 0 ? 'No products yet. Add one under Menu.' : 'No products match.'}</div>
        ) : (
          <div className="bar-table-wrap">
            <table className="bar-table bar-st-table">
              <thead>
                <tr><th>Product</th><th>Stock level</th><th>Alert at</th><th /></tr>
              </thead>
              <tbody>
                {shown.map((p) => {
                  const st = statusOf(p);
                  const l = limit[p.id];
                  const cur = l ?? { value: p.lowStockMl == null ? '' : String(p.lowStockMl), unit: 'ml' };
                  return [
                    <tr key={p.id} className={open?.id === p.id ? 'is-open' : undefined}>
                      <td>
                        <div className="bar-strong">{p.name}</div>
                        <div className="bar-muted">{p.brand ? `${p.brand} · ` : ''}{p.bottleMl} ml bottle</div>
                      </td>
                      <td>
                        <div className="bar-st-level">
                          <div className="bar-st-level__top">
                            <span className="bar-num bar-strong">{stockText(p)}</span>
                            <span className={`bar-chip bar-chip--${st === 'ok' ? 'ok' : st}`}>{STATUS_LABEL[st]}</span>
                          </div>
                          <div className="bar-st-level__track"><span className={`bar-st-level__fill bar-st-level__fill--${st}`} style={{ width: `${Math.max(st === 'out' ? 0 : 4, Math.round(level(p, menu.settings.defaultLowStockMl) * 100))}%` }} /></div>
                        </div>
                      </td>
                      <td>
                        <div className="bar-st-limit">
                          <input className="bar-input bar-input--sm" type="number" min="0" aria-label={`Alert limit for ${p.name}`} placeholder={menu.settings.defaultLowStockMl ? `${menu.settings.defaultLowStockMl}` : '—'} value={cur.value} onChange={(e) => setLimit((s) => ({ ...s, [p.id]: { ...cur, value: e.target.value } }))} />
                          <select className="bar-input bar-input--sm bar-st-unit" aria-label="Unit" value={cur.unit} onChange={(e) => setLimit((s) => ({ ...s, [p.id]: { ...cur, unit: e.target.value } }))}>
                            <option value="ml">ml</option>
                            <option value="btl">btl</option>
                          </select>
                          {l && <button type="button" className="bar-btn bar-btn--sm bar-btn--brand" onClick={() => saveLimit(p)}>Save</button>}
                        </div>
                      </td>
                      <td>
                        <div className="bar-st-actions">
                          <button type="button" className="bar-btn bar-btn--sm bar-btn--brand" onClick={() => openPanel(p, 'PURCHASE')}>Receive</button>
                          <button type="button" className="bar-btn bar-btn--sm" onClick={() => openPanel(p, 'WASTAGE')}>Wastage</button>
                          <button type="button" className="bar-btn bar-btn--sm" onClick={() => openPanel(p, 'ADJUSTMENT')}>Adjust</button>
                        </div>
                      </td>
                    </tr>,
                    open?.id === p.id && (
                      <tr key={`${p.id}-form`} className="bar-table__panel">
                        <td colSpan={4}>
                          <div className="bar-st-panel">
                            <div className="bar-st-panel__title">{REASON[open.reason]} <span className="bar-muted">· {p.name}</span></div>
                            <div className="bar-form-grid">
                              {open.reason === 'ADJUSTMENT' && (
                                <Field label="Action">
                                  <select value={form.direction} onChange={(e) => setForm({ ...form, direction: e.target.value })}>
                                    <option value="ADD">Add to stock</option>
                                    <option value="REMOVE">Remove from stock</option>
                                  </select>
                                </Field>
                              )}
                              <Field label="Bottles"><input type="number" min="0" value={form.bottles} onChange={(e) => setForm({ ...form, bottles: e.target.value })} /></Field>
                              <Field label="Extra ml"><input type="number" min="0" value={form.ml} onChange={(e) => setForm({ ...form, ml: e.target.value })} /></Field>
                              <Field label="Note (optional)"><input value={form.note} onChange={(e) => setForm({ ...form, note: e.target.value })} /></Field>
                            </div>
                            <div className="bar-flex">
                              <button type="button" className="bar-btn bar-btn--primary" onClick={() => save(p)}>Save</button>
                              <button type="button" className="bar-btn" onClick={() => setOpen(null)}>Cancel</button>
                            </div>
                          </div>
                        </td>
                      </tr>
                    ),
                  ];
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </>
  );
}

const PRESETS = [30, 60, 90, 180];
const blankProduct = { name: '', brand: '', categoryId: '', bottleMl: '750', openingBottles: '', sizes: [{ label: '60 ml', ml: '60', price: '' }] };

function MenuView({ menu, token, run }) {
  const [cat, setCat] = useState('');
  const [adding, setAdding] = useState(false);
  const [addingCat, setAddingCat] = useState(false);
  const [sizeOpen, setSizeOpen] = useState(null); // card whose add-size row is open
  const [editingId, setEditingId] = useState(null); // product open in the edit pop-up
  // Cards or compact list; remembered in this browser.
  const [layout, setLayoutState] = useState(() => {
    try {
      return localStorage.getItem('bar.menuLayout') === 'cards' ? 'cards' : 'list';
    } catch {
      return 'list';
    }
  });
  const setLayout = (v) => {
    setLayoutState(v);
    try {
      localStorage.setItem('bar.menuLayout', v);
    } catch {
      /* private window: the choice just is not remembered */
    }
  };
  const [editCat, setEditCat] = useState(null); // { id, name } being renamed
  const [delCat, setDelCat] = useState(null); // id armed for a second click
  const [prod, setProd] = useState(blankProduct);
  const [sizeFor, setSizeFor] = useState({}); // productId -> { label, ml, price }
  const [edit, setEdit] = useState(null); // { id, value } while a price is being edited
  const [filterCat, setFilterCat] = useState('ALL');
  const [query, setQuery] = useState('');

  const setSize = (i, patch) => setProd((p) => ({ ...p, sizes: p.sizes.map((s, j) => (i === j ? { ...s, ...patch } : s)) }));
  const addPreset = (ml) => setProd((p) => ({ ...p, sizes: [...p.sizes, { label: `${ml} ml`, ml: String(ml), price: '' }] }));

  const createProduct = async () => {
    const ok = await run(
      () =>
        apiPost(
          '/bar/products',
          {
            name: prod.name,
            brand: prod.brand || null,
            categoryId: prod.categoryId ? Number(prod.categoryId) : null,
            bottleMl: Number(prod.bottleMl),
            openingBottles: Number(prod.openingBottles || 0),
            sizes: prod.sizes.filter((s) => s.label && s.ml).map((s) => ({ label: s.label, ml: Number(s.ml), price: Number(s.price || 0) })),
          },
          { token }
        ),
      'Product added.'
    );
    if (ok) {
      setProd(blankProduct);
      setAdding(false);
    }
  };

  const savePrice = async (s) => {
    if (await run(() => apiPatch(`/bar/sizes/${s.id}`, { price: Number(edit.value) }, { token }), 'Price updated.')) setEdit(null);
  };

  const catName = (id) => menu.categories.find((c) => c.id === id)?.name || 'No category';
  const visible = menu.products.filter(
    (p) => (filterCat === 'ALL' || String(p.categoryId ?? 'NONE') === filterCat) && (!query.trim() || `${p.name} ${p.brand || ''}`.toLowerCase().includes(query.trim().toLowerCase()))
  );

  const countIn = (id) => menu.products.filter((p) => String(p.categoryId ?? 'NONE') === id).length;
  // Quick add from the product form's Category dropdown: create it, then select it.
  const [quick, setQuick] = useState(null); // null, or the name being typed
  const quickAdd = async () => {
    let id = null;
    const ok = await run(async () => {
      const res = await apiPost('/bar/categories', { name: quick }, { token });
      id = res.id;
    }, 'Category added.');
    if (ok && id != null) {
      setProd((p) => ({ ...p, categoryId: String(id) }));
      setQuick(null);
    }
  };

  const saveCategoryName = async (c) => {
    if (await run(() => apiPatch(`/bar/categories/${c.id}`, { name: editCat.name.trim(), sortOrder: c.sortOrder ?? 0, isActive: true }, { token }), 'Category renamed.')) setEditCat(null);
  };
  // Two clicks to delete; its products stay and move to "No category".
  const deleteCategory = async (c) => {
    if (delCat !== c.id) return setDelCat(c.id);
    setDelCat(null);
    if (await run(() => apiDelete(`/bar/categories/${c.id}`, { token }), 'Category deleted.') && filterCat === String(c.id)) setFilterCat('ALL');
  };

  const addCategory = async () => {
    if (await run(() => apiPost('/bar/categories', { name: cat }, { token }), 'Category added.')) {
      setCat('');
      setAddingCat(false);
    }
  };

  return (
    <>
      <section className="bar-card">
        <div className="bar-card__head">
          <div>
            <h3 className="bar-card__title">Bar menu <span className="bar-oc__count">{menu.products.length}</span></h3>
            <div className="bar-card__sub">Products, their selling sizes and prices.</div>
          </div>
          <div className="bar-flex">
            <button type="button" className="bar-btn" onClick={() => setAddingCat(true)}>Categories</button>
            <button type="button" className="bar-btn bar-btn--primary" onClick={() => setAdding(true)}>+ Add product</button>
          </div>
        </div>

        <div className="bar-mn-bar">
          <input className="bar-input bar-st-search" type="search" placeholder="Search the menu" aria-label="Search the menu" value={query} onChange={(e) => setQuery(e.target.value)} />
          <Seg value={layout} onChange={setLayout} options={[['list', 'List'], ['cards', 'Cards']]} />
        </div>
        <div className="bar-mn-cats" role="group" aria-label="Categories">
          <button type="button" aria-pressed={filterCat === 'ALL'} onClick={() => setFilterCat('ALL')}>All <i>{menu.products.length}</i></button>
          {menu.categories.map((c) => (
            <button key={c.id} type="button" aria-pressed={filterCat === String(c.id)} onClick={() => setFilterCat(String(c.id))}>{c.name} <i>{countIn(String(c.id))}</i></button>
          ))}
          {countIn('NONE') > 0 && <button type="button" aria-pressed={filterCat === 'NONE'} onClick={() => setFilterCat('NONE')}>Other <i>{countIn('NONE')}</i></button>}
        </div>

      </section>

      {visible.length === 0 && <div className="bar-card"><div className="bar-empty">No products yet.</div></div>}
      {layout === 'cards' && (
        <div className="bar-st-cards">
          {visible.map((p) => {
            const ns = sizeFor[p.id] ?? { label: '', ml: '', price: '' };
            const st = p.stockMl <= 0 ? 'out' : p.isLow ? 'low' : 'ok';
            return (
              <article className={`bar-st-card${p.isActive ? '' : ' is-hidden'}`} key={p.id}>
                <header className="bar-st-card__head">
                  <div>
                    <div className="bar-st-card__name">{p.name}</div>
                    <div className="bar-muted">{p.brand ? `${p.brand} · ` : ''}{catName(p.categoryId)} · {p.bottleMl} ml{p.isActive ? '' : ' · hidden'}</div>
                    <div className="bar-mn-stock">
                      <span className={`bar-chip bar-chip--${st}`}>{st === 'out' ? 'Out of stock' : st === 'low' ? 'Low stock' : 'In stock'}</span>
                      <span className="bar-muted">{stockText(p)}</span>
                    </div>
                  </div>
                  <button type="button" className="bar-btn bar-btn--sm" onClick={() => run(() => apiPatch(`/bar/products/${p.id}`, asProductBody(p, { isActive: !p.isActive }), { token }))}>
                    {p.isActive ? 'Hide' : 'Show'}
                  </button>
                </header>

                <ul className="bar-st-sizes">
                  {p.sizes.map((s) => (
                    <li className={`bar-st-size${s.isActive ? '' : ' is-off'}`} key={s.id}>
                      <div className="bar-st-size__name">
                        <span className="bar-strong">{s.label}</span>
                        <span className="bar-muted">{s.ml} ml</span>
                        {!s.isAvailable && s.isActive && <span className="bar-chip bar-chip--out">Out today</span>}
                        {!s.isActive && <span className="bar-chip">Removed</span>}
                      </div>
                      <div className="bar-st-size__acts">
                        {edit?.id === s.id ? (
                          <>
                            <input className="bar-input bar-input--sm" type="number" min="0" aria-label={`New price for ${s.label}`} value={edit.value} onChange={(e) => setEdit({ id: s.id, value: e.target.value })} autoFocus />
                            <button type="button" className="bar-btn bar-btn--sm bar-btn--brand" disabled={edit.value === ''} onClick={() => savePrice(s)}>Save</button>
                            <button type="button" className="bar-btn bar-btn--sm" onClick={() => setEdit(null)}>Cancel</button>
                          </>
                        ) : (
                          <>
                            <b className="bar-st-price">{formatPrice(s.price)}</b>
                            <button type="button" className="bar-btn bar-btn--sm" onClick={() => setEdit({ id: s.id, value: String(s.price) })}>Edit price</button>
                            <button type="button" className="bar-btn bar-btn--sm" onClick={() => run(() => apiPatch(`/bar/sizes/${s.id}`, { isAvailable: !s.isAvailable }, { token }))}>{s.isAvailable ? 'Mark out' : 'Mark available'}</button>
                            <button type="button" className="bar-btn bar-btn--sm bar-btn--danger" onClick={() => run(() => apiPatch(`/bar/sizes/${s.id}`, { isActive: !s.isActive }, { token }))}>{s.isActive ? 'Remove' : 'Restore'}</button>
                          </>
                        )}
                      </div>
                    </li>
                  ))}
                </ul>

                {sizeOpen !== p.id ? (
                  <div className="bar-st-addrow"><button type="button" className="bar-link" onClick={() => setSizeOpen(p.id)}>+ Add size</button></div>
                ) : (
                <div className="bar-st-addsize">
                  <input className="bar-input" aria-label="New size name" placeholder="New size (e.g. 90 ml)" value={ns.label} onChange={(e) => setSizeFor({ ...sizeFor, [p.id]: { ...ns, label: e.target.value } })} />
                  <input className="bar-input" type="number" min="1" aria-label="ml" placeholder="ml" value={ns.ml} onChange={(e) => setSizeFor({ ...sizeFor, [p.id]: { ...ns, ml: e.target.value } })} />
                  <input className="bar-input" type="number" min="0" aria-label="Price" placeholder="₹" value={ns.price} onChange={(e) => setSizeFor({ ...sizeFor, [p.id]: { ...ns, price: e.target.value } })} />
                  <button type="button" className="bar-btn" disabled={!ns.label || !ns.ml} onClick={async () => (await run(() => apiPost(`/bar/products/${p.id}/sizes`, { label: ns.label, ml: Number(ns.ml), price: Number(ns.price || 0) }, { token }), 'Size added.')) && (setSizeFor({ ...sizeFor, [p.id]: undefined }), setSizeOpen(null))}>Add size</button>
                  <button type="button" className="bar-btn" onClick={() => { setSizeOpen(null); setSizeFor({ ...sizeFor, [p.id]: undefined }); }}>Cancel</button>
                </div>
                )}
              </article>
            );
          })}
        </div>
      )}

      {layout === 'list' && (
      <div className="bar-mn-list">
        {visible.map((p) => {
          const st = p.stockMl <= 0 ? 'out' : p.isLow ? 'low' : 'ok';
          return (
            <article className={`bar-mn-item${p.isActive ? '' : ' is-hidden'}`} key={p.id}>
              <div className="bar-mn-row">
                <div className="bar-mn-row__name">
                  <span className="bar-strong">{p.name}</span>
                  <span className="bar-muted">{p.brand ? `${p.brand} · ` : ''}{catName(p.categoryId)} · {p.bottleMl} ml{p.isActive ? '' : ' · hidden'}</span>
                </div>
                <div className="bar-mn-chips">
                  {p.sizes.filter((s) => s.isActive).map((s) => (
                    <span key={s.id} className={`bar-mn-sz${s.isAvailable ? '' : ' is-out'}`} title={s.isAvailable ? `${s.label} · ${s.ml} ml` : 'Out today'}>{s.label} <b>{formatPrice(s.price)}</b></span>
                  ))}
                  {p.sizes.filter((s) => s.isActive).length === 0 && <span className="bar-muted">No sizes</span>}
                </div>
                <span className={`bar-chip bar-chip--${st}`} title={stockText(p)}>{st === 'out' ? 'Out' : st === 'low' ? 'Low' : 'In stock'}</span>
                <button type="button" className="bar-btn bar-btn--sm" onClick={() => setEditingId(p.id)}>Edit</button>
              </div>

            </article>
          );
        })}
      </div>
      )}

      {editingId != null && menu.products.find((x) => x.id === editingId) && (
        <EditProductModal
          key={editingId}
          p={menu.products.find((x) => x.id === editingId)}
          menu={menu}
          token={token}
          run={run}
          onClose={() => setEditingId(null)}
        />
      )}

      {addingCat && (
        <Modal
          title="Categories"
          sub="Group drinks on the order screen. Deleting a category keeps its products, they move to “No category”."
          onClose={() => { setAddingCat(false); setCat(''); setEditCat(null); setDelCat(null); }}
          footer={<button type="button" className="btn-secondary" onClick={() => { setAddingCat(false); setCat(''); setEditCat(null); setDelCat(null); }}>Done</button>}
        >
          <div className="bar-flex bar-mn-catadd">
            <input id="barCategoryName" autoFocus aria-label="New category name" placeholder="New category (e.g. Whisky)" value={cat} onChange={(e) => setCat(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter' && cat.trim()) addCategory(); }} />
            <button type="button" className="btn-accent" disabled={!cat.trim()} onClick={addCategory}>Add</button>
          </div>
          <ul className="bar-mn-catlist">
            {menu.categories.length === 0 && <li className="bar-muted">No categories yet.</li>}
            {menu.categories.map((c) => (
              <li key={c.id}>
                {editCat?.id === c.id ? (
                  <>
                    <input autoFocus aria-label={`Rename ${c.name}`} value={editCat.name} onChange={(e) => setEditCat({ id: c.id, name: e.target.value })} onKeyDown={(e) => { if (e.key === 'Enter' && editCat.name.trim()) saveCategoryName(c); }} />
                    <button type="button" className="bar-btn bar-btn--sm bar-btn--brand" disabled={!editCat.name.trim()} onClick={() => saveCategoryName(c)}>Save</button>
                    <button type="button" className="bar-btn bar-btn--sm" onClick={() => setEditCat(null)}>Cancel</button>
                  </>
                ) : (
                  <>
                    <span className="bar-strong">{c.name}</span>
                    <span className="bar-muted">{countIn(String(c.id))} product{countIn(String(c.id)) === 1 ? '' : 's'}</span>
                    <span className="bar-flex bar-mn-catacts">
                      <button type="button" className="bar-btn bar-btn--sm" onClick={() => { setEditCat({ id: c.id, name: c.name }); setDelCat(null); }}>Rename</button>
                      <button type="button" className={`bar-btn bar-btn--sm bar-btn--danger${delCat === c.id ? ' is-confirm' : ''}`} onClick={() => deleteCategory(c)} onBlur={() => setDelCat(null)}>
                        {delCat === c.id ? 'Confirm delete' : 'Delete'}
                      </button>
                    </span>
                  </>
                )}
              </li>
            ))}
          </ul>
        </Modal>
      )}

      {adding && (
        <Modal
          title="Add a product"
          sub="One product per bottle. Add the sizes you sell it in; each size uses a set number of ml."
          onClose={() => { setAdding(false); setProd(blankProduct); }}
          footer={
            <>
              <button type="button" className="btn-secondary" onClick={() => { setAdding(false); setProd(blankProduct); }}>Cancel</button>
              <button type="button" className="btn-accent" disabled={!prod.name.trim() || !Number(prod.bottleMl)} onClick={createProduct}>Save product</button>
            </>
          }
        >
          <div className="bar bar-mn-modal">
            <div className="bar-form-grid">
              <Field label="Name"><input placeholder="e.g. Royal Stag" value={prod.name} onChange={(e) => setProd({ ...prod, name: e.target.value })} /></Field>
              <Field label="Brand (optional)"><input value={prod.brand} onChange={(e) => setProd({ ...prod, brand: e.target.value })} /></Field>
              <Field label="Category">
                <select value={quick !== null ? '__new__' : prod.categoryId} onChange={(e) => (e.target.value === '__new__' ? setQuick('') : (setQuick(null), setProd({ ...prod, categoryId: e.target.value })))}>
                  <option value="">No category</option>
                  {menu.categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                  <option value="__new__">+ Add new category…</option>
                </select>
                {quick !== null && (
                  <span className="bar-flex bar-mn-quickcat">
                    <input autoFocus aria-label="New category name" placeholder="New category name" value={quick} onChange={(e) => setQuick(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter' && quick.trim()) { e.preventDefault(); quickAdd(); } }} />
                    <button type="button" className="bar-btn bar-btn--sm bar-btn--brand" disabled={!quick.trim()} onClick={quickAdd}>Add</button>
                    <button type="button" className="bar-btn bar-btn--sm" onClick={() => setQuick(null)}>Cancel</button>
                  </span>
                )}
              </Field>
              <Field label="Bottle size (ml)"><input type="number" min="1" value={prod.bottleMl} onChange={(e) => setProd({ ...prod, bottleMl: e.target.value })} /></Field>
              <Field label="Opening stock (bottles)"><input type="number" min="0" value={prod.openingBottles} onChange={(e) => setProd({ ...prod, openingBottles: e.target.value })} /></Field>
            </div>
            <div>
              <div className="bar-st-sub">Selling sizes</div>
              <div className="bar-stack">
                {prod.sizes.map((s, i) => (
                  <div className="bar-size-row" key={i}>
                    <Field label="Size name"><input value={s.label} onChange={(e) => setSize(i, { label: e.target.value })} /></Field>
                    <Field label="ml per serving"><input type="number" min="1" value={s.ml} onChange={(e) => setSize(i, { ml: e.target.value })} /></Field>
                    <Field label="Price (₹)"><input type="number" min="0" value={s.price} onChange={(e) => setSize(i, { price: e.target.value })} /></Field>
                    <button type="button" className="bar-btn bar-btn--danger" onClick={() => setProd((p) => ({ ...p, sizes: p.sizes.filter((_, j) => j !== i) }))} aria-label="Remove size">Remove</button>
                  </div>
                ))}
              </div>
              <div className="bar-flex" style={{ marginTop: 10 }}>
                <span className="bar-muted">Quick add:</span>
                {PRESETS.map((ml) => <button key={ml} type="button" className="bar-btn bar-btn--sm" onClick={() => addPreset(ml)}>{ml} ml</button>)}
                <button type="button" className="bar-btn bar-btn--sm" onClick={() => setProd((p) => ({ ...p, sizes: [...p.sizes, { label: 'Full bottle', ml: p.bottleMl, price: '' }] }))}>Full bottle</button>
              </div>
            </div>
          </div>
        </Modal>
      )}
    </>
  );
}

// Edit one product in a pop-up: its details, every selling size (price, out today, remove) and
// a new size. Each size change saves on its own; the details have their own Save.
function EditProductModal({ p, menu, token, run, onClose }) {
  const [d, setD] = useState({ name: p.name, brand: p.brand || '', categoryId: p.categoryId ?? '', bottleMl: String(p.bottleMl) });
  const [edit, setEdit] = useState(null); // { id, value } while a price is being edited
  const [ns, setNs] = useState({ label: '', ml: '', price: '' });
  const [showAdd, setShowAdd] = useState(false);
  const dirty = d.name !== p.name || d.brand !== (p.brand || '') || String(d.categoryId) !== String(p.categoryId ?? '') || d.bottleMl !== String(p.bottleMl);

  const saveDetails = () =>
    run(
      () => apiPatch(`/bar/products/${p.id}`, asProductBody(p, { name: d.name.trim(), brand: d.brand.trim() || null, categoryId: d.categoryId ? Number(d.categoryId) : null, bottleMl: Number(d.bottleMl) }), { token }),
      'Product updated.'
    );
  const savePrice = async (s) => {
    if (await run(() => apiPatch(`/bar/sizes/${s.id}`, { price: Number(edit.value) }, { token }), 'Price updated.')) setEdit(null);
  };

  return (
    <Modal
      title={p.name}
      sub={`${p.isActive ? 'Shown on the order screen' : 'Hidden from the order screen'} · stock ${stockText(p)}`}
      onClose={onClose}
      footer={
        <>
          <button type="button" className="btn-secondary" onClick={() => run(() => apiPatch(`/bar/products/${p.id}`, asProductBody(p, { isActive: !p.isActive }), { token }))}>
            {p.isActive ? 'Hide product' : 'Show product'}
          </button>
          <button type="button" className="btn-accent" onClick={onClose}>Done</button>
        </>
      }
    >
      <div className="bar bar-mn-modal">
        <div className="bar-form-grid">
          <Field label="Name"><input value={d.name} onChange={(e) => setD({ ...d, name: e.target.value })} /></Field>
          <Field label="Brand"><input value={d.brand} onChange={(e) => setD({ ...d, brand: e.target.value })} /></Field>
          <Field label="Category">
            <select value={d.categoryId} onChange={(e) => setD({ ...d, categoryId: e.target.value })}>
              <option value="">No category</option>
              {menu.categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </Field>
          <Field label="Bottle size (ml)"><input type="number" min="1" value={d.bottleMl} onChange={(e) => setD({ ...d, bottleMl: e.target.value })} /></Field>
        </div>
        {dirty && (
          <div><button type="button" className="bar-btn bar-btn--brand" disabled={!d.name.trim() || !Number(d.bottleMl)} onClick={saveDetails}>Save details</button></div>
        )}

        <div>
          <div className="bar-st-sub">Selling sizes</div>
          <ul className="bar-st-sizes bar-mn-sizes">
            {p.sizes.map((s) => (
              <li className={`bar-st-size${s.isActive ? '' : ' is-off'}`} key={s.id}>
                <div className="bar-st-size__name">
                  <span className="bar-strong">{s.label}</span>
                  <span className="bar-muted">{s.ml} ml</span>
                  {!s.isAvailable && s.isActive && <span className="bar-chip bar-chip--out">Out today</span>}
                  {!s.isActive && <span className="bar-chip">Removed</span>}
                </div>
                <div className="bar-st-size__acts">
                  {edit?.id === s.id ? (
                    <>
                      <input className="bar-input bar-input--sm" type="number" min="0" aria-label={`New price for ${s.label}`} value={edit.value} onChange={(e) => setEdit({ id: s.id, value: e.target.value })} autoFocus />
                      <button type="button" className="bar-btn bar-btn--sm bar-btn--brand" disabled={edit.value === ''} onClick={() => savePrice(s)}>Save</button>
                      <button type="button" className="bar-btn bar-btn--sm" onClick={() => setEdit(null)}>Cancel</button>
                    </>
                  ) : (
                    <>
                      <b className="bar-st-price">{formatPrice(s.price)}</b>
                      <button type="button" className="bar-btn bar-btn--sm" onClick={() => setEdit({ id: s.id, value: String(s.price) })}>Edit price</button>
                      <button type="button" className="bar-btn bar-btn--sm" onClick={() => run(() => apiPatch(`/bar/sizes/${s.id}`, { isAvailable: !s.isAvailable }, { token }))}>{s.isAvailable ? 'Mark out' : 'Mark available'}</button>
                      <button type="button" className="bar-btn bar-btn--sm bar-btn--danger" onClick={() => run(() => apiPatch(`/bar/sizes/${s.id}`, { isActive: !s.isActive }, { token }))}>{s.isActive ? 'Remove' : 'Restore'}</button>
                    </>
                  )}
                </div>
              </li>
            ))}
          </ul>
        </div>

        {!showAdd ? (
          <div><button type="button" className="bar-btn" onClick={() => setShowAdd(true)}>+ Add size</button></div>
        ) : (
        <div className="bar-st-addsize bar-mn-addsize">
          <input className="bar-input" autoFocus aria-label="New size name" placeholder="New size (e.g. 90 ml)" value={ns.label} onChange={(e) => setNs({ ...ns, label: e.target.value })} />
          <input className="bar-input" type="number" min="1" aria-label="ml" placeholder="ml" value={ns.ml} onChange={(e) => setNs({ ...ns, ml: e.target.value })} />
          <input className="bar-input" type="number" min="0" aria-label="Price" placeholder="₹" value={ns.price} onChange={(e) => setNs({ ...ns, price: e.target.value })} />
          <button type="button" className="bar-btn" disabled={!ns.label || !ns.ml} onClick={async () => (await run(() => apiPost(`/bar/products/${p.id}/sizes`, { label: ns.label, ml: Number(ns.ml), price: Number(ns.price || 0) }, { token }), 'Size added.')) && (setNs({ label: '', ml: '', price: '' }), setShowAdd(false))}>Add size</button>
          <button type="button" className="bar-btn" onClick={() => { setShowAdd(false); setNs({ label: '', ml: '', price: '' }); }}>Cancel</button>
        </div>
        )}
      </div>
    </Modal>
  );
}

function SettingsView({ menu, token, run }) {
  const [tax, setTax] = useState(String(menu.settings.taxPercent));
  const [low, setLow] = useState(menu.settings.defaultLowStockMl == null ? '' : String(menu.settings.defaultLowStockMl));
  return (
    <section className="bar-card bar-st-settings">
      <h3 className="bar-card__title">Bar settings</h3>
      <div className="bar-st-setting">
        <div>
          <div className="bar-strong">Tax included in prices</div>
          <div className="bar-muted">Alcohol is outside GST. If your prices include state excise/VAT, enter that rate; it is shown on the bill and is not added on top.</div>
        </div>
        <Field label="Rate (%)"><input type="number" min="0" max="100" step="0.01" value={tax} onChange={(e) => setTax(e.target.value)} /></Field>
      </div>
      <div className="bar-st-setting">
        <div>
          <div className="bar-strong">Default low-stock alert</div>
          <div className="bar-muted">Used for products that have no alert limit of their own.</div>
        </div>
        <Field label="Limit (ml)"><input type="number" min="0" placeholder="No default" value={low} onChange={(e) => setLow(e.target.value)} /></Field>
      </div>
      <div><button type="button" className="bar-btn bar-btn--primary" onClick={() => run(() => apiPatch('/bar/settings', { taxPercent: Number(tax || 0), defaultLowStockMl: low === '' ? null : Number(low) }, { token }), 'Settings saved.')}>Save settings</button></div>
    </section>
  );
}
