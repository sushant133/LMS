import { Router } from "express";
import { getAddressData } from "../controllers/addressController.js";

const router = Router();

router.get("/", getAddressData);

export default router;

