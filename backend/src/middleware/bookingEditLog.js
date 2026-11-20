const { getPool, sql } = require('../config/connection');
const { logger } = require('../config/logger');

// Records who changed a booking and from which device. audit_log already holds
// the before/after values but cannot name a person (one shared DB login), so
// this adds the who + device + IP. Mount AFTER authenticate on mutating routes.
//
// Runs once the response is sent and never touches the request: a failure here
// costs a log row, not a booking. Only 2xx writes are logged, and only the
// names of the body fields, not their values (guest details, ID numbers).
function bookingEditLog(req, res, next) {
  let responseId = null;
  const json = res.json.bind(res);
  res.json = (data) => {
    responseId = data?.booking?.id ?? data?.id ?? null;
    return json(data);
  };

  res.on('finish', () => {
    if (res.statusCode >= 300 || !req.user?.lodgeId) return;
    const bookingId = Number(req.params.id) || Number(responseId) || null;
    const deviceId = String(req.get('X-Device-Id') || '').slice(0, 64) || null;
    const fields = Object.keys(req.body || {}).join(',').slice(0, 1000) || null;
    getPool()
      .then((pool) =>
        pool
          .request()
          .input('lodgeId', sql.BigInt, req.user.lodgeId)
          .input('bookingId', sql.BigInt, bookingId)
          .input('userId', sql.BigInt, req.user.sub)
          .input('role', sql.NVarChar(20), req.user.role)
          .input('deviceId', sql.NVarChar(64), deviceId)
          .input('ip', sql.NVarChar(45), (req.ip || '').slice(0, 45) || null)
          .input('action', sql.NVarChar(200), `${req.method} ${req.baseUrl}${req.route?.path ?? ''}`.slice(0, 200))
          .input('fields', sql.NVarChar(1000), fields).query(`
            INSERT INTO dbo.booking_edit_log
              (lodge_id, booking_id, user_id, user_role, device_id, client_ip, action, fields)
            VALUES (@lodgeId, @bookingId, @userId, @role, @deviceId, @ip, @action, @fields)`)
      )
      .catch((err) => logger.warn({ err, bookingId }, 'Could not write booking edit log'));
  });
  next();
}

module.exports = { bookingEditLog };
