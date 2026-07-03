import type { Response } from "express";
import jwt, { type Secret, type SignOptions } from "jsonwebtoken";
import { env } from "../config/env.js";
import type { UserRole } from "@nepal-school-erp/shared";

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

const cookieSecure = env.COOKIE_SAME_SITE === "none" || env.NODE_ENV === "production" || env.COOKIE_SECURE;

const cookieOptions = {
  httpOnly: true,
  secure: cookieSecure,
  sameSite: env.COOKIE_SAME_SITE,
  path: "/",
  maxAge: 7 * 24 * 60 * 60 * 1000
} as const;

export const setAuthCookie = (res: Response, token: string): void => {
  res.cookie(env.COOKIE_NAME, token, cookieOptions);
};

export const setActiveSchoolCookie = (res: Response, schoolId: string): void => {
  res.cookie(env.ACTIVE_SCHOOL_COOKIE_NAME, schoolId, cookieOptions);
};

export const clearAuthCookie = (res: Response): void => {
  res.clearCookie(env.COOKIE_NAME, {
    httpOnly: true,
    sameSite: env.COOKIE_SAME_SITE,
    secure: cookieSecure
  });
};

export const clearActiveSchoolCookie = (res: Response): void => {
  res.clearCookie(env.ACTIVE_SCHOOL_COOKIE_NAME, {
    httpOnly: true,
    sameSite: env.COOKIE_SAME_SITE,
    secure: cookieSecure
  });
};
