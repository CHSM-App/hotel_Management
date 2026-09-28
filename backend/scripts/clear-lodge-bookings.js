// Clears booking data for ONE lodge, identified by its owner's mobile number —
// not the whole-database wipe reset-data.js does. Scope: bookings and their
// direct children, invoices/advance receipts and their shares/payment lines,
// and event bookings. Rooms, lodge, users, menu and expense data are untouched.
//
// food_orders.booking_id is nulled rather than deleted — food orders are out
// of scope, and the booking they pointed at is going away.
//
// Run `node scripts/clear-lodge-bookings.js "<owner mobile>"` for a dry run
// (counts only) and add --yes to actually delete.
require('dotenv').config();
const { getPool, sql } = require('../src/config/connection');

const args = process.argv.slice(2);
const confirmed = args.includes('--yes');
const phone = args.find((a) => !a.startsWith('--'));

if (!phone) {
  console.error('Usage: node scripts/clear-lodge-bookings.js "<owner mobile>" [--yes]');
  process.exit(1);
}

async function run() {
  const pool = await getPool();

  const owner = await pool.request().input('phone', sql.NVarChar, phone).query(`
    SELECT u.id AS user_id, u.name, u.phone, u.lodge_id, l.name AS lodge_name
    FROM dbo.users u JOIN dbo.lodges l ON l.id = u.lodge_id
    WHERE u.phone = @phone AND u.role = 'OWNER'
  `);

  if (owner.recordset.length === 0) {
    console.error(`No OWNER user found with phone "${phone}".`);
    process.exit(1);
  }
  if (owner.recordset.length > 1) {
    console.error(`Multiple OWNER users found with phone "${phone}" — refusing to guess.`);
    process.exit(1);
  }

  const { lodge_id: lodgeId, lodge_name: lodgeName } = owner.recordset[0];
  const req = () => pool.request().input('lodgeId', sql.BigInt, lodgeId);

  const counts = {
    bookings: (await req().query('SELECT COUNT(*) n FROM dbo.bookings WHERE lodge_id = @lodgeId')).recordset[0].n,
    invoices: (await req().query("SELECT COUNT(*) n FROM dbo.invoices WHERE lodge_id = @lodgeId AND (booking_id IS NOT NULL OR event_booking_id IS NOT NULL)")).recordset[0].n,
    advance_receipts: (await req().query('SELECT COUNT(*) n FROM dbo.advance_receipts WHERE lodge_id = @lodgeId')).recordset[0].n,
    event_bookings: (await req().query('SELECT COUNT(*) n FROM dbo.event_bookings WHERE lodge_id = @lodgeId')).recordset[0].n,
    food_orders_to_unlink: (await req().query('SELECT COUNT(*) n FROM dbo.food_orders WHERE lodge_id = @lodgeId AND booking_id IS NOT NULL')).recordset[0].n,
  };

  console.log(`\nLodge #${lodgeId} — ${lodgeName} (owner ${owner.recordset[0].name}, ${phone})`);
  console.log('Rows in scope:');
  for (const [k, n] of Object.entries(counts)) console.log(`  ${k.padEnd(24)} ${n}`);

  if (!confirmed) {
    console.log('\nDry run — nothing deleted. Re-run with --yes to apply.');
    process.exit(0);
  }

  const tx = new sql.Transaction(pool);
  await tx.begin();
  try {
    const r = () => new sql.Request(tx).input('lodgeId', sql.BigInt, lodgeId);

    await r().query('UPDATE dbo.food_orders SET booking_id = NULL WHERE lodge_id = @lodgeId AND booking_id IS NOT NULL');

    await r().query(`DELETE bs FROM dbo.bill_shares bs
      JOIN dbo.invoices i ON i.id = bs.invoice_id
      WHERE i.lodge_id = @lodgeId AND (i.booking_id IS NOT NULL OR i.event_booking_id IS NOT NULL)`);
    await r().query(`DELETE rs FROM dbo.receipt_shares rs
      JOIN dbo.advance_receipts ar ON ar.id = rs.receipt_id
      WHERE ar.lodge_id = @lodgeId`);
    await r().query(`DELETE pl FROM dbo.payment_lines pl
      LEFT JOIN dbo.invoices i ON i.id = pl.invoice_id
      LEFT JOIN dbo.advance_receipts ar ON ar.id = pl.advance_receipt_id
      WHERE pl.lodge_id = @lodgeId
        AND (i.booking_id IS NOT NULL OR i.event_booking_id IS NOT NULL OR ar.id IS NOT NULL)`);

    await r().query('DELETE FROM dbo.advance_receipts WHERE lodge_id = @lodgeId');
    await r().query("DELETE FROM dbo.invoices WHERE lodge_id = @lodgeId AND (booking_id IS NOT NULL OR event_booking_id IS NOT NULL)");

    await r().query(`DELETE eba FROM dbo.event_booking_addons eba
      JOIN dbo.event_bookings eb ON eb.id = eba.event_booking_id
      WHERE eb.lodge_id = @lodgeId`);
    await r().query('DELETE FROM dbo.event_bookings WHERE lodge_id = @lodgeId');

    await r().query(`DELETE bb FROM dbo.booking_beds bb JOIN dbo.bookings b ON b.id = bb.booking_id WHERE b.lodge_id = @lodgeId`);
    await r().query(`DELETE bsc FROM dbo.booking_switchable_charges bsc JOIN dbo.bookings b ON b.id = bsc.booking_id WHERE b.lodge_id = @lodgeId`);
    await r().query(`DELETE bv FROM dbo.booking_vehicles bv JOIN dbo.bookings b ON b.id = bv.booking_id WHERE b.lodge_id = @lodgeId`);
    await r().query(`DELETE bg FROM dbo.booking_guests bg JOIN dbo.bookings b ON b.id = bg.booking_id WHERE b.lodge_id = @lodgeId`);
    await r().query('DELETE FROM dbo.bookings WHERE lodge_id = @lodgeId');

    await tx.commit();
  } catch (err) {
    await tx.rollback();
    throw err;
  }

  console.log('\nDone.');
  process.exit(0);
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
