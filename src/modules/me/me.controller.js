const meService = require('./me.service');
const { changePasswordSchema, sendPasswordOtpSchema } = require('./me.schema');
const { ApiError } = require('../../middleware/errorHandler');

async function getMeHandler(req, res, next) {
  try {
    const me = await meService.getMe(req.user.sub);
    res.json(me);
  } catch (err) {
    next(err);
  }
}

async function sendPasswordOtpHandler(req, res, next) {
  try {
    const parsed = sendPasswordOtpSchema.safeParse(req.body);
    if (!parsed.success) {
      throw new ApiError(parsed.error.issues[0].message, 400);
    }
    const { phone, expiresAt } = await meService.sendPasswordChangeOtp(
      req.user.sub,
      parsed.data.currentPassword
    );
    res.json({ phone, expiresAt });
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
    await meService.changePassword(
      req.user.sub,
      parsed.data.currentPassword,
      parsed.data.newPassword,
      parsed.data.otp
    );
    res.status(204).end();
  } catch (err) {
    next(err);
  }
}

module.exports = { getMeHandler, sendPasswordOtpHandler, changePasswordHandler };
