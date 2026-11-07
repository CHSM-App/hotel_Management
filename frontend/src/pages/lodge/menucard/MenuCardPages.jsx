import { useEffect, useRef, useState } from 'react';
import { columnsFor, pageSize } from './menuCardModel';
import { formatPrice } from '../priceFormat';
import './menuCard.css';

function VegMark({ type }) {
  const veg = type !== 'NON_VEG';
  return (
    <span
      className={`mc-veg ${veg ? 'mc-veg--veg' : 'mc-veg--non'}`}
      role="img"
      aria-label={veg ? 'Vegetarian' : 'Non-vegetarian'}
    />
  );
}

function Price({ item }) {
  const priced = (v) => Number.isFinite(Number(v)) && Number(v) > 0;
  if (item.portions.length > 0) {
    return (
      <span className="mc-price mc-price--multi">
        {item.portions.map((p) => (
          <span key={p.id ?? p.label} className="mc-price__row">
            <i>{p.label}</i>
            {priced(p.price) ? formatPrice(p.price) : '—'}
          </span>
        ))}
      </span>
    );
  }
  return <span className="mc-price">{priced(item.price) ? formatPrice(item.price) : '—'}</span>;
}

export function Item({ item, cfg, imgs }) {
  const src = cfg.showImages && item.image ? imgs?.[item.image] : null;
  return (
    <div className={`mc-item${src ? ' mc-item--img' : ''}`}>
      {src && <img className="mc-item__img" src={src} alt="" />}
      <div className="mc-item__main">
        <div className="mc-item__row">
          {cfg.showVeg && <VegMark type={item.foodType} />}
          <span className="mc-item__name">{item.name}</span>
          <span className="mc-item__leader" />
          <Price item={item} />
        </div>
        {cfg.showDesc && item.description && <p className="mc-item__desc">{item.description}</p>}
      </div>
    </div>
  );
}

export function CatHead({ cat, cont }) {
  return (
    <div className="mc-cat">
      <span className="mc-cat__orn" />
      <h3 className="mc-cat__name">
        {cat.name}
        {cont && <em> · continued</em>}
      </h3>
      <span className="mc-cat__rule" />
    </div>
  );
}

function contactLine(hotel) {
  const where = [hotel.address, hotel.city, hotel.state].filter(Boolean).join(', ');
  return { where, phone: hotel.phone || '' };
}

function Brand({ hotel, cfg }) {
  const logo = cfg.showLogo ? hotel.logo : null;
  return (
    <div className="mc-brand">
      {logo && <img className="mc-brand__logo" src={logo} alt="" />}
      <div className="mc-brand__name">{hotel.name}</div>
      {cfg.tagline && <div className="mc-brand__tag">{cfg.tagline}</div>}
    </div>
  );
}

function Header({ hotel, cfg, heroImgs }) {
  return (
    <header className="mc-head">
      <div className="mc-photos">
        {heroImgs.length > 0 ? (
          heroImgs.map((s, i) => <img key={i} src={s} alt="" />)
        ) : (
          <div className="mc-photos__fallback" />
        )}
        <div className="mc-photos__shade" />
      </div>
      <div className="mc-head__bar">
        <Brand hotel={hotel} cfg={cfg} />
        <h1 className="mc-title">{cfg.title || 'MENU'}</h1>
      </div>
    </header>
  );
}

function MiniHeader({ hotel, cfg }) {
  return (
    <div className="mc-mini">
      <span>{hotel.name}</span>
      <span className="mc-mini__rule" />
      <span>{cfg.title || 'MENU'}</span>
    </div>
  );
}

function Footer({ hotel, cfg, index, total }) {
  const { where, phone } = contactLine(hotel);
  const show = cfg.showContact && (where || phone);
  // Always rendered so every page keeps the same body height whether or not
  // it has anything to say down here.
  if (!show && total <= 1) return <footer className="mc-foot mc-foot--empty">&nbsp;</footer>;
  return (
    <footer className="mc-foot">
      <span className="mc-foot__line">
        {cfg.showContact && where}
        {cfg.showContact && where && phone && <b> · </b>}
        {cfg.showContact && phone && <span>Tel {phone}</span>}
      </span>
      {total > 1 && (
        <span className="mc-foot__page">
          {index + 1} / {total}
        </span>
      )}
    </footer>
  );
}

// ── One page ───────────────────────────────────────────────────────────────
// `page.cols` is columns of segments ({cat, cont, items}); `units` is the
// measuring variant: the same chrome with every heading/dish dropped into the
// first column so the browser can report their real heights.
export function MenuCardPage({
  pageRef,
  tpl,
  pal,
  cfg,
  hotel,
  imgs,
  heroImgs,
  page,
  index,
  total,
  units,
  bodyRef,
  firstColRef,
  noHeader,
}) {
  const { w, h } = pageSize(cfg.paper, cfg.orient);
  const base = (16 * Math.min(w, h)) / 794;
  const first = index === 0;
  const cols = page?.cols ?? Array.from({ length: columnsFor(cfg.orient) }, () => []);
  return (
    <div
      ref={pageRef}
      className={`mc-page mc-t-${tpl.id}${cfg.orient === 'landscape' ? ' mc-land' : ''}${first ? ' mc-first' : ''}`}
      style={{ width: w, height: h, fontSize: base, ...pal.vars }}
    >
      <div className="mc-inner">
        {first && !noHeader ? (
          <Header hotel={hotel} cfg={cfg} heroImgs={heroImgs} />
        ) : (
          <MiniHeader hotel={hotel} cfg={cfg} />
        )}
        <div className="mc-body" ref={bodyRef}>
          {cols.map((segs, ci) => (
            <div className="mc-col" key={ci} ref={ci === 0 ? firstColRef : undefined}>
              {ci === 0 && units}
              {segs.map((seg, si) => (
                <section className="mc-seg" key={`${seg.cat.id}-${si}`}>
                  <CatHead cat={seg.cat} cont={seg.cont} />
                  {seg.items.map((it) => (
                    <Item key={it.id} item={it} cfg={cfg} imgs={imgs} />
                  ))}
                </section>
              ))}
            </div>
          ))}
        </div>
        <Footer hotel={hotel} cfg={cfg} index={index} total={total} />
      </div>
    </div>
  );
};

// ── Scaled display ─────────────────────────────────────────────────────────
// Lays a fixed-size page out at its true pixel size and shrinks it to fit its
// container. The capture reads the inner, unscaled node.
export function Scaled({ w, h, maxScale = 1, children, className = '' }) {
  const wrap = useRef(null);
  const [scale, setScale] = useState(0.5);
  useEffect(() => {
    const el = wrap.current;
    if (!el) return undefined;
    const fit = () => setScale(Math.min(maxScale, el.clientWidth / w));
    fit();
    const ro = new ResizeObserver(fit);
    ro.observe(el);
    return () => ro.disconnect();
  }, [w, maxScale]);
  return (
    <div ref={wrap} className={className} style={{ width: '100%', height: h * scale }}>
      <div style={{ width: w, height: h, transform: `scale(${scale})`, transformOrigin: 'top left' }}>
        {children}
      </div>
    </div>
  );
}
