/**
 * Coerce to a non-negative integer, falling back when the value is not one.
 *
 * Used at the two places an interval literal is interpolated into SQL. MySQL
 * will not accept a placeholder inside `INTERVAL ? MINUTE`, so those values are
 * concatenated — this function is the reason that is not an injection hole.
 */
export function safeInt(value, fallback) {
  const parsed = Number(value);

  if (!Number.isFinite(parsed) || parsed < 0) {
    return Math.trunc(fallback);
  }

  return Math.trunc(parsed);
}
