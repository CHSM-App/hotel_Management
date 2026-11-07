import { useLayoutEffect, useRef, useState } from 'react';
import { columnsFor, paginate } from './menuCardModel';
import { CatHead, Item, MenuCardPage } from './MenuCardPages';
import { templateById } from './menuCardTemplates';

// ── Pagination hook ────────────────────────────────────────────────────────
// Renders two off-screen probe pages (first and continuation) built from the
// real components, reads the body height each leaves and the height of every
// heading and dish, then packs. Because measuring and showing use the same
// markup and CSS, the preview pages cannot disagree with the PDF — they are
// the same elements.
export function useMenuCardPages({ cats, cfg, hotel, imgs, heroImgs }) {
  const tpl = templateById(cfg.templateId);
  const pal = tpl.palettes[cfg.paletteIdx] || tpl.palettes[0];
  const [pages, setPages] = useState(null);
  const firstBody = useRef(null);
  const restBody = useRef(null);
  const unitsRef = useRef(null);

  const cols = columnsFor(cfg.orient);
  const key = JSON.stringify([
    cfg.templateId, cfg.paletteIdx, cfg.title, cfg.tagline, cfg.showLogo, cfg.showContact, cfg.showDesc,
    cfg.showImages, cfg.showVeg, cfg.paper, cfg.orient, hotel.name, hotel.logo ? 1 : 0, hotel.address,
    hotel.phone, cats.map((c) => [c.id, c.name, c.items.map((i) => [i.id, i.name, i.description, i.price, i.portions.length])]),
    Object.keys(imgs || {}).length,
  ]);

  useLayoutEffect(() => {
    let dead = false;
    const run = async () => {
      try {
        const families = [...new Set(getComputedStyle(unitsRef.current.closest('.mc-page')).fontFamily.split(','))];
        await Promise.all(families.map((f) => document.fonts.load(`16px ${f.trim()}`).catch(() => null)));
        await document.fonts.ready;
      } catch {
        /* measure with whatever is loaded */
      }
      if (dead || !firstBody.current || !restBody.current || !unitsRef.current) return;
      const head = {};
      const item = {};
      const outer = (el) => {
        const cs = getComputedStyle(el);
        return el.offsetHeight + parseFloat(cs.marginTop) + parseFloat(cs.marginBottom);
      };
      unitsRef.current.querySelectorAll('[data-head]').forEach((el) => {
        head[el.dataset.head] = outer(el);
      });
      unitsRef.current.querySelectorAll('[data-item]').forEach((el) => {
        item[el.dataset.item] = outer(el);
      });
      // Small safety margin: sub-pixel rounding must never push a line off.
      const avail = [firstBody.current.clientHeight - 2, restBody.current.clientHeight - 2];
      if (!dead) setPages(paginate(cats, { head, item, avail }, cols));
    };
    run();
    return () => {
      dead = true;
    };
    // `key` summarises every input that can change a height.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  const units = (
    <div ref={unitsRef} className="mc-units">
      {cats.map((c) => (
        <div key={c.id}>
          <div data-head={c.id}>
            <CatHead cat={c} cont />
          </div>
          {c.items.map((it) => (
            <div key={it.id} data-item={it.id}>
              <Item item={it} cfg={cfg} imgs={imgs} />
            </div>
          ))}
        </div>
      ))}
    </div>
  );

  // The measuring head is "continued" — its text is longer, so the height it
  // reports can only be equal or greater than the plain heading's. Safe side.
  const probes = (
    <div className="mc-probe" aria-hidden="true">
      <MenuCardPage
        tpl={tpl} pal={pal} cfg={cfg} hotel={hotel} imgs={imgs} heroImgs={heroImgs}
        index={0} total={2} units={units} bodyRef={firstBody}
      />
      <MenuCardPage
        tpl={tpl} pal={pal} cfg={cfg} hotel={hotel} imgs={imgs} heroImgs={heroImgs}
        index={1} total={2} bodyRef={restBody}
      />
    </div>
  );

  return { tpl, pal, pages, probes };
}
