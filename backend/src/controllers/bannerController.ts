import type { Request, Response } from "express";
import type { Types } from "mongoose";
import { bannerSchema, BANNER_PRIORITY_ORDER, type BannerTargetRole } from "@phit-erp/shared";
import { Banner } from "../models/Banner.js";
import { BannerDismissal } from "../models/BannerDismissal.js";
import { User } from "../models/User.js";
import { asyncHandler } from "../utils/asyncHandler.js";
import { ApiError } from "../utils/apiError.js";
import { getBannerDisplayStatus, isBannerCurrentlyDisplayable, userMatchesBannerTarget } from "../utils/bannerScope.js";
import { sendSuccess } from "../utils/response.js";
import { tenantObjectId, withTenantScope } from "../utils/tenant.js";

type BannerLean = {
  _id: Types.ObjectId;
  schoolId: Types.ObjectId;
  title: string;
  description: string;
  imageUrl?: string;
  buttonText?: string;
  buttonUrl?: string;
  backgroundColor?: string;
  textColor?: string;
  priority: "HIGH" | "MEDIUM" | "LOW";
  startAt: Date;
  endAt: Date;
  isActive: boolean;
  showOnce: boolean;
  dismissible: boolean;
  targetRoles: BannerTargetRole[];
  createdBy: Types.ObjectId;
  createdAt?: Date;
  updatedAt?: Date;
};

const parseBannerDates = (startAt: string, endAt: string) => {
  const start = new Date(startAt);
  const end = new Date(endAt);

  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) {
    throw new ApiError(400, "Invalid start or end date");
  }
  if (end <= start) {
    throw new ApiError(400, "End date must be after start date");
  }

  return { start, end };
};

const serializeBanner = (banner: BannerLean, creatorName?: string) => ({
  _id: banner._id.toString(),
  schoolId: banner.schoolId.toString(),
  title: banner.title,
  description: banner.description,
  imageUrl: banner.imageUrl,
  buttonText: banner.buttonText,
  buttonUrl: banner.buttonUrl,
  backgroundColor: banner.backgroundColor,
  textColor: banner.textColor,
  priority: banner.priority,
  startAt: banner.startAt.toISOString(),
  endAt: banner.endAt.toISOString(),
  isActive: banner.isActive,
  showOnce: banner.showOnce,
  dismissible: banner.dismissible,
  targetRoles: banner.targetRoles,
  createdBy: banner.createdBy.toString(),
  createdByName: creatorName,
  displayStatus: getBannerDisplayStatus(banner.isActive, banner.startAt, banner.endAt),
  createdAt: banner.createdAt?.toISOString(),
  updatedAt: banner.updatedAt?.toISOString()
});

const enrichBanners = async (banners: BannerLean[]) => {
  const userIds = [...new Set(banners.map((banner) => banner.createdBy.toString()))];
  const users = await User.find({ _id: { $in: userIds } }).select("fullName").lean();
  const userById = new Map(users.map((user) => [user._id.toString(), user.fullName]));

  return banners.map((banner) => serializeBanner(banner, userById.get(banner.createdBy.toString())));
};

const sortBannersByPriority = <T extends { priority: "HIGH" | "MEDIUM" | "LOW" }>(banners: T[]) =>
  [...banners].sort((left, right) => BANNER_PRIORITY_ORDER[left.priority] - BANNER_PRIORITY_ORDER[right.priority]);

export const listBanners = asyncHandler(async (req: Request, res: Response) => {
  const banners = await Banner.find(withTenantScope(req)).sort({ createdAt: -1 }).lean();
  return sendSuccess(res, "Banners fetched", await enrichBanners(banners as BannerLean[]));
});

export const listActiveBanners = asyncHandler(async (req: Request, res: Response) => {
  const schoolId = tenantObjectId(req);
  const now = new Date();
  const userId = req.user?.userId;

  const banners = await Banner.find({
    schoolId,
    isActive: true,
    startAt: { $lte: now },
    endAt: { $gte: now }
  }).lean();

  const roleMatched = (banners as BannerLean[]).filter((banner) => userMatchesBannerTarget(req.user?.role, banner.targetRoles));

  let visible = roleMatched;
  if (userId) {
    const dismissedIds = await BannerDismissal.find({
      schoolId,
      userId,
      bannerId: { $in: roleMatched.filter((banner) => banner.showOnce).map((banner) => banner._id) }
    }).distinct("bannerId");
    const dismissedSet = new Set(dismissedIds.map((id) => id.toString()));
    visible = roleMatched.filter((banner) => !banner.showOnce || !dismissedSet.has(banner._id.toString()));
  }

  return sendSuccess(res, "Active banners fetched", sortBannersByPriority(visible.map((banner) => serializeBanner(banner))));
});

export const createBanner = asyncHandler(async (req: Request, res: Response) => {
  const payload = bannerSchema.parse(req.body);
  const { start, end } = parseBannerDates(payload.startAt, payload.endAt);

  const banner = await Banner.create({
    ...payload,
    imageUrl: payload.imageUrl || undefined,
    buttonText: payload.buttonText || undefined,
    buttonUrl: payload.buttonUrl || undefined,
    backgroundColor: payload.backgroundColor || undefined,
    textColor: payload.textColor || undefined,
    startAt: start,
    endAt: end,
    schoolId: tenantObjectId(req),
    createdBy: req.user?.userId
  });

  const creator = await User.findById(req.user?.userId).select("fullName").lean();
  return sendSuccess(res, "Banner created successfully", serializeBanner(banner.toObject() as BannerLean, creator?.fullName), 201);
});

export const updateBanner = asyncHandler(async (req: Request, res: Response) => {
  const payload = bannerSchema.parse(req.body);
  const { start, end } = parseBannerDates(payload.startAt, payload.endAt);

  const banner = await Banner.findOneAndUpdate(
    withTenantScope(req, { _id: req.params.id }),
    {
      ...payload,
      imageUrl: payload.imageUrl || undefined,
      buttonText: payload.buttonText || undefined,
      buttonUrl: payload.buttonUrl || undefined,
      backgroundColor: payload.backgroundColor || undefined,
      textColor: payload.textColor || undefined,
      startAt: start,
      endAt: end
    },
    { new: true }
  ).lean();

  if (!banner) {
    throw new ApiError(404, "Banner not found");
  }

  const creator = await User.findById(banner.createdBy).select("fullName").lean();
  return sendSuccess(res, "Banner updated successfully", serializeBanner(banner as BannerLean, creator?.fullName));
});

export const duplicateBanner = asyncHandler(async (req: Request, res: Response) => {
  const existing = await Banner.findOne(withTenantScope(req, { _id: req.params.id })).lean();
  if (!existing) {
    throw new ApiError(404, "Banner not found");
  }

  const banner = await Banner.create({
    schoolId: existing.schoolId,
    title: `${existing.title} (Copy)`,
    description: existing.description,
    imageUrl: existing.imageUrl,
    buttonText: existing.buttonText,
    buttonUrl: existing.buttonUrl,
    backgroundColor: existing.backgroundColor,
    textColor: existing.textColor,
    priority: existing.priority,
    startAt: existing.startAt,
    endAt: existing.endAt,
    isActive: false,
    showOnce: existing.showOnce,
    dismissible: existing.dismissible,
    targetRoles: existing.targetRoles,
    createdBy: req.user?.userId
  });

  const creator = await User.findById(req.user?.userId).select("fullName").lean();
  return sendSuccess(res, "Banner duplicated successfully", serializeBanner(banner.toObject() as BannerLean, creator?.fullName), 201);
});

export const toggleBannerActive = asyncHandler(async (req: Request, res: Response) => {
  const existing = await Banner.findOne(withTenantScope(req, { _id: req.params.id }));
  if (!existing) {
    throw new ApiError(404, "Banner not found");
  }

  existing.isActive = !existing.isActive;
  await existing.save();

  const creator = await User.findById(existing.createdBy).select("fullName").lean();
  return sendSuccess(
    res,
    existing.isActive ? "Banner activated" : "Banner deactivated",
    serializeBanner(existing.toObject() as BannerLean, creator?.fullName)
  );
});

export const deleteBanner = asyncHandler(async (req: Request, res: Response) => {
  const banner = await Banner.findOneAndDelete(withTenantScope(req, { _id: req.params.id }));
  if (!banner) {
    throw new ApiError(404, "Banner not found");
  }

  await BannerDismissal.deleteMany({ bannerId: banner._id });
  return sendSuccess(res, "Banner deleted successfully");
});

export const dismissBanner = asyncHandler(async (req: Request, res: Response) => {
  const schoolId = tenantObjectId(req);
  const userId = req.user?.userId;
  if (!userId) {
    throw new ApiError(401, "Authentication required");
  }

  const banner = await Banner.findOne({
    schoolId,
    _id: req.params.id,
    isActive: true
  }).lean();

  if (!banner) {
    throw new ApiError(404, "Banner not found");
  }

  if (!userMatchesBannerTarget(req.user?.role, (banner as BannerLean).targetRoles)) {
    throw new ApiError(403, "This banner is not visible to your role");
  }

  if (!isBannerCurrentlyDisplayable(banner.isActive, banner.startAt, banner.endAt)) {
    throw new ApiError(400, "This banner is not currently active");
  }

  if (banner.showOnce) {
    await BannerDismissal.findOneAndUpdate(
      { schoolId, userId, bannerId: banner._id },
      { schoolId, userId, bannerId: banner._id },
      { upsert: true, new: true, setDefaultsOnInsert: true }
    );
  }

  return sendSuccess(res, "Banner dismissed");
});

export const getActiveBannersForUser = async (req: Request) => {
  const schoolId = tenantObjectId(req);
  const now = new Date();
  const userId = req.user?.userId;

  const banners = await Banner.find({
    schoolId,
    isActive: true,
    startAt: { $lte: now },
    endAt: { $gte: now }
  }).lean();

  const roleMatched = (banners as BannerLean[]).filter((banner) => userMatchesBannerTarget(req.user?.role, banner.targetRoles));

  if (!userId) {
    return sortBannersByPriority(roleMatched.map((banner) => serializeBanner(banner)));
  }

  const dismissedIds = await BannerDismissal.find({
    schoolId,
    userId,
    bannerId: { $in: roleMatched.filter((banner) => banner.showOnce).map((banner) => banner._id) }
  }).distinct("bannerId");
  const dismissedSet = new Set(dismissedIds.map((id) => id.toString()));

  return sortBannersByPriority(
    roleMatched
      .filter((banner) => !banner.showOnce || !dismissedSet.has(banner._id.toString()))
      .map((banner) => serializeBanner(banner))
  );
};