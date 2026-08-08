const express = require('express');
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
const publicRoutes = require('./modules/public/public.routes');
const { errorHandler } = require('./middleware/errorHandler');
const { UPLOAD_DIR: ROOM_IMAGE_DIR } = require('./middleware/roomImageUpload');

const app = express();

const allowedOrigins = (process.env.ALLOWED_ORIGINS || '').split(',').filter(Boolean);
app.use(cors({ origin: allowedOrigins.length ? allowedOrigins : true }));
app.use(express.json());
app.use('/room-images', express.static(ROOM_IMAGE_DIR));

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
app.use('/public', publicRoutes);

app.use((req, res) => res.status(404).json({ success: false, error: 'Not found.' }));
app.use(errorHandler);

module.exports = app;
