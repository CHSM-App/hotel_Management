// Data + layout model for the Menu Card Designer.
//
// Everything here is pure: it turns the sections /menu already returns into
// the ordered, de-duplicated categories a card prints, and packs them into
// pages given the heights the browser measured. No API of its own — the card
// is built from the menu the kitchen already maintains.

// A4 / A5 at 96 CSS px to the inch. Pages are laid out at exactly these sizes
// and captured as-is, so the preview and the PDF are the same DOM.
export const PAPER = {
  A4: { w: 794, h: 1123, pdf: [595.28, 841.89] },
  A5: { w: 559, h: 794, pdf: [419.53, 595.28] },
};

export function pageSize(paper, orient) {
  const p = PAPER[paper] || PAPER.A4;
  return orient === 'landscape' ? { w: p.h, h: p.w } : { w: p.w, h: p.h };
}

export const DEFAULT_CONFIG = {
  templateId: 'gourmet',
  paletteIdx: 0,
  title: 'MENU',
  tagline: '',
  showLogo: true,
  showContact: true,
  showDesc: true,
  showImages: true,
  showVeg: true,
  hideSoldOut: true,
  paper: 'A4',
  orient: 'portrait',
  // Reordering and exclusions are stored as ids so they survive the menu
  // being edited: an id that no longer exists is simply ignored.
  catOrder: [],
  itemOrder: {},
  hiddenCats: [],
  hiddenItems: [],
};

const norm = (s) => String(s || '').trim().toLowerCase().replace(/\s+/g, ' ');

// The menu as printed pieces: active sections only, and no dish twice — the
// same id can't repeat, and neither can the same name inside one section.
export function buildCategories(sections) {
  const seenIds = new Set();
  return (sections ?? [])
    .filter((s) => s.isActive !== false)
    .map((s) => {
      const names = new Set();
      const items = [];
      for (const it of s.items ?? []) {
        if (it.isActive === false) continue;
        const key = norm(it.name);
        if (!key || seenIds.has(it.id) || names.has(key)) continue;
        seenIds.add(it.id);
        names.add(key);
        items.push({
          id: it.id,
          name: String(it.name).trim(),
          description: (it.description || '').trim(),
          foodType: it.foodType === 'NON_VEG' ? 'NON_VEG' : 'VEG',
          price: Number(it.price),
          portions: (it.portions ?? []).filter((p) => p.isAvailable !== false),
          image: it.image ?? null,
          isAvailable: it.isAvailable !== false,
        });
      }
      return { id: s.id, name: String(s.name).trim(), items };
    });
}

export function orderBy(list, order, idOf) {
  const rank = new Map((order ?? []).map((id, i) => [String(id), i]));
  return list
    .map((x, i) => ({ x, i }))
    .sort((a, b) => {
      const ra = rank.has(String(idOf(a.x))) ? rank.get(String(idOf(a.x))) : Infinity;
      const rb = rank.has(String(idOf(b.x))) ? rank.get(String(idOf(b.x))) : Infinity;
      return ra === rb ? a.i - b.i : ra - rb;
    })
    .map((e) => e.x);
}

// Categories in the user's order, with hidden ones/dishes removed. Categories
// left with nothing to print are dropped here, so an empty section never
// leaves a lone heading on the card.
export function applyConfig(categories, cfg) {
  const hiddenC = new Set(cfg.hiddenCats.map(String));
  const hiddenI = new Set(cfg.hiddenItems.map(String));
  return orderBy(categories, cfg.catOrder, (c) => c.id)
    .filter((c) => !hiddenC.has(String(c.id)))
    .map((c) => ({
      ...c,
      items: orderBy(c.items, cfg.itemOrder[c.id], (i) => i.id).filter(
        (i) => !hiddenI.has(String(i.id)) && !(cfg.hideSoldOut && !i.isAvailable)
      ),
    }))
    .filter((c) => c.items.length > 0);
}

export function columnsFor(orient) {
  return orient === 'landscape' ? 2 : 1;
}

// Greedy pack into pages → columns → segments. `m` carries the measured
// heights: head[catId], item[itemId], avail[0] for the first page's body and
// avail[1] for the rest. A heading only ever goes down with at least one dish
// beneath it, and a category that runs on to the next column or page gets its
// heading repeated ("continued") so no column starts mid-list unlabelled.
export function paginate(cats, m, cols) {
  const pages = [{ cols: Array.from({ length: cols }, () => []) }];
  let col = 0;
  let used = 0;
  const cap = () => (pages.length === 1 ? m.avail[0] : m.avail[1]);
  const advance = () => {
    col += 1;
    if (col >= cols) {
      pages.push({ cols: Array.from({ length: cols }, () => []) });
      col = 0;
    }
    used = 0;
  };

  for (const cat of cats) {
    let seg = null;
    let first = true;
    for (const item of cat.items) {
      const headH = m.head[cat.id] ?? 0;
      const itemH = m.item[item.id] ?? 0;
      const need = (seg ? 0 : headH) + itemH;
      if (used > 0 && used + need > cap()) {
        advance();
        seg = null;
      }
      if (!seg) {
        seg = { cat, cont: !first, items: [] };
        pages[pages.length - 1].cols[col].push(seg);
        used += headH;
      }
      seg.items.push(item);
      used += itemH;
      first = false;
    }
  }
  return pages;
}
