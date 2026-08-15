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

function errorHandler(err, req, res, next) { // eslint-disable-line no-unused-vars
  const statusCode = err.statusCode || 500;
  if (statusCode === 500) {
    console.error(err);
  }
  res.status(statusCode).json({
    success: false,
    error: statusCode === 500 ? 'Something went wrong.' : err.message,
    // Never on a 500: that message is deliberately generic, and pinning it to a
    // field would tell the user their input caused something it didn't.
    ...(err.field && statusCode !== 500 ? { field: err.field } : {}),
  });
}

module.exports = { ApiError, errorHandler };
