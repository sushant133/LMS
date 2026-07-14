import type { Request, Response } from "express";
import type { Types } from "mongoose";
import { bannerImageReplaceSchema, bannerSchema } from "@phit-erp/shared";
import { Banner } from "../models/Banner.js";
import { BannerDismissal } from "../models/BannerDismissal.js";
import { User } from "../models/User.js";
import { asyncHandler } from "../utils/asyncHandler.js";
import { ApiError } from "../utils/apiError.js";
import { deleteReplacedMedia, deleteStoredMediaUrls } from "../utils/mediaCleanup.js";
import { sendSuccess } from "../utils/response.js";
import { tenantObjectId, withTenantScope } from "../utils/tenant.js";

type BannerLean = {
  _id: Types.ObjectId;
  schoolId: Types.ObjectId;
  imageUrl: string;
  thumbnailUrl?: string;
  isActive: boolean;
  fileSizeBytes?: number;
  width?: number;
  height?: number;
  originalFileName?: string;
  createdBy: Types.ObjectId;
  createdAt?: Date;
  updatedAt?: Date;
};

const serializeBanner = (banner: BannerLean, creatorName?: string) => ({
  _id: banner._id.toString(),
  schoolId: banner.schoolId.toString(),
  imageUrl: banner.imageUrl,
  thumbnailUrl: banner.thumbnailUrl,
  isActive: banner.isActive,
  fileSizeBytes: banner.fileSizeBytes,
  width: banner.width,
  height: banner.height,
  originalFileName: banner.originalFileName,
  createdBy: banner.createdBy.toString(),
  createdByName: creatorName,
  displayStatus: banner.isActive ? ("ACTIVE" as const) : ("INACTIVE" as const),
  visibilityStatus: banner.isActive ? "Visible on dashboard" : "Hidden",
  createdAt: banner.createdAt?.toISOString(),
  updatedAt: banner.updatedAt?.toISOString()
});

const enrichBanners = async (banners: BannerLean[]) => {
  const userIds = [...new Set(banners.map((banner) => banner.createdBy.toString()))];
  const users = await User.find({ _id: { $in: userIds } }).select("fullName").lean();
  const userById = new Map(users.map((user) => [user._id.toString(), user.fullName]));

  return banners.map((banner) => serializeBanner(banner, userById.get(banner.createdBy.toString())));
};

const getActiveBannerDocs = async (schoolId: ReturnType<typeof tenantObjectId>) =>
  Banner.find({
    schoolId,
    isActive: true,
    imageUrl: { $exists: true, $ne: "" }
  })
    .sort({ createdAt: -1 })
    .lean();

export const listBanners = asyncHandler(async (req: Request, res: Response) => {
  const banners = await Banner.find(withTenantScope(req)).sort({ createdAt: -1 }).lean();
  return sendSuccess(res, "Banners fetched", await enrichBanners(banners as BannerLean[]));
});

export const listActiveBanners = asyncHandler(async (req: Request, res: Response) => {
  const schoolId = tenantObjectId(req);
  const banners = await getActiveBannerDocs(schoolId);
  return sendSuccess(res, "Active banners fetched", (await enrichBanners(banners as BannerLean[])));
});

export const createBanner = asyncHandler(async (req: Request, res: Response) => {
  const payload = bannerSchema.parse(req.body);

  const banner = await Banner.create({
    imageUrl: payload.imageUrl,
    thumbnailUrl: payload.thumbnailUrl,
    isActive: payload.isActive,
    fileSizeBytes: payload.fileSizeBytes,
    width: payload.width,
    height: payload.height,
    originalFileName: payload.originalFileName,
    schoolId: tenantObjectId(req),
    createdBy: req.user?.userId
  });

  const creator = await User.findById(req.user?.userId).select("fullName").lean();
  return sendSuccess(res, "Banner created successfully", serializeBanner(banner.toObject() as BannerLean, creator?.fullName), 201);
});

export const updateBanner = asyncHandler(async (req: Request, res: Response) => {
  const payload = bannerSchema.parse(req.body);

  const existing = await Banner.findOne(withTenantScope(req, { _id: req.params.id })).lean();
  if (!existing) {
    throw new ApiError(404, "Banner not found");
  }

  const banner = await Banner.findOneAndUpdate(
    withTenantScope(req, { _id: req.params.id }),
    {
      imageUrl: payload.imageUrl,
      thumbnailUrl: payload.thumbnailUrl,
      isActive: payload.isActive,
      fileSizeBytes: payload.fileSizeBytes,
      width: payload.width,
      height: payload.height,
      originalFileName: payload.originalFileName
    },
    { new: true }
  ).lean();

  if (!banner) {
    throw new ApiError(404, "Banner not found");
  }

  // Drop previous CDN/local assets when image URLs change
  await Promise.all([
    deleteReplacedMedia(existing.imageUrl, payload.imageUrl),
    deleteReplacedMedia(existing.thumbnailUrl, payload.thumbnailUrl)
  ]);

  const creator = await User.findById(banner.createdBy).select("fullName").lean();
  return sendSuccess(res, "Banner updated successfully", serializeBanner(banner as BannerLean, creator?.fullName));
});

export const replaceBannerImage = asyncHandler(async (req: Request, res: Response) => {
  const payload = bannerImageReplaceSchema.parse(req.body);

  const existing = await Banner.findOne(withTenantScope(req, { _id: req.params.id })).lean();
  if (!existing) {
    throw new ApiError(404, "Banner not found");
  }

  const banner = await Banner.findOneAndUpdate(
    withTenantScope(req, { _id: req.params.id }),
    {
      imageUrl: payload.imageUrl,
      thumbnailUrl: payload.thumbnailUrl,
      fileSizeBytes: payload.fileSizeBytes,
      width: payload.width,
      height: payload.height,
      originalFileName: payload.originalFileName
    },
    { new: true }
  ).lean();

  if (!banner) {
    throw new ApiError(404, "Banner not found");
  }

  await Promise.all([
    deleteReplacedMedia(existing.imageUrl, payload.imageUrl),
    deleteReplacedMedia(existing.thumbnailUrl, payload.thumbnailUrl)
  ]);

  const creator = await User.findById(banner.createdBy).select("fullName").lean();
  return sendSuccess(res, "Banner image replaced", serializeBanner(banner as BannerLean, creator?.fullName));
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
  await deleteStoredMediaUrls([banner.imageUrl, banner.thumbnailUrl]);
  return sendSuccess(res, "Banner deleted successfully");
});

export const dismissBanner = asyncHandler(async (_req: Request, res: Response) => {
  return sendSuccess(res, "Banner dismissed");
});

export const getActiveBannersForUser = async (req: Request) => {
  const schoolId = tenantObjectId(req);
  const banners = await getActiveBannerDocs(schoolId);
  return enrichBanners(banners as BannerLean[]);
};