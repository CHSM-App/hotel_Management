const { getPool, sql } = require('../../config/connection');

function round2(n) {
  return Math.round(n * 100) / 100;
}

function toIsoDate(d) {
  if (typeof d === 'string') return d.slice(0, 10);
  return d.toISOString().slice(0, 10);
}

// Inclusive of both ends — a report for "1 Aug to 3 Aug" covers all three
// calendar days, matching how an owner reads a date-range picker.
function datesInRange(fromDate, toDate) {
  const dates = [];
  const cur = new Date(`${fromDate}T00:00:00Z`);
  const end = new Date(`${toDate}T00:00:00Z`);
  while (cur <= end) {
    dates.push(cur.toISOString().slice(0, 10));
    cur.setUTCDate(cur.getUTCDate() + 1);
  }
  return dates;
}

// Occupied nights only count stays that actually happened — CHECKED_IN
// (in progress) or CHECKED_OUT (completed). A BOOKED reservation that
// never arrived, or a CANCELLED one, never occupied the room.
async function getOccupancyReport(lodgeId, fromDate, toDate) {
  const pool = await getPool();

  const roomsResult = await pool
    .request()
    .input('lodgeId', sql.BigInt, lodgeId)
    .query('SELECT COUNT(*) AS total FROM dbo.rooms WHERE lodge_id = @lodgeId AND is_active = 1');
  const totalRooms = roomsResult.recordset[0].total;

  const bookingsResult = await pool
    .request()
    .input('lodgeId', sql.BigInt, lodgeId)
    .input('fromDate', sql.Date, fromDate)
    .input('toDate', sql.Date, toDate)
    .query(`
      SELECT room_id, check_in_date, check_out_date
      FROM dbo.bookings
      WHERE lodge_id = @lodgeId AND status IN ('CHECKED_IN', 'CHECKED_OUT')
        AND check_in_date < DATEADD(day, 1, @toDate) AND check_out_date > @fromDate
    `);

  const dates = datesInRange(fromDate, toDate);
  const occupiedByDate = new Map(dates.map((d) => [d, new Set()]));

  for (const row of bookingsResult.recordset) {
    const stayStart = toIsoDate(row.check_in_date);
    const stayEnd = toIsoDate(row.check_out_date);
    for (const date of dates) {
      if (date >= stayStart && date < stayEnd) {
        occupiedByDate.get(date).add(row.room_id);
      }
    }
  }

  const days = dates.map((date) => {
    const occupiedRooms = occupiedByDate.get(date).size;
    return {
      date,
      occupiedRooms,
      totalRooms,
      occupancyPercent: totalRooms > 0 ? round2((occupiedRooms / totalRooms) * 100) : 0,
    };
  });

  const occupiedRoomNights = days.reduce((sum, d) => sum + d.occupiedRooms, 0);
  const totalRoomNights = totalRooms * dates.length;

  return {
    fromDate,
    toDate,
    totalRooms,
    days,
    summary: {
      occupiedRoomNights,
      totalRoomNights,
      occupancyPercent: totalRoomNights > 0 ? round2((occupiedRoomNights / totalRoomNights) * 100) : 0,
    },
  };
}

function emptyTotals() {
  return { count: 0, roomSubtotal: 0, cgstAmount: 0, sgstAmount: 0, totalAmount: 0 };
}

function addToTotals(totals, invoice) {
  totals.count += 1;
  totals.roomSubtotal = round2(totals.roomSubtotal + invoice.roomSubtotal);
  totals.cgstAmount = round2(totals.cgstAmount + invoice.cgstAmount);
  totals.sgstAmount = round2(totals.sgstAmount + invoice.sgstAmount);
  totals.totalAmount = round2(totals.totalAmount + invoice.totalAmount);
}

// A GST filing summary, not a GSTR-1 export — invoice-wise totals grouped
// by document type, the shape a lodge owner (or their CA) needs to fill in
// the actual return. Void bills are excluded; they carry no tax liability.
async function getGstSummary(lodgeId, fromDate, toDate) {
  const pool = await getPool();

  const result = await pool
    .request()
    .input('lodgeId', sql.BigInt, lodgeId)
    .input('fromDate', sql.Date, fromDate)
    .input('toDate', sql.Date, toDate)
    .query(`
      SELECT i.id, i.document_type, i.billing_side, i.invoice_number, i.room_subtotal,
             i.cgst_amount, i.sgst_amount, i.round_off, i.total_amount, i.created_at,
             b.guest_name
      FROM dbo.invoices i
      JOIN dbo.bookings b ON b.id = i.booking_id
      WHERE i.lodge_id = @lodgeId AND i.status = 'ISSUED'
        AND CAST(i.created_at AS DATE) BETWEEN @fromDate AND @toDate
      ORDER BY i.created_at ASC
    `);

  const invoices = result.recordset.map((row) => ({
    id: row.id,
    invoiceNumber: row.invoice_number,
    documentType: row.document_type,
    billingSide: row.billing_side,
    guestName: row.guest_name,
    roomSubtotal: Number(row.room_subtotal),
    cgstAmount: Number(row.cgst_amount),
    sgstAmount: Number(row.sgst_amount),
    roundOff: Number(row.round_off),
    totalAmount: Number(row.total_amount),
    createdAt: row.created_at,
  }));

  const totals = emptyTotals();
  const byDocumentType = {};

  for (const invoice of invoices) {
    addToTotals(totals, invoice);
    if (!byDocumentType[invoice.documentType]) {
      byDocumentType[invoice.documentType] = emptyTotals();
    }
    addToTotals(byDocumentType[invoice.documentType], invoice);
  }

  return { fromDate, toDate, totals, byDocumentType, invoices };
}

module.exports = { getOccupancyReport, getGstSummary };
