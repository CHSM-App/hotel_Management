const crypto = require('crypto');
const multer = require('multer');
const { ApiError } = require('./errorHandler');
const { uploadDir } = require('../config/uploadRoot');

// A property's own logo — shown before its name in the dashboard brand mark,
// and on the bill masthead when the owner opts in. Not sensitive, so it is
// served from a public static mount (see app.js) like room/menu/venue images.
const UPLOAD_DIR = uploadDir('hotel-logos');

const ALLOWED_MIME_EXT = {
  'image/jpeg': '.jpg',
  'image/png': '.png',
  'image/webp': '.webp',
  'image/svg+xml': '.svg',
};

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, UPLOAD_DIR),
  filename: (req, file, cb) => cb(null, `${crypto.randomUUID()}${ALLOWED_MIME_EXT[file.mimetype]}`),
});

const upload = multer({
  storage,
  limits: { fileSize: 2 * 1024 * 1024, files: 1 },
  fileFilter: (req, file, cb) => {
    if (!ALLOWED_MIME_EXT[file.mimetype]) {
      return cb(new ApiError('Logo must be an image (JPG, PNG, WEBP, or SVG).', 400));
    }
    cb(null, true);
  },
});

function logoUpload(req, res, next) {
  upload.single('logo')(req, res, (err) => {
    if (err instanceof multer.MulterError) {
      if (err.code === 'LIMIT_FILE_SIZE') {
        return next(new ApiError('The logo must be 2MB or smaller.', 400));
      }
      return next(new ApiError('Could not upload the logo.', 400));
    }
    if (err) return next(err);
    if (!req.file) return next(new ApiError('Choose an image to upload.', 400));
    next();
  });
}

module.exports = { logoUpload, UPLOAD_DIR };
