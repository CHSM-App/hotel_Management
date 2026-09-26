const { createLodgeSchema, updateLodgeSchema } = require('./lodges.schema');
const lodgesService = require('./lodges.service');
const menuService = require('../menu/menu.service');
const { menuImportSchema } = require('../menu/menu.schema');
const { ApiError } = require('../../middleware/errorHandler');

async function createLodgeHandler(req, res, next) {
  try {
    const parsed = createLodgeSchema.safeParse(req.body);
    if (!parsed.success) {
      throw new ApiError(parsed.error.issues[0].message, 400);
    }

    const result = await lodgesService.createLodgeWithOwner(parsed.data);
    res.status(201).json(result);
  } catch (err) {
    next(err);
  }
}

async function listLodgesHandler(req, res, next) {
  try {
    const lodges = await lodgesService.listLodges();
    res.json({ lodges });
  } catch (err) {
    next(err);
  }
}

async function getLodgeHandler(req, res, next) {
  try {
    // A non-numeric :id would reach SQL Server as a failed BigInt conversion
    // (a 500) rather than the "no such lodge" this actually is.
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) {
      throw new ApiError('Lodge not found.', 404);
    }

    const detail = await lodgesService.getLodgeDetail(id);
    res.json(detail);
  } catch (err) {
    next(err);
  }
}

async function updateLodgeHandler(req, res, next) {
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) {
      throw new ApiError('Lodge not found.', 404);
    }
    const parsed = updateLodgeSchema.safeParse(req.body ?? {});
    if (!parsed.success) {
      throw new ApiError(parsed.error.issues[0].message, 400);
    }
    const detail = await lodgesService.updateLodge(id, parsed.data);
    res.json(detail);
  } catch (err) {
    next(err);
  }
}

async function updateLodgeLogoHandler(req, res, next) {
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) {
      throw new ApiError('Lodge not found.', 404);
    }
    const detail = await lodgesService.updateLodgeLogo(id, req.file.filename);
    res.json(detail);
  } catch (err) {
    next(err);
  }
}

async function removeLodgeLogoHandler(req, res, next) {
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) {
      throw new ApiError('Lodge not found.', 404);
    }
    const detail = await lodgesService.removeLodgeLogo(id);
    res.json(detail);
  } catch (err) {
    next(err);
  }
}

// Same bulk import as a lodge owner's own menu.routes.js POST /import, just
// reached with the lodge named in the URL instead of taken from the token —
// SUPERADMIN carries no lodgeId (see requirePermission), so it can't use that
// route directly. Delegates to the same menuService.importRows either way.
async function importLodgeMenuHandler(req, res, next) {
  try {
    const id = Number(req.params.id);
    const parsed = menuImportSchema.safeParse(req.body);
    if (!parsed.success) {
      throw new ApiError(parsed.error.issues[0].message, 400);
    }
    const result = await menuService.importRows(id, parsed.data.rows);
    res.json(result);
  } catch (err) {
    next(err);
  }
}

// TEMPORARY — for pushing the demo dish photos a local seed script downloaded
// onto the live server's disk, since uploads/ is gitignored and never reaches
// production through a normal deploy (see .github/workflows/deploy.yml). One
// file per call, matched to an item already on this lodge's menu by dish name
// (the pusher script only has names, from menu-image-credits.json — no id).
// Remove once the one-off backfill this exists for is done; nothing else
// calls it.
async function uploadLodgeMenuItemImageHandler(req, res, next) {
  try {
    const lodgeId = Number(req.params.id);
    if (!req.file) {
      throw new ApiError('No image file was sent.', 400);
    }
    const dishName = String(req.body.dishName || '').trim().toLowerCase();
    if (!dishName) {
      throw new ApiError('dishName is required.', 400);
    }

    const current = await menuService.getMenu(lodgeId);
    const item = current.flatMap((c) => c.items).find((i) => i.name.trim().toLowerCase() === dishName);
    if (!item) {
      throw new ApiError('That item was not found on this lodge’s menu.', 404);
    }

    const result = await menuService.updateItem(lodgeId, item.id, {
      categoryId: item.categoryId,
      name: item.name,
      description: item.description,
      price: item.price,
      foodType: item.foodType,
      sortOrder: item.sortOrder,
      imageFilename: req.file.filename,
    });
    res.json(result);
  } catch (err) {
    next(err);
  }
}

module.exports = {
  createLodgeHandler,
  listLodgesHandler,
  getLodgeHandler,
  updateLodgeHandler,
  updateLodgeLogoHandler,
  removeLodgeLogoHandler,
  importLodgeMenuHandler,
  uploadLodgeMenuItemImageHandler,
};
