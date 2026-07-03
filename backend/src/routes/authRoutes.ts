import { Router } from "express";
import { getMe, login, logout, register, switchActiveSchool } from "../controllers/authController.js";
import { protect } from "../middleware/auth.js";

const router = Router();

router.post("/register", register);
router.post("/login", login);
router.post("/logout", logout);
router.get("/me", protect, getMe);
router.post("/active-school", protect, switchActiveSchool);

export default router;
