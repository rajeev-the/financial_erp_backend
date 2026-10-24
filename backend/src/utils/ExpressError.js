class ExpressError extends Error {
  constructor(statusCode, message, details = null) {
    super(message);
    this.name = "ExpressError";
    this.statusCode = statusCode;
    this.details = details;
    Error.captureStackTrace(this, this.constructor);
  }
}

export default ExpressError;