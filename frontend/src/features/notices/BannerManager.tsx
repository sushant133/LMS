import { useMemo, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import {
  BANNER_PRIORITIES,
  BANNER_TARGET_ROLE_LABELS,
  BANNER_TARGET_ROLES,
  bannerSchema,
  type BannerInput,
  type BannerRecord
} from "@nepal-school-erp/shared";
import { Copy, Eye, ImageIcon, Upload } from "lucide-react";
import { toast } from "sonner";
import { EmptyState } from "components/shared/EmptyState";
import { FormField } from "components/shared/FormField";

import { Badge } from "components/ui/badge";
import { Button } from "components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "components/ui/card";
import { Input } from "components/ui/input";
import { Select } from "components/ui/select";
import { Table, TableBody, Td, Th, TableHead } from "components/ui/table";
import { DashboardBannerStrip } from "features/notices/DashboardBannerStrip";
import { RichTextEditor } from "features/notices/RichTextEditor";
import { api, resolveApiUrl, unwrap } from "lib/api";
import { queryClient } from "lib/queryClient";
import { cn, parseErrorMessage } from "lib/utils";

const defaultBanner: BannerInput = {
  title: "",
  description: "",
  imageUrl: "",
  buttonText: "",
  buttonUrl: "",
  backgroundColor: "",
  textColor: "",
  priority: "MEDIUM",
  startAt: "",
  endAt: "",
  isActive: true,
  showOnce: false,
  dismissible: true,
  targetRoles: ["STUDENT", "TEACHER"]
};

const toDateTimeLocal = (iso?: string) => {
  if (!iso) return "";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
};

const fromDateTimeLocal = (value: string) => (value ? new Date(value).toISOString() : "");

const statusStyles: Record<string, string> = {
  ACTIVE: "bg-emerald-100 text-emerald-800",
  SCHEDULED: "bg-sky-100 text-sky-800",
  EXPIRED: "bg-slate-100 text-slate-700",
  INACTIVE: "bg-amber-100 text-amber-800"
};

const formatDateTime = (iso: string) => {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return date.toLocaleString();
};

export const BannerManager = () => {
  const [form, setForm] = useState<BannerInput>(defaultBanner);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [viewingBanner, setViewingBanner] = useState<BannerRecord | null>(null);
  const [isUploading, setIsUploading] = useState(false);

  const bannersQuery = useQuery({
    queryKey: ["banners", "manage"],
    queryFn: () => unwrap<BannerRecord[]>(api.get("/banners"))
  });

  const saveMutation = useMutation({
    mutationFn: async (payload: BannerInput) =>
      editingId
        ? unwrap<BannerRecord>(api.put(`/banners/${editingId}`, payload))
        : unwrap<BannerRecord>(api.post("/banners", payload)),
    onSuccess: async () => {
      toast.success(editingId ? "Banner updated" : "Banner created");
      setForm(defaultBanner);
      setEditingId(null);
      await queryClient.invalidateQueries({ queryKey: ["banners"] });
      await queryClient.invalidateQueries({ queryKey: ["dashboard"] });
    },
    onError: (error) => toast.error(parseErrorMessage(error))
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      await api.delete(`/banners/${id}`);
    },
    onSuccess: async () => {
      toast.success("Banner deleted");
      await queryClient.invalidateQueries({ queryKey: ["banners"] });
      await queryClient.invalidateQueries({ queryKey: ["dashboard"] });
    },
    onError: (error) => toast.error(parseErrorMessage(error))
  });

  const duplicateMutation = useMutation({
    mutationFn: async (id: string) => unwrap<BannerRecord>(api.post(`/banners/${id}/duplicate`)),
    onSuccess: async () => {
      toast.success("Banner duplicated");
      await queryClient.invalidateQueries({ queryKey: ["banners"] });
    },
    onError: (error) => toast.error(parseErrorMessage(error))
  });

  const toggleMutation = useMutation({
    mutationFn: async (id: string) => unwrap<BannerRecord>(api.post(`/banners/${id}/toggle-active`)),
    onSuccess: async (banner) => {
      toast.success(banner.isActive ? "Banner activated" : "Banner deactivated");
      await queryClient.invalidateQueries({ queryKey: ["banners"] });
      await queryClient.invalidateQueries({ queryKey: ["dashboard"] });
    },
    onError: (error) => toast.error(parseErrorMessage(error))
  });

  const banners = useMemo(() => bannersQuery.data ?? [], [bannersQuery.data]);

  const handleImageUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    setIsUploading(true);
    const formData = new FormData();
    formData.append("image", file);

    try {
      const response = await fetch(resolveApiUrl("/uploads/banners"), {
        method: "POST",
        body: formData,
        credentials: "include"
      });
      if (!response.ok) {
        const body = await response.json().catch(() => ({}));
        throw new Error(body.message ?? "Upload failed");
      }
      const body = await response.json();
      setForm((current) => ({ ...current, imageUrl: body.data?.url ?? "" }));
      toast.success("Image uploaded");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Upload failed");
    } finally {
      setIsUploading(false);
      event.target.value = "";
    }
  };

  const loadBannerToForm = (banner: BannerRecord) => {
    setEditingId(banner._id);
    setViewingBanner(null);
    setForm({
      title: banner.title,
      description: banner.description,
      imageUrl: banner.imageUrl ?? "",
      buttonText: banner.buttonText ?? "",
      buttonUrl: banner.buttonUrl ?? "",
      backgroundColor: banner.backgroundColor ?? "",
      textColor: banner.textColor ?? "",
      priority: banner.priority,
      startAt: toDateTimeLocal(banner.startAt),
      endAt: toDateTimeLocal(banner.endAt),
      isActive: banner.isActive,
      showOnce: banner.showOnce,
      dismissible: banner.dismissible,
      targetRoles: banner.targetRoles
    });
  };

  if (bannersQuery.isLoading) {
    return <EmptyState title="Loading banners" description="Please wait." />;
  }

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>{editingId ? "Edit Banner" : "Create Banner"}</CardTitle>
        </CardHeader>
        <CardContent>
          <form
            className="space-y-4"
            onSubmit={(event) => {
              event.preventDefault();
              const payload: BannerInput = {
                ...form,
                startAt: fromDateTimeLocal(form.startAt),
                endAt: fromDateTimeLocal(form.endAt)
              };
              const parsed = bannerSchema.safeParse(payload);
              if (!parsed.success) {
                toast.error(parsed.error.issues[0]?.message ?? "Validation failed");
                return;
              }
              if (!parsed.data.description.replace(/<[^>]*>/g, "").trim()) {
                toast.error("Banner description is required");
                return;
              }
              void saveMutation.mutateAsync(parsed.data);
            }}
          >
            <div className="grid gap-4 md:grid-cols-2">
              <FormField label="Banner Title">
                <Input value={form.title} onChange={(event) => setForm((current) => ({ ...current, title: event.target.value }))} />
              </FormField>
              <FormField label="Priority">
                <Select
                  value={form.priority}
                  onChange={(event) => setForm((current) => ({ ...current, priority: event.target.value as BannerInput["priority"] }))}
                >
                  {BANNER_PRIORITIES.map((priority) => (
                    <option key={priority} value={priority}>
                      {priority}
                    </option>
                  ))}
                </Select>
              </FormField>
              <FormField label="Start Date & Time">
                <Input
                  type="datetime-local"
                  value={form.startAt}
                  onChange={(event) => setForm((current) => ({ ...current, startAt: event.target.value }))}
                />
              </FormField>
              <FormField label="End Date & Time">
                <Input
                  type="datetime-local"
                  value={form.endAt}
                  onChange={(event) => setForm((current) => ({ ...current, endAt: event.target.value }))}
                />
              </FormField>
              <FormField label="Background Color (optional)">
                <div className="flex gap-2">
                  <Input
                    type="color"
                    className="h-10 w-14 shrink-0 p-1"
                    value={form.backgroundColor || "#ecfdf5"}
                    onChange={(event) => setForm((current) => ({ ...current, backgroundColor: event.target.value }))}
                  />
                  <Input
                    value={form.backgroundColor ?? ""}
                    placeholder="#ecfdf5"
                    onChange={(event) => setForm((current) => ({ ...current, backgroundColor: event.target.value }))}
                  />
                </div>
              </FormField>
              <FormField label="Text Color (optional)">
                <div className="flex gap-2">
                  <Input
                    type="color"
                    className="h-10 w-14 shrink-0 p-1"
                    value={form.textColor || "#0f172a"}
                    onChange={(event) => setForm((current) => ({ ...current, textColor: event.target.value }))}
                  />
                  <Input
                    value={form.textColor ?? ""}
                    placeholder="#0f172a"
                    onChange={(event) => setForm((current) => ({ ...current, textColor: event.target.value }))}
                  />
                </div>
              </FormField>
              <FormField label="Button Text (optional)">
                <Input value={form.buttonText ?? ""} onChange={(event) => setForm((current) => ({ ...current, buttonText: event.target.value }))} />
              </FormField>
              <FormField label="Button URL (optional)">
                <Input value={form.buttonUrl ?? ""} onChange={(event) => setForm((current) => ({ ...current, buttonUrl: event.target.value }))} placeholder="https://..." />
              </FormField>
            </div>

            <FormField label="Banner Description / Message">
              <RichTextEditor value={form.description} onChange={(value) => setForm((current) => ({ ...current, description: value }))} placeholder="Write your announcement message..." />
            </FormField>

            <FormField label="Banner Image (JPG, PNG, WEBP)">
              <div className="space-y-3">
                <label className="inline-flex cursor-pointer items-center gap-2 rounded-xl border border-slate-300 bg-white px-4 py-2 text-sm hover:bg-slate-50">
                  <Upload className="h-4 w-4" />
                  {isUploading ? "Uploading..." : "Upload image"}
                  <input type="file" accept="image/jpeg,image/png,image/webp" className="hidden" disabled={isUploading} onChange={handleImageUpload} />
                </label>
                {form.imageUrl ? (
                  <div className="flex items-start gap-3 rounded-xl border bg-slate-50 p-3">
                    <img src={form.imageUrl} alt="Banner preview" className="h-24 w-40 rounded-lg object-cover" />
                    <Button type="button" variant="outline" size="sm" onClick={() => setForm((current) => ({ ...current, imageUrl: "" }))}>
                      Remove image
                    </Button>
                  </div>
                ) : (
                  <div className="flex items-center gap-2 text-sm text-slate-500">
                    <ImageIcon className="h-4 w-4" />
                    Optional image with live preview after upload
                  </div>
                )}
              </div>
            </FormField>

            <FormField label="Target Audience">
              <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                {BANNER_TARGET_ROLES.map((role) => (
                  <label key={role} className="flex items-center gap-2 rounded-xl border border-slate-200 px-3 py-2 text-sm">
                    <input
                      type="checkbox"
                      checked={form.targetRoles.includes(role)}
                      onChange={(event) =>
                        setForm((current) => ({
                          ...current,
                          targetRoles: event.target.checked
                            ? [...current.targetRoles, role]
                            : current.targetRoles.filter((item) => item !== role)
                        }))
                      }
                    />
                    {BANNER_TARGET_ROLE_LABELS[role]}
                  </label>
                ))}
              </div>
            </FormField>

            <div className="grid gap-3 sm:grid-cols-3">
              <label className="flex items-center gap-2 rounded-xl border border-slate-200 px-3 py-2 text-sm">
                <input
                  type="checkbox"
                  checked={form.isActive}
                  onChange={(event) => setForm((current) => ({ ...current, isActive: event.target.checked }))}
                />
                Active
              </label>
              <label className="flex items-center gap-2 rounded-xl border border-slate-200 px-3 py-2 text-sm">
                <input
                  type="checkbox"
                  checked={form.showOnce}
                  onChange={(event) => setForm((current) => ({ ...current, showOnce: event.target.checked }))}
                />
                Show once (hide permanently after dismiss)
              </label>
              <label className="flex items-center gap-2 rounded-xl border border-slate-200 px-3 py-2 text-sm">
                <input
                  type="checkbox"
                  checked={form.dismissible}
                  onChange={(event) => setForm((current) => ({ ...current, dismissible: event.target.checked }))}
                />
                Dismissible (show close button)
              </label>
            </div>

            <div className="flex justify-end gap-2">
              {editingId ? (
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => {
                    setEditingId(null);
                    setForm(defaultBanner);
                  }}
                >
                  Cancel
                </Button>
              ) : null}
              <Button type="submit" disabled={saveMutation.isPending}>
                {editingId ? "Update Banner" : "Create Banner"}
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
              Close preview
            </Button>
          </CardHeader>
          <CardContent>
            <DashboardBannerStrip banners={[viewingBanner]} />
          </CardContent>
        </Card>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle>All Banners</CardTitle>
        </CardHeader>
        <CardContent>
          {banners.length === 0 ? (
            <EmptyState title="No banners yet" description="Create your first dashboard banner above." />
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHead>
                  <tr>
                    <Th>Image</Th>
                    <Th>Title</Th>
                    <Th>Target Roles</Th>
                    <Th>Status</Th>
                    <Th>Start</Th>
                    <Th>End</Th>
                    <Th>Created By</Th>
                    <Th />
                  </tr>
                </TableHead>
                <TableBody>
                  {banners.map((banner) => (
                    <tr key={banner._id}>
                      <Td>
                        {banner.imageUrl ? (
                          <img src={banner.imageUrl} alt={banner.title} className="h-12 w-20 rounded-lg object-cover" />
                        ) : (
                          <div className="flex h-12 w-20 items-center justify-center rounded-lg bg-slate-100 text-slate-400">
                            <ImageIcon className="h-4 w-4" />
                          </div>
                        )}
                      </Td>
                      <Td>
                        <div className="font-medium text-slate-900">{banner.title}</div>
                        <div className="text-xs text-slate-500">{banner.priority} priority</div>
                      </Td>
                      <Td className="max-w-[220px] text-xs">{banner.targetRoles.map((role) => BANNER_TARGET_ROLE_LABELS[role]).join(", ")}</Td>
                      <Td>
                        <Badge className={cn(statusStyles[banner.displayStatus ?? "INACTIVE"])}>
                          {banner.displayStatus ?? "INACTIVE"}
                        </Badge>
                      </Td>
                      <Td className="text-xs">{formatDateTime(banner.startAt)}</Td>
                      <Td className="text-xs">{formatDateTime(banner.endAt)}</Td>
                      <Td className="text-xs">{banner.createdByName ?? "Admin"}</Td>
                      <Td className="text-right">
                        <div className="flex flex-wrap justify-end gap-1">
                          <Button type="button" size="sm" variant="outline" onClick={() => setViewingBanner(banner)}>
                            <Eye className="mr-1 h-3.5 w-3.5" />
                            View
                          </Button>
                          <Button type="button" size="sm" variant="outline" onClick={() => loadBannerToForm(banner)}>
                            Edit
                          </Button>
                          <Button
                            type="button"
                            size="sm"
                            variant="outline"
                            disabled={duplicateMutation.isPending}
                            onClick={() => void duplicateMutation.mutateAsync(banner._id)}
                          >
                            <Copy className="mr-1 h-3.5 w-3.5" />
                            Duplicate
                          </Button>
                          <Button
                            type="button"
                            size="sm"
                            variant="outline"
                            disabled={toggleMutation.isPending}
                            onClick={() => void toggleMutation.mutateAsync(banner._id)}
                          >
                            {banner.isActive ? "Deactivate" : "Activate"}
                          </Button>
                          <Button
                            type="button"
                            size="sm"
                            variant="destructive"
                            disabled={deleteMutation.isPending}
                            onClick={() => void deleteMutation.mutateAsync(banner._id)}
                          >
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