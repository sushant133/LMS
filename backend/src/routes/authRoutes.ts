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

const router = Router();

router.post("/register", register);
router.post("/login", login);
router.post("/logout", logout);
router.get("/me", protect, getMe);
router.put("/profile", protect, updateProfile);
router.post("/change-password", protect, changePassword);
router.post("/active-school", protect, switchActiveSchool);

export default router;
