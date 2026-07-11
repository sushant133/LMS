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
import { protect } from "../middleware/auth.js";
import { rateLimit } from "../middleware/rateLimit.js";

const router = Router();

const authStrictLimit = rateLimit({
  name: "auth-strict",
  max: 20,
  windowMs: 15 * 60 * 1000,
  lockMs: 15 * 60 * 1000,
  message: "Too many authentication attempts. Please try again in 15 minutes."
});

const loginLimit = rateLimit({
  name: "auth-login",
  max: 10,
  windowMs: 15 * 60 * 1000,
  lockMs: 15 * 60 * 1000,
  message: "Too many login attempts. Please try again in 15 minutes."
});

const registerLimit = rateLimit({
  name: "auth-register",
  max: 8,
  windowMs: 60 * 60 * 1000,
  lockMs: 30 * 60 * 1000,
  message: "Too many registration attempts. Please try again later."
});

router.post("/register", registerLimit, register);
router.post("/login", loginLimit, login);
router.post("/logout", logout);
router.get("/me", protect, getMe);
router.put("/profile", protect, updateProfile);
router.post("/change-password", protect, authStrictLimit, changePassword);
router.post("/active-school", protect, switchActiveSchool);

export default router;
