import { useRef, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { bannerSchema, type BannerInput, type BannerRecord } from "@phit-erp/shared";
import { Eye, ImageIcon, RefreshCw, Trash2, Upload } from "lucide-react";
import { toast } from "sonner";
import { EmptyState } from "components/shared/EmptyState";
import { FormField } from "components/shared/FormField";
import { Badge } from "components/ui/badge";
import { Button } from "components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "components/ui/card";
import { Table, TableBody, Td, Th, TableHead } from "components/ui/table";
import { api, unwrap } from "lib/api";
import { queryClient } from "lib/queryClient";
import { cn, parseErrorMessage } from "lib/utils";
import {
  BANNER_ACCEPT,
  BANNER_RECOMMENDED_SIZES,
  formatFileSize,
  formatResolution,
  uploadBannerImage,
  type UploadedBannerImage
} from "./bannerUtils";

const defaultBanner: BannerInput = {
  imageUrl: "",
  thumbnailUrl: "",
  isActive: true
};

const statusStyles: Record<string, string> = {
  ACTIVE: "bg-brand-100 text-brand-800",
  INACTIVE: "bg-amber-100 text-amber-800"
};

const formatDateTime = (iso?: string) => {
  if (!iso) return "—";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return date.toLocaleString();
};

export const BannerManager = () => {
  const [form, setForm] = useState<BannerInput>(defaultBanner);
  const [preview, setPreview] = useState<UploadedBannerImage | null>(null);
  const [replacingId, setReplacingId] = useState<string | null>(null);
  const [viewingBanner, setViewingBanner] = useState<BannerRecord | null>(null);
  const [isUploading, setIsUploading] = useState(false);
  const createInputRef = useRef<HTMLInputElement>(null);
  const replaceInputRef = useRef<HTMLInputElement>(null);

  const bannersQuery = useQuery({
    queryKey: ["banners", "manage"],
    queryFn: () => unwrap<BannerRecord[]>(api.get("/banners"))
  });

  const invalidateBannerQueries = async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ["banners"] }),
      queryClient.invalidateQueries({ queryKey: ["dashboard"] })
    ]);
  };

  const saveMutation = useMutation({
    mutationFn: async (payload: BannerInput) => unwrap<BannerRecord>(api.post("/banners", payload)),
    onSuccess: async () => {
      toast.success("Banner saved");
      setForm(defaultBanner);
      setPreview(null);
      await invalidateBannerQueries();
    },
    onError: (error) => toast.error(parseErrorMessage(error))
  });

  const replaceMutation = useMutation({
    mutationFn: async ({ id, payload }: { id: string; payload: UploadedBannerImage }) =>
      unwrap<BannerRecord>(
        api.put(`/banners/${id}/image`, {
          imageUrl: payload.imageUrl,
          thumbnailUrl: payload.thumbnailUrl,
          fileSizeBytes: payload.fileSizeBytes,
          width: payload.width,
          height: payload.height,
          originalFileName: payload.originalFileName
        })
      ),
    onSuccess: async () => {
      toast.success("Banner image replaced");
      setReplacingId(null);
      await invalidateBannerQueries();
    },
    onError: (error) => toast.error(parseErrorMessage(error))
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      await api.delete(`/banners/${id}`);
    },
    onSuccess: async () => {
      toast.success("Banner deleted");
      await invalidateBannerQueries();
    },
    onError: (error) => toast.error(parseErrorMessage(error))
  });

  const toggleMutation = useMutation({
    mutationFn: async (id: string) => unwrap<BannerRecord>(api.post(`/banners/${id}/toggle-active`)),
    onSuccess: async (banner) => {
      toast.success(banner.isActive ? "Banner enabled" : "Banner disabled");
      await invalidateBannerQueries();
    },
    onError: (error) => toast.error(parseErrorMessage(error))
  });

  const banners = bannersQuery.data ?? [];

  const applyUploadedImage = (uploaded: UploadedBannerImage) => {
    setPreview(uploaded);
    setForm((current) => ({
      ...current,
      imageUrl: uploaded.imageUrl,
      thumbnailUrl: uploaded.thumbnailUrl,
      fileSizeBytes: uploaded.fileSizeBytes,
      width: uploaded.width,
      height: uploaded.height,
      originalFileName: uploaded.originalFileName
    }));
  };

  const handleImageUpload = async (event: React.ChangeEvent<HTMLInputElement>, replaceId?: string) => {
    const file = event.target.files?.[0];
    if (!file) return;

    setIsUploading(true);
    try {
      const uploaded = await uploadBannerImage(file);
      if (replaceId) {
        await replaceMutation.mutateAsync({ id: replaceId, payload: uploaded });
      } else {
        applyUploadedImage(uploaded);
        toast.success("Image uploaded");
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Upload failed");
    } finally {
      setIsUploading(false);
      event.target.value = "";
    }
  };

  if (bannersQuery.isLoading) {
    return <EmptyState title="Loading banners" description="Please wait." />;
  }

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>Upload Banner</CardTitle>
          <p className="text-sm text-slate-500">
            Upload a banner image and enable it. Active banners appear as a popup on the dashboard.
          </p>
        </CardHeader>
        <CardContent>
          <form
            className="space-y-4"
            onSubmit={(event) => {
              event.preventDefault();
              const parsed = bannerSchema.safeParse(form);
              if (!parsed.success) {
                toast.error(parsed.error.issues[0]?.message ?? "Validation failed");
                return;
              }
              void saveMutation.mutateAsync(parsed.data);
            }}
          >
            <FormField label="Banner Image">
              <div className="space-y-3">
                <label className="inline-flex cursor-pointer items-center gap-2 rounded-xl border border-dashed border-slate-300 bg-slate-50 px-4 py-3 text-sm hover:bg-slate-100">
                  <Upload className="h-4 w-4" />
                  {isUploading ? "Uploading..." : "Choose image (JPG, JPEG, PNG, WEBP)"}
                  <input
                    ref={createInputRef}
                    type="file"
                    accept={BANNER_ACCEPT}
                    className="hidden"
                    disabled={isUploading}
                    onChange={(event) => void handleImageUpload(event)}
                  />
                </label>
                <p className="text-xs text-slate-500">
                  Recommended: {BANNER_RECOMMENDED_SIZES.join(", ")}. Images are optimized automatically after upload.
                </p>
                {preview?.imageUrl || form.imageUrl ? (
                  <div className="overflow-hidden rounded-2xl border bg-slate-50">
                    <img
                      src={preview?.imageUrl || form.imageUrl}
                      alt="Banner preview"
                      className="max-h-72 w-full object-contain"
                    />
                    <div className="flex flex-wrap items-center justify-between gap-2 border-t px-4 py-3 text-sm text-slate-600">
                      <span>
                        {formatResolution(preview?.width ?? form.width, preview?.height ?? form.height)} ·{" "}
                        {formatFileSize(preview?.fileSizeBytes ?? form.fileSizeBytes)}
                      </span>
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={() => {
                          setPreview(null);
                          setForm(defaultBanner);
                        }}
                      >
                        Remove
                      </Button>
                    </div>
                  </div>
                ) : (
                  <div className="flex items-center gap-2 rounded-xl border border-dashed border-slate-200 px-4 py-8 text-sm text-slate-500">
                    <ImageIcon className="h-4 w-4" />
                    Upload an image to preview it here before saving.
                  </div>
                )}
              </div>
            </FormField>

            <label className="flex items-center gap-2 rounded-xl border border-slate-200 px-3 py-2 text-sm">
              <input
                type="checkbox"
                checked={form.isActive}
                onChange={(event) => setForm((current) => ({ ...current, isActive: event.target.checked }))}
              />
              Enable banner on dashboard
            </label>

            <div className="flex justify-end">
              <Button type="submit" disabled={saveMutation.isPending || !form.imageUrl}>
                Save Banner
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>

      {viewingBanner ? (
        <Card>
          <CardHeader className="flex flex-row items-center justify-between">
            <CardTitle>Banner Preview</CardTitle>
            <Button type="button" variant="outline" size="sm" onClick={() => setViewingBanner(null)}>
              Close
            </Button>
          </CardHeader>
          <CardContent>
            <img src={viewingBanner.imageUrl} alt="Banner preview" className="max-h-[70vh] w-full rounded-2xl object-contain" />
          </CardContent>
        </Card>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle>Banner Management</CardTitle>
        </CardHeader>
        <CardContent>
          <input
            ref={replaceInputRef}
            type="file"
            accept={BANNER_ACCEPT}
            className="hidden"
            onChange={(event) => {
              if (replacingId) {
                void handleImageUpload(event, replacingId);
              }
            }}
          />

          {banners.length === 0 ? (
            <EmptyState title="No banners yet" description="Upload your first dashboard banner above." />
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHead>
                  <tr>
                    <Th>Preview</Th>
                    <Th>Upload Date</Th>
                    <Th>Uploaded By</Th>
                    <Th>Status</Th>
                    <Th>Visibility</Th>
                    <Th>File Size</Th>
                    <Th>Resolution</Th>
                    <Th />
                  </tr>
                </TableHead>
                <TableBody>
                  {banners.map((banner) => (
                    <tr key={banner._id}>
                      <Td>
                        <img
                          src={banner.thumbnailUrl || banner.imageUrl}
                          alt="Banner"
                          className="h-14 w-24 rounded-lg object-cover"
                        />
                      </Td>
                      <Td className="text-xs">{formatDateTime(banner.createdAt)}</Td>
                      <Td className="text-xs">{banner.createdByName ?? "Admin"}</Td>
                      <Td>
                        <Badge className={cn(statusStyles[banner.displayStatus ?? "INACTIVE"])}>
                          {banner.isActive ? "Active" : "Inactive"}
                        </Badge>
                      </Td>
                      <Td className="text-xs">{banner.visibilityStatus ?? (banner.isActive ? "Visible" : "Hidden")}</Td>
                      <Td className="text-xs">{formatFileSize(banner.fileSizeBytes)}</Td>
                      <Td className="text-xs">{formatResolution(banner.width, banner.height)}</Td>
                      <Td className="text-right">
                        <div className="flex flex-wrap justify-end gap-1">
                          <Button type="button" size="sm" variant="outline" onClick={() => setViewingBanner(banner)}>
                            <Eye className="mr-1 h-3.5 w-3.5" />
                            View
                          </Button>
                          <Button
                            type="button"
                            size="sm"
                            variant="outline"
                            disabled={isUploading && replacingId === banner._id}
                            onClick={() => {
                              setReplacingId(banner._id);
                              replaceInputRef.current?.click();
                            }}
                          >
                            <RefreshCw className="mr-1 h-3.5 w-3.5" />
                            Replace
                          </Button>
                          <Button
                            type="button"
                            size="sm"
                            variant="outline"
                            disabled={toggleMutation.isPending}
                            onClick={() => void toggleMutation.mutateAsync(banner._id)}
                          >
                            {banner.isActive ? "Disable" : "Enable"}
                          </Button>
                          <Button
                            type="button"
                            size="sm"
                            variant="destructive"
                            disabled={deleteMutation.isPending}
                            onClick={() => void deleteMutation.mutateAsync(banner._id)}
                          >
                            <Trash2 className="mr-1 h-3.5 w-3.5" />
                            Delete
                          </Button>
                        </div>
                      </Td>
                    </tr>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
};