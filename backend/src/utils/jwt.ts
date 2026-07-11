import type { CookieOptions, Response } from "express";
import jwt, { type Secret, type SignOptions } from "jsonwebtoken";
import { env } from "../config/env.js";
import type { UserRole } from "@phit-erp/shared";

interface SignPayload {
  userId: string;
  role: UserRole;
  email: string;
  schoolId?: string | null;
}

export const signJwt = (payload: SignPayload): string =>
  jwt.sign(payload, env.JWT_SECRET as Secret, {
    expiresIn: env.JWT_EXPIRES_IN as SignOptions["expiresIn"]
  });

const cookieSecure =
  env.COOKIE_SECURE || env.COOKIE_SAME_SITE === "none" || env.NODE_ENV === "production";

const baseCookieOptions = (): CookieOptions => ({
  httpOnly: true,
  secure: cookieSecure,
  sameSite: env.COOKIE_SAME_SITE,
  path: "/",
  maxAge: 7 * 24 * 60 * 60 * 1000,
  ...(env.COOKIE_DOMAIN ? { domain: env.COOKIE_DOMAIN } : {})
});

export const setAuthCookie = (res: Response, token: string): void => {
  res.cookie(env.COOKIE_NAME, token, baseCookieOptions());
};

export const setActiveSchoolCookie = (res: Response, schoolId: string): void => {
  res.cookie(env.ACTIVE_SCHOOL_COOKIE_NAME, schoolId, baseCookieOptions());
};

/**
 * Clear cookies using the same attributes as setCookie.
 * Also try the opposite `secure` flag so a cookie set under a previous config still clears.
 */
const clearCookieBothSecureModes = (
  res: Response,
  name: string,
  options: CookieOptions
): void => {
  res.clearCookie(name, options);
  res.clearCookie(name, { ...options, secure: !options.secure });
};

export const clearAuthCookie = (res: Response): void => {
  const options: CookieOptions = {
    httpOnly: true,
    sameSite: env.COOKIE_SAME_SITE,
    secure: cookieSecure,
    path: "/",
    ...(env.COOKIE_DOMAIN ? { domain: env.COOKIE_DOMAIN } : {})
  };
  clearCookieBothSecureModes(res, env.COOKIE_NAME, options);
};

export const clearActiveSchoolCookie = (res: Response): void => {
  const options: CookieOptions = {
    httpOnly: true,
    sameSite: env.COOKIE_SAME_SITE,
    secure: cookieSecure,
    path: "/",
    ...(env.COOKIE_DOMAIN ? { domain: env.COOKIE_DOMAIN } : {})
  };
  clearCookieBothSecureModes(res, env.ACTIVE_SCHOOL_COOKIE_NAME, options);
};
