/**
 * Seeds a starter bar menu (categories, bottles, selling sizes) into one lodge.
 *
 *   node scripts/seed-bar-menu.js --phone 8263829478 --name "Hotel Renuka Palace"
 *
 * Phone AND name must both match, same safety as seed-menu.js. Turns has_bar on.
 * Idempotent: categories/products matched by name, sizes by label; prices are
 * restated on re-run. Opening stock is NOT seeded (stock_ml stays 0) - enter it
 * in the Bar screen. Prices are placeholders: edit in the app or here + re-run.
 */
require('dotenv').config();
const { getPool, sql } = require('../src/config/connection');

const arg = (f) => {
  const i = process.argv.indexOf(f);
  return i === -1 ? null : process.argv[i + 1] || null;
};
const PHONE = arg('--phone');
const NAME = arg('--name');
if (!PHONE || !NAME) {
  console.error('Usage: node scripts/seed-bar-menu.js --phone <number> --name "<lodge name>"');
  process.exit(1);
}

// [name, brand, bottleMl, {sizeLabel: price}] per category.
const MENU = [
  { name: 'Whisky', products: [
    ['Royal Stag', 'Seagram', 750, { '30 ml': 90, '60 ml': 180, Half: 1100, Full: 2100 }],
    ['Blenders Pride', 'Pernod Ricard', 750, { '30 ml': 120, '60 ml': 240, Half: 1500, Full: 2900 }],
    ['Imperial Blue', 'Pernod Ricard', 750, { '30 ml': 90, '60 ml': 180, Half: 1100, Full: 2100 }],
    ['Officer\'s Choice', 'Allied Blenders', 750, { '30 ml': 70, '60 ml': 140, Half: 800, Full: 1500 }],
    ['Old Monk Rum', 'Mohan Meakin', 750, { '30 ml': 80, '60 ml': 160, Half: 950, Full: 1800 }],
  ] },
  { name: 'Vodka & Rum', products: [
    ['Magic Moments Vodka', 'Radico Khaitan', 750, { '30 ml': 90, '60 ml': 180, Half: 1000, Full: 1900 }],
    ['Bacardi White Rum', 'Bacardi', 750, { '30 ml': 100, '60 ml': 200, Half: 1200, Full: 2300 }],
  ] },
  { name: 'Beer', products: [
    ['Kingfisher Strong', 'UB', 650, { Bottle: 200 }],
    ['Kingfisher Ultra', 'UB', 650, { Bottle: 260 }],
    ['Tuborg', 'Carlsberg', 650, { Bottle: 190 }],
    ['Budweiser', 'AB InBev', 650, { Bottle: 240 }],
  ] },
  { name: 'Wine', products: [
    ['House Red Wine', 'Sula', 750, { Glass: 250, Bottle: 1500 }],
    ['House White Wine', 'Sula', 750, { Glass: 250, Bottle: 1500 }],
  ] },
];
const ML = { '30 ml': 30, '60 ml': 60, Half: 375, Full: 750, Glass: 150 };

async function main() {
  const pool = await getPool();
  const lodge = await pool.request().input('p', sql.NVarChar, PHONE).input('n', sql.NVarChar, NAME)
    .query('SELECT id FROM dbo.lodges WHERE phone = @p AND name = @n');
  if (lodge.recordset.length !== 1) throw new Error(`Expected exactly one lodge for "${NAME}" / ${PHONE}, found ${lodge.recordset.length}.`);
  const lodgeId = lodge.recordset[0].id;
  const req = () => pool.request().input('l', sql.BigInt, lodgeId);

  await req().query('UPDATE dbo.lodges SET has_bar = 1 WHERE id = @l');

  let products = 0;
  for (const [ci, cat] of MENU.entries()) {
    const c = await req().input('n', sql.NVarChar, cat.name).input('s', sql.Int, ci).query(`
      MERGE dbo.bar_categories AS t USING (SELECT @l AS lodge_id, @n AS name) AS s
        ON t.lodge_id = s.lodge_id AND t.name = s.name
      WHEN NOT MATCHED THEN INSERT (lodge_id, name, sort_order) VALUES (@l, @n, @s)
      OUTPUT inserted.id;`);
    const categoryId = c.recordset[0].id;

    for (const [name, brand, bottleMl, sizes] of cat.products) {
      let r = await req().input('n', sql.NVarChar, name).query('SELECT id FROM dbo.bar_products WHERE lodge_id=@l AND name=@n');
      let productId = r.recordset[0]?.id;
      if (!productId) {
        r = await req().input('c', sql.BigInt, categoryId).input('n', sql.NVarChar, name)
          .input('b', sql.NVarChar, brand).input('m', sql.Int, bottleMl).query(
            `INSERT INTO dbo.bar_products (lodge_id, category_id, name, brand, bottle_ml)
             OUTPUT inserted.id VALUES (@l, @c, @n, @b, @m)`);
        productId = r.recordset[0].id;
        products += 1;
      }
      for (const [label, price] of Object.entries(sizes)) {
        const ml = label === 'Bottle' ? bottleMl : ML[label];
        await req().input('p', sql.BigInt, productId).input('lb', sql.NVarChar, label)
          .input('ml', sql.Int, ml).input('pr', sql.Decimal(10, 2), price).query(`
            IF EXISTS (SELECT 1 FROM dbo.bar_menu_items WHERE product_id=@p AND size_label=@lb)
              UPDATE dbo.bar_menu_items SET price=@pr, ml_per_unit=@ml WHERE product_id=@p AND size_label=@lb
            ELSE INSERT INTO dbo.bar_menu_items (lodge_id, product_id, size_label, ml_per_unit, price)
              VALUES (@l, @p, @lb, @ml, @pr)`);
      }
    }
  }
  console.log(`Bar menu seeded for lodge ${lodgeId}: ${products} new products.`);
  await pool.close();
}

main().catch((e) => { console.error(e.message); process.exit(1); });
