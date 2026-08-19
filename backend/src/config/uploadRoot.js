const fs = require('fs');
const path = require('path');

// Where uploaded files live on disk.
//
// This exists because the deploy pipeline destroys anything inside backend/.
// CI runs `git init` in that directory and force-pushes it as a fresh snapshot,
// and backend/.gitignore excludes uploads/ — so a server that deploys by clean
// checkout wipes the folder on every push. Guest ID proofs are KYC documents
// the property is legally required to hold, so "probably survives" is not a
// deployment strategy.
//
// UPLOAD_ROOT therefore points somewhere *outside* the deployed tree — on
// cPanel, typically /home/<account>/lms-uploads. Set it once in .env and the
// deploy can overwrite the application directory as violently as it likes.
//
// The fallback keeps `npm run dev` working with no configuration on a fresh
// clone. It resolves to the old in-tree location, which is correct locally and
// wrong in production — hence assertUploadRootConfigured() below, which turns
// that wrongness into a refusal to boot rather than silent data loss six weeks
// in.
const DEFAULT_DEV_ROOT = path.join(__dirname, '..', '..', 'uploads');

const UPLOAD_ROOT = process.env.UPLOAD_ROOT
  ? path.resolve(process.env.UPLOAD_ROOT)
  : DEFAULT_DEV_ROOT;

// Resolves a named subdirectory (id-proofs, room-images, ...) and creates it.
// Called at require time by each upload middleware, so a misconfigured path
// fails at startup rather than on the first guest check-in.
function uploadDir(name) {
  const dir = path.join(UPLOAD_ROOT, name);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

// Production must not run on the in-tree fallback: that directory is inside the
// blast radius of the next deploy. Called from the startup env check.
function assertUploadRootConfigured() {
  if (process.env.NODE_ENV === 'production' && !process.env.UPLOAD_ROOT) {
    throw new Error(
      'UPLOAD_ROOT must be set in production. Without it, uploads are written ' +
        'inside the deployed directory and are destroyed on the next deploy. ' +
        'Point it at a path outside the app directory (e.g. /home/<account>/lms-uploads).'
    );
  }
}

module.exports = { UPLOAD_ROOT, uploadDir, assertUploadRootConfigured };
