// Shared by InventoryPanel and RecipesPanel. Kept out of both so neither has to
// export anything but its component — a module that exports a component and a
// constant together loses fast refresh.

// The unit a material is bought and counted in. Bulk units first, because that
// is how a store room is stocked: rice arrives by the sack and oil by the tin,
// so the shelf count is in kilos and litres. Grams and millilitres stay on the
// list for the few things genuinely bought small — saffron, food colour — but
// they are the exception, not the default.
export const UNITS = [
  { key: 'KG', label: 'kg', name: 'Kilograms' },
  { key: 'L', label: 'L', name: 'Litres' },
  { key: 'PCS', label: 'pcs', name: 'Pieces' },
  { key: 'G', label: 'g', name: 'Grams' },
  { key: 'ML', label: 'ml', name: 'Millilitres' },
];

export const UNIT_LABEL = Object.fromEntries(UNITS.map((u) => [u.key, u.label]));

// Stock is counted big and cooked small. A dish takes 180 g of rice, not
// 0.18 kg — writing recipes in the shelf unit meant every line was a decimal
// with three places of zeros in front of it, which is how a gram becomes a kilo
// by typo. So a recipe is written in the finest unit of the material's family
// and converted on the way in and out; what is stored stays in the material's
// own unit, so nothing already recorded had to move.
//
// Materials already counted in a fine unit map to themselves — there is nothing
// smaller to offer — and pieces are indivisible.
const FINER_UNIT = { KG: 'G', L: 'ML', G: 'G', ML: 'ML', PCS: 'PCS' };
const PER_STOCK_UNIT = { KG: 1000, L: 1000, G: 1, ML: 1, PCS: 1 };

export const recipeUnitOf = (stockUnit) => FINER_UNIT[stockUnit] ?? stockUnit;
export const recipeUnitLabel = (stockUnit) => UNIT_LABEL[recipeUnitOf(stockUnit)] ?? '';

// Three decimals is all the quantity column keeps, so a kilo resolves to the
// gram and a litre to the millilitre — exactly the fine unit, and no finer.
// Rounding here rather than trusting the division keeps 0.18 from arriving as
// 0.18000000000000002.
const round3 = (n) => Math.round(n * 1000) / 1000;

// Stored (material's unit) → what the recipe editor shows.
export const toRecipeQty = (storedQty, stockUnit) =>
  round3(Number(storedQty) * (PER_STOCK_UNIT[stockUnit] ?? 1));

// What was typed in the recipe editor → what gets stored.
export const toStockQty = (recipeQty, stockUnit) =>
  round3(Number(recipeQty) / (PER_STOCK_UNIT[stockUnit] ?? 1));

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
