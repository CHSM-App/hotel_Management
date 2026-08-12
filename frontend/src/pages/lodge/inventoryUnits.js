// Shared by InventoryPanel and RecipesPanel. Kept out of both so neither has to
// export anything but its component — a module that exports a component and a
// constant together loses fast refresh.

// The unit a material is bought, counted and cooked in. No conversion between
// them anywhere — a kitchen that wants to think in grams stocks grams — so this
// list only decides what the label beside a number says.
export const UNITS = [
  { key: 'KG', label: 'kg', name: 'Kilograms' },
  { key: 'G', label: 'g', name: 'Grams' },
  { key: 'L', label: 'L', name: 'Litres' },
  { key: 'ML', label: 'ml', name: 'Millilitres' },
  { key: 'PCS', label: 'pcs', name: 'Pieces' },
];

export const UNIT_LABEL = Object.fromEntries(UNITS.map((u) => [u.key, u.label]));

// Which shelf a material sits on. The array order is the order the headings
// appear in, and it is deliberately the order a store room is walked rather
// than alphabetical: the things bought by the sack first, the little jars
// last, and OTHER at the bottom because it means "not filed yet".
export const CATEGORIES = [
  { key: 'GRAINS', label: 'Grains & Pulses' },
  { key: 'PRODUCE', label: 'Vegetables & Fresh' },
  { key: 'PROTEIN', label: 'Dairy, Egg & Meat' },
  { key: 'BAKERY', label: 'Bakery' },
  { key: 'STAPLES', label: 'Oils & Staples' },
  { key: 'SPICES', label: 'Spices & Masalas' },
  { key: 'BOTTLED', label: 'Sauces & Bottled' },
  { key: 'OTHER', label: 'Other' },
];

export const CATEGORY_LABEL = Object.fromEntries(CATEGORIES.map((c) => [c.key, c.label]));

// Groups a flat material list into CATEGORIES order, dropping headings that
// nothing landed under. Shared so the Inventory list and the recipe editor's
// dropdown can't disagree about where something belongs.
export function groupByCategory(materials) {
  return CATEGORIES.map((category) => ({
    ...category,
    materials: materials.filter((m) => (m.category || 'OTHER') === category.key),
  })).filter((group) => group.materials.length > 0);
}

// Why a quantity moved, in the kitchen's words rather than the column's.
export const REASON_LABEL = {
  OPENING: 'Opening stock',
  PURCHASE: 'Stock in',
  ADJUSTMENT: 'Recount',
  CONSUMPTION: 'Cooked',
  REVERSAL: 'Tick undone',
};

// Three decimals is what the column keeps, and trailing zeros on a shelf count
// read as false precision — "12" rather than "12.000".
export function formatQty(n) {
  if (!Number.isFinite(n)) return '—';
  return String(Math.round(n * 1000) / 1000);
}
