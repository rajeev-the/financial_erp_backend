import { ApiError } from '../utils/api-error.js';
import { ACCESS_COOKIE, verifyAccessToken } from '../utils/tokens.js';

export function authenticate(req, _res, next) {
  const header = req.headers.authorization;
  const bearer = header?.startsWith('Bearer ') ? header.slice(7) : null;
  const token = bearer || req.cookies?.[ACCESS_COOKIE];

  if (!token) {
    return next(ApiError.unauthorized());
  }

  try {
    const claims = verifyAccessToken(token);

    req.user = {
      id: claims.id
    };

    return next();
  } catch {
    return next(ApiError.unauthorized('Session expired or invalid'));
  }
}

export function optionalAuthenticate(req, _res, next) {
  const header = req.headers.authorization;
  const bearer = header?.startsWith('Bearer ') ? header.slice(7) : null;
  const token = bearer || req.cookies?.[ACCESS_COOKIE];

  if (!token) {
    return next();
  }

  try {
    const claims = verifyAccessToken(token);

    req.user = {
      id: claims.sub,
      email: claims.email,
      organisationId: claims.organisationId,
      roleSlug: claims.roleSlug,
      isPlatformAdmin: Boolean(claims.isPlatformAdmin),
    };
  } catch {
    // An expired token is treated as no token: the caller is anonymous, not
    // rejected, because that is the whole point of this variant.
  }

  return next();
}

/** Layer on top of `authenticate` for admin-only routes. */
export function requirePlatformAdmin(req, _res, next) {
  if (!req.user?.isPlatformAdmin) {
    return next(ApiError.forbidden('Platform admin access required'));
  }

  return next();
}
