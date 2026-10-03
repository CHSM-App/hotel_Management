const crypto = require('crypto');
const multer = require('multer');
const { ApiError } = require('./errorHandler');
const { uploadDir } = require('../config/uploadRoot');

// The advance receipt PDF the desk is sending to a guest, on its way to disk.
// Same shape as billShareUpload.js, and for the same reasons — see that file.
// Kept as its own directory and its own middleware rather than reusing the
// bill one: a receipt is not a bill, and the two must not end up served by
// the same tokenised route by accident of sharing a store.
const UPLOAD_DIR = uploadDir('receipt-shares');

const ALLOWED_MIME = 'application/pdf';

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, UPLOAD_DIR),
  filename: (req, file, cb) => cb(null, `${crypto.randomUUID()}.pdf`),
});

const upload = multer({
  storage,
  limits: { fileSize: 10 * 1024 * 1024, files: 1 },
  fileFilter: (req, file, cb) => {
    if (file.mimetype !== ALLOWED_MIME) {
      return cb(new ApiError('The receipt must be a PDF.', 400));
    }
    cb(null, true);
  },
});

function receiptShareUpload(req, res, next) {
  upload.single('receipt')(req, res, (err) => {
    if (err instanceof multer.MulterError) {
      if (err.code === 'LIMIT_FILE_SIZE') {
        return next(new ApiError('The receipt PDF must be 10MB or smaller.', 400));
      }
      return next(new ApiError('Could not upload the receipt PDF.', 400));
    }
    if (err) return next(err);
    next();
  });
}

module.exports = { receiptShareUpload, UPLOAD_DIR };
