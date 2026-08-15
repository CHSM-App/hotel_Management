const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const multer = require('multer');
const { ApiError } = require('./errorHandler');

// A photo of the dish, shown on the menu a guest orders from. Not sensitive —
// it is the most public thing this system holds — so it is served from a static
// mount (see app.js) like room photos rather than through an authenticated
// route: a menu of thirty dishes would otherwise be thirty authenticated
// fetches on a phone over hotel wifi.
//
// Its own directory rather than sharing room-images: the two are deleted on
// different schedules and by different code, and one folder holding both would
// make "is this file still referenced?" a question spanning two tables.
const UPLOAD_DIR = path.join(__dirname, '..', '..', 'uploads', 'menu-images');
fs.mkdirSync(UPLOAD_DIR, { recursive: true });

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
      return cb(new ApiError('A dish photo must be an image (JPG, PNG, or WEBP).', 400));
    }
    cb(null, true);
  },
});

// One photo per dish, under the field name "image". A menu item is a single
// thing on a list — a gallery would be a different screen, not a bigger form.
function menuImageUpload(req, res, next) {
  upload.single('image')(req, res, (err) => {
    if (err instanceof multer.MulterError) {
      if (err.code === 'LIMIT_FILE_SIZE') {
        return next(new ApiError('The dish photo must be 5MB or smaller.', 400));
      }
      if (err.code === 'LIMIT_FILE_COUNT' || err.code === 'LIMIT_UNEXPECTED_FILE') {
        return next(new ApiError('Only one photo per dish.', 400));
      }
      return next(new ApiError('Could not upload the photo.', 400));
    }
    if (err) return next(err);
    next();
  });
}

module.exports = { menuImageUpload, UPLOAD_DIR };
