const crypto = require('crypto');
const multer = require('multer');
const { ApiError } = require('./errorHandler');
const { uploadDir } = require('../config/uploadRoot');

// The receipt/bill for an expense. Same shape as assetBillUpload.js: outside
// any statically-served directory, so access goes through the authenticated
// GET /expenses/:id/bill route rather than a public URL.
const UPLOAD_DIR = uploadDir('expense-bills');

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
  limits: { fileSize: 5 * 1024 * 1024, files: 1 },
  fileFilter: (req, file, cb) => {
    if (!ALLOWED_MIME_EXT[file.mimetype]) {
      return cb(new ApiError('The receipt must be an image (JPG, PNG, WEBP) or a PDF.', 400));
    }
    cb(null, true);
  },
});

function expenseBillUpload(req, res, next) {
  upload.single('billDocument')(req, res, (err) => {
    if (err instanceof multer.MulterError) {
      if (err.code === 'LIMIT_FILE_SIZE') {
        return next(new ApiError('The receipt file must be 5MB or smaller.', 400));
      }
      return next(new ApiError('Could not upload the receipt.', 400));
    }
    if (err) return next(err);
    next();
  });
}

module.exports = { expenseBillUpload, UPLOAD_DIR };
