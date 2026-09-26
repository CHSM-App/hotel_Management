/**
 * Pushes dish photos already downloaded locally (by seed-menu-images.js) up
 * to the live server, one HTTPS upload per file, through the temporary
 * SUPERADMIN-only route added in lodges.routes.js
 * (POST /internal/lodges/:id/menu/items/:itemId/image).
 *
 * Why this exists at all: uploads/ is gitignored (see
 * .github/workflows/deploy.yml), so a photo downloaded onto this machine
 * never reaches production through the normal git-push deploy. There is no
 * SSH access to the server, so this goes over the same HTTPS API the app
 * itself uses instead.
 *
 *   node scripts/push-menu-images.js --lodge 12 --admin-email admin@x.com --admin-password ***
 *
 * Reads uploads/menu-image-credits.json for the dish-name -> local-file
 * mapping (written by seed-menu-images.js) and uploads each file with its
 * dish name; the server resolves the name to an item id itself.
 *
 * Idempotent-ish: re-running just re-uploads and re-points every credited
 * dish, which is harmless — the old file the row pointed at gets deleted
 * server-side, same as any other photo replace (see menu.service.updateItem).
 *
 * TEMPORARY, same as the route it calls — delete both once this backfill is
 * done and nothing else needs a way to push local files onto the server.
 */
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { UPLOAD_DIR: MENU_IMAGE_DIR } = require('../src/middleware/menuImageUpload');

const API_BASE = 'https://hotel.vengurlatech.com';

function readArg(flag) {
  const index = process.argv.indexOf(flag);
  return index === -1 ? null : process.argv[index + 1] || null;
}

const LODGE_ID = readArg('--lodge');
const ADMIN_EMAIL = readArg('--admin-email');
const ADMIN_PASSWORD = readArg('--admin-password');
const CREDITS_FILE = path.join(__dirname, '..', 'uploads', 'menu-image-credits.json');

if (!LODGE_ID || !ADMIN_EMAIL || !ADMIN_PASSWORD) {
  console.error(
    'Usage: node scripts/push-menu-images.js --lodge <id> --admin-email <email> --admin-password <password>'
  );
  process.exit(1);
}

async function adminLogin() {
  const res = await fetch(`${API_BASE}/auth/admin-login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ identifier: ADMIN_EMAIL, password: ADMIN_PASSWORD }),
  });
  if (!res.ok) throw new Error(`Admin login failed: HTTP ${res.status} — ${await res.text()}`);
  const { token } = await res.json();
  if (!token) throw new Error('Admin login succeeded but returned no token.');
  return token;
}

async function uploadOne(token, dishName, filePath) {
  const buffer = fs.readFileSync(filePath);
  const form = new FormData();
  form.append('dishName', dishName);
  form.append('image', new Blob([buffer]), path.basename(filePath));

  const res = await fetch(`${API_BASE}/internal/lodges/${LODGE_ID}/menu/image`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
    body: form,
  });
  if (!res.ok) throw new Error(`HTTP ${res.status} — ${await res.text()}`);
}

async function run() {
  const credits = JSON.parse(fs.readFileSync(CREDITS_FILE, 'utf8'));
  const entries = Object.entries(credits); // filename -> { dish, section, ... }

  console.log(`Logging in as ${ADMIN_EMAIL}...`);
  const token = await adminLogin();

  console.log(`Pushing ${entries.length} dish photos to lodge ${LODGE_ID}...`);
  let done = 0;
  let missing = 0;
  let failed = 0;

  for (const [filename, meta] of entries) {
    const localPath = path.join(MENU_IMAGE_DIR, filename);

    if (!fs.existsSync(localPath)) {
      console.log(`  ? ${meta.dish} — local file ${filename} is missing, skipped`);
      missing += 1;
      continue;
    }

    try {
      await uploadOne(token, meta.dish, localPath);
      done += 1;
      console.log(`  ✓ ${meta.dish}`);
    } catch (err) {
      failed += 1;
      console.log(`  ✗ ${meta.dish} — ${err.message}`);
    }
  }

  console.log(`\nDone — ${done} uploaded, ${missing} skipped (local file missing), ${failed} failed.`);
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
