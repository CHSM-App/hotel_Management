const { getPool, sql } = require('../../config/connection');
const { ApiError } = require('../../middleware/errorHandler');

// The shared payee directory — lifted out of assets.service.js now that
// Expenses needs the same vendor list Assets already built. dbo.vendors
// itself never belonged to either module (068_vendors.sql: "a shared
// procurement vendor directory"); this just gives that shared table a
// module of its own so neither Assets nor Expenses depends on the other.

function toNullable(value) {
  return value === '' || value === undefined ? null : value;
}

function mapVendor(row) {
  return {
    id: row.id,
    name: row.name,
    contactPerson: row.contact_person,
    phone: row.phone,
    email: row.email,
    specialty: row.specialty,
    notes: row.notes,
    isActive: !!row.is_active,
  };
}

async function listVendors(lodgeId, { includeInactive = false } = {}) {
  const pool = await getPool();
  const result = await pool
    .request()
    .input('lodgeId', sql.BigInt, lodgeId)
    .query(`
      SELECT id, name, contact_person, phone, email, specialty, notes, is_active
      FROM dbo.vendors
      WHERE lodge_id = @lodgeId ${includeInactive ? '' : 'AND is_active = 1'}
      ORDER BY name ASC
    `);
  return result.recordset.map(mapVendor);
}

async function createVendor(lodgeId, input) {
  const pool = await getPool();

  const existing = await pool
    .request()
    .input('lodgeId', sql.BigInt, lodgeId)
    .input('name', sql.NVarChar, input.name)
    .query('SELECT id FROM dbo.vendors WHERE lodge_id = @lodgeId AND name = @name');
  if (existing.recordset.length > 0) {
    throw new ApiError('A vendor with that name already exists.', 409, 'name');
  }

  const result = await pool
    .request()
    .input('lodgeId', sql.BigInt, lodgeId)
    .input('name', sql.NVarChar, input.name)
    .input('contactPerson', sql.NVarChar, toNullable(input.contactPerson))
    .input('phone', sql.NVarChar, toNullable(input.phone))
    .input('email', sql.NVarChar, toNullable(input.email))
    .input('specialty', sql.NVarChar, toNullable(input.specialty))
    .input('notes', sql.NVarChar, toNullable(input.notes))
    .query(`
      INSERT INTO dbo.vendors (lodge_id, name, contact_person, phone, email, specialty, notes)
      OUTPUT inserted.id
      VALUES (@lodgeId, @name, @contactPerson, @phone, @email, @specialty, @notes)
    `);

  const id = result.recordset[0].id;
  const vendors = await listVendors(lodgeId, { includeInactive: true });
  return vendors.find((v) => v.id === id);
}

async function updateVendor(lodgeId, vendorId, input) {
  const pool = await getPool();

  const conflict = await pool
    .request()
    .input('lodgeId', sql.BigInt, lodgeId)
    .input('name', sql.NVarChar, input.name)
    .input('vendorId', sql.BigInt, vendorId)
    .query('SELECT id FROM dbo.vendors WHERE lodge_id = @lodgeId AND name = @name AND id <> @vendorId');
  if (conflict.recordset.length > 0) {
    throw new ApiError('A vendor with that name already exists.', 409, 'name');
  }

  const result = await pool
    .request()
    .input('lodgeId', sql.BigInt, lodgeId)
    .input('vendorId', sql.BigInt, vendorId)
    .input('name', sql.NVarChar, input.name)
    .input('contactPerson', sql.NVarChar, toNullable(input.contactPerson))
    .input('phone', sql.NVarChar, toNullable(input.phone))
    .input('email', sql.NVarChar, toNullable(input.email))
    .input('specialty', sql.NVarChar, toNullable(input.specialty))
    .input('notes', sql.NVarChar, toNullable(input.notes))
    .query(`
      UPDATE dbo.vendors
      SET name = @name, contact_person = @contactPerson, phone = @phone, email = @email,
          specialty = @specialty, notes = @notes
      OUTPUT inserted.id
      WHERE id = @vendorId AND lodge_id = @lodgeId
    `);
  if (result.recordset.length === 0) {
    throw new ApiError('Vendor not found.', 404);
  }

  const vendors = await listVendors(lodgeId, { includeInactive: true });
  return vendors.find((v) => v.id === vendorId);
}

module.exports = {
  mapVendor,
  listVendors,
  createVendor,
  updateVendor,
};
