const test = require('node:test');
const assert = require('node:assert');
const request = require('supertest');

// The app is required once here, so the environment has to be valid before it
// loads — src/app.js pulls in the connection config at require time.
process.env.DB_SERVER ||= 'localhost';
process.env.DB_PORT ||= '1433';
process.env.DB_NAME ||= 'lodge_test';
process.env.DB_USER ||= 'sa';
process.env.DB_PASSWORD ||= 'test';
process.env.JWT_SECRET ||= 'a'.repeat(40);
process.env.UPLOAD_ROOT ||= require('path').join(require('os').tmpdir(), 'lms-test-uploads');

const app = require('../src/app');

// Headers are asserted against a route that needs no database, so these stay
// green without SQL Server and can run in CI.
const probe = () => request(app).get('/health/live');

test('sets X-Content-Type-Options: nosniff', async () => {
  // Load-bearing here specifically: user-uploaded images are served from the
  // same origin as the dashboard and the JWT in localStorage. Without nosniff a
  // file whose bytes look like HTML can execute as a document.
  const res = await probe().expect(200);
  assert.strictEqual(res.headers['x-content-type-options'], 'nosniff');
});

test('forbids being framed', async () => {
  // The dashboard was clickjackable. frame-ancestors is the modern control;
  // helmet also emits X-Frame-Options for older browsers.
  const res = await probe().expect(200);
  assert.match(res.headers['content-security-policy'], /frame-ancestors 'none'/);
  assert.strictEqual(res.headers['x-frame-options'], 'SAMEORIGIN');
});

test('sets a content security policy that blocks inline script', async () => {
  const csp = (await probe().expect(200)).headers['content-security-policy'];
  assert.ok(csp, 'expected a CSP header');
  assert.match(csp, /default-src 'self'/);
  assert.match(csp, /script-src 'self'/);
  // The whole point of the script directive: no 'unsafe-inline' on scripts.
  assert.ok(
    !/script-src[^;]*unsafe-inline/.test(csp),
    `script-src must not allow unsafe-inline: ${csp}`
  );
});

test('allows the data:/blob: images the PDF and QR features generate', async () => {
  // A CSP that breaks the invoice PDF would be reverted in a hurry, so the
  // exceptions are pinned deliberately rather than left to be rediscovered.
  const csp = (await probe().expect(200)).headers['content-security-policy'];
  assert.match(csp, /img-src[^;]*data:/);
  assert.match(csp, /img-src[^;]*blob:/);
});

test('does not advertise the framework', async () => {
  const res = await probe().expect(200);
  assert.strictEqual(res.headers['x-powered-by'], undefined);
});

test('sets a referrer policy so booking ids do not leak in URLs', async () => {
  const res = await probe().expect(200);
  assert.strictEqual(res.headers['referrer-policy'], 'strict-origin-when-cross-origin');
});

test('HSTS is off unless explicitly enabled', async () => {
  // Enabling HSTS before HTTPS is reliable locks visitors out of a working
  // site, and browsers remember it for the full max-age.
  const res = await probe().expect(200);
  assert.strictEqual(res.headers['strict-transport-security'], undefined);
});

test('liveness does not depend on the database', async () => {
  // /health/live is what a process supervisor restarts on. If it needed the
  // database, a database outage would trigger endless app restarts that cannot
  // possibly fix it.
  const res = await probe().expect(200);
  assert.deepStrictEqual(res.body, { ok: true });
});

test('unknown API paths return JSON, not the SPA shell', async () => {
  // The SPA fallback previously swallowed unknown routes under some API
  // prefixes and returned index.html with a 200, which clients cannot parse.
  const res = await request(app).get('/auth/does-not-exist').expect(404);
  assert.strictEqual(res.body.success, false);
});

test('the page may frame a file it built itself, but nothing remote', async () => {
  // The reports panel previews its PDF in an iframe on a blob: URL. With
  // frame-src 'none' that is refused by the browser and the preview shows
  // blank, with the reason only visible in the console.
  const csp = (await probe().expect(200)).headers['content-security-policy'];
  assert.match(csp, /frame-src[^;]*blob:/, 'the PDF preview iframe would be blocked');
  assert.ok(
    !/frame-src[^;]*https?:/.test(csp),
    'frame-src must not allow remote origins — this is for self-built files only'
  );
  // Being framed is a separate question and stays refused.
  assert.match(csp, /frame-ancestors 'none'/);
});
