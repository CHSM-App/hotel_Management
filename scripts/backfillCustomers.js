require('dotenv').config();
const { getPool } = require('../src/config/connection');

// One-time cleanup: builds dbo.customers from every lodge's existing history
// so a repeat guest or a past function organiser shows up in the new
// Customer List from day one, not just the people who book from here on —
// the live upsert hooks in customers.service.js take over after this runs.
//
// Idempotent and safe to re-run: every insert is guarded by
// "a customers row for this lodge+phone doesn't already exist yet", so a
// second run (interrupted first run, or run again before deploying the
// hooks) only fills in what's still missing rather than double-counting.
//
//   npm run backfill:customers   (add this script to package.json, or)
//   node scripts/backfillCustomers.js

async function run() {
  const pool = await getPool();

  console.log('Backfilling customers from room bookings...');
  const roomCustomers = await pool.request().query(`
    WITH ranked AS (
      SELECT
        b.lodge_id, b.guest_name, b.guest_phone, b.id_proof_type, b.id_proof_number, b.id_proof_document,
        b.check_in_date, b.total_price,
        ROW_NUMBER() OVER (
          PARTITION BY b.lodge_id, b.guest_phone
          ORDER BY CASE WHEN b.id_proof_document IS NULL THEN 1 ELSE 0 END, b.check_in_date DESC, b.id DESC
        ) AS rn,
        COUNT(*) OVER (PARTITION BY b.lodge_id, b.guest_phone) AS stay_count,
        SUM(b.total_price) OVER (PARTITION BY b.lodge_id, b.guest_phone) AS stay_spend,
        MAX(b.check_in_date) OVER (PARTITION BY b.lodge_id, b.guest_phone) AS last_stay
      FROM dbo.bookings b
      WHERE b.status <> 'CANCELLED' AND b.guest_phone IS NOT NULL AND b.guest_phone <> ''
    )
    INSERT INTO dbo.customers
      (lodge_id, phone, name, id_proof_type, id_proof_number, id_proof_document, total_stays, total_room_spend, last_stay_date)
    OUTPUT inserted.id
    SELECT lodge_id, guest_phone, guest_name, id_proof_type, id_proof_number, id_proof_document, stay_count, stay_spend, last_stay
    FROM ranked r
    WHERE rn = 1
      AND NOT EXISTS (SELECT 1 FROM dbo.customers c WHERE c.lodge_id = r.lodge_id AND c.phone = r.guest_phone);
  `);
  console.log(`  ${roomCustomers.recordset.length} new customer row(s) from room bookings.`);

  console.log('Linking room bookings to customers...');
  const linkedBookings = await pool.request().query(`
    UPDATE b
    SET b.customer_id = c.id
    OUTPUT inserted.id
    FROM dbo.bookings b
    JOIN dbo.customers c ON c.lodge_id = b.lodge_id AND c.phone = b.guest_phone
    WHERE b.customer_id IS NULL AND b.guest_phone IS NOT NULL AND b.guest_phone <> '';
  `);
  console.log(`  ${linkedBookings.recordset.length} booking(s) linked.`);

  console.log('Linking co-occupants (booking_guests) to customers...');
  const linkedGuests = await pool.request().query(`
    UPDATE bg
    SET bg.customer_id = c.id
    OUTPUT inserted.id
    FROM dbo.booking_guests bg
    JOIN dbo.bookings b ON b.id = bg.booking_id
    JOIN dbo.customers c ON c.lodge_id = b.lodge_id AND c.phone = bg.guest_phone
    WHERE bg.customer_id IS NULL AND bg.guest_phone IS NOT NULL AND bg.guest_phone <> '';
  `);
  console.log(`  ${linkedGuests.recordset.length} co-occupant row(s) linked.`);

  // Only CONFIRMED/SETTLED counts — a DRAFT (quote) never was a real booking,
  // same rule the live upsertCustomerForEvent hook applies.
  console.log('Backfilling event totals onto existing customers...');
  const updatedForEvents = await pool.request().query(`
    WITH rankedEvents AS (
      SELECT
        eb.lodge_id, eb.organiser_phone,
        ROW_NUMBER() OVER (PARTITION BY eb.lodge_id, eb.organiser_phone ORDER BY eb.start_at DESC, eb.id DESC) AS rn,
        COUNT(*) OVER (PARTITION BY eb.lodge_id, eb.organiser_phone) AS event_count,
        SUM(eb.total_amount) OVER (PARTITION BY eb.lodge_id, eb.organiser_phone) AS event_spend,
        MAX(eb.start_at) OVER (PARTITION BY eb.lodge_id, eb.organiser_phone) AS last_event
      FROM dbo.event_bookings eb
      WHERE eb.status IN ('CONFIRMED', 'SETTLED') AND eb.organiser_phone IS NOT NULL AND eb.organiser_phone <> ''
    )
    UPDATE c
    SET c.total_events = re.event_count,
        c.total_event_spend = re.event_spend,
        c.last_event_date = CAST(re.last_event AS DATE),
        c.updated_at = SYSDATETIMEOFFSET()
    OUTPUT inserted.id
    FROM dbo.customers c
    JOIN rankedEvents re ON re.rn = 1 AND re.lodge_id = c.lodge_id AND re.organiser_phone = c.phone
    WHERE c.total_events = 0;
  `);
  console.log(`  ${updatedForEvents.recordset.length} existing customer(s) updated with event history.`);

  console.log('Backfilling customers from event-only organisers...');
  const eventOnlyCustomers = await pool.request().query(`
    WITH rankedEvents AS (
      SELECT
        eb.lodge_id, eb.organiser_name, eb.organiser_phone,
        ROW_NUMBER() OVER (PARTITION BY eb.lodge_id, eb.organiser_phone ORDER BY eb.start_at DESC, eb.id DESC) AS rn,
        COUNT(*) OVER (PARTITION BY eb.lodge_id, eb.organiser_phone) AS event_count,
        SUM(eb.total_amount) OVER (PARTITION BY eb.lodge_id, eb.organiser_phone) AS event_spend,
        MAX(eb.start_at) OVER (PARTITION BY eb.lodge_id, eb.organiser_phone) AS last_event
      FROM dbo.event_bookings eb
      WHERE eb.status IN ('CONFIRMED', 'SETTLED') AND eb.organiser_phone IS NOT NULL AND eb.organiser_phone <> ''
    )
    INSERT INTO dbo.customers (lodge_id, phone, name, total_events, total_event_spend, last_event_date)
    OUTPUT inserted.id
    SELECT lodge_id, organiser_phone, organiser_name, event_count, event_spend, CAST(last_event AS DATE)
    FROM rankedEvents re
    WHERE re.rn = 1
      AND NOT EXISTS (SELECT 1 FROM dbo.customers c WHERE c.lodge_id = re.lodge_id AND c.phone = re.organiser_phone);
  `);
  console.log(`  ${eventOnlyCustomers.recordset.length} new customer row(s) from event-only organisers.`);

  console.log('Linking event bookings to customers...');
  const linkedEvents = await pool.request().query(`
    UPDATE eb
    SET eb.customer_id = c.id
    OUTPUT inserted.id
    FROM dbo.event_bookings eb
    JOIN dbo.customers c ON c.lodge_id = eb.lodge_id AND c.phone = eb.organiser_phone
    WHERE eb.customer_id IS NULL AND eb.organiser_phone IS NOT NULL AND eb.organiser_phone <> '';
  `);
  console.log(`  ${linkedEvents.recordset.length} event booking(s) linked.`);

  console.log('\nDone.\n');
}

run()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err.message || err);
    process.exit(1);
  });
