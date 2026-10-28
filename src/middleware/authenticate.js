const jwt = require('jsonwebtoken');
const { ApiError } = require('./errorHandler');
const { logger } = require('../config/logger');

// Best-effort "last seen" stamp for the superadmin panel, fired on every
// authenticated request so it reflects real activity rather than just login
// or token refresh — the web app never calls /auth/refresh, so that alone
// would leave last_seen stale for an entire shift. Required lazily to avoid
// a startup import cycle, the same precaution requirePermission takes below.
// Never awaited: a DB hiccup here must not block or fail the real request.
function touchLastSeen(userId) {
  const { touchLastSeen: touch } = require('../modules/auth/auth.service');
  touch(userId).catch((err) => logger.warn({ err, userId }, 'Could not update last_seen'));
}

function authenticate(req, res, next) {
  const header = req.headers.authorization;
  const token = header?.startsWith('Bearer ') ? header.slice(7) : null;

  if (!token) {
    return next(new ApiError('Sign in required.', 401));
  }

  try {
    req.user = jwt.verify(token, process.env.JWT_SECRET);
    touchLastSeen(req.user.sub);
    next();
  } catch {
    next(new ApiError('Session expired. Sign in again.', 401));
  }
}

function requireRole(...roles) {
  return (req, res, next) => {
    if (!req.user || !roles.includes(req.user.role)) {
      return next(new ApiError('Not allowed.', 403));
    }
    next();
  };
}

// Any signed-in member of a lodge, whatever their role — used for routes like
// /me that every staff login needs regardless of what they can reach.
function requireLodgeUser(req, res, next) {
  if (!req.user || req.user.role === 'SUPERADMIN' || req.user.lodgeId == null) {
    return next(new ApiError('Not allowed.', 403));
  }
  next();
}

// Authorises against the caller's *effective* permissions rather than a fixed
// role name, so lodge-defined roles and per-lodge overrides of the built-ins
// are honoured. Passing several permissions means "any of these".
//
// Resolved per request instead of being baked into the JWT: a permission change
// has to take effect immediately, not whenever the user next signs in. It's one
// indexed lookup, and required lazily to avoid a startup import cycle
// (roles.service -> connection -> ... -> this middleware).
function requirePermission(...permissions) {
  return async (req, res, next) => {
    try {
      if (!req.user || req.user.role === 'SUPERADMIN' || req.user.lodgeId == null) {
        throw new ApiError('Not allowed.', 403);
      }
      const rolesService = require('../modules/roles/roles.service');
      const { permissionAvailableFor } = require('../modules/roles/permissions');
      const [role, capabilities] = await Promise.all([
        rolesService.getEffectiveRole(req.user.lodgeId, req.user.role),
        rolesService.getLodgeCapabilities(req.user.lodgeId),
      ]);
      if (!role || !role.isActive) {
        throw new ApiError('Not allowed.', 403);
      }
      // A permission only counts if the property has the section it belongs to
      // (events, assets, expenses, food ...). The role row can still hold one the
      // property was later switched off from; it must not keep working.
      const granted = role.permissions.filter((p) => permissionAvailableFor(p, capabilities));
      if (!permissions.some((p) => granted.includes(p))) {
        throw new ApiError('Not allowed.', 403);
      }
      req.permissions = granted;
      next();
    } catch (err) {
      next(err);
    }
  };
}

// For features with no permission of their own (Other services is run under
// the rooms/bookings/billing permissions): the property must have the add-on
// switched on. Any one of the named capabilities is enough.
function requireCapability(...flags) {
  return async (req, res, next) => {
    try {
      if (!req.user || req.user.lodgeId == null) {
        throw new ApiError('Not allowed.', 403);
      }
      const rolesService = require('../modules/roles/roles.service');
      const capabilities = await rolesService.getLodgeCapabilities(req.user.lodgeId);
      if (!flags.some((flag) => capabilities[flag])) {
        throw new ApiError('This property does not have that feature.', 403);
      }
      next();
    } catch (err) {
      next(err);
    }
  };
}

module.exports = { authenticate, requireRole, requireLodgeUser, requirePermission, requireCapability };
