const { loginSchema } = require('./auth.schema');
const authService = require('./auth.service');
const { ApiError } = require('../../middleware/errorHandler');

function parseCredentials(body) {
  const parsed = loginSchema.safeParse(body);
  if (!parsed.success) {
    throw new ApiError(parsed.error.issues[0].message, 400);
  }
  return parsed.data;
}

async function loginHandler(req, res, next) {
  try {
    const session = await authService.login(parseCredentials(req.body));
    res.json(session);
  } catch (err) {
    next(err);
  }
}

async function adminLoginHandler(req, res, next) {
  try {
    const session = await authService.adminLogin(parseCredentials(req.body));
    res.json(session);
  } catch (err) {
    next(err);
  }
}

module.exports = { loginHandler, adminLoginHandler };
