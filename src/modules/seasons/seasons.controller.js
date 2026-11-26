const { createSeasonSchema, updateSeasonSchema } = require('./seasons.schema');
const seasonsService = require('./seasons.service');
const { ApiError } = require('../../middleware/errorHandler');

async function listSeasonsHandler(req, res, next) {
  try {
    const seasons = await seasonsService.listSeasons(req.user.lodgeId);
    res.json({ seasons });
  } catch (err) {
    next(err);
  }
}

async function createSeasonHandler(req, res, next) {
  try {
    const parsed = createSeasonSchema.safeParse(req.body);
    if (!parsed.success) {
      throw new ApiError(parsed.error.issues[0].message, 400);
    }

    const result = await seasonsService.createSeason(req.user.lodgeId, parsed.data);
    res.status(201).json(result);
  } catch (err) {
    next(err);
  }
}

async function updateSeasonHandler(req, res, next) {
  try {
    const parsed = updateSeasonSchema.safeParse(req.body);
    if (!parsed.success) {
      throw new ApiError(parsed.error.issues[0].message, 400);
    }

    const result = await seasonsService.updateSeason(req.user.lodgeId, Number(req.params.id), parsed.data);
    res.json(result);
  } catch (err) {
    next(err);
  }
}

async function deleteSeasonHandler(req, res, next) {
  try {
    await seasonsService.deleteSeason(req.user.lodgeId, Number(req.params.id));
    res.status(204).end();
  } catch (err) {
    next(err);
  }
}

module.exports = { listSeasonsHandler, createSeasonHandler, updateSeasonHandler, deleteSeasonHandler };
