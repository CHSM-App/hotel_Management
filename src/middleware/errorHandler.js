const { logger } = require('../config/logger');

// `field` names the form input a validation message belongs to, when the error
// is about one — it lets a form put the message under the offending field and
// move the cursor there, instead of stacking every failure in a banner at the
// top where the reader has to work out which input it means. Optional, because
// plenty of errors ("Not allowed", a failed lookup) aren't about a field.
class ApiError extends Error {
  constructor(message, statusCode = 400, field = null) {
    super(message);
    this.statusCode = statusCode;
    this.field = field;
  }
}

// What the client is told for a status we did not write a message for.
// Deliberately bland: enough to act on, nothing about what the server is made
// of, where it keeps its files, or which library refused.
const GENERIC = {
  400: 'That request could not be processed.',
  401: 'Sign in required.',
  403: 'Not allowed.',
  404: 'Not found.',
  405: 'That request is not allowed here.',
  409: 'That conflicts with something already saved.',
  413: 'That upload is too large.',
  415: 'That file type is not accepted.',
  429: 'Too many requests. Please wait a moment and try again.',
};

function errorHandler(err, req, res, next) { // eslint-disable-line no-unused-vars
  // Only messages this codebase wrote are safe to repeat back. Everything else
  // — the mssql driver, multer, and http-errors from res.sendFile — carries a
  // message written for a developer reading a terminal, and several of them
  // carry a status code with it.
  //
  // That combination was the leak: a missing ID proof made res.sendFile raise
  // an http-errors 404 whose message is the raw ENOENT, absolute server path
  // included, and because the status was 404 rather than 500 the old code
  // passed it straight to the browser. The 500 path was always sanitised; the
  // 4xx path was the hole, and every library that sets a status could fall
  // through it.
  //
  // So the test is what raised the error, not what status it carries.
  const trusted = err instanceof ApiError;

  // err.status as well as err.statusCode: http-errors sets both, other
  // libraries set only one, and losing a real 404 to a 500 makes the client
  // retry something that will never succeed.
  const statusCode = (trusted ? err.statusCode : err.statusCode || err.status) || 500;

  // Anything not deliberately raised is unexpected, whatever status it wears.
  // Logging only 500s would have made this exact bug invisible: the leak went
  // out as a 404 and nothing recorded that a guest's ID proof had gone missing
  // from disk.
  if (!trusted || statusCode === 500) {
    // Was `console.error(err)`, which dumped the whole error object. For an
    // mssql driver error that includes the failing statement and its bound
    // parameters — guest names, phone numbers, ID proof references — written
    // into an unrotated file. The response was always sanitised; the log was
    // not.
    //
    // req.log is attached per request by pino-http, so this line carries the
    // request id and the acting user, and the serialiser reduces the error to
    // type/message/stack/code. Falls back to the bare logger for the rare error
    // raised before the request logger has run.
    (req.log || logger).error({ err }, 'Unhandled error');
  }
  res.status(statusCode).json({
    success: false,
    error: trusted ? err.message : GENERIC[statusCode] || 'Something went wrong.',
    // Only ever from an ApiError, and never on a 500: that message is
    // deliberately generic, and pinning it to a field would tell the user their
    // input caused something it didn't.
    ...(trusted && err.field && statusCode !== 500 ? { field: err.field } : {}),
  });
}

module.exports = { ApiError, errorHandler };
