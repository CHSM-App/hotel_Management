require('dotenv').config();
const fs = require('fs');
const path = require('path');
const bcrypt = require('bcryptjs');
const { getPool, sql } = require('../src/config/connection');
const migrations = require('../src/config/migrations');

async function run() {
  const pool = await getPool();
  const schemaSql = fs.readFileSync(path.join(__dirname, '../src/config/schema.sql'), 'utf8');

  console.log('Applying schema.sql...');
  await pool.request().batch(schemaSql);
  console.log('Schema is up to date.');

  // schema.sql is kept current, so a database it just built already contains
  // everything the migration files describe. Recording them as applied here —
  // without running them — is what lets `npm run migrate` mean the same thing
  // on a day-old database and a year-old one: apply only what this database
  // has not seen.
  const baselined = await migrations.baseline(pool);
  if (baselined.length > 0) {
    console.log(`Baselined ${baselined.length} migration(s): ${baselined.join(', ')}`);
  }

  const email = process.env.SEED_SUPERADMIN_EMAIL;
  const phone = process.env.SEED_SUPERADMIN_PHONE;
  const password = process.env.SEED_SUPERADMIN_PASSWORD;

  if (!email || !phone || !password) {
    console.log('SEED_SUPERADMIN_EMAIL / SEED_SUPERADMIN_PHONE / SEED_SUPERADMIN_PASSWORD not set — skipping superadmin seed.');
    process.exit(0);
  }

  const existing = await pool
    .request()
    .input('email', sql.NVarChar, email)
    .query('SELECT id FROM dbo.users WHERE email = @email');

  if (existing.recordset.length > 0) {
    console.log(`Superadmin ${email} already exists — skipping.`);
    process.exit(0);
  }

  const passwordHash = await bcrypt.hash(password, 10);
  await pool
    .request()
    .input('name', sql.NVarChar, 'Vengurla Tech')
    .input('email', sql.NVarChar, email)
    .input('phone', sql.NVarChar, phone)
    .input('passwordHash', sql.NVarChar, passwordHash)
    .query(`
      INSERT INTO dbo.users (lodge_id, name, email, phone, password_hash, role, must_reset_password)
      VALUES (NULL, @name, @email, @phone, @passwordHash, 'SUPERADMIN', 0)
    `);

  console.log(`Superadmin created: ${email}`);
  process.exit(0);
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
