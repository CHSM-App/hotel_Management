const { getPool, sql } = require('../../config/connection');
const { ApiError } = require('../../middleware/errorHandler');

async function listSwitchableCharges(lodgeId) {
  const pool = await getPool();

  const result = await pool
    .request()
    .input('lodgeId', sql.BigInt, lodgeId)
    .query(`
      SELECT id, name, charge_per_night, is_active, is_counter, hidden_when_charge_id, created_at
      FROM dbo.switchable_charges
      WHERE lodge_id = @lodgeId
      ORDER BY name ASC
    `);

  return result.recordset.map((row) => ({
    id: row.id,
    name: row.name,
    chargePerNight: Number(row.charge_per_night),
    // Hidden from booking while this other extra is ticked.
    hiddenWhenChargeId: row.hidden_when_charge_id == null ? null : Number(row.hidden_when_charge_id),
    isActive: !!row.is_active,
    // Charged per unit: booking screens put a count box beside the extra. Set
    // by the "Charge per unit" tick on the rates screen.
    isCounter: !!row.is_counter,
    createdAt: row.created_at,
  }));
}

// The extra a "hide when" rule points at must be one of this lodge's own, and
// not the extra itself.
async function assertHiddenWhenTarget(pool, lodgeId, chargeId, targetId) {
  if (!targetId) return;
  if (chargeId != null && Number(targetId) === Number(chargeId)) {
    throw new ApiError('An extra can’t be hidden by itself.', 400, 'hiddenWhenChargeId');
  }
  const found = await pool
    .request()
    .input('lodgeId', sql.BigInt, lodgeId)
    .input('targetId', sql.BigInt, targetId)
    .query('SELECT id FROM dbo.switchable_charges WHERE id = @targetId AND lodge_id = @lodgeId');
  if (found.recordset.length === 0) {
    throw new ApiError('Choose one of your own extras.', 400, 'hiddenWhenChargeId');
  }
}

async function createSwitchableCharge(lodgeId, input) {
  const pool = await getPool();
  await assertHiddenWhenTarget(pool, lodgeId, null, input.hiddenWhenChargeId);

  const existing = await pool
    .request()
    .input('lodgeId', sql.BigInt, lodgeId)
    .input('name', sql.NVarChar, input.name)
    .query('SELECT id FROM dbo.switchable_charges WHERE lodge_id = @lodgeId AND name = @name');

  if (existing.recordset.length > 0) {
    throw new ApiError('A switchable charge with that name already exists.', 409, 'chargeName');
  }

  const result = await pool
    .request()
    .input('lodgeId', sql.BigInt, lodgeId)
    .input('name', sql.NVarChar, input.name)
    .input('chargePerNight', sql.Decimal(10, 2), input.chargePerNight)
    .input('isCounter', sql.Bit, input.isCounter ? 1 : 0)
    .input('hiddenWhen', sql.BigInt, input.hiddenWhenChargeId || null)
    .query(`
      INSERT INTO dbo.switchable_charges (lodge_id, name, charge_per_night, is_counter, hidden_when_charge_id)
      OUTPUT inserted.id
      VALUES (@lodgeId, @name, @chargePerNight, @isCounter, @hiddenWhen)
    `);

  return { id: result.recordset[0].id };
}

async function updateSwitchableCharge(lodgeId, chargeId, input) {
  const pool = await getPool();

  const existing = await pool
    .request()
    .input('lodgeId', sql.BigInt, lodgeId)
    .input('chargeId', sql.BigInt, chargeId)
    .query('SELECT id FROM dbo.switchable_charges WHERE id = @chargeId AND lodge_id = @lodgeId');
  if (existing.recordset.length === 0) {
    throw new ApiError('Charge not found.', 404);
  }
  await assertHiddenWhenTarget(pool, lodgeId, chargeId, input.hiddenWhenChargeId);

  const nameConflict = await pool
    .request()
    .input('lodgeId', sql.BigInt, lodgeId)
    .input('chargeId', sql.BigInt, chargeId)
    .input('name', sql.NVarChar, input.name)
    .query('SELECT id FROM dbo.switchable_charges WHERE lodge_id = @lodgeId AND name = @name AND id <> @chargeId');
  if (nameConflict.recordset.length > 0) {
    throw new ApiError('A switchable charge with that name already exists.', 409, 'chargeName');
  }

  await pool
    .request()
    .input('chargeId', sql.BigInt, chargeId)
    .input('name', sql.NVarChar, input.name)
    .input('chargePerNight', sql.Decimal(10, 2), input.chargePerNight)
    // Null when the caller did not say: the extra keeps how it is charged.
    .input('isCounter', sql.Bit, input.isCounter === undefined ? null : input.isCounter ? 1 : 0)
    // Absent means the caller predates the rule (an older app editing the
    // price): keep it. An explicit null is "Never hide" and clears it.
    .input('hiddenGiven', sql.Bit, input.hiddenWhenChargeId === undefined ? 0 : 1)
    .input('hiddenWhen', sql.BigInt, input.hiddenWhenChargeId || null)
    .query(`
      UPDATE dbo.switchable_charges
      SET name = @name, charge_per_night = @chargePerNight, is_counter = ISNULL(@isCounter, is_counter),
          hidden_when_charge_id = CASE WHEN @hiddenGiven = 1 THEN @hiddenWhen ELSE hidden_when_charge_id END
      WHERE id = @chargeId
    `);

  return { id: chargeId };
}

// Past bookings reference switchable charges directly (booking_switchable_charges),
// so "delete" deactivates instead — it drops out of new bookings/rooms without
// touching billing history.
async function setSwitchableChargeActive(lodgeId, chargeId, isActive) {
  const pool = await getPool();
  const result = await pool
    .request()
    .input('lodgeId', sql.BigInt, lodgeId)
    .input('chargeId', sql.BigInt, chargeId)
    .input('isActive', sql.Bit, isActive)
    .query(`
      UPDATE dbo.switchable_charges SET is_active = @isActive
      OUTPUT inserted.id
      WHERE id = @chargeId AND lodge_id = @lodgeId
    `);
  if (result.recordset.length === 0) {
    throw new ApiError('Charge not found.', 404);
  }
  return { id: chargeId };
}

// True delete, for a charge that was never actually applied to a booking —
// blocked once booking_switchable_charges references it, to keep billing
// history intact. room_switchable_charges is just a capability link with no
// independent history, so it's cleaned up automatically.
async function deleteSwitchableCharge(lodgeId, chargeId) {
  const pool = await getPool();

  const existing = await pool
    .request()
    .input('lodgeId', sql.BigInt, lodgeId)
    .input('chargeId', sql.BigInt, chargeId)
    .query('SELECT id FROM dbo.switchable_charges WHERE id = @chargeId AND lodge_id = @lodgeId');
  if (existing.recordset.length === 0) {
    throw new ApiError('Charge not found.', 404);
  }

  const bookingChargesResult = await pool
    .request()
    .input('chargeId', sql.BigInt, chargeId)
    .query(`
      SELECT TOP 1 booking_id FROM dbo.booking_switchable_charges WHERE charge_id = @chargeId
      UNION ALL
      SELECT TOP 1 booking_room_id FROM dbo.booking_room_switchable_charges WHERE charge_id = @chargeId
    `);
  if (bookingChargesResult.recordset.length > 0) {
    throw new ApiError(
      'This extra has been used on past bookings and can’t be permanently deleted — deactivate it instead.',
      409
    );
  }

  const transaction = new sql.Transaction(pool);
  await transaction.begin();
  try {
    await new sql.Request(transaction)
      .input('chargeId', sql.BigInt, chargeId)
      .query('DELETE FROM dbo.room_switchable_charges WHERE charge_id = @chargeId');
    await new sql.Request(transaction)
      .input('chargeId', sql.BigInt, chargeId)
      .query('DELETE FROM dbo.switchable_charges WHERE id = @chargeId');
    await transaction.commit();
  } catch (err) {
    await transaction.rollback();
    throw err;
  }
}

module.exports = {
  listSwitchableCharges,
  createSwitchableCharge,
  updateSwitchableCharge,
  setSwitchableChargeActive,
  deleteSwitchableCharge,
};
