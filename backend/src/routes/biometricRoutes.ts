import { Router } from "express";
import { biometricHealth, ingestBiometricPunches } from "../controllers/biometricController.js";
import { biometricApiKeyAuth } from "../middleware/biometricAuth.js";
import { rateLimit } from "../middleware/rateLimit.js";

const router = Router();

const punchRateLimit = rateLimit({
  name: "biometric-punches",
  max: 120,
  windowMs: 60_000,
  message: "Too many biometric punch requests; try again shortly"
});

// Device integration only — no JWT / tenant session
router.get("/health", biometricApiKeyAuth, biometricHealth);
router.post("/punches", punchRateLimit, biometricApiKeyAuth, ingestBiometricPunches);

export default router;
