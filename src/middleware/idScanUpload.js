const multer = require('multer');
const { ApiError } = require('./errorHandler');

// ID photos for the AI scan. Held in memory and never written to disk: the scan
// reads them and forgets them (the booking save stores the document separately).
// 20 images = 10 cards, front and back.
const MAX_SCAN_IMAGES = 20;

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024, files: MAX_SCAN_IMAGES },
  fileFilter: (req, file, cb) => {
    if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.mimetype)) {
      return cb(new ApiError('ID scan needs images (JPG, PNG, WEBP).', 400));
    }
    cb(null, true);
  },
});

function idScanUpload(req, res, next) {
  upload.array('images', MAX_SCAN_IMAGES)(req, res, (err) => {
    if (err instanceof multer.MulterError) {
      if (err.code === 'LIMIT_FILE_SIZE') return next(new ApiError('Each ID photo must be 5MB or smaller.', 400));
      if (err.code === 'LIMIT_UNEXPECTED_FILE' || err.code === 'LIMIT_FILE_COUNT') {
        return next(new ApiError(`Scan at most ${MAX_SCAN_IMAGES} photos at a time.`, 400));
      }
      return next(new ApiError('Could not read the ID photos.', 400));
    }
    next(err);
  });
}

module.exports = { idScanUpload, MAX_SCAN_IMAGES };
