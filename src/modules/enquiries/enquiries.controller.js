const enquiriesService = require('./enquiries.service');
const publicService = require('../public/public.service');
const { publicEnquirySchema, updateEnquirySchema } = require('./enquiries.schema');
const { ApiError } = require('../../middleware/errorHandler');

function parse(schema, body) {
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    throw new ApiError(parsed.error.issues[0].message, 400);
  }
  return parsed.data;
}

// Mounted on the public router (no auth) as POST /public/lodges/:slug/enquiries.
async function submitPublicEnquiryHandler(req, res, next) {
  try {
    const lodge = await publicService.getLodgeBySlug(req.params.slug);
    const data = parse(publicEnquirySchema, req.body);
    const result = await enquiriesService.createPublicEnquiry(lodge.id, data);
    res.status(201).json(result);
  } catch (err) {
    next(err);
  }
}

async function listEnquiriesHandler(req, res, next) {
  try {
    res.json(await enquiriesService.listEnquiries(req.user.lodgeId, { status: req.query.status }));
  } catch (err) {
    next(err);
  }
}

async function summaryHandler(req, res, next) {
  try {
    res.json(await enquiriesService.summarize(req.user.lodgeId));
  } catch (err) {
    next(err);
  }
}

// The room type / venue / add-on names the detail modal resolves an
// enquiry's ids against — see loadCatalogue's own comment for why this
// isn't just a call to /rooms or /events/venues.
async function catalogueHandler(req, res, next) {
  try {
    res.json(await enquiriesService.loadCatalogue(req.user.lodgeId));
  } catch (err) {
    next(err);
  }
}

async function updateEnquiryHandler(req, res, next) {
  try {
    const { status } = parse(updateEnquirySchema, req.body);
    res.json(await enquiriesService.updateStatus(req.user.lodgeId, req.user.sub, Number(req.params.id), status));
  } catch (err) {
    next(err);
  }
}

module.exports = {
  submitPublicEnquiryHandler,
  listEnquiriesHandler,
  summaryHandler,
  catalogueHandler,
  updateEnquiryHandler,
};
