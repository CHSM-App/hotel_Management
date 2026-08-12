const express = require('express');
const path = require('path');
const cors = require('cors');
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
const publicRoutes = require('./modules/public/public.routes');
const { errorHandler } = require('./middleware/errorHandler');
const { UPLOAD_DIR: ROOM_IMAGE_DIR } = require('./middleware/roomImageUpload');

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

// Built frontend (Vite output lands in src/public via CI). Serves index.html,
// assets/*, favicon, etc. Static files take precedence over the SPA fallback below.
const CLIENT_DIR = path.join(__dirname, 'public');
app.use(express.static(CLIENT_DIR));

app.get('/health', (req, res) => res.json({ ok: true }));

app.use('/auth', authRoutes);
app.use('/internal/lodges', lodgesRoutes);
app.use('/me', meRoutes);
app.use('/rooms', roomsRoutes);
app.use('/categories', categoriesRoutes);
app.use('/switchable-charges', switchableChargesRoutes);
app.use('/seasons', seasonsRoutes);
app.use('/pricing', pricingRoutes);
app.use('/bookings', bookingsRoutes);
app.use('/billing', billingRoutes);
app.use('/reports', reportsRoutes);
app.use('/roles', rolesRoutes);
app.use('/staff', staffRoutes);
app.use('/menu', menuRoutes);
app.use('/tables', tablesRoutes);
app.use('/orders', ordersRoutes);
app.use('/inventory', inventoryRoutes);
app.use('/public', publicRoutes);

// SPA fallback: any GET that wasn't an API route or a static file gets index.html
// so React Router can resolve the client-side route (e.g. a refresh on /bookings).
// API prefixes are listed so an unknown API path still returns a JSON 404 below.
const API_PREFIXES = [
  '/auth', '/internal', '/me', '/rooms', '/categories', '/switchable-charges',
  '/seasons', '/pricing', '/bookings', '/billing', '/reports', '/roles',
  '/staff', '/public', '/room-images', '/health', '/inventory',
];
app.get(/.*/, (req, res, next) => {
  if (API_PREFIXES.some((p) => req.path === p || req.path.startsWith(p + '/'))) {
    return next();
  }
  res.sendFile(path.join(CLIENT_DIR, 'index.html'));
});

app.use((req, res) => res.status(404).json({ success: false, error: 'Not found.' }));
app.use(errorHandler);

module.exports = app;
