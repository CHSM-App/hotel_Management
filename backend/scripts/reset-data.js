// Wipes every row of application data, keeping only what a fresh `npm run db:init`
// would have left behind: the SUPERADMIN login(s), the built-in role definitions
// (dbo.roles WHERE lodge_id IS NULL) and the GST slab reference table.
//
// Everything else — lodges, staff, rooms, bookings, invoices, the whole food side —
// goes. Identity counters on emptied tables are reseeded so the next lodge is id 1
// again.
//
// Run `node scripts/reset-data.js` for a dry run (counts only, no writes) and
// `node scripts/reset-data.js --yes` to actually delete. Pass --wipe-reference to
// also drop the built-in roles and GST slabs; db:init re-seeds both, so that is
// only useful when re-running it straight after.
require('dotenv').config();
const { getPool, sql } = require('../src/config/connection');

const args = process.argv.slice(2);
const confirmed = args.includes('--yes');
const wipeReference = args.includes('--wipe-reference');

// Children before parents. food_orders.invoice_id points at invoices, so orders
// clear before invoices; invoices point at bookings, bookings at rooms, and
// everything lodge-scoped clears before dbo.lodges itself.
const DELETE_ORDER = [
  // Every stock movement points at a material, and a cooked one also points at
  // the order line that ate it, so the ledger clears before any of the three.
  'dbo.stock_movements',
  'dbo.food_order_items',
  'dbo.food_orders',
  'dbo.invoices',
  'dbo.invoice_series',
  'dbo.food_order_counters',
  'dbo.food_pin_lockouts',
  // Recipe lines name a dish, one of its sizes and a material, so they go
  // before the sizes and the dish — and before raw_materials below.
  'dbo.menu_item_recipes',
  'dbo.menu_item_portions',
  'dbo.menu_items',
  'dbo.menu_categories',
  'dbo.raw_materials',
  'dbo.dining_tables',
  'dbo.booking_switchable_charges',
  'dbo.booking_vehicles',
  'dbo.booking_guests',
  'dbo.bookings',
  'dbo.room_switchable_charges',
  'dbo.room_features',
  'dbo.room_images',
  'dbo.rooms',
  'dbo.switchable_charges',
  'dbo.seasons',
  'dbo.features',
  'dbo.room_categories',
];

// Tables emptied completely, so their IDENTITY can restart at 1. Link tables with
// a composite primary key have no identity and are excluded by the check below.
const RESEED = DELETE_ORDER.concat(['dbo.lodges']);

async function count(pool, table, where = '1 = 1') {
  const rs = await pool.request().query(`SELECT COUNT(*) AS n FROM ${table} WHERE ${where}`);
  return rs.recordset[0].n;
}

async function run() {
  const pool = await getPool();

  // The rows that survive. Anything not matching these predicates is data.
  const keepUsers = "role = 'SUPERADMIN'";
  const keepRoles = wipeReference ? '1 = 0' : 'lodge_id IS NULL';

  const surveyed = [];
  for (const table of DELETE_ORDER) {
    surveyed.push([table, await count(pool, table)]);
  }
  surveyed.push(['dbo.roles (lodge-defined)', await count(pool, 'dbo.roles', `NOT (${keepRoles})`)]);
  surveyed.push(['dbo.users (non-superadmin)', await count(pool, 'dbo.users', `NOT (${keepUsers})`)]);
  surveyed.push(['dbo.lodges', await count(pool, 'dbo.lodges')]);
  if (wipeReference) surveyed.push(['dbo.gst_slabs', await count(pool, 'dbo.gst_slabs')]);

  const superadmins = await pool
    .request()
    .query(`SELECT id, name, email, phone FROM dbo.users WHERE ${keepUsers} ORDER BY id`);

  console.log(`\nDatabase: ${process.env.DB_NAME}@${process.env.DB_SERVER}`);
  console.log('\nRows to delete:');
  const total = surveyed.reduce((sum, [, n]) => sum + n, 0);
  for (const [table, n] of surveyed) {
    if (n > 0) console.log(`  ${table.padEnd(34)} ${n}`);
  }
  console.log(`  ${'TOTAL'.padEnd(34)} ${total}`);

  console.log(`\nKeeping ${superadmins.recordset.length} superadmin login(s):`);
  for (const u of superadmins.recordset) {
    console.log(`  #${u.id} ${u.name} — ${u.email || '(no email)'} / ${u.phone}`);
  }
  if (!wipeReference) {
    console.log('Keeping built-in roles (lodge_id IS NULL) and dbo.gst_slabs.');
  }

  if (!confirmed) {
    console.log('\nDry run — nothing deleted. Re-run with --yes to apply.');
    process.exit(0);
  }

  if (superadmins.recordset.length === 0) {
    console.error('\nRefusing to run: no SUPERADMIN row to keep. Run `npm run db:init` first.');
    process.exit(1);
  }

  const tx = new sql.Transaction(pool);
  await tx.begin();
  try {
    for (const table of DELETE_ORDER) {
      await new sql.Request(tx).query(`DELETE FROM ${table}`);
    }
    await new sql.Request(tx).query(`DELETE FROM dbo.roles WHERE NOT (${keepRoles})`);
    await new sql.Request(tx).query(`DELETE FROM dbo.users WHERE NOT (${keepUsers})`);
    await new sql.Request(tx).query('DELETE FROM dbo.lodges');
    if (wipeReference) await new sql.Request(tx).query('DELETE FROM dbo.gst_slabs');
    await tx.commit();
  } catch (err) {
    await tx.rollback();
    throw err;
  }

  // Outside the transaction: DBCC CHECKIDENT is not transactional, and a reseed
  // rolled back leaves the counter where it was rather than where the data is.
  for (const table of RESEED) {
    await pool.request().query(`
      IF OBJECTPROPERTY(OBJECT_ID('${table}'), 'TableHasIdentity') = 1
        DBCC CHECKIDENT ('${table}', RESEED, 0) WITH NO_INFOMSGS;
    `);
  }

  console.log(`\nDeleted ${total} rows. Identity counters reset to 1.`);
  process.exit(0);
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
