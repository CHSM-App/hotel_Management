const crypto = require('crypto');
const multer = require('multer');
const { ApiError } = require('./errorHandler');
const { uploadDir } = require('../config/uploadRoot');

// The quotation PDF the desk is sharing, on its way to disk. Same shape as
// receiptShareUpload.js; its own directory so the tokenised quotation route can
// only ever serve quotations.
const UPLOAD_DIR = uploadDir('quotation-shares');

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, UPLOAD_DIR),
  filename: (req, file, cb) => cb(null, `${crypto.randomUUID()}.pdf`),
});

const upload = multer({
  storage,
  limits: { fileSize: 10 * 1024 * 1024, files: 1 },
  fileFilter: (req, file, cb) => {
    if (file.mimetype !== 'application/pdf') return cb(new ApiError('The quotation must be a PDF.', 400));
    cb(null, true);
  },
});

function quotationShareUpload(req, res, next) {
  upload.single('quotation')(req, res, (err) => {
    if (err instanceof multer.MulterError) {
      return next(new ApiError(err.code === 'LIMIT_FILE_SIZE' ? 'The quotation PDF must be 10MB or smaller.' : 'Could not upload the quotation PDF.', 400));
    }
    if (err) return next(err);
    next();
  });
}

module.exports = { quotationShareUpload, UPLOAD_DIR };
