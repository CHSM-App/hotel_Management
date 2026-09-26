const test = require('node:test');
const assert = require('node:assert');
const request = require('supertest');

process.env.DB_SERVER ||= 'localhost';
process.env.DB_PORT ||= '1433';
process.env.DB_NAME ||= 'lodge_test';
process.env.DB_USER ||= 'sa';
process.env.DB_PASSWORD ||= 'test';
process.env.JWT_SECRET ||= 'a'.repeat(40);
process.env.UPLOAD_ROOT ||= require('path').join(require('os').tmpdir(), 'lms-test-uploads');

const app = require('../src/app');

// The regression: the SPA fallback used a hand-maintained list of API prefixes
// that had drifted from the routers actually mounted. /menu, /tables and
// /orders were missing, so an unknown GET under them returned index.html with a
// 200 — and a client calling res.json() on that fails on the first character.
//
// /menu, /tables and /orders are the paths that were broken; the rest are here
// so the list cannot silently lose an entry later.
const API_PREFIXES = [
  '/menu',
  '/tables',
  '/orders',
  '/auth',
  '/bookings',
  '/billing',
  '/rooms',
  '/categories',
  '/inventory',
  '/reports',
  '/roles',
  '/staff',
  '/seasons',
  '/pricing',
  '/switchable-charges',
  '/me',
  '/internal',
  '/public',
];

for (const prefix of API_PREFIXES) {
  test(`${prefix}/<unknown> returns JSON, not the SPA shell`, async () => {
    const res = await request(app).get(`${prefix}/definitely-not-a-real-route`);

    assert.notStrictEqual(
      res.status,
      200,
      `${prefix} fell through to the SPA fallback and returned index.html with a 200`
    );
    assert.match(
      res.headers['content-type'] || '',
      /application\/json/,
      `${prefix} returned ${res.headers['content-type']} instead of JSON`
    );
  });
}

test('a real SPA route still serves the app shell', async () => {
  // The other half of the behaviour: refreshing the browser on a client-side
  // route has to keep working, or the fix has broken the dashboard.
  const res = await request(app).get('/bookings-overview');
  // 200 with HTML when the SPA is built into src/public; 404 when it is not
  // (a bare checkout, as in CI). Either is correct — what must not happen is
  // this path being treated as an API route.
  assert.ok(
    res.status === 200 || res.status === 404,
    `unexpected status ${res.status} for a client-side route`
  );
  if (res.status === 200) {
    assert.match(res.headers['content-type'] || '', /text\/html/);
  }
});

test('the prefix list is derived from the mounted routers, not hand-written', () => {
  // Guards the fix itself rather than its symptom. If someone reintroduces a
  // literal array, the two can drift apart again.
  const source = require('fs').readFileSync(require.resolve('../src/app.js'), 'utf8');
  assert.match(
    source,
    /API_ROUTES\.map\(/,
    'API_PREFIXES should be derived from API_ROUTES so it cannot drift'
  );
});
