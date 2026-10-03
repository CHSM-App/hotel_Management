const crypto = require('crypto');
const multer = require('multer');
const { ApiError } = require('./errorHandler');
const { uploadDir } = require('../config/uploadRoot');

// Photos of a hall or lawn, shown beside the venue on the events setup card
// the same way room photos sit on a room card. Not sensitive, so they are
// served from a public static mount (see app.js) like room and menu photos.
//
// Their own directory rather than sharing room-images: a venue's photos are
// deleted by different code on a different schedule, and one folder holding
// both would make "is this file still referenced?" a question spanning two
// tables. See config/uploadRoot.js for where the root lives.
const UPLOAD_DIR = uploadDir('venue-images');

const ALLOWED_MIME_EXT = {
  'image/jpeg': '.jpg',
  'image/png': '.png',
  'image/webp': '.webp',
};

// The same ceiling as a room: enough to show the hall set up, the entrance,
// the lawn and the stage, without turning the setup card into a gallery.
const MAX_IMAGES = 6;

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, UPLOAD_DIR),
  filename: (req, file, cb) => cb(null, `${crypto.randomUUID()}${ALLOWED_MIME_EXT[file.mimetype]}`),
});

const upload = multer({
  storage,
  limits: { fileSize: 5 * 1024 * 1024, files: MAX_IMAGES },
  fileFilter: (req, file, cb) => {
    if (!ALLOWED_MIME_EXT[file.mimetype]) {
      return cb(new ApiError('Venue photos must be an image (JPG, PNG, or WEBP).', 400));
    }
    cb(null, true);
  },
});

// Under the field name "images", as room photos are. A JSON request (the
// activate/deactivate toggle) passes straight through — multer only reads
// multipart bodies.
function venueImageUpload(req, res, next) {
  upload.array('images', MAX_IMAGES)(req, res, (err) => {
    if (err instanceof multer.MulterError) {
      if (err.code === 'LIMIT_FILE_SIZE') {
        return next(new ApiError('Each photo must be 5MB or smaller.', 400));
      }
      if (err.code === 'LIMIT_FILE_COUNT' || err.code === 'LIMIT_UNEXPECTED_FILE') {
        return next(new ApiError(`Up to ${MAX_IMAGES} photos per venue.`, 400));
      }
      return next(new ApiError('Could not upload the photos.', 400));
    }
    if (err) return next(err);
    next();
  });
}

module.exports = { venueImageUpload, UPLOAD_DIR, MAX_IMAGES };
