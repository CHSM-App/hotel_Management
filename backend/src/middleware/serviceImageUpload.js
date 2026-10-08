const crypto = require('crypto');
const multer = require('multer');
const { ApiError } = require('./errorHandler');
const { uploadDir } = require('../config/uploadRoot');

// A photo of a lodge service — private pool, gaming area, spa — shown on its
// card in Services & prices. Not sensitive, so it is served from a static
// mount (see app.js) rather than through an authenticated route, the same way
// a dish photo or a room photo is.
//
// Its own directory rather than sharing menu-images: the two are deleted on
// different schedules by different code, and one folder holding both would
// make "is this file still referenced?" a question spanning two tables.
const UPLOAD_DIR = uploadDir('service-images');

const ALLOWED_MIME_EXT = {
  'image/jpeg': '.jpg',
  'image/png': '.png',
  'image/webp': '.webp',
};

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, UPLOAD_DIR),
  filename: (req, file, cb) => cb(null, `${crypto.randomUUID()}${ALLOWED_MIME_EXT[file.mimetype]}`),
});

const upload = multer({
  storage,
  limits: { fileSize: 5 * 1024 * 1024, files: 1 },
  fileFilter: (req, file, cb) => {
    if (!ALLOWED_MIME_EXT[file.mimetype]) {
      return cb(new ApiError('A service photo must be an image (JPG, PNG, or WEBP).', 400));
    }
    cb(null, true);
  },
});

// One photo per service, under the field name "image" — optional, so a save
// with no file picked passes straight through.
function serviceImageUpload(req, res, next) {
  upload.single('image')(req, res, (err) => {
    if (err instanceof multer.MulterError) {
      if (err.code === 'LIMIT_FILE_SIZE') {
        return next(new ApiError('The service photo must be 5MB or smaller.', 400));
      }
      if (err.code === 'LIMIT_FILE_COUNT' || err.code === 'LIMIT_UNEXPECTED_FILE') {
        return next(new ApiError('Only one photo per service.', 400));
      }
      return next(new ApiError('Could not upload the photo.', 400));
    }
    if (err) return next(err);
    next();
  });
}

module.exports = { serviceImageUpload, UPLOAD_DIR };
