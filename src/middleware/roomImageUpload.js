const crypto = require('crypto');
const multer = require('multer');
const { ApiError } = require('./errorHandler');
const { uploadDir } = require('../config/uploadRoot');

// Room photos aren't sensitive like a guest's ID proof, so they're served
// straight from a public static mount (see app.js) instead of an
// authenticated route — a room card showing several thumbnails would
// otherwise mean a separate authenticated fetch per image.
//
// They share the upload root with the ID proofs — backend/uploads/room-images —
// and are exposed by mounting only that one sub-directory statically in app.js,
// which is what keeps the sibling id-proofs folder unreachable by URL.
// See config/uploadRoot.js.
const UPLOAD_DIR = uploadDir('room-images');

const ALLOWED_MIME_EXT = {
  'image/jpeg': '.jpg',
  'image/png': '.png',
  'image/webp': '.webp',
};

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
      return cb(new ApiError('Room photos must be an image (JPG, PNG, or WEBP).', 400));
    }
    cb(null, true);
  },
});

function roomImageUpload(req, res, next) {
  upload.array('images', MAX_IMAGES)(req, res, (err) => {
    if (err instanceof multer.MulterError) {
      if (err.code === 'LIMIT_FILE_SIZE') {
        return next(new ApiError('Each photo must be 5MB or smaller.', 400));
      }
      if (err.code === 'LIMIT_FILE_COUNT' || err.code === 'LIMIT_UNEXPECTED_FILE') {
        return next(new ApiError(`Up to ${MAX_IMAGES} photos per room.`, 400));
      }
      return next(new ApiError('Could not upload the photos.', 400));
    }
    if (err) return next(err);
    next();
  });
}

module.exports = { roomImageUpload, UPLOAD_DIR, MAX_IMAGES };
