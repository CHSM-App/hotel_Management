import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import PageLoader from '../../../components/PageLoader';
import { apiGet, ApiError, API_BASE } from '../../../lib/api';
import { getSession } from '../../../lib/auth';
import { readCache, writeCache } from '../../../lib/dataCache';
import {
  DEFAULT_CONFIG,
  applyConfig,
  buildCategories,
  orderBy,
  pageSize,
} from './menuCardModel';
import { MenuCardPage, Scaled } from './MenuCardPages';
import { useMenuCardPages } from './useMenuCard';
import { buildMenuCardPdf, imageToDataUrl, saveBlob } from './menuCardPdf';
import './MenuCardDesigner.css';

const STORE_KEY = (lodge) => `atithya.menucard.v1.${lodge?.id ?? lodge?.slug ?? 'lodge'}`;

function loadSaved(lodge) {
  try {
    const raw = localStorage.getItem(STORE_KEY(lodge));
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

const Icon = {
  back: <path d="M15 5l-7 7 7 7" />,
  down: <path d="M12 4v12m0 0l-5-5m5 5l5-5M5 20h14" />,
  up: <path d="M7 14l5-5 5 5" />,
  chev: <path d="M7 10l5 5 5-5" />,
  eye: <><path d="M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12z" /><circle cx="12" cy="12" r="3" /></>,
  eyeOff: <><path d="M3 3l18 18M10.6 5.2A9.8 9.8 0 0 1 12 5c6 0 10 7 10 7a17 17 0 0 1-3.2 3.9M6.5 6.6A17 17 0 0 0 2 12s4 7 10 7a9.6 9.6 0 0 0 4.2-1" /></>,
  reset: <path d="M4 12a8 8 0 1 0 3-6.2M4 4v5h5" />,
};

function Ic({ name, size = 18 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {Icon[name]}
    </svg>
  );
}

function Toggle({ label, checked, onChange, hint }) {
  return (
    <label className="mcd-toggle">
      <span className="mcd-toggle__text">
        {label}
        {hint && <small>{hint}</small>}
      </span>
      <input type="checkbox" role="switch" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      <span className="mcd-toggle__track" aria-hidden="true" />
    </label>
  );
}

function Segmented({ label, value, options, onChange }) {
  return (
    <div className="mcd-field">
      <span className="mcd-field__label">{label}</span>
      <div className="mcd-seg" role="radiogroup" aria-label={label}>
        {options.map((o) => (
          <button
            key={o.value}
            type="button"
            role="radio"
            aria-checked={value === o.value}
            className={value === o.value ? 'is-on' : ''}
            onClick={() => onChange(o.value)}
          >
            {o.label}
          </button>
        ))}
      </div>
    </div>
  );
}

// ── Customiser ─────────────────────────────────────────────────────────────
function Customizer({ cfg, setCfg, allCats, hotel, imgs, heroImgs, onGoToMenu }) {
  const cats = useMemo(() => applyConfig(allCats, cfg), [allCats, cfg]);
  const { tpl, pal, pages, probes } = useMenuCardPages({ cats, cfg, hotel, imgs, heroImgs });
  const { w, h } = pageSize(cfg.paper, cfg.orient);
  const nodes = useRef([]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [open, setOpen] = useState(null);

  const set = (patch) => setCfg((c) => ({ ...c, ...patch }));

  const download = useCallback(async () => {
    if (!pages || busy) return;
    setBusy(true);
    setErr('');
    try {
      const els = nodes.current.slice(0, pages.length).filter(Boolean);
      const blob = await buildMenuCardPdf(els, { paper: cfg.paper, orient: cfg.orient });
      const slug = (hotel.name || 'hotel').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
      saveBlob(blob, `${slug}-menu-card-${tpl.id}.pdf`);
    } catch {
      setErr('Could not create the PDF. Check your connection (fonts are fetched once) and try again.');
    } finally {
      setBusy(false);
    }
  }, [pages, busy, cfg.paper, cfg.orient, hotel.name, tpl.id]);

  const orderedAll = useMemo(() => orderBy(allCats, cfg.catOrder, (c) => c.id), [allCats, cfg.catOrder]);

  const moveCat = (id, dir) => {
    const ids = orderedAll.map((c) => c.id);
    const i = ids.indexOf(id);
    const j = i + dir;
    if (j < 0 || j >= ids.length) return;
    [ids[i], ids[j]] = [ids[j], ids[i]];
    set({ catOrder: ids });
  };
  const moveItem = (cat, id, dir) => {
    const ids = orderBy(cat.items, cfg.itemOrder[cat.id], (x) => x.id).map((x) => x.id);
    const i = ids.indexOf(id);
    const j = i + dir;
    if (j < 0 || j >= ids.length) return;
    [ids[i], ids[j]] = [ids[j], ids[i]];
    set({ itemOrder: { ...cfg.itemOrder, [cat.id]: ids } });
  };
  const flip = (key, id) => {
    const list = cfg[key].map(String);
    set({ [key]: list.includes(String(id)) ? list.filter((x) => x !== String(id)) : [...list, String(id)] });
  };

  const printable = cats.reduce((n, c) => n + c.items.length, 0);

  return (
    <div className="mcd-cust">
      <div className="mcd-toolbar">
        <div className="mcd-toolbar__title">
          <strong>{tpl.name}</strong>
          <span>
            {pages ? `${pages.length} page${pages.length === 1 ? '' : 's'} · ${cfg.paper} ${cfg.orient}` : 'Laying out…'}
          </span>
        </div>
        <button type="button" className="mcd-btn mcd-btn--gold" onClick={download} disabled={!pages || busy || printable === 0}>
          <Ic name="down" size={16} /> {busy ? 'Preparing PDF…' : 'Download PDF'}
        </button>
      </div>
      {err && <div className="mcd-alert" role="alert">{err}</div>}

      <div className="mcd-cust__grid">
        <aside className="mcd-panel" aria-label="Menu card settings">
          <section>
            <h4>Colour</h4>
            <div className="mcd-palettes">
              {tpl.palettes.map((p, i) => (
                <button
                  key={p.name}
                  type="button"
                  className={cfg.paletteIdx === i ? 'is-on' : ''}
                  onClick={() => set({ paletteIdx: i })}
                  aria-pressed={cfg.paletteIdx === i}
                >
                  <span style={{ background: `linear-gradient(135deg, ${p.swatch[0]} 0 45%, ${p.swatch[1]} 45% 75%, ${p.swatch[2]} 75%)` }} />
                  {p.name}
                </button>
              ))}
            </div>
          </section>

          <section>
            <h4>Heading</h4>
            <label className="mcd-field">
              <span className="mcd-field__label">Card title</span>
              <input value={cfg.title} maxLength={40} onChange={(e) => set({ title: e.target.value })} placeholder="MENU" />
            </label>
            <label className="mcd-field">
              <span className="mcd-field__label">Tagline <small>(optional)</small></span>
              <input value={cfg.tagline} maxLength={70} onChange={(e) => set({ tagline: e.target.value })} placeholder="e.g. Pure veg · Since 1998" />
            </label>
          </section>

          <section>
            <h4>Show on card</h4>
            <Toggle label="Hotel logo" checked={cfg.showLogo} onChange={(v) => set({ showLogo: v })} hint={hotel.logo ? null : 'No logo uploaded — name is used'} />
            <Toggle label="Address & contact" checked={cfg.showContact} onChange={(v) => set({ showContact: v })} />
            <Toggle label="Dish descriptions" checked={cfg.showDesc} onChange={(v) => set({ showDesc: v })} />
            <Toggle label="Food images" checked={cfg.showImages} onChange={(v) => set({ showImages: v })} />
            <Toggle label="Veg / Non-veg marks" checked={cfg.showVeg} onChange={(v) => set({ showVeg: v })} />
            <Toggle label="Skip dishes marked out" checked={cfg.hideSoldOut} onChange={(v) => set({ hideSoldOut: v })} />
          </section>

          <section>
            <h4>Page</h4>
            <Segmented label="Orientation" value={cfg.orient} onChange={(v) => set({ orient: v })} options={[{ value: 'portrait', label: 'Portrait' }, { value: 'landscape', label: 'Landscape' }]} />
            <Segmented label="Paper size" value={cfg.paper} onChange={(v) => set({ paper: v })} options={[{ value: 'A4', label: 'A4' }, { value: 'A5', label: 'A5' }]} />
          </section>

          <section>
            <h4>Categories & dishes</h4>
            <p className="mcd-hint">Reorder with the arrows, hide with the eye. Open a category to arrange its dishes.</p>
            <ul className="mcd-order">
              {orderedAll.map((cat, ci) => {
                const hiddenCat = cfg.hiddenCats.map(String).includes(String(cat.id));
                const isOpen = open === cat.id;
                const items = orderBy(cat.items, cfg.itemOrder[cat.id], (x) => x.id);
                return (
                  <li key={cat.id} className={hiddenCat ? 'is-off' : ''}>
                    <div className="mcd-order__row">
                      <button type="button" className="mcd-order__name" onClick={() => setOpen(isOpen ? null : cat.id)} aria-expanded={isOpen}>
                        <Ic name="chev" size={15} />
                        {cat.name}
                        <small>{cat.items.length || 'empty'}</small>
                      </button>
                      <button type="button" aria-label={`Move ${cat.name} up`} disabled={ci === 0} onClick={() => moveCat(cat.id, -1)}><Ic name="up" size={16} /></button>
                      <button type="button" aria-label={`Move ${cat.name} down`} disabled={ci === orderedAll.length - 1} onClick={() => moveCat(cat.id, 1)} className="mcd-flipv"><Ic name="up" size={16} /></button>
                      <button type="button" aria-label={hiddenCat ? `Show ${cat.name}` : `Hide ${cat.name}`} onClick={() => flip('hiddenCats', cat.id)}><Ic name={hiddenCat ? 'eyeOff' : 'eye'} size={16} /></button>
                    </div>
                    {isOpen && (
                      <ul className="mcd-order__items">
                        {items.length === 0 && <li className="mcd-hint">No dishes in this category.</li>}
                        {items.map((it, ii) => {
                          const off = cfg.hiddenItems.map(String).includes(String(it.id));
                          return (
                            <li key={it.id} className={off ? 'is-off' : ''}>
                              <span className="mcd-order__itemname">{it.name}{!it.isAvailable && <small> · out</small>}</span>
                              <button type="button" aria-label={`Move ${it.name} up`} disabled={ii === 0} onClick={() => moveItem(cat, it.id, -1)}><Ic name="up" size={15} /></button>
                              <button type="button" aria-label={`Move ${it.name} down`} disabled={ii === items.length - 1} onClick={() => moveItem(cat, it.id, 1)} className="mcd-flipv"><Ic name="up" size={15} /></button>
                              <button type="button" aria-label={off ? `Show ${it.name}` : `Hide ${it.name}`} onClick={() => flip('hiddenItems', it.id)}><Ic name={off ? 'eyeOff' : 'eye'} size={15} /></button>
                            </li>
                          );
                        })}
                      </ul>
                    )}
                  </li>
                );
              })}
            </ul>
            <button type="button" className="mcd-link" onClick={() => setCfg({ ...DEFAULT_CONFIG, templateId: cfg.templateId })}>
              <Ic name="reset" size={14} /> Reset all settings
            </button>
          </section>
        </aside>

        <div className="mcd-stage">
          {printable === 0 ? (
            <div className="mcd-empty">
              <h3>Nothing to print yet</h3>
              <p>Every dish is hidden or marked out. Turn some back on, or add dishes to the menu.</p>
              <button type="button" className="mcd-btn mcd-btn--primary" onClick={onGoToMenu}>Open Menu</button>
            </div>
          ) : !pages ? (
            <div className="mcd-laying"><PageLoader inline label="Laying out your menu card…" /></div>
          ) : (
            <div className="mcd-pages">
              {pages.map((page, i) => (
                <figure key={i} className="mcd-sheet">
                  <Scaled w={w} h={h} className="mcd-sheet__scaled">
                    <MenuCardPage
                      pageRef={(el) => { nodes.current[i] = el; }}
                      tpl={tpl} pal={pal} cfg={cfg} hotel={hotel} imgs={imgs} heroImgs={heroImgs}
                      page={page} index={i} total={pages.length}
                    />
                  </Scaled>
                  <figcaption>Page {i + 1} of {pages.length}</figcaption>
                </figure>
              ))}
            </div>
          )}
        </div>
      </div>
      {probes}
    </div>
  );
}

// ── Screen ─────────────────────────────────────────────────────────────────
export default function MenuCardDesigner({ lodge, onGoToMenu }) {
  const session = getSession();
  const [sections, setSections] = useState(() => readCache('/menu'));
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(!readCache('/menu'));
  const [cfg, setCfg] = useState(() => ({ ...DEFAULT_CONFIG, ...(loadSaved(lodge) || {}) }));
  const [imgs, setImgs] = useState({});
  const [logoState, setLogoState] = useState({ url: null, data: null });

  const load = useCallback(() => {
    apiGet('/menu', { token: session?.token })
      .then((data) => {
        setSections(writeCache('/menu', data.sections));
        setError('');
      })
      .catch((e) => setError(e instanceof ApiError ? e.message : 'Could not load the menu.'))
      .finally(() => setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() => {
    load();
  }, [load]);

  const logo = logoState.url === lodge?.logoUrl ? logoState.data : null;

  const allCats = useMemo(() => buildCategories(sections), [sections]);

  // Logo and dish photos become data: URIs once, so the capture carries them
  // rather than reaching across origins mid-render.
  useEffect(() => {
    let dead = false;
    const url = lodge?.logoUrl;
    if (!url) return undefined;
    imageToDataUrl(`${API_BASE}${url}`).then((d) => !dead && setLogoState({ url, data: d }));
    return () => { dead = true; };
  }, [lodge?.logoUrl]);

  useEffect(() => {
    let dead = false;
    const files = [...new Set(allCats.flatMap((c) => c.items.map((i) => i.image)).filter(Boolean))];
    (async () => {
      const next = {};
      for (let i = 0; i < files.length; i += 6) {
        const batch = files.slice(i, i + 6);
        const got = await Promise.all(batch.map((f) => imageToDataUrl(`${API_BASE}/menu-images/${f}`)));
        batch.forEach((f, k) => { if (got[k]) next[f] = got[k]; });
      }
      if (!dead) setImgs(next);
    })();
    return () => { dead = true; };
  }, [allCats]);

  useEffect(() => {
    try {
      localStorage.setItem(STORE_KEY(lodge), JSON.stringify(cfg));
    } catch {
      /* private mode: settings just aren't remembered */
    }
  }, [cfg, lodge]);

  const hotel = useMemo(
    () => ({
      name: lodge?.name || 'Your Hotel',
      phone: lodge?.phone || '',
      address: lodge?.address || '',
      city: lodge?.city || '',
      state: lodge?.state || '',
      logo,
    }),
    [lodge, logo]
  );

  const heroImgs = useMemo(
    () => allCats.flatMap((c) => c.items).map((i) => imgs[i.image]).filter(Boolean).slice(0, 3),
    [allCats, imgs]
  );

  const hasItems = allCats.some((c) => c.items.length > 0);

  if (loading && !sections) return <PageLoader label="Loading your menu…" />;

  if (error && !sections) {
    return (
      <div className="mcd-empty" role="alert">
        <h3>Couldn’t load the menu</h3>
        <p>{error}</p>
        <button type="button" className="mcd-btn mcd-btn--primary" onClick={() => { setLoading(true); load(); }}>Try again</button>
      </div>
    );
  }

  if (!hasItems) {
    return (
      <div className="mcd-empty">
        <h3>Your menu has no dishes yet</h3>
        <p>Add dishes to your menu, then come back to design and download your menu card.</p>
        {onGoToMenu && (
          <button type="button" className="mcd-btn mcd-btn--primary" onClick={onGoToMenu}>Open Menu</button>
        )}
      </div>
    );
  }

  return (
    <div className="mcd">
      <Customizer
        cfg={cfg} setCfg={setCfg} allCats={allCats} hotel={hotel} imgs={imgs} heroImgs={heroImgs}
        onGoToMenu={onGoToMenu}
      />
    </div>
  );
}
