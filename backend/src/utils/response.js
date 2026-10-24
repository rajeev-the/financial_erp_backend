
export function ok(res, data = null, message = "OK", statusCode = 200) {
  return res.status(statusCode).json({ success: true, message, data });
}
export function fail(res, message, statusCode = 400, details = undefined) {
  return res
    .status(statusCode)
    .json({ success: false, message, data: null, details });
}

export function asyncHandler(handler) {
  return (req, res, next) =>
    Promise.resolve(handler(req, res, next)).catch(next);
}

export default { ok, fail, asyncHandler };
