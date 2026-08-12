import { Router } from "express";
import {
  changePassword,
  getMe,
  login,
  logout,
  register,
  switchActiveSchool,
  updateProfile
} from "../controllers/authController.js";
import { optionalAuth, protect } from "../middleware/auth.js";
import { rateLimit } from "../middleware/rateLimit.js";

const router = Router();

const authStrictLimit = rateLimit({
  name: "auth-strict",
  max: 20,
  windowMs: 15 * 60 * 1000,
  lockMs: 15 * 60 * 1000,
  message: "Too many authentication attempts. Please try again in 15 minutes."
});

/**
 * Login throttling is keyed per **account**, not per IP.
 *
 * An institution sits behind one public IP, so an IP-keyed counter is really a
 * campus-wide counter: once ten people had signed in (successfully!) within the
 * window, everyone else was locked out for 15 minutes. Both limiters below also
 * refund successful sign-ins, so only wrong passwords accumulate.
 */
const loginAccountLimit = rateLimit({
  name: "auth-login-account",
  max: process.env.NODE_ENV === "production" ? 8 : 40,
  windowMs: 15 * 60 * 1000,
  lockMs: process.env.NODE_ENV === "production" ? 10 * 60 * 1000 : 60 * 1000,
  countOnlyFailures: true,
  keyGenerator: (req) => {
    const raw = (req.body as { email?: unknown } | undefined)?.email;
    const account = typeof raw === "string" ? raw.toLowerCase().trim() : "";
    return account || "unknown-account";
  },
  message: "Too many failed sign-in attempts for this login ID."
});

/**
 * Wide flood guard so a scripted attack against many accounts from one host is
 * still stopped. Sized for a shared campus connection — normal typos across a
 * college never reach it.
 */
const loginIpLimit = rateLimit({
  name: "auth-login-ip",
  max: process.env.NODE_ENV === "production" ? 100 : 200,
  windowMs: 15 * 60 * 1000,
  lockMs: 5 * 60 * 1000,
  countOnlyFailures: true,
  message: "Too many failed sign-in attempts from this network."
});

const registerLimit = rateLimit({
  name: "auth-register",
  max: 8,
  windowMs: 60 * 60 * 1000,
  lockMs: 30 * 60 * 1000,
  message: "Too many registration attempts. Please try again later."
});

router.post("/register", registerLimit, register);
router.post("/login", loginIpLimit, loginAccountLimit, login);
router.post("/logout", logout);
/** Optional auth: 200 + null when logged out (avoids console 401 on first visit). */
router.get("/me", optionalAuth, getMe);
router.put("/profile", protect, updateProfile);
router.post("/change-password", protect, authStrictLimit, changePassword);
router.post("/active-school", protect, switchActiveSchool);

export default router;
