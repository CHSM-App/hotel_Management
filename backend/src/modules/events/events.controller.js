const fs = require('fs');
const path = require('path');
const {
  DATE_RE,
  venueSchema,
  updateVenueSchema,
  addonSchema,
  updateAddonSchema,
  quoteSchema,
  createEventSchema,
  updateEventSchema,
  holdSchema,
  cancelSchema,
  extraSchema,
  priceExtraSchema,
} = require('./events.schema');
const eventsService = require('./events.service');
const advanceReceiptsService = require('../billing/advanceReceipts.service');
const { logger } = require('../../config/logger');
const { ApiError } = require('../../middleware/errorHandler');
const { UPLOAD_DIR: VENUE_IMAGE_DIR, MAX_IMAGES: MAX_VENUE_IMAGES } = require('../../middleware/venueImageUpload');

function parse(schema, body) {
  const parsed = schema.safeParse(body ?? {});
  if (!parsed.success) {
    throw new ApiError(parsed.error.issues[0].message, 400);
  }
  return parsed.data;
}

const idParam = (raw) => {
  const id = Number(raw);
  if (!Number.isInteger(id) || id <= 0) throw new ApiError('Not found.', 404);
  return id;
};

// --- Venues ---------------------------------------------------------------

async function listVenuesHandler(req, res, next) {
  try {
    const venues = await eventsService.listVenues(req.user.lodgeId, {
      includeInactive: req.query.includeInactive === 'true',
    });
    res.json({ venues });
  } catch (err) {
    next(err);
  }
}

// Photos arrive with the venue's fields as multipart (see venueImageUpload);
// multer has already written them to disk by the time this runs, so any
// failure after that point has to take the files with it or they are
// orphans nothing will ever clean up.
const removeUploads = (files) => {
  for (const file of files) fs.unlink(file.path, () => {});
};

async function createVenueHandler(req, res, next) {
  const files = req.files || [];
  try {
    const created = await eventsService.createVenue(req.user.lodgeId, parse(venueSchema, req.body));
    let venue = created;
    if (files.length > 0) {
      await eventsService.addVenueImages(req.user.lodgeId, created.id, files.map((f) => f.filename), MAX_VENUE_IMAGES);
      venue = await eventsService.getVenue(req.user.lodgeId, created.id);
    }
    res.status(201).json({ venue });
  } catch (err) {
    removeUploads(files);
    next(err);
  }
}

async function updateVenueHandler(req, res, next) {
  const files = req.files || [];
  try {
    const venueId = idParam(req.params.id);
    let venue = await eventsService.updateVenue(req.user.lodgeId, venueId, parse(updateVenueSchema, req.body));
    if (files.length > 0) {
      await eventsService.addVenueImages(req.user.lodgeId, venueId, files.map((f) => f.filename), MAX_VENUE_IMAGES);
      venue = await eventsService.getVenue(req.user.lodgeId, venueId);
    }
    res.json({ venue });
  } catch (err) {
    removeUploads(files);
    next(err);
  }
}

async function deleteVenueImageHandler(req, res, next) {
  try {
    const filename = await eventsService.deleteVenueImage(
      req.user.lodgeId,
      idParam(req.params.id),
      idParam(req.params.imageId)
    );
    fs.unlink(path.join(VENUE_IMAGE_DIR, filename), () => {});
    res.status(204).end();
  } catch (err) {
    next(err);
  }
}

// --- Add-on catalogue -------------------------------------------------------

async function listAddonsHandler(req, res, next) {
  try {
    const addons = await eventsService.listAddons(req.user.lodgeId, {
      includeInactive: req.query.includeInactive === 'true',
    });
    res.json({ addons });
  } catch (err) {
    next(err);
  }
}

async function createAddonHandler(req, res, next) {
  try {
    const addon = await eventsService.createAddon(req.user.lodgeId, parse(addonSchema, req.body));
    res.status(201).json({ addon });
  } catch (err) {
    next(err);
  }
}

async function updateAddonHandler(req, res, next) {
  try {
    const addon = await eventsService.updateAddon(
      req.user.lodgeId,
      idParam(req.params.id),
      parse(updateAddonSchema, req.body)
    );
    res.json({ addon });
  } catch (err) {
    next(err);
  }
}

// --- Availability and quoting -----------------------------------------------

async function availabilityHandler(req, res, next) {
  try {
    const venueId = Number(req.query.venueId);
    const startAt = String(req.query.startAt || '');
    const endAt = String(req.query.endAt || '');
    if (!venueId) throw new ApiError('Choose a venue.', 400);
    if (Number.isNaN(Date.parse(startAt)) || Number.isNaN(Date.parse(endAt))) {
      throw new ApiError('Choose when the function starts and ends.', 400);
    }
    if (Date.parse(endAt) <= Date.parse(startAt)) {
      throw new ApiError('The function must end after it starts.', 400);
    }
    const excludeId = req.query.excludeId ? Number(req.query.excludeId) : null;
    const result = await eventsService.checkAvailability(req.user.lodgeId, { venueId, startAt, endAt, excludeId });
    res.json(result);
  } catch (err) {
    next(err);
  }
}

// A POST, like the advance-receipt preview: the quote is priced from a body
// with add-on lines in it, which a query string cannot carry.
async function quoteHandler(req, res, next) {
  try {
    const result = await eventsService.quote(req.user.lodgeId, parse(quoteSchema, req.body));
    res.json(result);
  } catch (err) {
    next(err);
  }
}

// --- Bookings ---------------------------------------------------------------

async function listEventsHandler(req, res, next) {
  try {
    const fromDate = req.query.fromDate ? String(req.query.fromDate) : null;
    const toDate = req.query.toDate ? String(req.query.toDate) : null;
    if ((fromDate && !DATE_RE.test(fromDate)) || (toDate && !DATE_RE.test(toDate))) {
      throw new ApiError('Choose a valid date range.', 400);
    }
    const events = await eventsService.listEventBookings(req.user.lodgeId, {
      fromDate,
      toDate,
      status: req.query.status ? String(req.query.status).toUpperCase() : null,
      venueId: req.query.venueId ? Number(req.query.venueId) : null,
      includeClosed: req.query.includeClosed === 'true',
    });
    res.json({ events });
  } catch (err) {
    next(err);
  }
}

async function getEventHandler(req, res, next) {
  try {
    const event = await eventsService.getEventBooking(req.user.lodgeId, idParam(req.params.id));
    res.json({ event });
  } catch (err) {
    next(err);
  }
}

// A deposit taken as the function is written down is receipted the way the
// detail page would receipt it — same numbering, same paper, same
// confirmation of the function. The function is saved first: money against
// a booking that failed to save is the worse mistake, so if the receipt is
// what fails the desk is told and takes it from the function's page.
async function createEventHandler(req, res, next) {
  try {
    const input = parse(createEventSchema, req.body);
    let event = await eventsService.createEventBooking(req.user.lodgeId, req.user.sub, input);
    let receipt = null;
    let advanceError = null;
    if (Number(input.advanceAmount) > 0) {
      try {
        receipt = await advanceReceiptsService.issueEventAdvanceReceipt(req.user.lodgeId, req.user.sub, event.id, {
          amountReceived: Number(input.advanceAmount),
          paymentMethod: input.advancePaymentMethod ?? input.advanceLines?.[0]?.method,
          paymentReference: input.advanceReference,
          ...(input.advanceLines?.length > 1 ? { paymentLines: input.advanceLines } : {}),
        });
        event = await eventsService.getEventBooking(req.user.lodgeId, event.id);
      } catch (err) {
        logger.error({ err, eventId: event.id, lodgeId: req.user.lodgeId }, 'Could not receipt the advance taken with a new function');
        advanceError = err instanceof ApiError ? err.message : 'The advance could not be recorded.';
      }
    }
    res.status(201).json({ event, receipt, advanceError });
  } catch (err) {
    next(err);
  }
}

async function updateEventHandler(req, res, next) {
  try {
    const event = await eventsService.updateEventBooking(
      req.user.lodgeId,
      idParam(req.params.id),
      parse(updateEventSchema, req.body)
    );
    res.json({ event });
  } catch (err) {
    next(err);
  }
}

// --- Extras noted on the day ------------------------------------------------

async function addExtraHandler(req, res, next) {
  try {
    const event = await eventsService.addExtra(req.user.lodgeId, idParam(req.params.id), parse(extraSchema, req.body));
    res.status(201).json({ event });
  } catch (err) {
    next(err);
  }
}

async function priceExtraHandler(req, res, next) {
  try {
    const event = await eventsService.priceExtra(
      req.user.lodgeId,
      idParam(req.params.id),
      idParam(req.params.lineId),
      parse(priceExtraSchema, req.body)
    );
    res.json({ event });
  } catch (err) {
    next(err);
  }
}

async function removeExtraHandler(req, res, next) {
  try {
    const event = await eventsService.removeExtra(req.user.lodgeId, idParam(req.params.id), idParam(req.params.lineId));
    res.json({ event });
  } catch (err) {
    next(err);
  }
}

async function holdEventHandler(req, res, next) {
  try {
    const event = await eventsService.holdEventBooking(
      req.user.lodgeId,
      idParam(req.params.id),
      parse(holdSchema, req.body)
    );
    res.json({ event });
  } catch (err) {
    next(err);
  }
}

async function confirmEventHandler(req, res, next) {
  try {
    const event = await eventsService.confirmEventBooking(req.user.lodgeId, idParam(req.params.id));
    res.json({ event });
  } catch (err) {
    next(err);
  }
}

async function releaseEventHandler(req, res, next) {
  try {
    const event = await eventsService.releaseEventBooking(req.user.lodgeId, idParam(req.params.id));
    res.json({ event });
  } catch (err) {
    next(err);
  }
}

async function cancelEventHandler(req, res, next) {
  try {
    const event = await eventsService.cancelEventBooking(
      req.user.lodgeId,
      idParam(req.params.id),
      parse(cancelSchema, req.body)
    );
    res.json({ event });
  } catch (err) {
    next(err);
  }
}

module.exports = {
  listVenuesHandler,
  createVenueHandler,
  updateVenueHandler,
  deleteVenueImageHandler,
  listAddonsHandler,
  createAddonHandler,
  updateAddonHandler,
  availabilityHandler,
  quoteHandler,
  listEventsHandler,
  getEventHandler,
  createEventHandler,
  updateEventHandler,
  addExtraHandler,
  priceExtraHandler,
  removeExtraHandler,
  holdEventHandler,
  confirmEventHandler,
  releaseEventHandler,
  cancelEventHandler,
};
