const fs = require('fs');
const path = require('path');

// Where uploaded files live on disk: backend/uploads/, alongside the app.
//
// This mirrors the college-admission backend, which roots its uploads the same
// way (BackEnd/uploads/students/...) and needs no configuration to do it. The
// directory is deliberately outside src/public, so nothing here is reachable by
// URL unless a route serves it on purpose — id-proofs never are.
//
// The tree survives a deploy because it is untracked: CI force-pushes the
// contents of backend/, and backend/.gitignore excludes uploads/, so a server
// that deploys by pull or checkout leaves the folder alone. Guest ID proofs are
// KYC documents the property must retain, so the one thing never to do here is
// a clean wipe (`git clean -xdf`) or a delete-then-copy deploy — either removes
// the uploads with it. Back this directory up.
//
// UPLOAD_ROOT overrides the location for a host that would rather keep uploads
// on a separate volume. It is optional everywhere, including production: an
// unset value is a working default, not a misconfiguration.
const DEFAULT_ROOT = path.join(__dirname, '..', '..', 'uploads');

const UPLOAD_ROOT = process.env.UPLOAD_ROOT
  ? path.resolve(process.env.UPLOAD_ROOT)
  : DEFAULT_ROOT;

// Resolves a named subdirectory (id-proofs, room-images, ...) and creates it.
// Called at require time by each upload middleware, so a path the process
// cannot write fails at startup rather than on the first guest check-in.
function uploadDir(name) {
  const dir = path.join(UPLOAD_ROOT, name);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

module.exports = { UPLOAD_ROOT, uploadDir };
