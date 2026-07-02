import { Router } from "express";
import { getMe, login, logout, register, switchActiveSchool } from "../controllers/authController";
import { protect } from "../middleware/auth";

const router = Router();

router.post("/register", register);
router.post("/login", login);
router.post("/logout", logout);
router.get("/me", protect, getMe);
router.post("/active-school", protect, switchActiveSchool);

export default router;
