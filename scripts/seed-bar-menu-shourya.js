/**
 * Seeds Hotel Shourya Inn's bar menu (from "Hotel_Shourya_Inn_Bar_Menu.pdf" - the
 * PERMIT ROOM & BEER BAR price list) into one lodge.
 *
 *   node scripts/seed-bar-menu-shourya.js --phone 9270339797 --name "Hotel Shourya Inn" [--dry-run]
 *
 * Phone AND name must both match, same safety as seed-bar-menu.js. Turns has_bar
 * on. Idempotent: categories/products matched by name, sizes by label; prices are
 * restated on re-run. All of it runs in one transaction, so a failure leaves
 * nothing half-seeded. Opening stock is NOT seeded (stock_ml stays 0) - enter it
 * in the Bar screen.
 *
 * Notes on reading the PDF:
 *  - Spirit prices are for 180 / 90 / 60 / 30 ml; beer for 650 / 500 ml.
 *  - The PDF lists some items with no price at all (Masic Movement, Masic
 *    Movement Jamun, Bacardi Black, Bacardi Plain White). They are created as
 *    products with no selling sizes, so stock can be tracked and a price added
 *    later in the app; until then they are not offered when taking an order.
 *  - Kingfisher and London Pilsner appear under both Strong and Mild beer with
 *    different prices, so those products are named "... Strong" / "... Mild".
 *  - The PDF gives no bottle sizes or brands: spirits are assumed to be 750 ml
 *    bottles and beer 650 ml (stock is kept in ml, bottles are derived).
 */
require('dotenv').config();
const { getPool, sql } = require('../src/config/connection');

const arg = (f) => {
  const i = process.argv.indexOf(f);
  return i === -1 ? null : process.argv[i + 1] || null;
};
const PHONE = arg('--phone');
const NAME = arg('--name');
const DRY = process.argv.includes('--dry-run');
if (!PHONE || !NAME) {
  console.error('Usage: node scripts/seed-bar-menu-shourya.js --phone <number> --name "<lodge name>" [--dry-run]');
  process.exit(1);
}

const SPIRIT_ML = 750;
const BEER_ML = 650;

// Spirit rows: [name, p180, p90, p60, p30]
const spirit = (rows) => rows.map(([name, a, b, c, d]) => [name, SPIRIT_ML, { '180 ml': a, '90 ml': b, '60 ml': c, '30 ml': d }]);
// Beer rows: [name, p650, p500]
const beer = (rows) => rows.map(([name, a, b]) => [name, BEER_ML, { ...(a ? { '650 ml': a } : {}), ...(b ? { '500 ml': b } : {}) }]);

// [name, bottleMl, {sizeLabel: price}] per category, in the PDF's order.
const MENU = [
  { name: 'Whisky', products: spirit([
    ['Antiquity Blue', 580, 300, 200, 100],
    ['McDowells No. 1', 300, 160, 110, 60],
    ['McDowells Luxury', 310, 160, 110, 60],
    ['The Edition Blue Whisky', 220, 110, 80, 40],
    ['Imperial Blue', 300, 160, 110, 60],
    ['Royal Challenge', 350, 180, 120, 65],
    ['Royal Stag', 350, 180, 120, 65],
    ['Signature Rare', 550, 280, 190, 95],
    ['Masters Delight Whisky PET', 220, 110, 80, 40],
    ['Bagpiper Whisky', 280, 150, 100, 50],
    ['Oaksmith Silver', 440, 230, 150, 75],
    ['Royal Stag Barrel', 450, 230, 155, 80],
    ['Blenders Pride', 550, 280, 190, 95],
    ['DSP Black New', 280, 150, 100, 50],
    ['Black Dog', 850, 430, 285, 140],
    ['Black Dog Gold', 1100, 550, 370, 185],
  ]) },
  { name: 'Vodka', products: [
    ...spirit([
      ['Smirnoff', 580, 300, 200, 100],
      ['Romanov Apple', 300, 160, 110, 60],
      ['Romanov', 300, 160, 110, 60],
      ['White Mischief Vodka', 380, 200, 130, 65],
      ['Sea Link Vodka', 230, 120, 80, 40],
      ['Sea Link Vodka Apple', 230, 120, 80, 40],
    ]),
    ['Masic Movement', SPIRIT_ML, {}],
    ['Masic Movement Jamun', SPIRIT_ML, {}],
  ] },
  { name: 'Gin', products: spirit([
    ['Blue Riband', 300, 160, 110, 50],
  ]) },
  { name: 'Rum', products: [
    ...spirit([
      ['Old Monk', 280, 150, 100, 50],
      ['McDowells Rum', 280, 150, 100, 50],
    ]),
    ['Bacardi Black', SPIRIT_ML, {}],
    ['Bacardi Plain White', SPIRIT_ML, {}],
  ] },
  { name: 'Beer (Strong)', products: beer([
    ['Tuborg Strong Beer', 260, 230],
    ['Kingfisher Strong', 260, 210],
    ['London Pilsner Strong', 230, 160],
    ['Budweiser Magnum', 340, null],
  ]) },
  { name: 'Beer (Mild)', products: beer([
    ['Kingfisher Mild', 260, 230],
    ['London Pilsner Mild', 200, 160],
    ['Budweiser', 320, 270],
  ]) },
];

const mlOf = (label) => Number(/^(\d+) ml$/.exec(label)[1]);

async function main() {
  const totals = {
    categories: MENU.length,
    products: MENU.reduce((n, c) => n + c.products.length, 0),
    sizes: MENU.reduce((n, c) => n + c.products.reduce((m, p) => m + Object.keys(p[2]).length, 0), 0),
  };
  console.log(`Menu: ${totals.categories} categories, ${totals.products} products, ${totals.sizes} priced sizes.`);

  const pool = await getPool();
  const lodge = await pool.request().input('p', sql.NVarChar, PHONE).input('n', sql.NVarChar, NAME)
    .query('SELECT id FROM dbo.lodges WHERE phone = @p AND name = @n');
  if (lodge.recordset.length !== 1) throw new Error(`Expected exactly one lodge for "${NAME}" / ${PHONE}, found ${lodge.recordset.length}.`);
  const lodgeId = lodge.recordset[0].id;
  console.log(`Lodge ${lodgeId}: "${NAME}".`);

  if (DRY) {
    for (const c of MENU) {
      console.log(`\n${c.name}`);
      for (const [name, bottleMl, sizes] of c.products) {
        const s = Object.entries(sizes).map(([l, p]) => `${l} ${p}`).join(', ');
        console.log(`  ${name} (${bottleMl} ml bottle): ${s || 'no price in the PDF - no sizes'}`);
      }
    }
    console.log('\nDry run - nothing written.');
    await pool.close();
    return;
  }

  const tx = new sql.Transaction(pool);
  await tx.begin();
  try {
    const req = () => new sql.Request(tx).input('l', sql.BigInt, lodgeId);

    await req().query('UPDATE dbo.lodges SET has_bar = 1 WHERE id = @l');

    let newProducts = 0;
    let newSizes = 0;
    for (const [ci, cat] of MENU.entries()) {
      const c = await req().input('n', sql.NVarChar, cat.name).input('s', sql.Int, ci).query(`
        MERGE dbo.bar_categories AS t USING (SELECT @l AS lodge_id, @n AS name) AS s
          ON t.lodge_id = s.lodge_id AND t.name = s.name
        WHEN MATCHED THEN UPDATE SET sort_order = @s
        WHEN NOT MATCHED THEN INSERT (lodge_id, name, sort_order) VALUES (@l, @n, @s)
        OUTPUT inserted.id;`);
      const categoryId = c.recordset[0].id;

      for (const [name, bottleMl, sizes] of cat.products) {
        let r = await req().input('n', sql.NVarChar, name).query('SELECT id FROM dbo.bar_products WHERE lodge_id=@l AND name=@n');
        let productId = r.recordset[0]?.id;
        if (!productId) {
          r = await req().input('c', sql.BigInt, categoryId).input('n', sql.NVarChar, name).input('m', sql.Int, bottleMl).query(
            `INSERT INTO dbo.bar_products (lodge_id, category_id, name, bottle_ml)
             OUTPUT inserted.id VALUES (@l, @c, @n, @m)`);
          productId = r.recordset[0].id;
          newProducts += 1;
        }
        // Ascending by size, so the smallest peg is listed first.
        for (const [label, price] of Object.entries(sizes).sort((a, b) => mlOf(a[0]) - mlOf(b[0]))) {
          const res = await req().input('p', sql.BigInt, productId).input('lb', sql.NVarChar, label)
            .input('ml', sql.Int, mlOf(label)).input('pr', sql.Decimal(10, 2), price).query(`
              IF EXISTS (SELECT 1 FROM dbo.bar_menu_items WHERE product_id=@p AND size_label=@lb)
                BEGIN
                  UPDATE dbo.bar_menu_items SET price=@pr, ml_per_unit=@ml WHERE product_id=@p AND size_label=@lb;
                  SELECT 0 AS added;
                END
              ELSE
                BEGIN
                  INSERT INTO dbo.bar_menu_items (lodge_id, product_id, size_label, ml_per_unit, price) VALUES (@l, @p, @lb, @ml, @pr);
                  SELECT 1 AS added;
                END`);
          newSizes += res.recordset[0].added;
        }
      }
    }
    await tx.commit();
    console.log(`Bar menu seeded for lodge ${lodgeId}: ${newProducts} new products, ${newSizes} new sizes.`);
  } catch (e) {
    await tx.rollback();
    throw e;
  }
  await pool.close();
}

main().catch((e) => { console.error(e.message); process.exit(1); });
