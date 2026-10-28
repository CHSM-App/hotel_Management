const crypto = require('crypto');
const multer = require('multer');
const { ApiError } = require('./errorHandler');
const { uploadDir } = require('../config/uploadRoot');

// The bill PDF the desk is sending to a guest, on its way to disk.
//
// The file is built in the browser, not here — jsPDF draws it off the very
// document the desk is looking at (frontend/src/pages/lodge/billPaper.js), so
// what the guest receives is the bill as it was previewed, on the paper size
// and in the language that was chosen. Rebuilding it server-side would mean a
// second renderer that has to agree with the first one forever, and the first
// divergence would be a guest holding a bill the property cannot reproduce.
//
// So the browser posts the finished PDF and this stores it.
//
// Deliberately NOT beside the room photos: those are decoration, this is a
// guest's bill. It gets its own directory so the static mount that exposes
// images cannot reach it — bill PDFs are served only by the tokenised public
// route (public.routes.js), never by express.static.
const UPLOAD_DIR = uploadDir('bill-shares');

// One type only. This endpoint exists to carry a bill, and a store that will
// accept anything is a store that will be used for something else.
const ALLOWED_MIME = 'application/pdf';

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, UPLOAD_DIR),
  // A random name, not the invoice number. The file sits behind a token and
  // the name must not be the second, guessable way to reach it — nor leak how
  // many bills the property has cut.
  filename: (req, file, cb) => cb(null, `${crypto.randomUUID()}.pdf`),
});

const upload = multer({
  storage,
  // A bill is a page or two of vector text; 10MB is far above any real one and
  // still small enough that a mistake cannot fill the disk.
  limits: { fileSize: 10 * 1024 * 1024, files: 1 },
  fileFilter: (req, file, cb) => {
    if (file.mimetype !== ALLOWED_MIME) {
      return cb(new ApiError('The bill must be a PDF.', 400));
    }
    cb(null, true);
  },
});

function billShareUpload(req, res, next) {
  upload.single('bill')(req, res, (err) => {
    if (err instanceof multer.MulterError) {
      if (err.code === 'LIMIT_FILE_SIZE') {
        return next(new ApiError('The bill PDF must be 10MB or smaller.', 400));
      }
      return next(new ApiError('Could not upload the bill PDF.', 400));
    }
    if (err) return next(err);
    next();
  });
}

module.exports = { billShareUpload, UPLOAD_DIR };
