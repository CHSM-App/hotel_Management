const path = require('path');
const fs = require('fs');
const {
  DATE_RE,
  createBookingSchema,
  checkInSchema,
  updateBookingSchema,
  checkOutSchema,
} = require('./bookings.schema');
const bookingsService = require('./bookings.service');
const pricingService = require('../pricing/pricing.service');
const { ApiError } = require('../../middleware/errorHandler');
const { UPLOAD_DIR } = require('../../middleware/idProofUpload');

// "3,5:2" — one of charge 3, two of charge 5. A bare id keeps meaning one,
// which is every link and bookmark that predates counts.
const parseChargeIds = pricingService.parseChargeSelections;

// A quote is a preview, so a half-typed or absent override just falls back to
// the category price rather than erroring at the guest-facing desk. The real
// validation happens in the schema when the booking is actually saved.
function parseBasePriceOverride(raw) {
  if (raw == null || String(raw).trim() === '') return null;
  const value = Number(raw);
  return Number.isFinite(value) && value > 0 ? value : null;
}

function parseDateRange(query) {
  const checkInDate = String(query.checkInDate || '');
  const checkOutDate = String(query.checkOutDate || '');
  if (!DATE_RE.test(checkInDate) || !DATE_RE.test(checkOutDate)) {
    throw new ApiError('Choose a valid date range.', 400);
  }
  if (checkOutDate <= checkInDate) {
    throw new ApiError('Check-out date must be after check-in date.', 400);
  }
  return { checkInDate, checkOutDate };
}

function parseFromToRange(query) {
  const fromDate = String(query.fromDate || '');
  const toDate = String(query.toDate || '');
  if (!DATE_RE.test(fromDate) || !DATE_RE.test(toDate) || toDate < fromDate) {
    throw new ApiError('Choose a valid date range.', 400);
  }
  return { fromDate, toDate };
}

async function listAvailableRoomsHandler(req, res, next) {
  try {
    const { checkInDate, checkOutDate } = parseDateRange(req.query);
    const rooms = await bookingsService.listAvailableRooms(req.user.lodgeId, checkInDate, checkOutDate);
    res.json({ rooms });
  } catch (err) {
    next(err);
  }
}

async function listAvailableRoomsForBookingHandler(req, res, next) {
  try {
    const checkOutDate = String(req.query.checkOutDate || '');
    if (!DATE_RE.test(checkOutDate)) {
      throw new ApiError('Choose a valid check-out date.', 400);
    }
    const result = await bookingsService.listAvailableRoomsForBooking(
      req.user.lodgeId,
      Number(req.params.id),
      checkOutDate
    );
    res.json(result);
  } catch (err) {
    next(err);
  }
}

async function listBookingsHandler(req, res, next) {
  try {
    const filter = req.query.fromDate || req.query.toDate ? parseFromToRange(req.query) : {};
    const bookings = await bookingsService.listBookings(req.user.lodgeId, filter);
    res.json({ bookings });
  } catch (err) {
    next(err);
  }
}

async function priceQuoteHandler(req, res, next) {
  try {
    const roomId = Number(req.query.roomId);
    if (!roomId) {
      throw new ApiError('Choose a room.', 400);
    }
    const { checkInDate, checkOutDate } = parseDateRange(req.query);
    const chargeIds = parseChargeIds(req.query.chargeIds);
    const result = await bookingsService.priceStay(
      req.user.lodgeId,
      roomId,
      checkInDate,
      checkOutDate,
      chargeIds,
      parseBasePriceOverride(req.query.basePriceOverride)
    );
    res.json(result);
  } catch (err) {
    next(err);
  }
}

async function getTapeChartHandler(req, res, next) {
  try {
    const startDate = String(req.query.startDate || '');
    const endDate = String(req.query.endDate || '');
    if (!DATE_RE.test(startDate) || !DATE_RE.test(endDate) || endDate <= startDate) {
      throw new ApiError('Choose a valid date range.', 400);
    }
    const result = await bookingsService.getTapeChart(req.user.lodgeId, startDate, endDate);
    res.json(result);
  } catch (err) {
    next(err);
  }
}

async function getBookingHandler(req, res, next) {
  try {
    const booking = await bookingsService.getBooking(req.user.lodgeId, Number(req.params.id));
    res.json({ booking });
  } catch (err) {
    next(err);
  }
}

function parseJsonArrayField(value) {
  if (typeof value !== 'string') return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

// Each additional guest's file arrives as "guestIdProofDocument_<index>",
// matching the position of that guest in the parsed `guests` array.
function attachGuestFiles(guests, files) {
  const guestFileByIndex = new Map();
  for (const file of files) {
    const match = /^guestIdProofDocument_(\d+)$/.exec(file.fieldname);
    if (match) guestFileByIndex.set(Number(match[1]), file.filename);
  }
  return guests.map((guest, index) => ({
    name: guest.name,
    phone: guest.phone || null,
    idProofType: guest.idProofType || null,
    idProofDocument: guestFileByIndex.get(index) || null,
    isChild: Boolean(guest.isChild),
  }));
}

async function createBookingHandler(req, res, next) {
  const files = req.files || [];
  const cleanupUploads = () => {
    for (const file of files) fs.unlink(file.path, () => {});
  };
  try {
    const body = { ...req.body };
    body.switchableCharges = parseJsonArrayField(body.switchableCharges ?? body.switchableChargeIds);
    body.vehicles = parseJsonArrayField(body.vehicles);
    body.guests = parseJsonArrayField(body.guests);

    const parsed = createBookingSchema.safeParse(body);
    if (!parsed.success) {
      throw new ApiError(parsed.error.issues[0].message, 400);
    }

    // A walk-in booking claims its ID proof type up front, so the document
    // must arrive with it. A pre-reservation omits idProofType entirely and
    // defers both to check-in.
    const primaryFile = files.find((file) => file.fieldname === 'idProofDocument');
    if (parsed.data.idProofType && !primaryFile) {
      throw new ApiError('Upload the guest’s ID proof (image or PDF).', 400);
    }

    const result = await bookingsService.createBooking(req.user.lodgeId, req.user.sub, {
      ...parsed.data,
      idProofDocument: primaryFile ? primaryFile.filename : null,
      guests: attachGuestFiles(parsed.data.guests, files),
    });
    res.status(201).json(result);
  } catch (err) {
    cleanupUploads();
    next(err);
  }
}

async function getIdProofHandler(req, res, next) {
  try {
    const filename = await bookingsService.getIdProofFilename(req.user.lodgeId, Number(req.params.id));
    res.sendFile(path.join(UPLOAD_DIR, filename));
  } catch (err) {
    next(err);
  }
}

async function getGuestIdProofHandler(req, res, next) {
  try {
    const filename = await bookingsService.getGuestIdProofFilename(
      req.user.lodgeId,
      Number(req.params.id),
      Number(req.params.guestId)
    );
    res.sendFile(path.join(UPLOAD_DIR, filename));
  } catch (err) {
    next(err);
  }
}

async function checkInHandler(req, res, next) {
  const files = req.files || [];
  const cleanupUploads = () => {
    for (const file of files) fs.unlink(file.path, () => {});
  };
  try {
    const body = { ...req.body };
    body.guests = parseJsonArrayField(body.guests);
    body.vehicles = parseJsonArrayField(body.vehicles);

    const parsed = checkInSchema.safeParse(body);
    if (!parsed.success) {
      throw new ApiError(parsed.error.issues[0].message, 400);
    }

    const primaryFile = files.find((file) => file.fieldname === 'idProofDocument');
    if (parsed.data.idProofType && !primaryFile) {
      throw new ApiError('Upload the guest’s ID proof (image or PDF).', 400);
    }

    const booking = await bookingsService.checkIn(req.user.lodgeId, Number(req.params.id), {
      ...parsed.data,
      idProofDocument: primaryFile ? primaryFile.filename : null,
      guests: attachGuestFiles(parsed.data.guests, files),
    });
    res.json({ booking });
  } catch (err) {
    cleanupUploads();
    next(err);
  }
}

async function updateBookingHandler(req, res, next) {
  try {
    const body = { ...req.body };
    // A client still sending the pre-quantity field means one of each, and
    // must keep its three-way meaning: absent stays absent, [] still clears.
    if (body.switchableCharges === undefined && body.switchableChargeIds !== undefined) {
      body.switchableCharges = body.switchableChargeIds;
    }
    const parsed = updateBookingSchema.safeParse(body);
    if (!parsed.success) {
      throw new ApiError(parsed.error.issues[0].message, 400);
    }
    const booking = await bookingsService.updateBooking(req.user.lodgeId, Number(req.params.id), parsed.data);
    res.json({ booking });
  } catch (err) {
    next(err);
  }
}

// Read before the desk commits to anything: how overdue the stay is and what
// the property's policy suggests that is worth.
async function getLateCheckoutHandler(req, res, next) {
  try {
    const lateCheckout = await bookingsService.getLateCheckout(req.user.lodgeId, Number(req.params.id));
    res.json({ lateCheckout });
  } catch (err) {
    next(err);
  }
}

async function checkOutHandler(req, res, next) {
  try {
    const parsed = checkOutSchema.safeParse(req.body ?? {});
    if (!parsed.success) {
      throw new ApiError(parsed.error.issues[0].message, 400);
    }
    const booking = await bookingsService.checkOut(req.user.lodgeId, Number(req.params.id), parsed.data);
    res.json({ booking });
  } catch (err) {
    next(err);
  }
}

async function cancelBookingHandler(req, res, next) {
  try {
    const booking = await bookingsService.cancelBooking(req.user.lodgeId, Number(req.params.id));
    res.json({ booking });
  } catch (err) {
    next(err);
  }
}

module.exports = {
  listAvailableRoomsHandler,
  listAvailableRoomsForBookingHandler,
  listBookingsHandler,
  priceQuoteHandler,
  getTapeChartHandler,
  getBookingHandler,
  getIdProofHandler,
  getGuestIdProofHandler,
  createBookingHandler,
  checkInHandler,
  updateBookingHandler,
  getLateCheckoutHandler,
  checkOutHandler,
  cancelBookingHandler,
};
