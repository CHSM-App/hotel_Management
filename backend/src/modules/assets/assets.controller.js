const {
  categorySchema,
  assetSchema,
  bulkAssetSchema,
  coveragePeriodSchema,
  updateAssetStatusSchema,
  vendorSchema,
  createWorkOrderSchema,
  bulkWorkOrderSchema,
  updateWorkOrderSchema,
} = require('./assets.schema');
const fs = require('fs');
const path = require('path');
const assetsService = require('./assets.service');
const { ApiError } = require('../../middleware/errorHandler');
const { UPLOAD_DIR: BILL_UPLOAD_DIR } = require('../../middleware/assetBillUpload');

function parse(schema, body) {
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    throw new ApiError(parsed.error.issues[0].message, 400);
  }
  return parsed.data;
}

async function listCategoriesHandler(req, res, next) {
  try {
    const categories = await assetsService.listCategories(req.user.lodgeId);
    res.json({ categories });
  } catch (err) {
    next(err);
  }
}

async function createCategoryHandler(req, res, next) {
  try {
    const category = await assetsService.createCategory(req.user.lodgeId, parse(categorySchema, req.body));
    res.status(201).json({ category });
  } catch (err) {
    next(err);
  }
}

async function listAssetsHandler(req, res, next) {
  try {
    const assets = await assetsService.listAssets(req.user.lodgeId, {
      includeInactive: req.query.includeInactive === 'true',
    });
    res.json({ assets });
  } catch (err) {
    next(err);
  }
}

async function getAssetHandler(req, res, next) {
  try {
    const asset = await assetsService.getAsset(req.user.lodgeId, Number(req.params.id));
    res.json({ asset });
  } catch (err) {
    next(err);
  }
}

async function getAssetByQrHandler(req, res, next) {
  try {
    const asset = await assetsService.getAssetByQrToken(req.user.lodgeId, req.params.token);
    res.json({ asset });
  } catch (err) {
    next(err);
  }
}

async function createAssetHandler(req, res, next) {
  try {
    const asset = await assetsService.createAsset(
      req.user.lodgeId,
      parse(assetSchema, req.body),
      req.file?.filename
    );
    res.status(201).json({ asset });
  } catch (err) {
    // A validation failure after multer already wrote the file leaves it
    // orphaned on disk — nothing in the database ever points to it.
    if (req.file) fs.unlink(req.file.path, () => {});
    next(err);
  }
}

async function updateAssetHandler(req, res, next) {
  try {
    const asset = await assetsService.updateAsset(
      req.user.lodgeId,
      Number(req.params.id),
      parse(assetSchema, req.body),
      req.file?.filename
    );
    res.json({ asset });
  } catch (err) {
    if (req.file) fs.unlink(req.file.path, () => {});
    next(err);
  }
}

// units arrives as a JSON string inside the multipart body — the bill file
// rides in the same request, so this can't be a plain JSON POST.
function parseJsonArrayField(value) {
  if (typeof value !== 'string') return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

async function createAssetsBulkHandler(req, res, next) {
  try {
    const body = { ...req.body, units: parseJsonArrayField(req.body.units) };
    const parsed = parse(bulkAssetSchema, body);
    const assets = await assetsService.createAssetsBulk(
      req.user.lodgeId,
      parsed,
      parsed.units,
      req.file?.filename
    );
    res.status(201).json({ assets });
  } catch (err) {
    if (req.file) fs.unlink(req.file.path, () => {});
    next(err);
  }
}

async function getAssetBillHandler(req, res, next) {
  try {
    const filename = await assetsService.getBillFilename(req.user.lodgeId, Number(req.params.id));
    if (!(await assetsService.billExists(filename))) {
      throw new ApiError('That bill is no longer on file.', 404);
    }
    // basename, not the stored string: the filename comes out of the
    // database, and joining it unexamined is how "../.." reaches somewhere
    // it should not. The upload middleware writes UUID names, so this can
    // only ever be a no-op — which is the point of it being here anyway.
    // Same Cross-Origin-Resource-Policy relaxation as expenses.controller.js —
    // otherwise a cross-origin fetch (e.g. a Flutter web build) is silently
    // blocked by the browser even though CORS allows the origin.
    res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');
    res.sendFile(path.join(BILL_UPLOAD_DIR, path.basename(filename)));
  } catch (err) {
    next(err);
  }
}

async function updateAssetStatusHandler(req, res, next) {
  try {
    const { status } = parse(updateAssetStatusSchema, req.body);
    const asset = await assetsService.setAssetStatus(req.user.lodgeId, Number(req.params.id), status);
    res.json({ asset });
  } catch (err) {
    next(err);
  }
}

async function deleteAssetHandler(req, res, next) {
  try {
    await assetsService.setAssetActive(req.user.lodgeId, Number(req.params.id), false);
    res.status(204).end();
  } catch (err) {
    next(err);
  }
}

async function listCoveragePeriodsHandler(req, res, next) {
  try {
    const periods = await assetsService.listCoveragePeriods(req.user.lodgeId, Number(req.params.id));
    res.json({ periods });
  } catch (err) {
    next(err);
  }
}

async function createCoveragePeriodHandler(req, res, next) {
  try {
    const period = await assetsService.addCoveragePeriod(
      req.user.lodgeId,
      Number(req.params.id),
      parse(coveragePeriodSchema, req.body)
    );
    res.status(201).json({ period });
  } catch (err) {
    next(err);
  }
}

async function updateCoveragePeriodHandler(req, res, next) {
  try {
    const period = await assetsService.updateCoveragePeriod(
      req.user.lodgeId,
      Number(req.params.id),
      Number(req.params.periodId),
      parse(coveragePeriodSchema, req.body)
    );
    res.json({ period });
  } catch (err) {
    next(err);
  }
}

async function deleteCoveragePeriodHandler(req, res, next) {
  try {
    await assetsService.deleteCoveragePeriod(req.user.lodgeId, Number(req.params.id), Number(req.params.periodId));
    res.status(204).end();
  } catch (err) {
    next(err);
  }
}

async function listVendorsHandler(req, res, next) {
  try {
    const vendors = await assetsService.listVendors(req.user.lodgeId, {
      includeInactive: req.query.includeInactive === 'true',
    });
    res.json({ vendors });
  } catch (err) {
    next(err);
  }
}

async function createVendorHandler(req, res, next) {
  try {
    const vendor = await assetsService.createVendor(req.user.lodgeId, parse(vendorSchema, req.body));
    res.status(201).json({ vendor });
  } catch (err) {
    next(err);
  }
}

async function updateVendorHandler(req, res, next) {
  try {
    const vendor = await assetsService.updateVendor(
      req.user.lodgeId,
      Number(req.params.id),
      parse(vendorSchema, req.body)
    );
    res.json({ vendor });
  } catch (err) {
    next(err);
  }
}

async function listWorkOrdersHandler(req, res, next) {
  try {
    const workOrders = await assetsService.listWorkOrders(req.user.lodgeId, {
      assetId: req.query.assetId ? Number(req.query.assetId) : undefined,
      status: req.query.status || undefined,
    });
    res.json({ workOrders });
  } catch (err) {
    next(err);
  }
}

async function createWorkOrderHandler(req, res, next) {
  try {
    const workOrder = await assetsService.createWorkOrder(
      req.user.lodgeId,
      parse(createWorkOrderSchema, req.body),
      req.user.sub
    );
    res.status(201).json({ workOrder });
  } catch (err) {
    next(err);
  }
}

async function createWorkOrdersBulkHandler(req, res, next) {
  try {
    const workOrders = await assetsService.createWorkOrdersBulk(
      req.user.lodgeId,
      parse(bulkWorkOrderSchema, req.body),
      req.user.sub
    );
    res.status(201).json({ workOrders });
  } catch (err) {
    next(err);
  }
}

async function updateWorkOrderHandler(req, res, next) {
  try {
    const workOrder = await assetsService.updateWorkOrder(
      req.user.lodgeId,
      Number(req.params.id),
      parse(updateWorkOrderSchema, req.body)
    );
    res.json({ workOrder });
  } catch (err) {
    next(err);
  }
}

module.exports = {
  listCategoriesHandler,
  createCategoryHandler,
  listAssetsHandler,
  getAssetHandler,
  getAssetByQrHandler,
  createAssetHandler,
  createAssetsBulkHandler,
  updateAssetHandler,
  getAssetBillHandler,
  updateAssetStatusHandler,
  deleteAssetHandler,
  listCoveragePeriodsHandler,
  createCoveragePeriodHandler,
  updateCoveragePeriodHandler,
  deleteCoveragePeriodHandler,
  listVendorsHandler,
  createVendorHandler,
  updateVendorHandler,
  listWorkOrdersHandler,
  createWorkOrderHandler,
  createWorkOrdersBulkHandler,
  updateWorkOrderHandler,
};
