class ApiError extends Error {
  constructor(message, statusCode = 400) {
    super(message);
    this.statusCode = statusCode;
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
  });
}

module.exports = { ApiError, errorHandler };
