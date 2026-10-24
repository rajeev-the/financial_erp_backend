/**
 * An error the client is allowed to see.
 *
 * Anything thrown that is *not* an ApiError is treated as a bug by the error
 * middleware and reported as a generic 500, so an accidental SQL or driver
 * message can never reach the browser.
 */
export class ApiError extends Error {
  constructor(statusCode, message, details = undefined) {
    super(message);
    this.name = "ApiError";
    this.statusCode = statusCode;
    this.details = details;
  }

  static badRequest(message = "Bad Request", details) {
    return new ApiError(400, message, details);
  }

  static unauthorized(message = "Authentication required") {
    return new ApiError(401, message);
  }

  static forbidden(message = "You do not have access to this resource") {
    return new ApiError(403, message);
  }

  static notFound(message = "Not found") {
    return new ApiError(404, message);
  }

  static tooManyRequests(
    message = "Too many requests. Please try again later.",
  ) {
    return new ApiError(429, message);
  }

  static internal(message = "Internal Server Error", details) {
    return new ApiError(500, message, details);
  }
}

export default ApiError;
