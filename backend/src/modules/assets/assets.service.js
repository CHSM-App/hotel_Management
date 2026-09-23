const fs = require('fs/promises');
const path = require('path');
const { getPool, sql } = require('../../config/connection');
const { ApiError } = require('../../middleware/errorHandler');
const { UPLOAD_DIR: BILL_UPLOAD_DIR } = require('../../middleware/assetBillUpload');
const vendorsService = require('../vendors/vendors.service');

// ---------------------------------------------------------------------------
// Categories
// ---------------------------------------------------------------------------

async function listCategories(lodgeId) {
  const pool = await getPool();
  const result = await pool
    .request()
    .input('lodgeId', sql.BigInt, lodgeId)
    .query(`
      SELECT id, name, is_active
      FROM dbo.asset_categories
      WHERE lodge_id = @lodgeId AND is_active = 1
      ORDER BY name ASC
    `);
  return result.recordset.map((row) => ({ id: row.id, name: row.name, isActive: !!row.is_active }));
}

async function createCategory(lodgeId, input) {
  const pool = await getPool();

  const existing = await pool
    .request()
    .input('lodgeId', sql.BigInt, lodgeId)
    .input('name', sql.NVarChar, input.name)
    .query('SELECT id FROM dbo.asset_categories WHERE lodge_id = @lodgeId AND name = @name');
  if (existing.recordset.length > 0) {
    throw new ApiError('A category with that name already exists.', 409, 'name');
  }

  const result = await pool
    .request()
    .input('lodgeId', sql.BigInt, lodgeId)
    .input('name', sql.NVarChar, input.name)
    .query(`
      INSERT INTO dbo.asset_categories (lodge_id, name)
      OUTPUT inserted.id
      VALUES (@lodgeId, @name)
    `);

  return { id: result.recordset[0].id, name: input.name, isActive: true };
}

// ---------------------------------------------------------------------------
// Assets
// ---------------------------------------------------------------------------

function mapAsset(row) {
  return {
    id: row.id,
    name: row.name,
    categoryId: row.category_id,
    categoryName: row.category_name,
    assetTag: row.asset_tag,
    brand: row.brand,
    model: row.model,
    serialNumber: row.serial_number,
    purchaseDate: row.purchase_date,
    purchaseCost: row.purchase_cost == null ? null : Number(row.purchase_cost),
    roomId: row.room_id,
    roomNumber: row.room_number ?? null,
    floor: row.floor,
    department: row.department,
    locationNote: row.location_note,
    vendorId: row.vendor_id,
    vendorName: row.vendor_name ?? null,
    warrantyExpiry: row.warranty_expiry,
    amcExpiry: row.amc_expiry,
    amcCoverageNote: row.amc_coverage_note,
    // Only whether a bill is on file, never the stored filename — the
    // filename is an internal detail the frontend has no use for; it always
    // reaches the file through GET /assets/:id/bill on the asset's own id.
    hasBillDocument: !!row.bill_document,
    status: row.status,
    qrToken: row.qr_token,
    isActive: !!row.is_active,
    openWorkOrders: row.open_work_orders ?? 0,
  };
}

const ASSET_SELECT = `
  SELECT a.id, a.name, a.category_id, c.name AS category_name, a.asset_tag, a.brand, a.model,
         a.serial_number, a.purchase_date, a.purchase_cost, a.room_id, r.room_number, a.floor,
         a.department, a.location_note, a.vendor_id, v.name AS vendor_name, a.warranty_expiry,
         a.amc_expiry, a.amc_coverage_note, a.bill_document, a.status, a.qr_token, a.is_active,
         (SELECT COUNT(*) FROM dbo.asset_work_orders w WHERE w.asset_id = a.id AND w.status <> 'CLOSED') AS open_work_orders
  FROM dbo.assets a
  JOIN dbo.asset_categories c ON c.id = a.category_id
  LEFT JOIN dbo.rooms r ON r.id = a.room_id
  LEFT JOIN dbo.vendors v ON v.id = a.vendor_id
`;

async function listAssets(lodgeId, { includeInactive = false } = {}) {
  const pool = await getPool();
  const result = await pool
    .request()
    .input('lodgeId', sql.BigInt, lodgeId)
    .query(`
      ${ASSET_SELECT}
      WHERE a.lodge_id = @lodgeId ${includeInactive ? '' : 'AND a.is_active = 1'}
      ORDER BY a.name ASC
    `);
  return result.recordset.map(mapAsset);
}

async function getAsset(lodgeId, assetId) {
  const pool = await getPool();
  const result = await pool
    .request()
    .input('lodgeId', sql.BigInt, lodgeId)
    .input('assetId', sql.BigInt, assetId)
    .query(`${ASSET_SELECT} WHERE a.id = @assetId AND a.lodge_id = @lodgeId`);

  const row = result.recordset[0];
  if (!row) {
    throw new ApiError('Asset not found.', 404);
  }
  return mapAsset(row);
}

async function getAssetByQrToken(lodgeId, qrToken) {
  const pool = await getPool();
  const result = await pool
    .request()
    .input('lodgeId', sql.BigInt, lodgeId)
    .input('qrToken', sql.UniqueIdentifier, qrToken)
    .query(`${ASSET_SELECT} WHERE a.qr_token = @qrToken AND a.lodge_id = @lodgeId`);

  const row = result.recordset[0];
  if (!row) {
    throw new ApiError('Asset not found.', 404);
  }
  return mapAsset(row);
}

function toNullable(value) {
  return value === '' || value === undefined ? null : value;
}

// One tag sequence per lodge — see dbo.asset_tag_counters in schema.sql.
// UPDATE ... OUTPUT is the atomic allocate-and-read: two staff registering
// assets at once still get distinct numbers, never SELECT MAX()+1.
async function allocateAssetTag(request, lodgeId) {
  const existing = await request.query(
    'SELECT 1 FROM dbo.asset_tag_counters WHERE lodge_id = @lodgeId'
  );
  if (existing.recordset.length === 0) {
    await request.query(
      'INSERT INTO dbo.asset_tag_counters (lodge_id, next_number) VALUES (@lodgeId, 1)'
    );
  }

  const allocated = await request.query(`
    UPDATE dbo.asset_tag_counters
    SET next_number = next_number + 1
    OUTPUT deleted.next_number AS number
    WHERE lodge_id = @lodgeId
  `);
  const number = allocated.recordset[0].number;
  return `AST-${String(number).padStart(4, '0')}`;
}

// A warranty date given at registration seeds the asset's first coverage
// row — same vendor as the asset itself, since the maker's warranty is
// whoever was just picked as the purchase vendor. AMC is deliberately never
// entered here: it doesn't exist at purchase time, it starts later once the
// warranty lapses, and from then on every change to coverage (extend the
// warranty, add the first AMC, renew it) goes through the Coverage history
// "Add/Renew" action on the asset detail view — one place to manage it,
// not this form and that view both claiming the same data.
async function seedWarrantyCoverage(request, lodgeId, assetId, input) {
  if (!input.warrantyExpiry) return;
  await request
    .input('lodgeId', sql.BigInt, lodgeId)
    .input('assetId', sql.BigInt, assetId)
    .input('vendorId', sql.BigInt, input.vendorId ?? null)
    .input('startDate', sql.Date, toNullable(input.purchaseDate))
    .input('endDate', sql.Date, input.warrantyExpiry)
    .query(`
      INSERT INTO dbo.asset_coverage_periods
        (lodge_id, asset_id, coverage_type, vendor_id, start_date, end_date)
      VALUES
        (@lodgeId, @assetId, 'WARRANTY', @vendorId, @startDate, @endDate)
    `);
}

async function createAsset(lodgeId, input, billFilename) {
  const pool = await getPool();

  const category = await pool
    .request()
    .input('lodgeId', sql.BigInt, lodgeId)
    .input('categoryId', sql.BigInt, input.categoryId)
    .query('SELECT id FROM dbo.asset_categories WHERE id = @categoryId AND lodge_id = @lodgeId');
  if (category.recordset.length === 0) {
    throw new ApiError('Choose a valid category.', 400, 'categoryId');
  }

  const transaction = new sql.Transaction(pool);
  await transaction.begin();
  try {
    const assetTag = await allocateAssetTag(
      new sql.Request(transaction).input('lodgeId', sql.BigInt, lodgeId),
      lodgeId
    );

    const result = await new sql.Request(transaction)
      .input('lodgeId', sql.BigInt, lodgeId)
      .input('categoryId', sql.BigInt, input.categoryId)
      .input('name', sql.NVarChar, input.name)
      .input('assetTag', sql.NVarChar, assetTag)
      .input('brand', sql.NVarChar, toNullable(input.brand))
      .input('model', sql.NVarChar, toNullable(input.model))
      .input('serialNumber', sql.NVarChar, toNullable(input.serialNumber))
      .input('purchaseDate', sql.Date, toNullable(input.purchaseDate))
      .input('purchaseCost', sql.Decimal(12, 2), input.purchaseCost ?? null)
      .input('roomId', sql.BigInt, input.roomId ?? null)
      .input('floor', sql.NVarChar, toNullable(input.floor))
      .input('department', sql.NVarChar, toNullable(input.department))
      .input('locationNote', sql.NVarChar, toNullable(input.locationNote))
      .input('vendorId', sql.BigInt, input.vendorId ?? null)
      .input('warrantyExpiry', sql.Date, toNullable(input.warrantyExpiry))
      .input('billDocument', sql.NVarChar, billFilename ?? null)
      .query(`
        INSERT INTO dbo.assets
          (lodge_id, category_id, name, asset_tag, brand, model, serial_number, purchase_date,
           purchase_cost, room_id, floor, department, location_note, vendor_id, warranty_expiry,
           bill_document)
        OUTPUT inserted.id
        VALUES
          (@lodgeId, @categoryId, @name, @assetTag, @brand, @model, @serialNumber, @purchaseDate,
           @purchaseCost, @roomId, @floor, @department, @locationNote, @vendorId, @warrantyExpiry,
           @billDocument)
      `);

    const assetId = result.recordset[0].id;
    await seedWarrantyCoverage(new sql.Request(transaction), lodgeId, assetId, input);

    await transaction.commit();
    return getAsset(lodgeId, assetId);
  } catch (err) {
    await transaction.rollback();
    throw err;
  }
}

// One purchase, several assets — a category, vendor, bill and purchase/
// warranty details shared across every row, with only what varies per unit
// (name, room, floor, location) asked for per unit. Runs as one transaction:
// fifty rows should either all land or none do, not stop at thirty-one
// because the thirty-second room id turned out to belong to another lodge.
async function createAssetsBulk(lodgeId, sharedInput, units, billFilename) {
  const pool = await getPool();

  const category = await pool
    .request()
    .input('lodgeId', sql.BigInt, lodgeId)
    .input('categoryId', sql.BigInt, sharedInput.categoryId)
    .query('SELECT id FROM dbo.asset_categories WHERE id = @categoryId AND lodge_id = @lodgeId');
  if (category.recordset.length === 0) {
    throw new ApiError('Choose a valid category.', 400, 'categoryId');
  }

  const transaction = new sql.Transaction(pool);
  await transaction.begin();
  try {
    const insertedIds = [];
    for (const unit of units) {
      const assetTag = await allocateAssetTag(
        new sql.Request(transaction).input('lodgeId', sql.BigInt, lodgeId),
        lodgeId
      );

      const result = await new sql.Request(transaction)
        .input('lodgeId', sql.BigInt, lodgeId)
        .input('categoryId', sql.BigInt, sharedInput.categoryId)
        .input('name', sql.NVarChar, unit.name)
        .input('assetTag', sql.NVarChar, assetTag)
        .input('brand', sql.NVarChar, toNullable(sharedInput.brand))
        .input('model', sql.NVarChar, toNullable(sharedInput.model))
        .input('serialNumber', sql.NVarChar, toNullable(unit.serialNumber))
        .input('purchaseDate', sql.Date, toNullable(sharedInput.purchaseDate))
        .input('purchaseCost', sql.Decimal(12, 2), sharedInput.purchaseCost ?? null)
        .input('roomId', sql.BigInt, unit.roomId ?? null)
        .input('floor', sql.NVarChar, toNullable(unit.floor))
        .input('department', sql.NVarChar, toNullable(unit.department))
        .input('locationNote', sql.NVarChar, toNullable(unit.locationNote))
        .input('vendorId', sql.BigInt, sharedInput.vendorId ?? null)
        .input('warrantyExpiry', sql.Date, toNullable(sharedInput.warrantyExpiry))
        .input('billDocument', sql.NVarChar, billFilename ?? null)
        .query(`
          INSERT INTO dbo.assets
            (lodge_id, category_id, name, asset_tag, brand, model, serial_number, purchase_date,
             purchase_cost, room_id, floor, department, location_note, vendor_id, warranty_expiry,
             bill_document)
          OUTPUT inserted.id
          VALUES
            (@lodgeId, @categoryId, @name, @assetTag, @brand, @model, @serialNumber, @purchaseDate,
             @purchaseCost, @roomId, @floor, @department, @locationNote, @vendorId, @warrantyExpiry,
             @billDocument)
        `);

      const insertedId = result.recordset[0].id;
      await seedWarrantyCoverage(new sql.Request(transaction), lodgeId, insertedId, sharedInput);
      insertedIds.push(insertedId);
    }

    await transaction.commit();
    return Promise.all(insertedIds.map((id) => getAsset(lodgeId, id)));
  } catch (err) {
    await transaction.rollback();
    throw err;
  }
}

async function updateAsset(lodgeId, assetId, input, billFilename) {
  const pool = await getPool();

  const category = await pool
    .request()
    .input('lodgeId', sql.BigInt, lodgeId)
    .input('categoryId', sql.BigInt, input.categoryId)
    .query('SELECT id FROM dbo.asset_categories WHERE id = @categoryId AND lodge_id = @lodgeId');
  if (category.recordset.length === 0) {
    throw new ApiError('Choose a valid category.', 400, 'categoryId');
  }

  // A new bill replaces the old one — the previous file is deleted once the
  // row commits to the new filename, so a crash between the two never loses
  // the only copy on file.
  let previousBill = null;
  if (billFilename) {
    const current = await pool
      .request()
      .input('lodgeId', sql.BigInt, lodgeId)
      .input('assetId', sql.BigInt, assetId)
      .query('SELECT bill_document FROM dbo.assets WHERE id = @assetId AND lodge_id = @lodgeId');
    previousBill = current.recordset[0]?.bill_document || null;
  }

  // asset_tag is deliberately absent here — it's allocated once at
  // registration and never rewritten, so it stays trustworthy as an
  // identifier (a physical sticker printed with it doesn't go stale).
  //
  // warranty_expiry / amc_expiry / amc_coverage_note are absent too, on
  // purpose — they're a cache of dbo.asset_coverage_periods, written only by
  // refreshAssetCoverageCache. Editing them here would let this form and the
  // Coverage history "Add/Renew" action disagree about which one is the real
  // record; only the latter is.
  const request = pool
    .request()
    .input('lodgeId', sql.BigInt, lodgeId)
    .input('assetId', sql.BigInt, assetId)
    .input('categoryId', sql.BigInt, input.categoryId)
    .input('name', sql.NVarChar, input.name)
    .input('brand', sql.NVarChar, toNullable(input.brand))
    .input('model', sql.NVarChar, toNullable(input.model))
    .input('serialNumber', sql.NVarChar, toNullable(input.serialNumber))
    .input('purchaseDate', sql.Date, toNullable(input.purchaseDate))
    .input('purchaseCost', sql.Decimal(12, 2), input.purchaseCost ?? null)
    .input('roomId', sql.BigInt, input.roomId ?? null)
    .input('floor', sql.NVarChar, toNullable(input.floor))
    .input('department', sql.NVarChar, toNullable(input.department))
    .input('locationNote', sql.NVarChar, toNullable(input.locationNote))
    .input('vendorId', sql.BigInt, input.vendorId ?? null);

  // Only touched when a new file actually arrived — an edit that doesn't
  // re-upload a bill must not wipe the one already on file.
  const setBillDocument = billFilename ? ', bill_document = @billDocument' : '';
  if (billFilename) request.input('billDocument', sql.NVarChar, billFilename);

  const result = await request.query(`
      UPDATE dbo.assets
      SET category_id = @categoryId, name = @name, brand = @brand,
          model = @model, serial_number = @serialNumber, purchase_date = @purchaseDate,
          purchase_cost = @purchaseCost, room_id = @roomId, floor = @floor,
          department = @department, location_note = @locationNote, vendor_id = @vendorId
          ${setBillDocument}, updated_at = SYSDATETIMEOFFSET()
      OUTPUT inserted.id
      WHERE id = @assetId AND lodge_id = @lodgeId
    `);
  if (result.recordset.length === 0) {
    throw new ApiError('Asset not found.', 404);
  }

  if (previousBill) {
    fs.unlink(path.join(BILL_UPLOAD_DIR, path.basename(previousBill))).catch(() => {});
  }

  return getAsset(lodgeId, assetId);
}

// Whether a stored bill filename still resolves to a file — same reasoning
// as idProofExists in bookings.service.js: the column and the disk can
// disagree, so anything that offers to serve a bill has to ask the disk
// before promising one exists.
async function billExists(filename) {
  if (!filename) return false;
  try {
    await fs.access(path.join(BILL_UPLOAD_DIR, path.basename(filename)));
    return true;
  } catch {
    return false;
  }
}

async function getBillFilename(lodgeId, assetId) {
  const pool = await getPool();
  const result = await pool
    .request()
    .input('lodgeId', sql.BigInt, lodgeId)
    .input('assetId', sql.BigInt, assetId)
    .query('SELECT bill_document FROM dbo.assets WHERE id = @assetId AND lodge_id = @lodgeId');
  const row = result.recordset[0];
  if (!row || !row.bill_document) {
    throw new ApiError('No bill on file for this asset.', 404);
  }
  return row.bill_document;
}

// RETIRED also drops is_active, so a retired asset stops showing in the
// Register list and its counts/badges without a second, easy-to-forget step —
// the same is_active flag setAssetActive already uses to hide an asset while
// keeping its row (and its work orders' history) intact. Moving a retired
// asset back to any other status reverses that, since "un-retiring" should
// put it back in the list it disappeared from.
async function setAssetStatus(lodgeId, assetId, status) {
  const pool = await getPool();
  const result = await pool
    .request()
    .input('lodgeId', sql.BigInt, lodgeId)
    .input('assetId', sql.BigInt, assetId)
    .input('status', sql.NVarChar, status)
    .input('isActive', sql.Bit, status === 'RETIRED' ? 0 : 1)
    .query(`
      UPDATE dbo.assets
      SET status = @status, is_active = @isActive, updated_at = SYSDATETIMEOFFSET()
      OUTPUT inserted.id
      WHERE id = @assetId AND lodge_id = @lodgeId
    `);
  if (result.recordset.length === 0) {
    throw new ApiError('Asset not found.', 404);
  }
  return getAsset(lodgeId, assetId);
}

// Retiring rather than deleting: work orders keep pointing at a real asset row
// so their history still reads correctly.
async function setAssetActive(lodgeId, assetId, isActive) {
  const pool = await getPool();
  const result = await pool
    .request()
    .input('lodgeId', sql.BigInt, lodgeId)
    .input('assetId', sql.BigInt, assetId)
    .input('isActive', sql.Bit, isActive)
    .query(`
      UPDATE dbo.assets SET is_active = @isActive, updated_at = SYSDATETIMEOFFSET()
      OUTPUT inserted.id
      WHERE id = @assetId AND lodge_id = @lodgeId
    `);
  if (result.recordset.length === 0) {
    throw new ApiError('Asset not found.', 404);
  }
  return getAsset(lodgeId, assetId);
}

// ---------------------------------------------------------------------------
// Coverage: warranty, then AMC, then AMC renewed
// ---------------------------------------------------------------------------
//
// assets.warranty_expiry / amc_expiry are a cache of this table's latest row
// per type — kept because the register list's "expiring soon" badge already
// reads them directly and re-deriving a MAX(end_date) per asset on every list
// load is work the list screen shouldn't have to do. Every write to this
// table goes through refreshAssetCoverageCache so the two never drift.

function mapCoveragePeriod(row) {
  return {
    id: row.id,
    assetId: row.asset_id,
    coverageType: row.coverage_type,
    vendorId: row.vendor_id,
    vendorName: row.vendor_name ?? null,
    startDate: row.start_date,
    endDate: row.end_date,
    cost: row.cost == null ? null : Number(row.cost),
    coverageNote: row.coverage_note,
    createdAt: row.created_at,
  };
}

async function listCoveragePeriods(lodgeId, assetId) {
  const pool = await getPool();
  const result = await pool
    .request()
    .input('lodgeId', sql.BigInt, lodgeId)
    .input('assetId', sql.BigInt, assetId)
    .query(`
      SELECT p.id, p.asset_id, p.coverage_type, p.vendor_id, v.name AS vendor_name,
             p.start_date, p.end_date, p.cost, p.coverage_note, p.created_at
      FROM dbo.asset_coverage_periods p
      LEFT JOIN dbo.vendors v ON v.id = p.vendor_id
      WHERE p.asset_id = @assetId AND p.lodge_id = @lodgeId
      ORDER BY p.end_date DESC, p.id DESC
    `);
  return result.recordset.map(mapCoveragePeriod);
}

// Rewrites assets.warranty_expiry / amc_expiry from whichever row of each
// type now ends latest — "latest" rather than "most recently added", so
// entering an old AMC record after a newer one already exists (a hotel
// catching up its records) doesn't wrongly move the cached date backwards.
async function refreshAssetCoverageCache(request, lodgeId, assetId) {
  await request
    .input('assetLodgeId', sql.BigInt, lodgeId)
    .input('assetId2', sql.BigInt, assetId).query(`
    UPDATE dbo.assets
    SET warranty_expiry = (
          SELECT MAX(end_date) FROM dbo.asset_coverage_periods
          WHERE asset_id = @assetId2 AND lodge_id = @assetLodgeId AND coverage_type = 'WARRANTY'
        ),
        amc_expiry = (
          SELECT MAX(end_date) FROM dbo.asset_coverage_periods
          WHERE asset_id = @assetId2 AND lodge_id = @assetLodgeId AND coverage_type = 'AMC'
        ),
        amc_coverage_note = (
          SELECT TOP 1 coverage_note FROM dbo.asset_coverage_periods
          WHERE asset_id = @assetId2 AND lodge_id = @assetLodgeId AND coverage_type = 'AMC'
          ORDER BY end_date DESC, id DESC
        ),
        updated_at = SYSDATETIMEOFFSET()
    WHERE id = @assetId2 AND lodge_id = @assetLodgeId
  `);
}

async function addCoveragePeriod(lodgeId, assetId, input) {
  const pool = await getPool();

  const asset = await pool
    .request()
    .input('lodgeId', sql.BigInt, lodgeId)
    .input('assetId', sql.BigInt, assetId)
    .query('SELECT id FROM dbo.assets WHERE id = @assetId AND lodge_id = @lodgeId');
  if (asset.recordset.length === 0) {
    throw new ApiError('Asset not found.', 404);
  }

  const transaction = new sql.Transaction(pool);
  await transaction.begin();
  try {
    const result = await new sql.Request(transaction)
      .input('lodgeId', sql.BigInt, lodgeId)
      .input('assetId', sql.BigInt, assetId)
      .input('coverageType', sql.NVarChar, input.coverageType)
      .input('vendorId', sql.BigInt, input.vendorId ?? null)
      .input('startDate', sql.Date, toNullable(input.startDate))
      .input('endDate', sql.Date, input.endDate)
      .input('cost', sql.Decimal(12, 2), input.cost ?? null)
      .input('coverageNote', sql.NVarChar, toNullable(input.coverageNote))
      .query(`
        INSERT INTO dbo.asset_coverage_periods
          (lodge_id, asset_id, coverage_type, vendor_id, start_date, end_date, cost, coverage_note)
        OUTPUT inserted.id
        VALUES
          (@lodgeId, @assetId, @coverageType, @vendorId, @startDate, @endDate, @cost, @coverageNote)
      `);

    await refreshAssetCoverageCache(new sql.Request(transaction), lodgeId, assetId);

    await transaction.commit();
    return mapCoveragePeriod({
      id: result.recordset[0].id,
      asset_id: assetId,
      coverage_type: input.coverageType,
      vendor_id: input.vendorId ?? null,
      start_date: toNullable(input.startDate),
      end_date: input.endDate,
      cost: input.cost ?? null,
      coverage_note: toNullable(input.coverageNote),
      created_at: new Date().toISOString(),
    });
  } catch (err) {
    await transaction.rollback();
    throw err;
  }
}

async function deleteCoveragePeriod(lodgeId, assetId, periodId) {
  const pool = await getPool();

  const transaction = new sql.Transaction(pool);
  await transaction.begin();
  try {
    const result = await new sql.Request(transaction)
      .input('lodgeId', sql.BigInt, lodgeId)
      .input('assetId', sql.BigInt, assetId)
      .input('periodId', sql.BigInt, periodId)
      .query(`
        DELETE FROM dbo.asset_coverage_periods
        OUTPUT deleted.id
        WHERE id = @periodId AND asset_id = @assetId AND lodge_id = @lodgeId
      `);
    if (result.recordset.length === 0) {
      throw new ApiError('Coverage period not found.', 404);
    }

    await refreshAssetCoverageCache(new sql.Request(transaction), lodgeId, assetId);
    await transaction.commit();
  } catch (err) {
    await transaction.rollback();
    throw err;
  }
}

// ---------------------------------------------------------------------------
// Vendors
// ---------------------------------------------------------------------------
//
// dbo.vendors is now a shared directory (see vendors/vendors.service.js) —
// the Expenses module uses the same table and the same CRUD. These just
// re-export it so every existing caller of assetsService.listVendors etc.
// keeps working unchanged.

const { listVendors, createVendor, updateVendor } = vendorsService;

// ---------------------------------------------------------------------------
// Work orders
// ---------------------------------------------------------------------------

function mapWorkOrder(row) {
  return {
    id: row.id,
    assetId: row.asset_id,
    assetName: row.asset_name,
    issueType: row.issue_type,
    description: row.description,
    status: row.status,
    reportedBy: row.reported_by,
    reportedByName: row.reported_by_name ?? null,
    assignedToName: row.assigned_to_name,
    vendorId: row.vendor_id,
    vendorName: row.vendor_name ?? null,
    partsCost: row.parts_cost == null ? null : Number(row.parts_cost),
    laborCost: row.labor_cost == null ? null : Number(row.labor_cost),
    partsUsedNote: row.parts_used_note,
    isWarrantyClaim: !!row.is_warranty_claim,
    resolutionNote: row.resolution_note,
    openedAt: row.opened_at,
    closedAt: row.closed_at,
  };
}

const WORK_ORDER_SELECT = `
  SELECT w.id, w.asset_id, a.name AS asset_name, w.issue_type, w.description, w.status,
         w.reported_by, u.name AS reported_by_name, w.assigned_to_name, w.vendor_id,
         v.name AS vendor_name, w.parts_cost, w.labor_cost, w.parts_used_note,
         w.is_warranty_claim, w.resolution_note, w.opened_at, w.closed_at
  FROM dbo.asset_work_orders w
  JOIN dbo.assets a ON a.id = w.asset_id
  LEFT JOIN dbo.vendors v ON v.id = w.vendor_id
  LEFT JOIN dbo.users u ON u.id = w.reported_by
`;

async function listWorkOrders(lodgeId, { assetId, status } = {}) {
  const pool = await getPool();
  const request = pool.request().input('lodgeId', sql.BigInt, lodgeId);
  let filter = '';
  if (assetId) {
    request.input('assetId', sql.BigInt, assetId);
    filter += ' AND w.asset_id = @assetId';
  }
  if (status) {
    request.input('status', sql.NVarChar, status);
    filter += ' AND w.status = @status';
  }

  const result = await request.query(`
    ${WORK_ORDER_SELECT}
    WHERE w.lodge_id = @lodgeId ${filter}
    ORDER BY w.id DESC
  `);
  return result.recordset.map(mapWorkOrder);
}

async function getWorkOrder(lodgeId, workOrderId) {
  const pool = await getPool();
  const result = await pool
    .request()
    .input('lodgeId', sql.BigInt, lodgeId)
    .input('workOrderId', sql.BigInt, workOrderId)
    .query(`${WORK_ORDER_SELECT} WHERE w.id = @workOrderId AND w.lodge_id = @lodgeId`);

  const row = result.recordset[0];
  if (!row) {
    throw new ApiError('Work order not found.', 404);
  }
  return mapWorkOrder(row);
}

async function createWorkOrder(lodgeId, input, userId) {
  const pool = await getPool();

  const asset = await pool
    .request()
    .input('lodgeId', sql.BigInt, lodgeId)
    .input('assetId', sql.BigInt, input.assetId)
    .query('SELECT id FROM dbo.assets WHERE id = @assetId AND lodge_id = @lodgeId');
  if (asset.recordset.length === 0) {
    throw new ApiError('Choose a valid asset.', 400, 'assetId');
  }

  const result = await pool
    .request()
    .input('lodgeId', sql.BigInt, lodgeId)
    .input('assetId', sql.BigInt, input.assetId)
    .input('issueType', sql.NVarChar, input.issueType)
    .input('description', sql.NVarChar, input.description)
    .input('reportedBy', sql.BigInt, userId ?? null)
    .input('assignedToName', sql.NVarChar, toNullable(input.assignedToName))
    .input('vendorId', sql.BigInt, input.vendorId ?? null)
    .query(`
      INSERT INTO dbo.asset_work_orders
        (lodge_id, asset_id, issue_type, description, reported_by, assigned_to_name, vendor_id)
      OUTPUT inserted.id
      VALUES
        (@lodgeId, @assetId, @issueType, @description, @reportedBy, @assignedToName, @vendorId)
    `);

  return getWorkOrder(lodgeId, result.recordset[0].id);
}

// One routine-service visit that covers every unit of a kind at once — "the
// AC contractor is coming Tuesday for all 12 split ACs" is a single event on
// site, not 12 separate ones a staff member should have to type out. Targets
// a category rather than asking for asset ids one by one, since that's how
// the person filing this thinks about it ("all the ACs"), and it's exactly
// the set the Asset Register's own category filter already shows them.
async function createWorkOrdersBulk(lodgeId, input, userId) {
  const pool = await getPool();

  const assetsResult = await pool
    .request()
    .input('lodgeId', sql.BigInt, lodgeId)
    .input('categoryId', sql.BigInt, input.categoryId)
    .query(`
      SELECT id FROM dbo.assets
      WHERE lodge_id = @lodgeId AND category_id = @categoryId AND is_active = 1
      ORDER BY id
    `);
  const assetIds = assetsResult.recordset.map((r) => r.id);
  if (assetIds.length === 0) {
    throw new ApiError('No active assets in that category.', 400, 'categoryId');
  }

  const createdIds = [];
  for (const assetId of assetIds) {
    const result = await pool
      .request()
      .input('lodgeId', sql.BigInt, lodgeId)
      .input('assetId', sql.BigInt, assetId)
      .input('issueType', sql.NVarChar, input.issueType)
      .input('description', sql.NVarChar, input.description)
      .input('reportedBy', sql.BigInt, userId ?? null)
      .input('assignedToName', sql.NVarChar, toNullable(input.assignedToName))
      .input('vendorId', sql.BigInt, input.vendorId ?? null)
      .query(`
        INSERT INTO dbo.asset_work_orders
          (lodge_id, asset_id, issue_type, description, reported_by, assigned_to_name, vendor_id)
        OUTPUT inserted.id
        VALUES
          (@lodgeId, @assetId, @issueType, @description, @reportedBy, @assignedToName, @vendorId)
      `);
    createdIds.push(result.recordset[0].id);
  }

  return Promise.all(createdIds.map((id) => getWorkOrder(lodgeId, id)));
}

async function updateWorkOrder(lodgeId, workOrderId, input) {
  const pool = await getPool();
  const current = await getWorkOrder(lodgeId, workOrderId);

  const next = {
    status: input.status ?? current.status,
    issueType: input.issueType ?? current.issueType,
    description: input.description ?? current.description,
    assignedToName: input.assignedToName !== undefined ? input.assignedToName : current.assignedToName ?? '',
    vendorId: input.vendorId !== undefined ? input.vendorId : current.vendorId,
    partsCost: input.partsCost !== undefined ? input.partsCost : current.partsCost,
    laborCost: input.laborCost !== undefined ? input.laborCost : current.laborCost,
    partsUsedNote: input.partsUsedNote !== undefined ? input.partsUsedNote : current.partsUsedNote ?? '',
    isWarrantyClaim: input.isWarrantyClaim !== undefined ? input.isWarrantyClaim : current.isWarrantyClaim,
    resolutionNote: input.resolutionNote !== undefined ? input.resolutionNote : current.resolutionNote ?? '',
  };

  // closed_at follows the status transition rather than being settable
  // directly — it marks the moment the work order actually closed, not
  // whatever the client happened to send.
  const closingNow = next.status === 'CLOSED' && current.status !== 'CLOSED';
  const reopening = next.status !== 'CLOSED' && current.status === 'CLOSED';

  const result = await pool
    .request()
    .input('lodgeId', sql.BigInt, lodgeId)
    .input('workOrderId', sql.BigInt, workOrderId)
    .input('status', sql.NVarChar, next.status)
    .input('issueType', sql.NVarChar, next.issueType)
    .input('description', sql.NVarChar, next.description)
    .input('assignedToName', sql.NVarChar, toNullable(next.assignedToName))
    .input('vendorId', sql.BigInt, next.vendorId ?? null)
    .input('partsCost', sql.Decimal(12, 2), next.partsCost ?? null)
    .input('laborCost', sql.Decimal(12, 2), next.laborCost ?? null)
    .input('partsUsedNote', sql.NVarChar, toNullable(next.partsUsedNote))
    .input('isWarrantyClaim', sql.Bit, next.isWarrantyClaim)
    .input('resolutionNote', sql.NVarChar, toNullable(next.resolutionNote))
    .query(`
      UPDATE dbo.asset_work_orders
      SET status = @status, issue_type = @issueType, description = @description,
          assigned_to_name = @assignedToName, vendor_id = @vendorId, parts_cost = @partsCost,
          labor_cost = @laborCost, parts_used_note = @partsUsedNote,
          is_warranty_claim = @isWarrantyClaim, resolution_note = @resolutionNote,
          closed_at = ${closingNow ? 'SYSDATETIMEOFFSET()' : reopening ? 'NULL' : 'closed_at'},
          updated_at = SYSDATETIMEOFFSET()
      OUTPUT inserted.id
      WHERE id = @workOrderId AND lodge_id = @lodgeId
    `);
  if (result.recordset.length === 0) {
    throw new ApiError('Work order not found.', 404);
  }

  // A work order closing (or reopening) is the asset's own state changing
  // too — the desk shouldn't have to flip both by hand every time.
  if (closingNow) {
    await pool
      .request()
      .input('lodgeId', sql.BigInt, lodgeId)
      .input('assetId', sql.BigInt, current.assetId)
      .query(`
        UPDATE dbo.assets SET status = 'IN_USE', updated_at = SYSDATETIMEOFFSET()
        WHERE id = @assetId AND lodge_id = @lodgeId AND status = 'UNDER_REPAIR'
      `);
  } else if (next.status === 'IN_PROGRESS' && current.status !== 'IN_PROGRESS') {
    await pool
      .request()
      .input('lodgeId', sql.BigInt, lodgeId)
      .input('assetId', sql.BigInt, current.assetId)
      .query(`
        UPDATE dbo.assets SET status = 'UNDER_REPAIR', updated_at = SYSDATETIMEOFFSET()
        WHERE id = @assetId AND lodge_id = @lodgeId AND status = 'IN_USE'
      `);
  }

  return getWorkOrder(lodgeId, workOrderId);
}

module.exports = {
  listCategories,
  createCategory,
  listAssets,
  getAsset,
  getAssetByQrToken,
  createAsset,
  createAssetsBulk,
  updateAsset,
  billExists,
  getBillFilename,
  setAssetStatus,
  setAssetActive,
  listCoveragePeriods,
  addCoveragePeriod,
  deleteCoveragePeriod,
  listVendors,
  createVendor,
  updateVendor,
  listWorkOrders,
  getWorkOrder,
  createWorkOrder,
  createWorkOrdersBulk,
  updateWorkOrder,
};
