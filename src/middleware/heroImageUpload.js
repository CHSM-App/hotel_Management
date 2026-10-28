const crypto = require('crypto');
const multer = require('multer');
const { ApiError } = require('./errorHandler');
const { uploadDir } = require('../config/uploadRoot');
const { compressUploadedImages } = require('./imageCompression');

// The public page's hero background — a wide banner shot, not a small mark
// like the logo, so it keeps its own directory and a bigger size ceiling.
// Not sensitive, so it is served from a public static mount (see app.js)
// like room/venue/logo images.
const UPLOAD_DIR = uploadDir('lodge-hero-images');

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
      return cb(new ApiError('The hero image must be a photo (JPG, PNG, or WEBP).', 400));
    }
    cb(null, true);
  },
});

function heroImageUpload(req, res, next) {
  upload.single('heroImage')(req, res, async (err) => {
    if (err instanceof multer.MulterError) {
      if (err.code === 'LIMIT_FILE_SIZE') {
        return next(new ApiError('The hero image must be 5MB or smaller.', 400));
      }
      return next(new ApiError('Could not upload the hero image.', 400));
    }
    if (err) return next(err);
    if (!req.file) return next(new ApiError('Choose an image to upload.', 400));
    // Same ceiling as a room/venue photo: wide enough for a hero banner
    // without storing a multi-megabyte original.
    await compressUploadedImages(req, { maxDimension: 1920, quality: 80 });
    next();
  });
}

module.exports = { heroImageUpload, UPLOAD_DIR };
