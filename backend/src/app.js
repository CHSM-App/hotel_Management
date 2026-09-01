const express = require('express');
const path = require('path');
const cors = require('cors');
const helmet = require('helmet');
const compression = require('compression');
const { getPool } = require('./config/connection');
const { requestLogger } = require('./middleware/requestLogger');
const authRoutes = require('./modules/auth/auth.routes');
const lodgesRoutes = require('./modules/lodges/lodges.routes');
const meRoutes = require('./modules/me/me.routes');
const roomsRoutes = require('./modules/rooms/rooms.routes');
const categoriesRoutes = require('./modules/categories/categories.routes');
const switchableChargesRoutes = require('./modules/switchableCharges/switchableCharges.routes');
const seasonsRoutes = require('./modules/seasons/seasons.routes');
const pricingRoutes = require('./modules/pricing/pricing.routes');
const bookingsRoutes = require('./modules/bookings/bookings.routes');
const billingRoutes = require('./modules/billing/billing.routes');
const reportsRoutes = require('./modules/reports/reports.routes');
const rolesRoutes = require('./modules/roles/roles.routes');
const staffRoutes = require('./modules/staff/staff.routes');
const menuRoutes = require('./modules/menu/menu.routes');
const tablesRoutes = require('./modules/tables/tables.routes');
const ordersRoutes = require('./modules/orders/orders.routes');
const inventoryRoutes = require('./modules/inventory/inventory.routes');
const eventsRoutes = require('./modules/events/events.routes');
const publicRoutes = require('./modules/public/public.routes');
const { errorHandler } = require('./middleware/errorHandler');
const { UPLOAD_DIR: ROOM_IMAGE_DIR } = require('./middleware/roomImageUpload');
const { UPLOAD_DIR: MENU_IMAGE_DIR } = require('./middleware/menuImageUpload');
const { UPLOAD_DIR: VENUE_IMAGE_DIR } = require('./middleware/venueImageUpload');

const app = express();

// The public ordering endpoints are rate limited per client IP. Behind a
// reverse proxy every request arrives from the proxy, so without this the
// limiter sees one client and would throttle the whole property at once.
// Set to the number of proxies in front of the app — 1 for a single nginx.
if (process.env.TRUST_PROXY) {
  app.set('trust proxy', Number(process.env.TRUST_PROXY) || 1);
}

const allowedOrigins = (process.env.ALLOWED_ORIGINS || '').split(',').filter(Boolean);
const isProduction = process.env.NODE_ENV === 'production';

// In development the dev server's port isn't stable: Vite walks up from 5173
// whenever a previous instance is still holding the port, so a pinned
// "http://<lan-ip>:5173" allowlist breaks with a CORS error the moment that
// happens. Outside production we therefore match on *host* — loopback, or a
// private LAN address — and let any port through, which is what a phone
// testing over Wi-Fi needs anyway.
//
// Production is untouched: it uses the explicit ALLOWED_ORIGINS list and
// nothing else, so this can't widen a deployed origin.
const DEV_HOST_RE = /^(localhost|127\.0\.0\.1|\[::1\]|10\.\d+\.\d+\.\d+|192\.168\.\d+\.\d+|172\.(1[6-9]|2\d|3[01])\.\d+\.\d+)$/;

function isDevOrigin(origin) {
  try {
    return DEV_HOST_RE.test(new URL(origin).hostname);
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// Security headers
// ---------------------------------------------------------------------------
//
// The backend serves the SPA and the API from one origin, so these headers
// protect the dashboard as well as the endpoints — and the JWT lives in
// localStorage on that same origin, which is what makes XSS here expensive
// rather than merely embarrassing.
app.use(
  helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        // Vite emits plain <script src> bundles, so no inline script is needed
        // and none is allowed — that is the directive doing the real work.
        scriptSrc: ["'self'"],
        // Styles are the exception: the SPA sets element styles at runtime
        // (chart bars, tape-chart offsets, print layout), and React writes
        // those as inline style attributes. 'unsafe-inline' for styles is a
        // far weaker concession than it would be for scripts.
        // fonts.googleapis.com serves the stylesheet index.html links for
        // Fraunces and Inter; the font files themselves come from
        // fonts.gstatic.com (fontSrc). Without both the link is silently
        // blocked and every page falls back to Georgia and the system sans.
        styleSrc: ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com'],
        // data: for the QR codes and the html-to-image/jsPDF canvases, which
        // are generated in the browser as data URIs. blob: for the same
        // pipeline when it hands back a Blob to download.
        // OpenStreetMap tiles, for the map internal staff pick a property's
        // location on. Images only: the map library itself is bundled, and
        // no script or fetch goes to a third party.
        imgSrc: ["'self'", 'data:', 'blob:', 'https://*.tile.openstreetmap.org'],
        fontSrc: ["'self'", 'data:', 'https://fonts.gstatic.com'],
        // Same-origin API only. Nothing in this app talks to a third party, so
        // anything that tries is either a bug or an exfiltration attempt.
        connectSrc: ["'self'"],
        // Nothing may embed this app — the clickjacking defence, and the
        // modern replacement for X-Frame-Options.
        frameAncestors: ["'none'"],
        // blob: so a report PDF built in the browser can be previewed in an
        // iframe before it is saved. Still no remote frames — this allows the
        // page to show a file it made itself, not to embed anyone else's.
        frameSrc: ["'self'", 'blob:'],
        objectSrc: ["'none'"],
        baseUri: ["'self'"],
        formAction: ["'self'"],
        // jsPDF and html-to-image build documents in workers/blobs.
        workerSrc: ["'self'", 'blob:'],
        // Helmet adds upgrade-insecure-requests by default, which tells the
        // browser to fetch every subresource over https. On a host that only
        // speaks http — the LAN dev server, a first deploy before the
        // certificate — that upgrades the bundle, the stylesheet and every
        // uploaded photo into an SSL error, and the page renders as a blank
        // or photo-less shell. Gated on the same flag as HSTS: both are
        // "this site is reliably on HTTPS" statements, and neither is true
        // until someone says so.
        upgradeInsecureRequests: process.env.ENABLE_HSTS === 'true' ? [] : null,
      },
    },
    // HSTS tells browsers to refuse plain HTTP for this host. Only meaningful
    // once the site is reliably on HTTPS — enabling it before then locks
    // visitors out of a working site, and the header is remembered for its full
    // duration, so it cannot simply be taken back. Off unless asked for.
    hsts: process.env.ENABLE_HSTS === 'true'
      ? { maxAge: 15552000, includeSubDomains: true, preload: false }
      : false,
    // Uploaded images are served from this origin. Without nosniff a file whose
    // bytes look like HTML could be interpreted as a document rather than an
    // image, which on the same origin as the dashboard is stored XSS. The
    // upload filters already restrict type and rewrite filenames; this is the
    // second lock on the same door.
    noSniff: true,
    // Referrer stops leaking booking ids and guest identifiers in the URL to
    // anywhere a user might navigate next.
    referrerPolicy: { policy: 'strict-origin-when-cross-origin' },
    // Express advertises itself by default; there is no reason to tell an
    // attacker which framework and version to look up.
    hidePoweredBy: true,
    // Lets the SPA's generated PDFs and images load without tripping the
    // cross-origin isolation checks a strict default would impose.
    crossOriginEmbedderPolicy: false,
    crossOriginResourcePolicy: { policy: 'same-site' },
  })
);

// gzip for JSON responses. The reports and tape-chart endpoints return the
// large payloads on this system, and they are the ones staff wait on.
app.use(compression());

// Request logging, before the routes so every request is recorded including the
// ones that never reach a handler. See middleware/requestLogger.js.
app.use(requestLogger);

app.use(
  cors({
    origin(origin, callback) {
      // No Origin header at all — curl, a health check, a same-origin request.
      // Never a browser cross-origin call, so there's nothing to police.
      if (!origin) return callback(null, true);
      if (allowedOrigins.includes(origin)) return callback(null, true);
      if (!isProduction && isDevOrigin(origin)) return callback(null, true);
      return callback(null, false);
    },
  })
);
app.use(express.json());
app.use('/room-images', express.static(ROOM_IMAGE_DIR));
app.use('/menu-images', express.static(MENU_IMAGE_DIR));
app.use('/venue-images', express.static(VENUE_IMAGE_DIR));

// Built frontend (Vite output lands in src/public via CI). Serves index.html,
// assets/*, favicon, etc. Static files take precedence over the SPA fallback below.
const CLIENT_DIR = path.join(__dirname, 'public');
app.use(express.static(CLIENT_DIR));

// Two probes, because "is the process alive" and "can it actually serve a
// request" are different questions and conflating them is how an outage stays
// green on a dashboard for an hour.
//
// /health hits the database. It is what an uptime monitor should watch: an app
// that cannot reach SQL Server can't serve a single business endpoint, so
// reporting it healthy is worse than reporting nothing.
app.get('/health', async (req, res) => {
  try {
    const pool = await getPool();
    await pool.request().query('SELECT 1');
    res.json({ ok: true, database: 'up' });
  } catch (err) {
    // The reason goes to the log, not to the caller. This route has no auth in
    // front of it — it is meant to be reachable by an uptime monitor — so
    // anyone at all could read what came back, and a tedious connection failure
    // names the database host, the port and often the login it tried. That is a
    // free map of the back end handed to whoever asks.
    //
    // Nothing is lost by logging it instead: the operator reading this at 2am
    // has the log, and the monitor only needs to know it is down.
    req.log?.error({ err }, 'Health check failed — database unreachable');

    // 503 rather than 500: "not ready to serve" is a state a load balancer
    // knows how to act on.
    res.status(503).json({ ok: false, database: 'down' });
  }
});

// /health/live answers only "is this process running" — no dependencies. This
// is what a process supervisor should restart on, because restarting the app
// when the *database* is down accomplishes nothing but a slower recovery.
app.get('/health/live', (req, res) => res.json({ ok: true }));

// Every API mount point, declared once.
//
// This list used to be written out twice — once as the app.use() calls and
// again as a hand-maintained API_PREFIXES array for the SPA fallback below —
// and the two had already drifted: /menu, /tables and /orders were mounted but
// missing from the prefix list, so an unknown GET under them fell through to
// the SPA and returned index.html with a 200. Any client parsing that as JSON
// fails on the first character.
//
// Deriving the prefixes from the same array that mounts the routers makes that
// class of bug impossible rather than merely fixed: adding a router adds its
// prefix, because they are the same line.
const API_ROUTES = [
  ['/auth', authRoutes],
  ['/internal/lodges', lodgesRoutes],
  ['/me', meRoutes],
  ['/rooms', roomsRoutes],
  ['/categories', categoriesRoutes],
  ['/switchable-charges', switchableChargesRoutes],
  ['/seasons', seasonsRoutes],
  ['/pricing', pricingRoutes],
  ['/bookings', bookingsRoutes],
  ['/billing', billingRoutes],
  ['/reports', reportsRoutes],
  ['/roles', rolesRoutes],
  ['/staff', staffRoutes],
  ['/menu', menuRoutes],
  ['/tables', tablesRoutes],
  ['/orders', ordersRoutes],
  ['/inventory', inventoryRoutes],
  ['/events', eventsRoutes],
  ['/public', publicRoutes],
];

for (const [prefix, router] of API_ROUTES) {
  app.use(prefix, router);
}

// Paths that serve API-shaped responses without being a mounted router: the
// static upload mounts and the health probes. They belong in the fallback
// exclusion list for the same reason — a missing image should 404, not return
// the SPA shell.
const NON_ROUTER_API_PREFIXES = ['/room-images', '/menu-images', '/venue-images', '/health'];

// '/internal/lodges' is mounted, but '/internal/anything-else' should also be
// treated as API rather than handed to the SPA, so the first path segment is
// what gets matched.
const API_PREFIXES = [
  ...API_ROUTES.map(([prefix]) => '/' + prefix.split('/')[1]),
  ...NON_ROUTER_API_PREFIXES,
];

// SPA fallback: any GET that wasn't an API route or a static file gets index.html
// so React Router can resolve the client-side route (e.g. a refresh on /bookings).
// API prefixes are excluded so an unknown API path still returns the JSON 404 below.
app.get(/.*/, (req, res, next) => {
  if (API_PREFIXES.some((p) => req.path === p || req.path.startsWith(p + '/'))) {
    return next();
  }
  res.sendFile(path.join(CLIENT_DIR, 'index.html'));
});

app.use((req, res) => res.status(404).json({ success: false, error: 'Not found.' }));
app.use(errorHandler);

module.exports = app;
