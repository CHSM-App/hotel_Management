// One-off, idempotent seed: creates (or reuses) a "Demo Lodge" and one login
// per role, so anyone can explore every part of the app without registering a
// real property. Run with: node backend/scripts/seed-demo-logins.js
//
// Safe to re-run: existing accounts are left untouched and just printed again.
require('dotenv').config();
const bcrypt = require('bcryptjs');
const { getPool, sql } = require('../src/config/connection');

const DEMO_SLUG = 'demo-lodge';
const DEMO_LODGE_NAME = 'Demo Lodge';

// One password per role, professional-looking (Word-Case + digits + symbol)
// rather than "password123" or "demo@123". Same shape auth.service.js/staff
// service already validate against (bcrypt hash, min length).
const DEMO_USERS = [
  { role: 'SUPERADMIN', name: 'Demo Super Admin', email: 'superadmin@demo.hotel', phone: '9999900001', password: 'SuperAdmin@2026' },
  { role: 'OWNER', name: 'Demo Owner', email: 'owner@demo.hotel', phone: '9999900002', password: 'OwnerAccess@2026' },
  { role: 'RECEPTION', name: 'Demo Reception', email: 'reception@demo.hotel', phone: '9999900003', password: 'FrontDesk@2026' },
  { role: 'KITCHEN', name: 'Demo Kitchen', email: 'kitchen@demo.hotel', phone: '9999900004', password: 'KitchenOps@2026' },
  { role: 'CAPTAIN', name: 'Demo Captain', email: 'captain@demo.hotel', phone: '9999900005', password: 'FloorCaptain@2026' },
  { role: 'EVENTS_MANAGER', name: 'Demo Events Manager', email: 'events@demo.hotel', phone: '9999900006', password: 'EventsDesk@2026' },
  { role: 'ASSETS_MANAGER', name: 'Demo Assets Manager', email: 'assets@demo.hotel', phone: '9999900007', password: 'AssetTrack@2026' },
  { role: 'ACCOUNTANT', name: 'Demo Accountant', email: 'accountant@demo.hotel', phone: '9999900008', password: 'LedgerBooks@2026' },
];

async function ensureDemoLodge(pool) {
  const existing = await pool.request().input('slug', sql.NVarChar, DEMO_SLUG)
    .query('SELECT id FROM dbo.lodges WHERE slug = @slug');
  if (existing.recordset.length > 0) return existing.recordset[0].id;

  const inserted = await pool.request()
    .input('name', sql.NVarChar, DEMO_LODGE_NAME)
    .input('slug', sql.NVarChar, DEMO_SLUG)
    .query(`
      INSERT INTO dbo.lodges
        (name, slug, checkin_mode, is_gst_registered, is_specified_premises,
         has_rooms, serves_food, food_room_service, food_table_service, has_events,
         has_assets, has_expenses)
      OUTPUT inserted.id
      VALUES
        (@name, @slug, 'NIGHT_BASED', 0, 0, 1, 1, 1, 1, 1, 1, 1)
    `);
  return inserted.recordset[0].id;
}

async function ensureUser(pool, lodgeId, user) {
  const existing = await pool.request()
    .input('email', sql.NVarChar, user.email)
    .input('phone', sql.NVarChar, user.phone)
    .query('SELECT id FROM dbo.users WHERE email = @email OR phone = @phone');
  if (existing.recordset.length > 0) return false;

  const passwordHash = await bcrypt.hash(user.password, 10);
  await pool.request()
    .input('lodgeId', sql.BigInt, user.role === 'SUPERADMIN' ? null : lodgeId)
    .input('name', sql.NVarChar, user.name)
    .input('email', sql.NVarChar, user.email)
    .input('phone', sql.NVarChar, user.phone)
    .input('passwordHash', sql.NVarChar, passwordHash)
    .input('role', sql.NVarChar, user.role)
    .query(`
      INSERT INTO dbo.users (lodge_id, name, email, phone, password_hash, role, must_reset_password)
      VALUES (@lodgeId, @name, @email, @phone, @passwordHash, @role, 0)
    `);
  return true;
}

async function run() {
  const pool = await getPool();
  const lodgeId = await ensureDemoLodge(pool);

  console.log(`Demo lodge: ${DEMO_LODGE_NAME} (id ${lodgeId})\n`);
  console.log('Role'.padEnd(16), 'Email/Login'.padEnd(24), 'Password');
  console.log('-'.repeat(60));

  for (const user of DEMO_USERS) {
    const created = await ensureUser(pool, lodgeId, user);
    console.log(user.role.padEnd(16), user.email.padEnd(24), user.password, created ? '' : '(already existed)');
  }

  process.exit(0);
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
