const { getPool, sql } = require('../../config/connection');
const { ApiError } = require('../../middleware/errorHandler');
const assetsService = require('../assets/assets.service');
const expensesService = require('../expenses/expenses.service');

// ---------------------------------------------------------------------------
// Room cleaning
//
// Status is derived, never stored, so check-in and check-out are untouched:
//   OUT_OF_ORDER  housekeeping marked it
//   OCCUPIED      a guest is checked in
//   CLEANING      an attendant has started it
//   DIRTY         a guest checked out after it was last cleaned, or someone
//                 marked it "needs cleaning"
//   READY         everything else
// ---------------------------------------------------------------------------

// Pure — takes one board row. Exported so a test can pin the rules.
function roomStatusOf(row) {
  if (row.out_of_order) return 'OUT_OF_ORDER';
  if (row.occupied) return 'OCCUPIED';
  if (row.cleaning_started_at) return 'CLEANING';
  const checkedOutSince =
    row.last_checkout_at && new Date(row.last_checkout_at) > new Date(row.last_cleaned_at);
  if (row.needs_cleaning || checkedOutSince) return 'DIRTY';
  return 'READY';
}

// Rooms get a housekeeping row the first time the board is opened, stamped
// "cleaned now" so turning the section on never floods it with rooms that were
// checked out months ago.
async function ensureRoomRows(pool, lodgeId) {
  try {
    await pool
      .request()
      .input('lodgeId', sql.BigInt, lodgeId)
      .query(`
        INSERT INTO dbo.housekeeping_rooms (room_id, lodge_id)
        SELECT r.id, r.lodge_id FROM dbo.rooms r
        WHERE r.lodge_id = @lodgeId
          AND NOT EXISTS (SELECT 1 FROM dbo.housekeeping_rooms h WHERE h.room_id = r.id)
      `);
  } catch (err) {
    // Two screens opening at once can race to insert the same row; the loser's
    // duplicate is harmless because the winner's row is the one wanted.
    if (!/PRIMARY KEY|duplicate key/i.test(String(err.message))) throw err;
  }
}

const STATUS_ORDER = { DIRTY: 0, CLEANING: 1, READY: 2, OCCUPIED: 3, OUT_OF_ORDER: 4 };

async function listRooms(lodgeId) {
  const pool = await getPool();
  await ensureRoomRows(pool, lodgeId);
  const result = await pool
    .request()
    .input('lodgeId', sql.BigInt, lodgeId)
    .query(`
      SELECT r.id, r.room_number, r.floor, c.name AS category_name,
             -- Who is in the room and when they leave, so a cleaner can plan
             -- around a check-out. A dormitory can hold several stays at once.
             stay.guest_name AS guest_name, stay.check_out_date AS guest_check_out,
             (SELECT COUNT(*) FROM dbo.booking_rooms br WHERE br.room_id = r.id AND br.status = 'CHECKED_IN') AS guests_in,
             CASE WHEN stay.check_out_date <= CAST(SYSDATETIMEOFFSET() AT TIME ZONE 'India Standard Time' AS DATE)
                  THEN 1 ELSE 0 END AS leaving_today,
             -- The last real clean, from the log. last_cleaned_at is not it: a
             -- room that has never been cleaned is stamped "now" when its row is made.
             clean.done_at AS log_cleaned_at, clean.cleaner AS log_cleaned_by,
             (SELECT COUNT(*) FROM dbo.housekeeping_log l
              WHERE l.room_id = r.id AND l.issues IS NOT NULL AND l.issue_resolved_at IS NULL) AS open_issues,
             h.last_cleaned_at, h.needs_cleaning, h.cleaning_started_at, h.out_of_order, h.out_of_order_note,
             cu.name AS cleaning_by_name,
             CASE WHEN EXISTS (SELECT 1 FROM dbo.booking_rooms br WHERE br.room_id = r.id AND br.status = 'CHECKED_IN')
                  THEN 1 ELSE 0 END AS occupied,
             (SELECT MAX(br.actual_check_out_at) FROM dbo.booking_rooms br
              WHERE br.room_id = r.id AND br.status = 'CHECKED_OUT') AS last_checkout_at,
             CASE WHEN EXISTS (SELECT 1 FROM dbo.booking_rooms br
                               WHERE br.room_id = r.id AND br.status = 'BOOKED'
                                 AND br.check_in_date = CAST(SYSDATETIMEOFFSET() AT TIME ZONE 'India Standard Time' AS DATE))
                  THEN 1 ELSE 0 END AS arriving_today
      FROM dbo.rooms r
      JOIN dbo.room_categories c ON c.id = r.category_id
      JOIN dbo.housekeeping_rooms h ON h.room_id = r.id
      LEFT JOIN dbo.users cu ON cu.id = h.cleaning_by
      OUTER APPLY (
        SELECT TOP 1 b.guest_name, br.check_out_date
        FROM dbo.booking_rooms br
        JOIN dbo.bookings b ON b.id = br.booking_id
        WHERE br.room_id = r.id AND br.status = 'CHECKED_IN'
        ORDER BY br.check_out_date ASC, br.id ASC
      ) stay
      OUTER APPLY (
        SELECT TOP 1 l.done_at, u.name AS cleaner
        FROM dbo.housekeeping_log l
        LEFT JOIN dbo.users u ON u.id = l.cleaned_by
        WHERE l.room_id = r.id
        ORDER BY l.done_at DESC, l.id DESC
      ) clean
      WHERE r.lodge_id = @lodgeId AND r.is_active = 1
    `);

  const rooms = result.recordset.map((row) => ({
    id: row.id,
    kind: 'ROOM',
    roomNumber: row.room_number,
    categoryName: row.category_name,
    floor: row.floor ?? null,
    guestName: row.guest_name ?? null,
    // A calendar day, not a moment: sent as YYYY-MM-DD so no time zone can move it.
    guestCheckOut: row.guest_check_out ? new Date(row.guest_check_out).toISOString().slice(0, 10) : null,
    guestsIn: Number(row.guests_in ?? 0),
    leavingToday: !!row.leaving_today,
    cleanedAt: row.log_cleaned_at ?? null,
    cleanedBy: row.log_cleaned_by ?? null,
    openIssues: Number(row.open_issues ?? 0),
    status: roomStatusOf(row),
    arrivingToday: !!row.arriving_today,
    cleaningBy: row.cleaning_by_name ?? null,
    cleaningStartedAt: row.cleaning_started_at ?? null,
    outOfOrderNote: row.out_of_order_note ?? null,
    lastCleanedAt: row.last_cleaned_at,
    // The guest's check-out, when that is what made the room dirty, so the
    // board can say how long it has been waiting. Null for a room someone
    // marked by hand: there is no honest start time for that.
    dirtySince:
      row.last_checkout_at && new Date(row.last_checkout_at) > new Date(row.last_cleaned_at) ? row.last_checkout_at : null,
  }));
  // Work to do first, and among dirty rooms the ones a guest is arriving into.
  rooms.sort(
    (a, b) =>
      STATUS_ORDER[a.status] - STATUS_ORDER[b.status] ||
      Number(b.arrivingToday) - Number(a.arrivingToday) ||
      String(a.roomNumber).localeCompare(String(b.roomNumber), undefined, { numeric: true })
  );
  return rooms;
}

async function requireRoom(request, lodgeId, roomId) {
  const found = await request
    .input('lodgeId', sql.BigInt, lodgeId)
    .input('roomId', sql.BigInt, roomId)
    .query('SELECT id FROM dbo.rooms WHERE id = @roomId AND lodge_id = @lodgeId');
  if (found.recordset.length === 0) throw new ApiError('Room not found.', 404);
}

async function startCleaning(lodgeId, userId, roomId) {
  const pool = await getPool();
  await requireRoom(pool.request(), lodgeId, roomId);
  await ensureRoomRows(pool, lodgeId);
  const result = await pool
    .request()
    .input('lodgeId', sql.BigInt, lodgeId)
    .input('roomId', sql.BigInt, roomId)
    .input('userId', sql.BigInt, userId ?? null)
    .query(`
      UPDATE dbo.housekeeping_rooms
      SET cleaning_started_at = SYSDATETIMEOFFSET(), cleaning_by = @userId
      WHERE room_id = @roomId AND lodge_id = @lodgeId AND cleaning_started_at IS NULL AND out_of_order = 0
    `);
  if (result.rowsAffected[0] === 0) {
    throw new ApiError('This room is already being cleaned or is out of order.', 409);
  }
}

// Gives the room back without cleaning it — started by mistake.
async function releaseRoom(lodgeId, roomId) {
  const pool = await getPool();
  await requireRoom(pool.request(), lodgeId, roomId);
  await pool
    .request()
    .input('roomId', sql.BigInt, roomId)
    .query('UPDATE dbo.housekeeping_rooms SET cleaning_started_at = NULL, cleaning_by = NULL WHERE room_id = @roomId');
}

async function hasLaundry(pool, lodgeId) {
  const result = await pool.request().input('lodgeId', sql.BigInt, lodgeId).query('SELECT has_laundry FROM dbo.lodges WHERE id = @lodgeId');
  return !!result.recordset[0]?.has_laundry;
}

async function assertLinenItems(request, lodgeId, ids) {
  if (ids.length === 0) return;
  request.input('lodgeId', sql.BigInt, lodgeId);
  ids.forEach((id, i) => request.input(`li${i}`, sql.BigInt, id));
  const found = await request.query(
    `SELECT id FROM dbo.linen_items WHERE lodge_id = @lodgeId AND id IN (${ids.map((_, i) => `@li${i}`).join(', ')})`
  );
  if (found.recordset.length !== new Set(ids).size) throw new ApiError('One of those linen items was not found.', 404);
}

// A room/venue can only be changed with — and a loss can only be taken off —
// linen that is actually clean and in the store right now. Without this, a
// hotel owning 3 bedsheets could have 5 "changed" into a room or "lost" in
// one entry, and the stock board would show more out than it owns (see
// linenStockOf's `short` flag, which this stops from ever being set).
async function assertLinenAvailable(lodgeId, lines) {
  if (lines.length === 0) return;
  const stock = await stockById(lodgeId);
  for (const line of lines) {
    const item = stock.get(String(line.linenItemId));
    if (item && line.quantity > item.clean) {
      throw new ApiError(
        `Only ${item.clean} ${item.name} ${item.clean === 1 ? 'is' : 'are'} clean and in the store. Check how many you own, or lower the count.`,
        409
      );
    }
  }
}

// Done: the room is clean, the linen changed in it waits for the laundry to
// receive it, and anything found is logged. Works whether or not Start was pressed first.
async function finishCleaning(lodgeId, userId, roomId, input) {
  const pool = await getPool();
  await requireRoom(pool.request(), lodgeId, roomId);
  await ensureRoomRows(pool, lodgeId);
  // Linen is only counted where the Laundry section is on. A screen left open
  // from before it was switched off must not keep writing to the ledger.
  const linen = (await hasLaundry(pool, lodgeId)) ? input.linen : [];
  // Blocking a room needs a reason to show for it.
  const blockRoom = Boolean(input.blockRoom && input.issues);
  await assertLinenItems(pool.request(), lodgeId, linen.map((l) => l.linenItemId));
  await assertLinenAvailable(lodgeId, linen);

  const transaction = new sql.Transaction(pool);
  await transaction.begin();
  try {
    const row = await new sql.Request(transaction)
      .input('roomId', sql.BigInt, roomId)
      .input('lodgeId', sql.BigInt, lodgeId)
      .query(`
        UPDATE dbo.housekeeping_rooms
        SET last_cleaned_at = SYSDATETIMEOFFSET(), needs_cleaning = 0, cleaning_started_at = NULL, cleaning_by = NULL
        OUTPUT deleted.cleaning_started_at AS started_at, deleted.out_of_order AS out_of_order
        WHERE room_id = @roomId AND lodge_id = @lodgeId
      `);
    if (row.recordset[0]?.out_of_order) {
      throw new ApiError('This room is out of order. Put it back in service first.', 409);
    }

    const log = await new sql.Request(transaction)
      .input('lodgeId', sql.BigInt, lodgeId)
      .input('roomId', sql.BigInt, roomId)
      .input('userId', sql.BigInt, userId ?? null)
      .input('startedAt', sql.DateTimeOffset, row.recordset[0]?.started_at ?? new Date())
      .input('issues', sql.NVarChar, input.issues || null)
      .input('lostFound', sql.NVarChar, input.lostFound || null)
      .input('blocked', sql.Bit, blockRoom ? 1 : 0)
      .query(`
        INSERT INTO dbo.housekeeping_log (lodge_id, room_id, cleaned_by, started_at, issues, lost_found, blocked_room)
        OUTPUT inserted.id
        VALUES (@lodgeId, @roomId, @userId, @startedAt, @issues, @lostFound, @blocked)
      `);

    // The cleaner said the room cannot be let as it is: it is clean, but it
    // goes under repair, with the problem as the reason, until the issue is closed.
    if (blockRoom) {
      await new sql.Request(transaction)
        .input('roomId', sql.BigInt, roomId)
        .input('note', sql.NVarChar, input.issues.slice(0, 300))
        .query('UPDATE dbo.housekeeping_rooms SET out_of_order = 1, out_of_order_note = @note WHERE room_id = @roomId');
    }

    for (const line of linen) {
      await new sql.Request(transaction)
        .input('lodgeId', sql.BigInt, lodgeId)
        .input('itemId', sql.BigInt, line.linenItemId)
        .input('qty', sql.Int, line.quantity)
        .input('roomId', sql.BigInt, roomId)
        .input('userId', sql.BigInt, userId ?? null)
        .input('logId', sql.BigInt, log.recordset[0].id)
        .query(`
          INSERT INTO dbo.linen_movements (lodge_id, linen_item_id, kind, quantity, room_id, created_by, log_id)
          VALUES (@lodgeId, @itemId, 'CHANGED', @qty, @roomId, @userId, @logId)
        `);
    }
    await transaction.commit();
  } catch (err) {
    await transaction.rollback();
    throw err;
  }
}

async function markDirty(lodgeId, roomId) {
  const pool = await getPool();
  await requireRoom(pool.request(), lodgeId, roomId);
  await ensureRoomRows(pool, lodgeId);
  await pool.request().input('roomId', sql.BigInt, roomId).query('UPDATE dbo.housekeeping_rooms SET needs_cleaning = 1 WHERE room_id = @roomId');
}

// Back in service always lands DIRTY: whoever repaired it left a mess.
async function setOutOfOrder(lodgeId, roomId, { outOfOrder, note }) {
  const pool = await getPool();
  await requireRoom(pool.request(), lodgeId, roomId);
  await ensureRoomRows(pool, lodgeId);
  await pool
    .request()
    .input('roomId', sql.BigInt, roomId)
    .input('flag', sql.Bit, outOfOrder ? 1 : 0)
    .input('note', sql.NVarChar, outOfOrder ? note || null : null)
    .query(`
      UPDATE dbo.housekeeping_rooms
      SET out_of_order = @flag, out_of_order_note = @note,
          cleaning_started_at = NULL, cleaning_by = NULL,
          needs_cleaning = CASE WHEN @flag = 0 THEN 1 ELSE needs_cleaning END
      WHERE room_id = @roomId
    `);
}

// ---------------------------------------------------------------------------
// Event venues
//
// A hall or lawn sits on the same board as the rooms and moves through the
// same states, read from the function diary the way a room's are read from
// its stays:
//   OCCUPIED  a confirmed function is running now ("In use" on the screen)
//   DIRTY     a function ended after the venue was last cleaned, or someone
//             marked it
// The rest are the room's own. Drafts and cancelled functions never count:
// neither put anyone in the hall. Every query here carries the lodge id — a
// venue id alone proves nothing about whose venue it is.
// ---------------------------------------------------------------------------

async function lodgeHasEvents(pool, lodgeId) {
  const result = await pool.request().input('lodgeId', sql.BigInt, lodgeId).query('SELECT has_events FROM dbo.lodges WHERE id = @lodgeId');
  return !!result.recordset[0]?.has_events;
}

// As ensureRoomRows: a venue gets its row the first time the board is opened,
// stamped "cleaned now", so last season's functions do not all show as dirty.
async function ensureVenueRows(pool, lodgeId) {
  try {
    await pool
      .request()
      .input('lodgeId', sql.BigInt, lodgeId)
      .query(`
        INSERT INTO dbo.housekeeping_venues (venue_id, lodge_id)
        SELECT v.id, v.lodge_id FROM dbo.event_venues v
        WHERE v.lodge_id = @lodgeId
          AND NOT EXISTS (SELECT 1 FROM dbo.housekeeping_venues h WHERE h.venue_id = v.id AND h.lodge_id = @lodgeId)
      `);
  } catch (err) {
    if (!/PRIMARY KEY|duplicate key/i.test(String(err.message))) throw err;
  }
}

// The same shape a room row has, so one list on the screen (and one day in the
// mobile app) can hold both. `roomNumber` carries the venue's name.
async function listVenues(lodgeId) {
  const pool = await getPool();
  if (!(await lodgeHasEvents(pool, lodgeId))) return [];
  await ensureVenueRows(pool, lodgeId);
  const result = await pool
    .request()
    .input('lodgeId', sql.BigInt, lodgeId)
    .query(`
      SELECT v.id, v.name, v.capacity_pax,
             h.last_cleaned_at, h.needs_cleaning, h.cleaning_started_at, h.out_of_order, h.out_of_order_note,
             cu.name AS cleaning_by_name,
             CASE WHEN running.id IS NOT NULL THEN 1 ELSE 0 END AS occupied,
             running.title AS running_title, running.end_at AS running_end_at,
             -- A function is over at its booked end, or sooner where the desk
             -- marked it completed: that is when the venue needs cleaning.
             (SELECT MAX(CASE WHEN e.completed_at IS NOT NULL AND e.completed_at < e.end_at THEN e.completed_at ELSE e.end_at END) FROM dbo.event_bookings e
              WHERE e.venue_id = v.id AND e.lodge_id = @lodgeId AND e.status IN ('CONFIRMED', 'SETTLED')
                AND CASE WHEN e.completed_at IS NOT NULL AND e.completed_at < e.end_at THEN e.completed_at ELSE e.end_at END <= SYSDATETIMEOFFSET()) AS last_checkout_at,
             upcoming.title AS next_title, upcoming.start_at AS next_start_at,
             clean.done_at AS log_cleaned_at, clean.cleaner AS log_cleaned_by,
             (SELECT COUNT(*) FROM dbo.housekeeping_log l
              WHERE l.venue_id = v.id AND l.lodge_id = @lodgeId AND l.issues IS NOT NULL AND l.issue_resolved_at IS NULL) AS open_issues
      FROM dbo.event_venues v
      JOIN dbo.housekeeping_venues h ON h.venue_id = v.id AND h.lodge_id = @lodgeId
      LEFT JOIN dbo.users cu ON cu.id = h.cleaning_by
      OUTER APPLY (
        SELECT TOP 1 e.id, e.title, e.end_at
        FROM dbo.event_bookings e
        WHERE e.venue_id = v.id AND e.lodge_id = @lodgeId AND e.status IN ('CONFIRMED', 'SETTLED')
          AND e.start_at <= SYSDATETIMEOFFSET() AND e.end_at > SYSDATETIMEOFFSET() AND e.completed_at IS NULL
        ORDER BY e.end_at ASC
      ) running
      OUTER APPLY (
        SELECT TOP 1 e.title, e.start_at
        FROM dbo.event_bookings e
        WHERE e.venue_id = v.id AND e.lodge_id = @lodgeId AND e.status = 'CONFIRMED'
          AND e.start_at > SYSDATETIMEOFFSET()
          AND CAST(e.start_at AT TIME ZONE 'India Standard Time' AS DATE) = CAST(SYSDATETIMEOFFSET() AT TIME ZONE 'India Standard Time' AS DATE)
        ORDER BY e.start_at ASC
      ) upcoming
      OUTER APPLY (
        SELECT TOP 1 l.done_at, u.name AS cleaner
        FROM dbo.housekeeping_log l
        LEFT JOIN dbo.users u ON u.id = l.cleaned_by
        WHERE l.venue_id = v.id AND l.lodge_id = @lodgeId
        ORDER BY l.done_at DESC, l.id DESC
      ) clean
      WHERE v.lodge_id = @lodgeId AND v.is_active = 1
    `);

  const venues = result.recordset.map((row) => ({
    id: row.id,
    kind: 'VENUE',
    roomNumber: row.name,
    categoryName: row.capacity_pax ? `Venue · up to ${row.capacity_pax} guests` : 'Venue',
    floor: null,
    // The function in the hall now, and the one still to come today.
    eventTitle: row.running_title ?? null,
    eventEndsAt: row.running_end_at ?? null,
    nextEventTitle: row.next_title ?? null,
    nextEventAt: row.next_start_at ?? null,
    guestName: null,
    guestCheckOut: null,
    guestsIn: 0,
    leavingToday: false,
    cleanedAt: row.log_cleaned_at ?? null,
    cleanedBy: row.log_cleaned_by ?? null,
    openIssues: Number(row.open_issues ?? 0),
    status: roomStatusOf(row),
    // A function later today: the venue has to be ready for it.
    arrivingToday: !!row.next_start_at,
    cleaningBy: row.cleaning_by_name ?? null,
    cleaningStartedAt: row.cleaning_started_at ?? null,
    outOfOrderNote: row.out_of_order_note ?? null,
    lastCleanedAt: row.last_cleaned_at,
    dirtySince:
      row.last_checkout_at && new Date(row.last_checkout_at) > new Date(row.last_cleaned_at) ? row.last_checkout_at : null,
  }));
  venues.sort(
    (a, b) =>
      STATUS_ORDER[a.status] - STATUS_ORDER[b.status] ||
      Number(b.arrivingToday) - Number(a.arrivingToday) ||
      String(a.roomNumber).localeCompare(String(b.roomNumber), undefined, { numeric: true })
  );
  return venues;
}

async function requireVenue(pool, lodgeId, venueId) {
  const found = await pool
    .request()
    .input('lodgeId', sql.BigInt, lodgeId)
    .input('venueId', sql.BigInt, venueId)
    .query('SELECT id FROM dbo.event_venues WHERE id = @venueId AND lodge_id = @lodgeId');
  if (found.recordset.length === 0) throw new ApiError('Venue not found.', 404);
  await ensureVenueRows(pool, lodgeId);
}

async function startVenueCleaning(lodgeId, userId, venueId) {
  const pool = await getPool();
  await requireVenue(pool, lodgeId, venueId);
  const result = await pool
    .request()
    .input('lodgeId', sql.BigInt, lodgeId)
    .input('venueId', sql.BigInt, venueId)
    .input('userId', sql.BigInt, userId ?? null)
    .query(`
      UPDATE dbo.housekeeping_venues
      SET cleaning_started_at = SYSDATETIMEOFFSET(), cleaning_by = @userId
      WHERE venue_id = @venueId AND lodge_id = @lodgeId AND cleaning_started_at IS NULL AND out_of_order = 0
    `);
  if (result.rowsAffected[0] === 0) {
    throw new ApiError('This venue is already being cleaned or is under repair.', 409);
  }
}

async function releaseVenue(lodgeId, venueId) {
  const pool = await getPool();
  await requireVenue(pool, lodgeId, venueId);
  await pool
    .request()
    .input('lodgeId', sql.BigInt, lodgeId)
    .input('venueId', sql.BigInt, venueId)
    .query('UPDATE dbo.housekeeping_venues SET cleaning_started_at = NULL, cleaning_by = NULL WHERE venue_id = @venueId AND lodge_id = @lodgeId');
}

// The venue's finishCleaning: clean, its linen on the way to the laundry, and
// anything reported logged. Works whether or not Start was pressed first.
async function finishVenueCleaning(lodgeId, userId, venueId, input) {
  const pool = await getPool();
  await requireVenue(pool, lodgeId, venueId);
  const linen = (await hasLaundry(pool, lodgeId)) ? input.linen : [];
  const blockVenue = Boolean(input.blockRoom && input.issues);
  await assertLinenItems(pool.request(), lodgeId, linen.map((l) => l.linenItemId));
  await assertLinenAvailable(lodgeId, linen);

  const transaction = new sql.Transaction(pool);
  await transaction.begin();
  try {
    const row = await new sql.Request(transaction)
      .input('venueId', sql.BigInt, venueId)
      .input('lodgeId', sql.BigInt, lodgeId)
      .query(`
        UPDATE dbo.housekeeping_venues
        SET last_cleaned_at = SYSDATETIMEOFFSET(), needs_cleaning = 0, cleaning_started_at = NULL, cleaning_by = NULL
        OUTPUT deleted.cleaning_started_at AS started_at, deleted.out_of_order AS out_of_order
        WHERE venue_id = @venueId AND lodge_id = @lodgeId
      `);
    if (row.recordset[0]?.out_of_order) {
      throw new ApiError('This venue is under repair. Put it back in service first.', 409);
    }

    const log = await new sql.Request(transaction)
      .input('lodgeId', sql.BigInt, lodgeId)
      .input('venueId', sql.BigInt, venueId)
      .input('userId', sql.BigInt, userId ?? null)
      .input('startedAt', sql.DateTimeOffset, row.recordset[0]?.started_at ?? new Date())
      .input('issues', sql.NVarChar, input.issues || null)
      .input('lostFound', sql.NVarChar, input.lostFound || null)
      .input('blocked', sql.Bit, blockVenue ? 1 : 0)
      .query(`
        INSERT INTO dbo.housekeeping_log (lodge_id, venue_id, cleaned_by, started_at, issues, lost_found, blocked_room)
        OUTPUT inserted.id
        VALUES (@lodgeId, @venueId, @userId, @startedAt, @issues, @lostFound, @blocked)
      `);

    if (blockVenue) {
      await new sql.Request(transaction)
        .input('venueId', sql.BigInt, venueId)
        .input('lodgeId', sql.BigInt, lodgeId)
        .input('note', sql.NVarChar, input.issues.slice(0, 300))
        .query('UPDATE dbo.housekeeping_venues SET out_of_order = 1, out_of_order_note = @note WHERE venue_id = @venueId AND lodge_id = @lodgeId');
    }

    for (const line of linen) {
      await new sql.Request(transaction)
        .input('lodgeId', sql.BigInt, lodgeId)
        .input('itemId', sql.BigInt, line.linenItemId)
        .input('qty', sql.Int, line.quantity)
        .input('venueId', sql.BigInt, venueId)
        .input('userId', sql.BigInt, userId ?? null)
        .input('logId', sql.BigInt, log.recordset[0].id)
        .query(`
          INSERT INTO dbo.linen_movements (lodge_id, linen_item_id, kind, quantity, venue_id, created_by, log_id)
          VALUES (@lodgeId, @itemId, 'CHANGED', @qty, @venueId, @userId, @logId)
        `);
    }
    await transaction.commit();
  } catch (err) {
    await transaction.rollback();
    throw err;
  }
}

async function markVenueDirty(lodgeId, venueId) {
  const pool = await getPool();
  await requireVenue(pool, lodgeId, venueId);
  await pool
    .request()
    .input('lodgeId', sql.BigInt, lodgeId)
    .input('venueId', sql.BigInt, venueId)
    .query('UPDATE dbo.housekeeping_venues SET needs_cleaning = 1 WHERE venue_id = @venueId AND lodge_id = @lodgeId');
}

// Back in service always lands DIRTY, as for a room.
async function setVenueOutOfOrder(lodgeId, venueId, { outOfOrder, note }) {
  const pool = await getPool();
  await requireVenue(pool, lodgeId, venueId);
  await pool
    .request()
    .input('lodgeId', sql.BigInt, lodgeId)
    .input('venueId', sql.BigInt, venueId)
    .input('flag', sql.Bit, outOfOrder ? 1 : 0)
    .input('note', sql.NVarChar, outOfOrder ? note || null : null)
    .query(`
      UPDATE dbo.housekeeping_venues
      SET out_of_order = @flag, out_of_order_note = @note,
          cleaning_started_at = NULL, cleaning_by = NULL,
          needs_cleaning = CASE WHEN @flag = 0 THEN 1 ELSE needs_cleaning END
      WHERE venue_id = @venueId AND lodge_id = @lodgeId
    `);
}

// ---------------------------------------------------------------------------
// Issues — what a cleaner reported when finishing a room. One log row can carry
// a problem and a found item; each is listed, and closed, on its own.
// ---------------------------------------------------------------------------

const ISSUE_KINDS = {
  ISSUE: { text: 'issues', closedAt: 'issue_resolved_at', closedBy: 'issue_resolved_by', resolution: 'issue_resolution' },
  FOUND: { text: 'lost_found', closedAt: 'found_closed_at', closedBy: 'found_closed_by', resolution: 'found_resolution' },
};

// 'open' = still waiting on someone; anything else adds the recently closed.
async function listIssues(lodgeId, scope) {
  const pool = await getPool();
  const result = await pool
    .request()
    .input('lodgeId', sql.BigInt, lodgeId)
    .query(`
      SELECT TOP 300 l.id, l.room_id, l.venue_id, r.room_number, v.name AS venue_name,
             l.issues, l.lost_found, l.done_at, l.blocked_room,
             u.name AS reported_by,
             l.issue_resolved_at, iu.name AS issue_resolved_by, l.issue_resolution,
             l.found_closed_at, fu.name AS found_closed_by, l.found_resolution,
             COALESCE(h.out_of_order, hv.out_of_order, 0) AS out_of_order
      FROM dbo.housekeeping_log l
      LEFT JOIN dbo.rooms r ON r.id = l.room_id
      LEFT JOIN dbo.event_venues v ON v.id = l.venue_id
      LEFT JOIN dbo.housekeeping_rooms h ON h.room_id = l.room_id
      LEFT JOIN dbo.housekeeping_venues hv ON hv.venue_id = l.venue_id AND hv.lodge_id = l.lodge_id
      LEFT JOIN dbo.users u ON u.id = l.cleaned_by
      LEFT JOIN dbo.users iu ON iu.id = l.issue_resolved_by
      LEFT JOIN dbo.users fu ON fu.id = l.found_closed_by
      WHERE l.lodge_id = @lodgeId AND (l.issues IS NOT NULL OR l.lost_found IS NOT NULL)
      ORDER BY l.done_at DESC, l.id DESC
    `);

  const entries = [];
  for (const row of result.recordset) {
    const base = {
      logId: row.id,
      roomId: row.room_id,
      // A venue has a name where a room has a number; `space` says which this is.
      space: row.venue_id != null ? 'VENUE' : 'ROOM',
      roomNumber: row.venue_id != null ? row.venue_name : row.room_number,
      reportedAt: row.done_at,
      reportedBy: row.reported_by ?? null,
    };
    if (row.issues) {
      entries.push({
        ...base,
        kind: 'ISSUE',
        text: row.issues,
        closedAt: row.issue_resolved_at ?? null,
        closedBy: row.issue_resolved_by ?? null,
        resolution: row.issue_resolution ?? null,
        // Still holding the room back: closing this is what lets it be let again.
        roomBlocked: !!row.blocked_room && !!row.out_of_order && !row.issue_resolved_at,
      });
    }
    if (row.lost_found) {
      entries.push({
        ...base,
        kind: 'FOUND',
        text: row.lost_found,
        closedAt: row.found_closed_at ?? null,
        closedBy: row.found_closed_by ?? null,
        resolution: row.found_resolution ?? null,
        roomBlocked: false,
      });
    }
  }
  return scope === 'open' ? entries.filter((e) => !e.closedAt) : entries;
}

// For the desk's badge and alert: how many are open, and the newest one.
async function openIssueSummary(lodgeId) {
  const open = await listIssues(lodgeId, 'open');
  const latest = open[0] ?? null;
  return {
    count: open.length,
    latestKey: latest ? `${latest.logId}:${latest.kind}` : null,
    latest: latest ? { kind: latest.kind, space: latest.space, roomNumber: latest.roomNumber, text: latest.text } : null,
  };
}

async function closeIssue(lodgeId, userId, logId, { kind, note }) {
  const cols = ISSUE_KINDS[kind];
  const pool = await getPool();
  const transaction = new sql.Transaction(pool);
  await transaction.begin();
  try {
    // The guard on "still open" is what stops two people closing the same one.
    const closed = await new sql.Request(transaction)
      .input('id', sql.BigInt, logId)
      .input('lodgeId', sql.BigInt, lodgeId)
      .input('userId', sql.BigInt, userId ?? null)
      .input('note', sql.NVarChar, note || null)
      .query(`
        UPDATE dbo.housekeeping_log
        SET ${cols.closedAt} = SYSDATETIMEOFFSET(), ${cols.closedBy} = @userId, ${cols.resolution} = @note
        OUTPUT inserted.room_id, inserted.venue_id, inserted.blocked_room
        WHERE id = @id AND lodge_id = @lodgeId AND ${cols.text} IS NOT NULL AND ${cols.closedAt} IS NULL
      `);
    if (closed.recordset.length === 0) throw new ApiError('This was already closed, or could not be found.', 409);

    // A room this report took out of use comes back once nothing else is
    // holding it — to the cleaning list, like any room back from a repair.
    let roomReleased = false;
    const { room_id: roomId, venue_id: venueId, blocked_room: blocked } = closed.recordset[0];
    if (kind === 'ISSUE' && blocked && venueId != null) {
      // The same release, for a venue this report took out of use.
      const released = await new sql.Request(transaction)
        .input('venueId', sql.BigInt, venueId)
        .input('lodgeId', sql.BigInt, lodgeId)
        .query(`
          UPDATE dbo.housekeeping_venues
          SET out_of_order = 0, out_of_order_note = NULL, needs_cleaning = 1
          WHERE venue_id = @venueId AND lodge_id = @lodgeId AND out_of_order = 1
            AND NOT EXISTS (SELECT 1 FROM dbo.housekeeping_log o
                            WHERE o.venue_id = @venueId AND o.lodge_id = @lodgeId AND o.blocked_room = 1
                              AND o.issues IS NOT NULL AND o.issue_resolved_at IS NULL)
        `);
      roomReleased = released.rowsAffected[0] > 0;
    } else if (kind === 'ISSUE' && blocked) {
      const released = await new sql.Request(transaction)
        .input('roomId', sql.BigInt, roomId)
        .query(`
          UPDATE dbo.housekeeping_rooms
          SET out_of_order = 0, out_of_order_note = NULL, needs_cleaning = 1
          WHERE room_id = @roomId AND out_of_order = 1
            AND NOT EXISTS (SELECT 1 FROM dbo.housekeeping_log o
                            WHERE o.room_id = @roomId AND o.blocked_room = 1 AND o.issues IS NOT NULL AND o.issue_resolved_at IS NULL)
        `);
      roomReleased = released.rowsAffected[0] > 0;
    }
    await transaction.commit();
    return { roomReleased };
  } catch (err) {
    await transaction.rollback();
    throw err;
  }
}

// ---------------------------------------------------------------------------
// Hotel linen — an append-only ledger; stock is derived from it.
// ---------------------------------------------------------------------------

// Pure, exported for a test. Everything is a sum over the ledger:
//   withHousekeeping  changed in a room, not yet handed to the laundry
//   dirty      with the laundry, waiting to be washed = CHANGED (handed over) - SENT
//   inLaundry  in the wash, not yet back = SENT - RECEIVED - lost/damaged in the wash
//   owned      what the lodge still has = totalOwned - every loss
//   clean      in rooms and the store   = owned - withHousekeeping - dirty - inLaundry
//
// Neither dirty nor at-the-laundry can be negative. Linen sent out beyond what
// was recorded as dirty simply came from the clean pile (the room's linen change
// was never counted), so dirty bottoms out at 0 instead of showing -31.
// `short` flags a lodge whose counts cannot be right (more out than owned), so
// the screen can say "check how many you own" rather than print a negative.
function linenStockOf(row) {
  const n = (v) => Number(v ?? 0);
  const withHousekeeping = n(row.pending);
  const dirty = Math.max(0, n(row.changed) - n(row.sent));
  const inLaundry = Math.max(0, n(row.sent) - n(row.received) - n(row.lost_laundry));
  const owned = n(row.total_owned) - n(row.lost_all);
  const clean = owned - withHousekeeping - dirty - inLaundry;
  return { owned, withHousekeeping, dirty, inLaundry, clean: Math.max(0, clean), short: clean < 0, lostTotal: n(row.lost_all) };
}

// ---------------------------------------------------------------------------
// Where the linen list comes from.
//
// At a property with Asset Inventory, linen is registered there, under the
// linen category ("Bedsheets & Towels"), and Laundry only reads it: each linen asset gets a
// linen_items row (made here the first time it is seen) that takes the asset's
// name and quantity. The ledger keeps pointing at linen_items, so nothing in
// the stock arithmetic changes. Without Asset Inventory, Laundry keeps its own
// list as before.
// ---------------------------------------------------------------------------

async function linenManagedInAssets(lodgeId) {
  const pool = await getPool();
  const result = await pool.request().input('lodgeId', sql.BigInt, lodgeId).query('SELECT has_assets FROM dbo.lodges WHERE id = @lodgeId');
  return !!result.recordset[0]?.has_assets;
}

async function syncLinenFromAssets(pool, lodgeId) {
  if (!(await linenManagedInAssets(lodgeId))) return;

  // Is there anything to link? Asked first and without a lock, because the
  // answer is almost always no and this runs on every load of the screen.
  const pending = await pool
    .request()
    .input('lodgeId', sql.BigInt, lodgeId)
    .query(`
      SELECT
        (SELECT COUNT(*) FROM dbo.linen_items WHERE lodge_id = @lodgeId AND asset_id IS NULL) AS unregistered,
        (SELECT COUNT(*) FROM dbo.assets a JOIN dbo.asset_categories c ON c.id = a.category_id
         WHERE a.lodge_id = @lodgeId AND c.is_linen = 1
           AND NOT EXISTS (SELECT 1 FROM dbo.linen_items i WHERE i.asset_id = a.id)) AS unlinked
    `);
  const { unregistered, unlinked } = pending.recordset[0];

  if (unregistered > 0 || unlinked > 0) {
    const transaction = new sql.Transaction(pool);
    await transaction.begin();
    try {
      // One screen at a time per property: two opening together would each
      // register the same linen as an asset.
      await new sql.Request(transaction)
        .input('resource', sql.NVarChar, `linen-sync-${lodgeId}`)
        .query("EXEC sp_getapplock @Resource = @resource, @LockMode = 'Exclusive', @LockOwner = 'Transaction', @LockTimeout = 15000");

      // Linen added in Laundry before Asset Inventory took it over.
      const legacy = await new sql.Request(transaction)
        .input('lodgeId', sql.BigInt, lodgeId)
        .query('SELECT id, name, total_owned FROM dbo.linen_items WHERE lodge_id = @lodgeId AND asset_id IS NULL');
      if (legacy.recordset.length > 0) {
        const categoryId = await assetsService.ensureLinenCategory(transaction, lodgeId);
        for (const item of legacy.recordset) {
          const assetId = await assetsService.registerLinenAsset(transaction, lodgeId, categoryId, { name: item.name, quantity: item.total_owned });
          await new sql.Request(transaction)
            .input('id', sql.BigInt, item.id)
            .input('assetId', sql.BigInt, assetId)
            .input('lodgeId', sql.BigInt, lodgeId)
            .query('UPDATE dbo.linen_items SET asset_id = @assetId WHERE id = @id AND lodge_id = @lodgeId');
        }
      }

      // Linen registered in Asset Inventory that Laundry has not seen yet.
      await new sql.Request(transaction)
        .input('lodgeId', sql.BigInt, lodgeId)
        .query(`
          INSERT INTO dbo.linen_items (lodge_id, name, total_owned, asset_id)
          SELECT a.lodge_id, LEFT(a.name, 80), ISNULL(a.quantity, 0), a.id
          FROM dbo.assets a
          JOIN dbo.asset_categories c ON c.id = a.category_id
          WHERE a.lodge_id = @lodgeId AND c.is_linen = 1
            AND NOT EXISTS (SELECT 1 FROM dbo.linen_items i WHERE i.asset_id = a.id)
        `);
      await transaction.commit();
    } catch (err) {
      await transaction.rollback();
      throw err;
    }
  }

  // The asset is the record: its name and count are what Laundry shows, and an
  // asset that is retired, deleted or moved out of the category drops out.
  await pool
    .request()
    .input('lodgeId', sql.BigInt, lodgeId)
    .query(`
      UPDATE i
      SET i.name = LEFT(a.name, 80),
          i.total_owned = ISNULL(a.quantity, 0),
          i.is_active = CASE WHEN a.is_active = 1 AND a.status <> 'RETIRED' AND c.is_linen = 1 THEN 1 ELSE 0 END
      FROM dbo.linen_items i
      JOIN dbo.assets a ON a.id = i.asset_id
      JOIN dbo.asset_categories c ON c.id = a.category_id
      WHERE i.lodge_id = @lodgeId
    `);
}

async function listLinen(lodgeId) {
  const pool = await getPool();
  await syncLinenFromAssets(pool, lodgeId);
  const result = await pool
    .request()
    .input('lodgeId', sql.BigInt, lodgeId)
    .query(`
      SELECT i.id, i.name, i.total_owned, i.is_active,
             SUM(CASE WHEN m.kind = 'CHANGED' AND m.handover_at IS NOT NULL THEN m.quantity ELSE 0 END) AS changed,
             SUM(CASE WHEN m.kind = 'CHANGED' AND m.handover_at IS NULL THEN m.quantity ELSE 0 END) AS pending,
             SUM(CASE WHEN m.kind = 'SENT' THEN m.quantity ELSE 0 END) AS sent,
             SUM(CASE WHEN m.kind = 'RECEIVED' THEN m.quantity ELSE 0 END) AS received,
             SUM(CASE WHEN m.kind IN ('LOST', 'DAMAGED') AND m.source = 'LAUNDRY' THEN m.quantity ELSE 0 END) AS lost_laundry,
             SUM(CASE WHEN m.kind IN ('LOST', 'DAMAGED') THEN m.quantity ELSE 0 END) AS lost_all
      FROM dbo.linen_items i
      LEFT JOIN dbo.linen_movements m ON m.linen_item_id = i.id AND m.lodge_id = i.lodge_id
      WHERE i.lodge_id = @lodgeId
      GROUP BY i.id, i.name, i.total_owned, i.is_active
      ORDER BY i.name
    `);
  return result.recordset.map((row) => ({
    id: row.id,
    name: row.name,
    totalOwned: row.total_owned,
    isActive: !!row.is_active,
    ...linenStockOf(row),
  }));
}

// Linen changed in rooms that housekeeping has not handed over yet, one entry
// per room finish, oldest first: the laundry receives what has waited longest.
async function listHandovers(lodgeId) {
  const pool = await getPool();
  const result = await pool
    .request()
    .input('lodgeId', sql.BigInt, lodgeId)
    .query(`
      SELECT m.id, m.log_id, m.quantity, m.created_at, m.created_by, i.name AS item_name, r.room_number, v.name AS venue_name,
             u.name AS user_name
      FROM dbo.linen_movements m
      JOIN dbo.linen_items i ON i.id = m.linen_item_id
      LEFT JOIN dbo.rooms r ON r.id = m.room_id
      LEFT JOIN dbo.event_venues v ON v.id = m.venue_id
      LEFT JOIN dbo.users u ON u.id = m.created_by
      WHERE m.lodge_id = @lodgeId AND m.kind = 'CHANGED' AND m.handover_at IS NULL
      ORDER BY m.created_at ASC, m.id ASC
    `);
  const entries = new Map();
  for (const row of result.recordset) {
    const key = row.log_id != null ? `log-${row.log_id}` : `move-${row.id}`;
    const entry = entries.get(key) ?? {
      key,
      roomNumber: row.room_number ?? null,
      venueName: row.venue_name ?? null,
      changedBy: row.user_name ?? null,
      // The laundry receives from one person at a time, so entries group by this.
      changedById: row.created_by ?? null,
      changedAt: row.created_at,
      movementIds: [],
      lines: [],
    };
    entry.movementIds.push(row.id);
    entry.lines.push({ name: row.item_name, quantity: row.quantity });
    entries.set(key, entry);
  }
  return [...entries.values()];
}

// The laundry has the linen in hand. From here it is dirty stock it can send
// for washing. The guard on "not yet received" makes a second tap a no-op.
async function receiveHandovers(lodgeId, userId, movementIds) {
  const pool = await getPool();
  const request = pool.request().input('lodgeId', sql.BigInt, lodgeId).input('userId', sql.BigInt, userId ?? null);
  movementIds.forEach((id, i) => request.input(`m${i}`, sql.BigInt, id));
  const result = await request.query(`
    UPDATE dbo.linen_movements
    SET handover_at = SYSDATETIMEOFFSET(), handover_by = @userId
    WHERE lodge_id = @lodgeId AND kind = 'CHANGED' AND handover_at IS NULL
      AND id IN (${movementIds.map((_, i) => `@m${i}`).join(', ')})
  `);
  if (result.rowsAffected[0] === 0) throw new ApiError('That linen was already received.', 409);
}

// "Towel" and "towel" are the same thing. A second copy would split one stock
// across two rows that can never be reconciled.
async function assertLinenNameFree(pool, lodgeId, name, exceptId = null) {
  const found = await pool
    .request()
    .input('lodgeId', sql.BigInt, lodgeId)
    .input('name', sql.NVarChar, name)
    .input('exceptId', sql.BigInt, exceptId)
    .query(`
      SELECT TOP 1 name, is_active FROM dbo.linen_items
      WHERE lodge_id = @lodgeId AND LOWER(name) = LOWER(@name) AND (@exceptId IS NULL OR id <> @exceptId)
    `);
  if (found.recordset.length > 0) {
    const hidden = !found.recordset[0].is_active;
    throw new ApiError(
      hidden
        ? `${found.recordset[0].name} is already in your list but hidden. Bring it back instead of adding it again.`
        : `You already have ${found.recordset[0].name}.`,
      409
    );
  }
}

// Refused where Asset Inventory holds the linen: a second list kept here
// would drift from the one the owner maintains.
async function assertLinenEditableHere(lodgeId) {
  if (await linenManagedInAssets(lodgeId)) {
    throw new ApiError('Linen is kept in Asset Inventory, under the Bedsheets & Towels category. Add or change it there.', 409);
  }
}

async function createLinenItem(lodgeId, input) {
  await assertLinenEditableHere(lodgeId);
  const pool = await getPool();
  await assertLinenNameFree(pool, lodgeId, input.name);
  await pool
    .request()
    .input('lodgeId', sql.BigInt, lodgeId)
    .input('name', sql.NVarChar, input.name)
    .input('owned', sql.Int, input.totalOwned)
    .query('INSERT INTO dbo.linen_items (lodge_id, name, total_owned) VALUES (@lodgeId, @name, @owned)');
}

async function updateLinenItem(lodgeId, id, input) {
  await assertLinenEditableHere(lodgeId);
  const pool = await getPool();
  if (input.name !== undefined) await assertLinenNameFree(pool, lodgeId, input.name, id);
  const request = pool.request().input('lodgeId', sql.BigInt, lodgeId).input('id', sql.BigInt, id);
  const sets = [];
  if (input.name !== undefined) {
    request.input('name', sql.NVarChar, input.name);
    sets.push('name = @name');
  }
  if (input.totalOwned !== undefined) {
    request.input('owned', sql.Int, input.totalOwned);
    sets.push('total_owned = @owned');
  }
  if (input.isActive !== undefined) {
    request.input('active', sql.Bit, input.isActive ? 1 : 0);
    sets.push('is_active = @active');
  }
  if (sets.length === 0) throw new ApiError('Nothing to update.', 400);
  const result = await request.query(`UPDATE dbo.linen_items SET ${sets.join(', ')} WHERE id = @id AND lodge_id = @lodgeId`);
  if (result.rowsAffected[0] === 0) throw new ApiError('Linen item not found.', 404);
}

async function addMovements(lodgeId, userId, rows) {
  const pool = await getPool();
  await assertLinenItems(pool.request(), lodgeId, rows.map((r) => r.linenItemId));
  const transaction = new sql.Transaction(pool);
  await transaction.begin();
  // Collects the id each inserted row got, so the own-linen vendor cost can
  // be logged as an expense (linked by linen_movement_id) once this commits.
  const inserted = [];
  try {
    for (const r of rows) {
      const result = await new sql.Request(transaction)
        .input('lodgeId', sql.BigInt, lodgeId)
        .input('itemId', sql.BigInt, r.linenItemId)
        .input('kind', sql.NVarChar, r.kind)
        .input('source', sql.NVarChar, r.source ?? null)
        .input('qty', sql.Int, r.quantity)
        .input('note', sql.NVarChar, r.note || null)
        .input('washedBy', sql.NVarChar, r.washedBy || null)
        .input('washCharge', sql.Decimal(10, 2), r.washCharge ?? null)
        .input('userId', sql.BigInt, userId ?? null)
        .query(`
          INSERT INTO dbo.linen_movements (lodge_id, linen_item_id, kind, source, quantity, note, washed_by, wash_charge, created_by)
          OUTPUT inserted.id
          VALUES (@lodgeId, @itemId, @kind, @source, @qty, @note, @washedBy, @washCharge, @userId)
        `);
      inserted.push({ id: result.recordset[0].id, washedBy: r.washedBy, washCharge: r.washCharge });
    }
    await transaction.commit();
  } catch (err) {
    await transaction.rollback();
    throw err;
  }

  // Outside-vendor cost for the hotel's own linen, logged the same way a
  // guest order's vendor price is in setLaundryStatus — best-effort, after
  // commit, one at a time (not Promise.all) so two rows for the same lodge
  // don't race resolveLaundryExpenseCategoryId's find-or-create.
  const today = new Date().toISOString().slice(0, 10);
  for (const row of inserted) {
    const washedBy = (row.washedBy || '').trim();
    if (!washedBy || washedBy.toLowerCase() === OWN_LAUNDRY || !row.washCharge) continue;
    await expensesService
      .logLaundryExpense(lodgeId, {
        linenMovementId: row.id,
        title: `Linen wash: ${washedBy}`,
        amount: row.washCharge,
        expenseDate: today,
      })
      .catch(() => {});
  }
}

// A batch can only hold linen that exists. Without this the board happily showed
// 31 sheets at the laundry for a lodge that owns 24.
async function stockById(lodgeId) {
  return new Map((await listLinen(lodgeId)).map((i) => [String(i.id), i]));
}

async function sendToLaundry(lodgeId, userId, input) {
  const stock = await stockById(lodgeId);
  for (const l of input.lines) {
    const item = stock.get(String(l.linenItemId));
    if (!item) continue; // an unknown id is rejected by addMovements below
    const available = item.dirty + item.clean;
    if (l.quantity > available) {
      throw new ApiError(
        `Only ${available} ${item.name} ${available === 1 ? 'is' : 'are'} here to send. Check how many you own, or lower the count.`,
        409
      );
    }
  }
  // The charge is for the batch, so it rides on the first row only.
  await addMovements(
    lodgeId,
    userId,
    input.lines.map((l, i) => ({ ...l, kind: 'SENT', note: input.note, washedBy: input.washedBy, washCharge: i === 0 ? (input.charge ?? null) : null }))
  );
}

// What came back, and what did not: a shortfall is recorded as lost or damaged
// at the laundry so the stock board stays true.
async function receiveFromLaundry(lodgeId, userId, input) {
  const stock = await stockById(lodgeId);
  for (const l of input.lines) {
    const item = stock.get(String(l.linenItemId));
    if (item && l.received + l.lost + l.damaged > item.inLaundry) {
      throw new ApiError(`Only ${item.inLaundry} ${item.name} ${item.inLaundry === 1 ? 'is' : 'are'} in the wash.`, 409);
    }
  }
  const rows = [];
  const batch = { note: input.note, washedBy: input.washedBy };
  for (const l of input.lines) {
    if (l.received > 0) rows.push({ linenItemId: l.linenItemId, kind: 'RECEIVED', quantity: l.received, ...batch });
    if (l.lost > 0) rows.push({ linenItemId: l.linenItemId, kind: 'LOST', source: 'LAUNDRY', quantity: l.lost, ...batch });
    if (l.damaged > 0) rows.push({ linenItemId: l.linenItemId, kind: 'DAMAGED', source: 'LAUNDRY', quantity: l.damaged, ...batch });
  }
  if (rows.length === 0) throw new ApiError('Enter at least one count.', 400);
  // The charge is for the batch, so it rides on the first row only.
  rows[0].washCharge = input.charge ?? null;
  await addMovements(lodgeId, userId, rows);
}

// A loss from the room or store, not at the laundry.
async function recordLoss(lodgeId, userId, input) {
  await assertLinenAvailable(lodgeId, [input]);
  await addMovements(lodgeId, userId, [{ linenItemId: input.linenItemId, kind: input.kind, source: 'STORE', quantity: input.quantity, note: input.note }]);
}

async function listLinenMovements(lodgeId) {
  const pool = await getPool();
  const result = await pool
    .request()
    .input('lodgeId', sql.BigInt, lodgeId)
    .query(`
      SELECT TOP 200 m.id, m.kind, m.source, m.quantity, m.note, m.washed_by, m.wash_charge, m.created_at, i.name AS item_name, r.room_number,
             v.name AS venue_name, u.name AS user_name
      FROM dbo.linen_movements m
      JOIN dbo.linen_items i ON i.id = m.linen_item_id
      LEFT JOIN dbo.rooms r ON r.id = m.room_id
      LEFT JOIN dbo.event_venues v ON v.id = m.venue_id
      LEFT JOIN dbo.users u ON u.id = m.created_by
      WHERE m.lodge_id = @lodgeId
      ORDER BY m.created_at DESC, m.id DESC
    `);
  return result.recordset.map((row) => ({
    id: row.id,
    kind: row.kind,
    source: row.source,
    quantity: row.quantity,
    note: row.note,
    washedBy: row.washed_by ?? null,
    washCharge: row.wash_charge == null ? null : Number(row.wash_charge),
    createdAt: row.created_at,
    itemName: row.item_name,
    roomNumber: row.room_number ?? null,
    venueName: row.venue_name ?? null,
    userName: row.user_name ?? null,
  }));
}

// Who washed the last batch — the outside laundry's name, or "Own laundry" — so
// the next Send or Receive opens with it already filled in.
async function lastWashedBy(lodgeId) {
  const pool = await getPool();
  const result = await pool
    .request()
    .input('lodgeId', sql.BigInt, lodgeId)
    .query('SELECT TOP 1 washed_by FROM dbo.linen_movements WHERE lodge_id = @lodgeId AND washed_by IS NOT NULL ORDER BY id DESC');
  return result.recordset[0]?.washed_by ?? '';
}

// ---------------------------------------------------------------------------
// Guest laundry — a tagged order of garments. Delivered writes completed
// service uses, which the existing Services to bill flow takes from there.
// ---------------------------------------------------------------------------

// An order is in the wash (WASHING) from the moment it is taken in, comes back
// from the wash (READY), and is then handed to the guest (DELIVERED). RECEIVED
// is a stage the desk no longer uses; an order still sitting in it can move on.
const NEXT_STATUS = {
  RECEIVED: ['WASHING', 'READY', 'DELIVERED', 'CANCELLED'],
  WASHING: ['READY', 'DELIVERED', 'CANCELLED'],
  READY: ['DELIVERED', 'CANCELLED'],
};

// There is no price list. Each laundry entry is priced when the clothes are taken
// in; this only remembers what was typed before, so the form can offer the same
// garment at the price last used. Newest price wins, names compared ignoring case.
async function listRecentGarments(lodgeId) {
  const pool = await getPool();
  const result = await pool
    .request()
    .input('lodgeId', sql.BigInt, lodgeId)
    .query(`
      SELECT TOP 40 item_name, unit_price FROM (
        SELECT i.item_name, i.unit_price,
               ROW_NUMBER() OVER (PARTITION BY LOWER(i.item_name) ORDER BY i.id DESC) AS rn
        FROM dbo.laundry_order_items i
        JOIN dbo.laundry_orders o ON o.id = i.order_id
        WHERE o.lodge_id = @lodgeId
      ) x
      WHERE rn = 1
      ORDER BY item_name
    `);
  return result.recordset.map((row) => ({ name: row.item_name, price: Number(row.unit_price) }));
}

// Laundry is a service sold at the lodge's usual service tax rate. It is not asked
// at the desk — staff should not have to think about GST while taking in a bag.
// A property that is not GST registered bills these on a cash receipt with no tax.
const LAUNDRY_GST_RATE = 18;

// Guests staying right now, per room — what a housekeeping login needs to pick
// a guest without being given billing access.
async function listInHouse(lodgeId) {
  const pool = await getPool();
  const result = await pool
    .request()
    .input('lodgeId', sql.BigInt, lodgeId)
    .query(`
      SELECT b.id AS booking_id, br.room_id, r.room_number, b.guest_name
      FROM dbo.booking_rooms br
      JOIN dbo.bookings b ON b.id = br.booking_id
      JOIN dbo.rooms r ON r.id = br.room_id
      WHERE b.lodge_id = @lodgeId AND br.status = 'CHECKED_IN'
      ORDER BY r.room_number
    `);
  return result.recordset.map((row) => ({
    bookingId: row.booking_id,
    roomId: row.room_id,
    roomNumber: row.room_number,
    guestName: row.guest_name,
  }));
}

async function createLaundryOrder(lodgeId, userId, input) {
  const pool = await getPool();
  const transaction = new sql.Transaction(pool);
  await transaction.begin();
  try {
    let roomId = null;
    let guestName = input.guestName || null;
    let guestPhone = input.guestPhone || null;
    if (input.bookingId) {
      const stay = await new sql.Request(transaction)
        .input('lodgeId', sql.BigInt, lodgeId)
        .input('bookingId', sql.BigInt, input.bookingId)
        .input('roomId', sql.BigInt, input.roomId ?? null)
        .query(`
          SELECT TOP 1 br.room_id, b.guest_name, b.guest_phone
          FROM dbo.booking_rooms br
          JOIN dbo.bookings b ON b.id = br.booking_id
          WHERE b.id = @bookingId AND b.lodge_id = @lodgeId AND br.status = 'CHECKED_IN'
            AND (@roomId IS NULL OR br.room_id = @roomId)
          ORDER BY br.room_id
        `);
      if (stay.recordset.length === 0) throw new ApiError('That guest is not checked in.', 409);
      roomId = stay.recordset[0].room_id;
      guestName = guestName || stay.recordset[0].guest_name;
      guestPhone = guestPhone || stay.recordset[0].guest_phone;
    } else if (!guestName) {
      throw new ApiError('Enter the customer’s name, or choose a guest staying in-house.', 400);
    }

    // Per-lodge running tag, taken under a lock so two desks never share one.
    const tag = await new sql.Request(transaction)
      .input('lodgeId', sql.BigInt, lodgeId)
      .query('SELECT ISNULL(MAX(tag_number), 0) + 1 AS n FROM dbo.laundry_orders WITH (UPDLOCK, HOLDLOCK) WHERE lodge_id = @lodgeId');
    const tagNumber = tag.recordset[0].n;

    const order = await new sql.Request(transaction)
      .input('lodgeId', sql.BigInt, lodgeId)
      .input('tag', sql.Int, tagNumber)
      .input('roomId', sql.BigInt, roomId)
      .input('bookingId', sql.BigInt, input.bookingId ?? null)
      .input('guestName', sql.NVarChar, guestName)
      .input('guestPhone', sql.NVarChar, guestPhone)
      .input('note', sql.NVarChar, input.note || null)
      .input('washedBy', sql.NVarChar, input.washedBy || null)
      .input('vendorPhone', sql.NVarChar, input.vendorPhone || null)
      .input('washCharge', sql.Decimal(10, 2), input.charge ?? null)
      .input('userId', sql.BigInt, userId ?? null)
      .query(`
        INSERT INTO dbo.laundry_orders (lodge_id, tag_number, room_id, booking_id, guest_name, guest_phone, note, status, washed_by, vendor_phone, wash_charge, created_by)
        OUTPUT inserted.id
        VALUES (@lodgeId, @tag, @roomId, @bookingId, @guestName, @guestPhone, @note, 'WASHING', @washedBy, @vendorPhone, @washCharge, @userId)
      `);
    const orderId = order.recordset[0].id;

    // Priced as typed at the desk. Same garment twice in one entry is two lines,
    // which is what the guest was told, so it is not merged.
    for (const item of input.items) {
      await new sql.Request(transaction)
        .input('orderId', sql.BigInt, orderId)
        .input('name', sql.NVarChar, item.name)
        .input('price', sql.Decimal(10, 2), item.price)
        .input('gst', sql.Decimal(5, 2), LAUNDRY_GST_RATE)
        .input('qty', sql.Int, item.quantity)
        .query(`
          INSERT INTO dbo.laundry_order_items (order_id, service_id, item_name, unit_label, unit_price, gst_rate_percent, quantity)
          VALUES (@orderId, NULL, @name, 'piece', @price, @gst, @qty)
        `);
    }
    await transaction.commit();
    return getLaundryOrder(lodgeId, orderId);
  } catch (err) {
    await transaction.rollback();
    throw err;
  }
}

function mapOrder(row, items) {
  const lines = (items ?? []).map((i) => ({
    id: i.id,
    name: i.item_name,
    quantity: i.quantity,
    unitPrice: Number(i.unit_price),
    lineTotal: Math.round(Number(i.unit_price) * i.quantity * 100) / 100,
  }));
  return {
    id: row.id,
    tagNumber: row.tag_number,
    status: row.status,
    roomNumber: row.room_number ?? null,
    guestName: row.guest_name,
    guestPhone: row.guest_phone,
    note: row.note,
    washedBy: row.washed_by ?? null,
    vendorPhone: row.vendor_phone ?? null,
    washCharge: row.wash_charge == null ? null : Number(row.wash_charge),
    washedBackAt: row.washed_back_at ?? null,
    receivedAt: row.received_at,
    deliveredAt: row.delivered_at,
    pieces: lines.reduce((n, l) => n + l.quantity, 0),
    total: Math.round(lines.reduce((n, l) => n + l.lineTotal, 0) * 100) / 100,
    items: lines,
  };
}

async function loadOrders(lodgeId, where) {
  const pool = await getPool();
  const orders = await pool
    .request()
    .input('lodgeId', sql.BigInt, lodgeId)
    .query(`
      SELECT TOP 200 o.id, o.tag_number, o.status, o.guest_name, o.guest_phone, o.note, o.received_at, o.delivered_at,
             o.washed_by, o.vendor_phone, o.wash_charge, o.washed_back_at, r.room_number
      FROM dbo.laundry_orders o
      LEFT JOIN dbo.rooms r ON r.id = o.room_id
      WHERE o.lodge_id = @lodgeId AND ${where}
      ORDER BY o.received_at DESC
    `);
  if (orders.recordset.length === 0) return [];
  const itemsRequest = pool.request();
  orders.recordset.forEach((o, i) => itemsRequest.input(`o${i}`, sql.BigInt, o.id));
  const items = await itemsRequest.query(`
    SELECT id, order_id, item_name, quantity, unit_price FROM dbo.laundry_order_items
    WHERE order_id IN (${orders.recordset.map((_, i) => `@o${i}`).join(', ')}) ORDER BY id
  `);
  const byOrder = new Map();
  for (const item of items.recordset) byOrder.set(String(item.order_id), [...(byOrder.get(String(item.order_id)) ?? []), item]);
  return orders.recordset.map((o) => mapOrder(o, byOrder.get(String(o.id))));
}

async function getLaundryOrder(lodgeId, id) {
  const orders = await loadOrders(lodgeId, `o.id = ${Number(id)}`);
  if (orders.length === 0) throw new ApiError('Laundry order not found.', 404);
  return orders[0];
}

// 'open' = still with us; anything else = the most recent of every kind.
const listLaundryOrders = (lodgeId, scope) =>
  loadOrders(lodgeId, scope === 'open' ? "o.status IN ('RECEIVED', 'WASHING', 'READY')" : '1 = 1');

// What the lodge's own laundry is recorded as. Anything else is an outside vendor.
const OWN_LAUNDRY = 'own laundry';

async function setLaundryStatus(lodgeId, userId, id, { status, washedBy = '', vendorPhone = '', charge = null, items = [] }) {
  // Receiving from an outside vendor is where their name and price are settled:
  // the lodge is about to owe that money, so neither can be left blank.
  if (status === 'READY' && washedBy.trim().toLowerCase() !== OWN_LAUNDRY) {
    if (!washedBy.trim()) throw new ApiError('Enter the vendor’s name, or choose Own laundry.', 400);
    if (charge == null) throw new ApiError('Enter the vendor’s price.', 400);
  }
  const pool = await getPool();
  const current = await pool
    .request()
    .input('lodgeId', sql.BigInt, lodgeId)
    .input('id', sql.BigInt, id)
    .query('SELECT status FROM dbo.laundry_orders WHERE id = @id AND lodge_id = @lodgeId');
  if (current.recordset.length === 0) throw new ApiError('Laundry order not found.', 404);
  const from = current.recordset[0].status;
  if (!(NEXT_STATUS[from] ?? []).includes(status)) {
    throw new ApiError(`This order is ${from.toLowerCase()} and cannot move to ${status.toLowerCase()}.`, 409);
  }

  const transaction = new sql.Transaction(pool);
  await transaction.begin();
  // Declared outside the try so the tag_number from OUTPUT is still reachable
  // below for the post-commit expense log, not just inside the try block.
  let moved;
  try {
    // The guard on the old status is what stops two people delivering the same
    // order and billing it twice.
    moved = await new sql.Request(transaction)
      .input('id', sql.BigInt, id)
      .input('from', sql.NVarChar, from)
      .input('to', sql.NVarChar, status)
      .input('washedBy', sql.NVarChar, washedBy || null)
      .input('vendorPhone', sql.NVarChar, vendorPhone || null)
      .input('washCharge', sql.Decimal(10, 2), charge ?? null)
      .query(`
        UPDATE dbo.laundry_orders
        SET status = @to, delivered_at = CASE WHEN @to = 'DELIVERED' THEN SYSDATETIMEOFFSET() ELSE delivered_at END,
            -- Who washed it and for how much is confirmed as it comes back.
            washed_by = CASE WHEN @to = 'READY' THEN @washedBy ELSE washed_by END,
            vendor_phone = CASE WHEN @to = 'READY' THEN @vendorPhone ELSE vendor_phone END,
            wash_charge = CASE WHEN @to = 'READY' THEN @washCharge ELSE wash_charge END,
            washed_back_at = CASE WHEN @to = 'READY' THEN SYSDATETIMEOFFSET() ELSE washed_back_at END
        OUTPUT inserted.tag_number, inserted.room_id, inserted.booking_id, inserted.guest_name, inserted.guest_phone
        WHERE id = @id AND status = @from
      `);
    if (moved.recordset.length === 0) throw new ApiError('Someone else just changed this order.', 409);

    // Prices put right as the clothes come back. The guest is billed from these
    // lines at hand-over, so this is the last point they can be changed. The
    // order id in the WHERE keeps a line of some other order out of reach.
    if (status === 'READY') {
      for (const item of items) {
        await new sql.Request(transaction)
          .input('orderId', sql.BigInt, id)
          .input('itemId', sql.BigInt, item.id)
          .input('price', sql.Decimal(10, 2), item.price)
          .query('UPDATE dbo.laundry_order_items SET unit_price = @price WHERE id = @itemId AND order_id = @orderId');
      }
    }

    if (status === 'DELIVERED') {
      const order = moved.recordset[0];
      const items = await new sql.Request(transaction)
        .input('id', sql.BigInt, id)
        .query('SELECT service_id, item_name, unit_label, unit_price, gst_rate_percent, quantity FROM dbo.laundry_order_items WHERE order_id = @id');
      for (const item of items.recordset) {
        await new sql.Request(transaction)
          .input('lodgeId', sql.BigInt, lodgeId)
          .input('serviceId', sql.BigInt, item.service_id)
          .input('name', sql.NVarChar, item.item_name)
          .input('unit', sql.NVarChar, item.unit_label)
          .input('price', sql.Decimal(10, 2), item.unit_price)
          .input('gst', sql.Decimal(5, 2), item.gst_rate_percent)
          .input('qty', sql.Decimal(8, 2), item.quantity)
          .input('total', sql.Decimal(10, 2), Math.round(Number(item.unit_price) * item.quantity * 100) / 100)
          .input('roomId', sql.BigInt, order.room_id)
          .input('bookingId', sql.BigInt, order.booking_id)
          .input('guestName', sql.NVarChar, order.guest_name)
          .input('guestPhone', sql.NVarChar, order.guest_phone)
          .input('note', sql.NVarChar, `Laundry tag ${order.tag_number}`)
          .input('userId', sql.BigInt, userId ?? null)
          .input('orderId', sql.BigInt, id)
          .query(`
            INSERT INTO dbo.service_usages
              (lodge_id, service_id, service_name, unit_label, unit_price, gst_rate_percent, quantity, line_total,
               room_id, booking_id, guest_name, guest_phone, note, status, completed_at, created_by, laundry_order_id)
            VALUES (@lodgeId, @serviceId, @name, @unit, @price, @gst, @qty, @total,
                    @roomId, @bookingId, @guestName, @guestPhone, @note, 'COMPLETED', SYSDATETIMEOFFSET(), @userId, @orderId)
          `);
      }
    }
    await transaction.commit();
  } catch (err) {
    await transaction.rollback();
    throw err;
  }

  // Outside-vendor price, logged as a real expense now that it's settled —
  // best-effort and after commit, same placement as logAssetExpenseQuietly
  // in assets.service.js, so a logging hiccup never fails the status change.
  if (status === 'READY' && washedBy.trim().toLowerCase() !== OWN_LAUNDRY && charge != null) {
    const tagNumber = moved.recordset[0].tag_number;
    expensesService
      .logLaundryExpense(lodgeId, {
        laundryOrderId: id,
        title: `Laundry vendor: ${washedBy.trim()} (Tag #${tagNumber})`,
        amount: charge,
        expenseDate: new Date().toISOString().slice(0, 10),
      })
      .catch(() => {});
  }

  return getLaundryOrder(lodgeId, id);
}

module.exports = {
  roomStatusOf,
  linenStockOf,
  listRooms,
  startCleaning,
  releaseRoom,
  finishCleaning,
  markDirty,
  setOutOfOrder,
  listVenues,
  startVenueCleaning,
  releaseVenue,
  finishVenueCleaning,
  markVenueDirty,
  setVenueOutOfOrder,
  listIssues,
  openIssueSummary,
  closeIssue,
  listLinen,
  linenManagedInAssets,
  createLinenItem,
  updateLinenItem,
  sendToLaundry,
  receiveFromLaundry,
  recordLoss,
  listLinenMovements,
  listHandovers,
  receiveHandovers,
  lastWashedBy,
  listRecentGarments,
  listInHouse,
  createLaundryOrder,
  listLaundryOrders,
  setLaundryStatus,
};
