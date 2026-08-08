const meService = require('./me.service');
const { changePasswordSchema } = require('./me.schema');
const { ApiError } = require('../../middleware/errorHandler');

async function getMeHandler(req, res, next) {
  try {
    const me = await meService.getMe(req.user.sub);
    res.json(me);
  } catch (err) {
    next(err);
  }
}

async function changePasswordHandler(req, res, next) {
  try {
    const parsed = changePasswordSchema.safeParse(req.body);
    if (!parsed.success) {
      throw new ApiError(parsed.error.issues[0].message, 400);
    }
    await meService.changePassword(req.user.sub, parsed.data.currentPassword, parsed.data.newPassword);
    res.status(204).end();
  } catch (err) {
    next(err);
  }
}

module.exports = { getMeHandler, changePasswordHandler };
