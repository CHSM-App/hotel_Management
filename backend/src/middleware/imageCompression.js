const fs = require('fs/promises');
const path = require('path');
const crypto = require('crypto');
const sharp = require('sharp');
const { logger } = require('../config/logger');

// Shrinks an image multer has already written to disk, in place — the
// filename, extension and path it chose are left untouched, so every route
// and static mount downstream (and every other middleware in this
// directory) needs no change at all to pick up the smaller file.
//
// Run as the last step of each upload middleware's own callback, after
// multer's own validation and disk write, not as a multer storage engine
// itself — that keeps this one small module reusable across every upload
// route in the app (room/venue/menu/service photos, logos, ID proofs,
// bills, receipts) without any of them needing to know how compression
// works, only that it runs before `next()`.
const DEFAULT_MAX_DIMENSION = 1920;
const DEFAULT_QUALITY = 78;

// GIF would lose its animation to a still resize, and SVG is already vector
// text with nothing a raster re-encode could shrink — both pass through
// untouched. Anything that isn't an image (a PDF bill, say) is skipped by
// the mimetype check in compressFile below, so this module can safely run
// over a request's files without the caller having to filter first.
const SKIP_MIME = new Set(['image/gif', 'image/svg+xml']);

async function compressFile(file, { maxDimension, quality }) {
  if (!file || !file.mimetype || !file.mimetype.startsWith('image/')) return;
  if (SKIP_MIME.has(file.mimetype)) return;

  try {
    // rotate() with no argument bakes in the EXIF orientation flag before
    // it's gone — a phone photo shot in portrait would otherwise re-save
    // sideways, because the re-encoded file carries no EXIF of its own.
    const pipeline = sharp(file.path, { failOn: 'none' })
      .rotate()
      .resize({ width: maxDimension, height: maxDimension, fit: 'inside', withoutEnlargement: true });

    const buffer = await (file.mimetype === 'image/png'
      ? pipeline.png({ quality, compressionLevel: 9 })
      : file.mimetype === 'image/webp'
        ? pipeline.webp({ quality })
        : pipeline.jpeg({ quality, mozjpeg: true })
    ).toBuffer();

    // Only overwrite if compression actually shrank it — a small icon-sized
    // PNG re-encoded at a lossy quality can come out larger than the
    // original, and the point here is smaller files, not different ones.
    if (buffer.length < file.size) {
      // Write to a sibling temp file and rename it over the original rather
      // than writing file.path directly: sharp's read of that same path can
      // still hold the file open at the OS level for a moment after
      // toBuffer() resolves (seen on Windows as an UNKNOWN/EBUSY open
      // error), and writing to a different path sidesteps the read/write
      // collision entirely. The rename itself is atomic on the same volume,
      // which this always is — it's the directory multer just wrote into.
      const tempPath = path.join(path.dirname(file.path), `.${crypto.randomUUID()}.tmp`);
      await fs.writeFile(tempPath, buffer);
      await fs.rename(tempPath, file.path);
      file.size = buffer.length;
    }
  } catch (err) {
    // Compression is an optimisation, not a correctness requirement. A file
    // sharp can't parse (corrupt upload, format it doesn't support) leaves
    // the original multer already wrote on disk — the request still
    // succeeds with the uncompressed file rather than failing the upload
    // over a problem the guest/staff member can do nothing about.
    logger.warn({ err, file: file.originalname }, 'Image compression skipped for an upload');
  }
}

// Collects whichever shape multer left on the request — .single() sets
// req.file, .array()/.any() set req.files as an array, .fields() sets it as
// an object of arrays — into one flat list.
function filesOf(req) {
  if (req.file) return [req.file];
  if (Array.isArray(req.files)) return req.files;
  if (req.files && typeof req.files === 'object') return Object.values(req.files).flat();
  return [];
}

// Call with `await` from inside each upload middleware's own multer
// callback, after checking `err`, before `next()`:
//
//   upload.array('images', MAX_IMAGES)(req, res, async (err) => {
//     if (err) { ... }
//     await compressUploadedImages(req, { maxDimension: 1920, quality: 78 });
//     next();
//   });
async function compressUploadedImages(req, options = {}) {
  const opts = {
    maxDimension: options.maxDimension ?? DEFAULT_MAX_DIMENSION,
    quality: options.quality ?? DEFAULT_QUALITY,
  };
  await Promise.all(filesOf(req).map((file) => compressFile(file, opts)));
}

module.exports = { compressUploadedImages };
