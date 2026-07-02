import type { Request, Response } from "express";
import { nepalAddressData } from "@nepal-school-erp/shared";
import { asyncHandler } from "../utils/asyncHandler";
import { sendSuccess } from "../utils/response";

export const getAddressData = asyncHandler(async (_req: Request, res: Response) => sendSuccess(res, "Address data fetched", nepalAddressData));

