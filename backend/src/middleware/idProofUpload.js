const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const multer = require('multer');
const { ApiError } = require('./errorHandler');

// Guest ID proofs (Aadhaar, passport, ...) are sensitive documents, so they
// live outside any statically-served directory — access goes through the
// authenticated /bookings/:id/id-proof route instead of a public URL.
const UPLOAD_DIR = path.join(__dirname, '..', '..', 'uploads', 'id-proofs');
fs.mkdirSync(UPLOAD_DIR, { recursive: true });

const ALLOWED_MIME_EXT = {
  'image/jpeg': '.jpg',
  'image/png': '.png',
  'image/webp': '.webp',
  'application/pdf': '.pdf',
};

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, UPLOAD_DIR),
  filename: (req, file, cb) => cb(null, `${crypto.randomUUID()}${ALLOWED_MIME_EXT[file.mimetype]}`),
});

const upload = multer({
  storage,
  limits: { fileSize: 5 * 1024 * 1024, files: 20 },
  fileFilter: (req, file, cb) => {
    if (!ALLOWED_MIME_EXT[file.mimetype]) {
      return cb(new ApiError('ID proof must be an image (JPG, PNG, WEBP) or a PDF.', 400));
    }
    cb(null, true);
  },
});

// upload.any() rather than a fixed field list — the primary guest's file
// arrives as "idProofDocument", each additional guest's as
// "guestIdProofDocument_<index>", and the guest count (and so the set of
// field names) varies per booking.
function idProofUpload(req, res, next) {
  upload.any()(req, res, (err) => {
    if (err instanceof multer.MulterError) {
      if (err.code === 'LIMIT_FILE_SIZE') {
        return next(new ApiError('ID proof file must be 5MB or smaller.', 400));
      }
      return next(new ApiError('Could not upload the ID proof.', 400));
    }
    if (err) return next(err);
    next();
  });
}

module.exports = { idProofUpload, UPLOAD_DIR };
