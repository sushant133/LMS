import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import {
  COLLEGE_STAFF_CATEGORIES,
  COLLEGE_STAFF_CATEGORY_LABELS,
  EMPLOYMENT_TYPES,
  collegeStaffSchema,
  type CollegeStaffCategory,
  type CollegeStaffInput,
  type CollegeStaffRecord,
  type CollegeStaffReportResponse,
} from "@phit-erp/shared";
import { Eye, Upload } from "lucide-react";
import { toast } from "sonner";
import { AddressFields } from "components/shared/AddressFields";
import { EmptyState } from "components/shared/EmptyState";
import { FormField } from "components/shared/FormField";
import { NepaliDateField } from "components/shared/NepaliDateField";
import { Badge } from "components/ui/badge";
import { Button } from "components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "components/ui/card";
import { Input } from "components/ui/input";
import { NumberInput } from "components/ui/number-input";
import { Select } from "components/ui/select";
import { Textarea } from "components/ui/textarea";
import { Table, TableBody, Td, Th, TableHead } from "components/ui/table";
import { api, resolveApiUrl, unwrap } from "lib/api";
import {
  toastCredentialCreateResult,
  type CredentialsEmailResult,
} from "lib/credentialsEmail";
import { queryClient } from "lib/queryClient";
import { formatCurrencyNpr, parseErrorMessage } from "lib/utils";
import { useIsTenantAdmin } from "hooks/useNormalizedRole";
import { ModuleAccessControlPanel } from "features/users/ModuleAccessControlPanel";
import {
  categoryDisplayLabel,
  categoryLoginRoleLabel,
  createDefaultStaff,
  downloadCsv,
  emailStatusStyle,
  exportElementToPdf,
  exportRowsToExcel,
  rowsToCsv,
  sanitizeStaffFormNumbers,
  staffPhotoSrc,
  staffReportOptions,
} from "./staffUtils";

interface CollegeStaffManagerProps {
  /**
   * Filters the staff directory only (does not lock create form).
   * Omit to list all non-teaching staff.
   */
  listCategory?: CollegeStaffCategory;
  title: string;
  showReports?: boolean;
  /**
   * When false, only the filtered directory is shown (no create form),
   * unless the admin is editing a row.
   */
  showCreateForm?: boolean;
}

export const CollegeStaffManager = ({
  listCategory,
  title,
  showReports = false,
  showCreateForm = true,
}: CollegeStaffManagerProps) => {
  const canManage = useIsTenantAdmin();
  const [form, setForm] = useState<CollegeStaffInput>(() =>
    createDefaultStaff(listCategory ?? "OFFICE_ASSISTANT"),
  );
  const [password, setPassword] = useState("");
  const [autoGeneratePassword, setAutoGeneratePassword] = useState(true);
  const [editing, setEditing] = useState<CollegeStaffRecord | null>(null);
  const [viewing, setViewing] = useState<CollegeStaffRecord | null>(null);
  /** Separate from edit form — open Module Access from list without full edit. */
  const [accessStaff, setAccessStaff] = useState<CollegeStaffRecord | null>(null);
  const [isUploading, setIsUploading] = useState(false);
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [departmentFilter, setDepartmentFilter] = useState("");
  const [accountStatusFilter, setAccountStatusFilter] = useState("");
  const [reportType, setReportType] = useState<(typeof staffReportOptions)[number]["value"]>(
    "DIRECTORY",
  );
  const [reportData, setReportData] = useState<CollegeStaffReportResponse | null>(null);

  // Debounce directory search to avoid a request per keystroke.
  useEffect(() => {
    const timer = window.setTimeout(() => setDebouncedSearch(search.trim()), 300);
    return () => window.clearTimeout(timer);
  }, [search]);

  // Tab / filter change: clear edit/view state so forms do not leak across sections.
  useEffect(() => {
    setEditing(null);
    setViewing(null);
    setAccessStaff(null);
    setForm(createDefaultStaff(listCategory ?? "OFFICE_ASSISTANT"));
    setPassword("");
    setAutoGeneratePassword(true);
    setDepartmentFilter("");
  }, [listCategory, showCreateForm, showReports]);

  const staffQuery = useQuery({
    queryKey: [
      "college-staff",
      listCategory ?? "all",
      debouncedSearch,
      statusFilter,
      departmentFilter,
      accountStatusFilter,
    ],
    queryFn: () =>
      unwrap<CollegeStaffRecord[]>(
        api.get("/college-staff", {
          params: {
            category: listCategory || undefined,
            search: debouncedSearch || undefined,
            status: statusFilter || undefined,
            department: departmentFilter || undefined,
            accountStatus: accountStatusFilter || undefined,
          },
        }),
      ),
    enabled: !showReports,
  });

  const invalidate = async () => {
    await queryClient.invalidateQueries({ queryKey: ["college-staff"] });
    await queryClient.invalidateQueries({ queryKey: ["accounting-salary-employees"] });
    await queryClient.invalidateQueries({ queryKey: ["accounting-accountants"] });
  };

  const saveMutation = useMutation({
    mutationFn: async (payload: CollegeStaffInput) => {
      const body = {
        ...payload,
        // Create: auto-gen or manual. Edit: only send password when admin entered one.
        password: editing
          ? password.trim() || undefined
          : autoGeneratePassword
            ? undefined
            : password.trim() || undefined,
        enableLogin: true,
      };
      if (editing) {
        return unwrap<
          | CollegeStaffRecord
          | {
              staff: CollegeStaffRecord;
              loginEmail?: string;
              defaultPassword?: string;
              credentialsEmail?: CredentialsEmailResult;
            }
        >(api.put(`/college-staff/${editing._id}`, body));
      }
      return unwrap<{
        staff: CollegeStaffRecord;
        loginEmail?: string;
        defaultPassword?: string;
        credentialsEmail?: CredentialsEmailResult;
      }>(api.post("/college-staff", body));
    },
    onSuccess: async (data) => {
      const credentialPayload =
        data && typeof data === "object" && "loginEmail" in data && data.loginEmail
          ? (data as {
              loginEmail?: string;
              defaultPassword?: string;
              credentialsEmail?: CredentialsEmailResult;
            })
          : null;

      if (credentialPayload) {
        toastCredentialCreateResult(credentialPayload, {
          successTitle: editing
            ? "Staff updated — credentials emailed"
            : "Staff created successfully",
        });
      } else if (editing) {
        toast.success("Staff member updated");
      } else {
        toast.success("Staff member created");
      }
      setForm(createDefaultStaff(listCategory ?? "OFFICE_ASSISTANT"));
      setPassword("");
      setAutoGeneratePassword(true);
      setEditing(null);
      setViewing(null);
      await invalidate();
    },
    onError: (error) => toast.error(parseErrorMessage(error)),
  });

  const statusMutation = useMutation({
    mutationFn: ({ id, status }: { id: string; status: "ACTIVE" | "INACTIVE" }) =>
      unwrap(api.put(`/college-staff/${id}/status`, { status })),
    onSuccess: async (_, vars) => {
      toast.success(vars.status === "ACTIVE" ? "Staff activated" : "Staff deactivated");
      await invalidate();
    },
    onError: (error) => toast.error(parseErrorMessage(error)),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => unwrap(api.delete(`/college-staff/${id}`)),
    onSuccess: async () => {
      toast.success("Staff deleted");
      setViewing(null);
      await invalidate();
    },
    onError: (error) => toast.error(parseErrorMessage(error)),
  });

  const resetPasswordMutation = useMutation({
    mutationFn: (id: string) =>
      unwrap<{
        loginEmail?: string;
        defaultPassword?: string;
        credentialsEmail?: CredentialsEmailResult;
      }>(api.post(`/college-staff/${id}/reset-password`, {})),
    onSuccess: async (data) => {
      toastCredentialCreateResult(data ?? {}, {
        successTitle: "Password reset — credentials emailed",
      });
      await invalidate();
    },
    onError: (error) => toast.error(parseErrorMessage(error)),
  });

  const resendMutation = useMutation({
    mutationFn: (id: string) =>
      unwrap<{
        loginEmail?: string;
        defaultPassword?: string;
        credentialsEmail?: CredentialsEmailResult;
      }>(api.post(`/college-staff/${id}/resend-credentials`)),
    onSuccess: async (data) => {
      toastCredentialCreateResult(data ?? {}, {
        successTitle: "Credentials resent",
      });
      await invalidate();
    },
    onError: (error) => toast.error(parseErrorMessage(error)),
  });

  const loadReport = useMutation({
    mutationFn: () =>
      unwrap<CollegeStaffReportResponse>(
        api.get("/college-staff/reports", {
          params: {
            reportType,
            category: listCategory || undefined,
            format: "json",
          },
        }),
      ),
    onSuccess: (data) => {
      setReportData(data);
      toast.success("Report generated");
    },
    onError: (error) => toast.error(parseErrorMessage(error)),
  });

  const handlePhotoUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    setIsUploading(true);
    const formData = new FormData();
    formData.append("photo", file);

    try {
      const response = await fetch(resolveApiUrl("/uploads/staff/photo"), {
        method: "POST",
        body: formData,
        credentials: "include",
      });
      if (!response.ok) {
        const body = await response.json().catch(() => ({}));
        throw new Error(body.message ?? "Upload failed");
      }
      const body = await response.json();
      setForm((current) => ({ ...current, photoUrl: body.data?.url ?? "" }));
      toast.success("Photo uploaded");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Upload failed");
    } finally {
      setIsUploading(false);
      event.target.value = "";
    }
  };

  const loadStaff = (staff: CollegeStaffRecord) => {
    setEditing(staff);
    setViewing(null);
    setForm({
      fullName: staff.fullName,
      email: staff.email ?? staff.user?.email ?? "",
      phone: staff.phone,
      enableLogin: true,
      staffId: staff.staffId,
      photoUrl: staff.photoUrl ?? "",
      gender: staff.gender,
      dateOfBirthBs: staff.dateOfBirthBs ?? "",
      address: staff.address,
      emergencyContactName: staff.emergencyContactName ?? "",
      emergencyContactPhone: staff.emergencyContactPhone ?? "",
      joinedDateBs: staff.joinedDateBs,
      designation: staff.designation,
      department: staff.department ?? "",
      category: staff.category,
      customRoleLabel: staff.customRoleLabel ?? "",
      qualification: staff.qualification ?? "",
      experienceYears: staff.experienceYears ?? 0,
      employmentType: staff.employmentType,
      basicSalaryNpr: staff.basicSalaryNpr,
      remarks: staff.remarks ?? "",
      status: staff.status,
    });
    setAutoGeneratePassword(true);
    setPassword("");
  };

  const staffList = staffQuery.data ?? [];
  const departmentOptions = useMemo(() => {
    const set = new Set<string>();
    for (const s of staffList) {
      if (s.department?.trim()) set.add(s.department.trim());
    }
    return [...set].sort();
  }, [staffList]);

  if (showReports) {
    return (
      <div className="space-y-6">
        <Card>
          <CardHeader>
            <CardTitle>Staff reports</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-3 md:grid-cols-3">
            <FormField label="Report type">
              <Select
                value={reportType}
                onChange={(e) =>
                  setReportType(e.target.value as (typeof staffReportOptions)[number]["value"])
                }
              >
                {staffReportOptions.map((opt) => (
                  <option key={opt.value} value={opt.value}>
                    {opt.label}
                  </option>
                ))}
              </Select>
            </FormField>
            <div className="flex items-end gap-2 md:col-span-2">
              <Button onClick={() => loadReport.mutate()}>Generate</Button>
              <Button
                variant="secondary"
                disabled={!reportData?.rows?.length}
                onClick={() => {
                  if (!reportData) return;
                  downloadCsv(
                    `staff-report-${reportType.toLowerCase()}.csv`,
                    rowsToCsv(reportData.rows),
                  );
                }}
              >
                CSV
              </Button>
              <Button
                variant="secondary"
                disabled={!reportData?.rows?.length}
                onClick={async () => {
                  if (!reportData) return;
                  try {
                    await exportRowsToExcel(
                      reportData.rows,
                      `staff-report-${reportType.toLowerCase()}.xlsx`,
                    );
                  } catch (e) {
                    toast.error(parseErrorMessage(e));
                  }
                }}
              >
                Excel
              </Button>
              <Button
                variant="secondary"
                disabled={!reportData?.rows?.length}
                onClick={async () => {
                  try {
                    await exportElementToPdf(
                      "staff-report-preview",
                      `staff-report-${reportType.toLowerCase()}.pdf`,
                    );
                  } catch (e) {
                    toast.error(parseErrorMessage(e));
                  }
                }}
              >
                PDF
              </Button>
            </div>
          </CardContent>
        </Card>

        {reportData ? (
          <Card>
            <CardHeader>
              <CardTitle>
                {staffReportOptions.find((r) => r.value === reportData.reportType)?.label ??
                  reportData.reportType}
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div id="staff-report-preview" className="overflow-x-auto bg-white p-2">
                <p className="mb-3 text-sm text-slate-500">
                  Generated {new Date(reportData.generatedAt).toLocaleString()} ·{" "}
                  {reportData.summary?.rowCount ?? reportData.rows.length} rows
                  {reportData.summary?.activeCount != null
                    ? ` · Active: ${reportData.summary.activeCount}`
                    : ""}
                  {reportData.summary?.inactiveCount != null
                    ? ` · Inactive: ${reportData.summary.inactiveCount}`
                    : ""}
                </p>
                <Table>
                  <TableHead>
                    <tr>
                      {reportData.rows[0]
                        ? Object.keys(reportData.rows[0]).map((key) => <Th key={key}>{key}</Th>)
                        : <Th>Message</Th>}
                    </tr>
                  </TableHead>
                  <TableBody>
                    {reportData.rows.length === 0 ? (
                      <tr>
                        <Td>No data</Td>
                      </tr>
                    ) : (
                      reportData.rows.map((row, idx) => (
                        <tr key={idx}>
                          {Object.values(row).map((value, colIdx) => (
                            <Td key={colIdx}>{value == null ? "—" : String(value)}</Td>
                          ))}
                        </tr>
                      ))
                    )}
                  </TableBody>
                </Table>
              </div>
            </CardContent>
          </Card>
        ) : null}
      </div>
    );
  }

  if (staffQuery.isPending && !staffQuery.data) {
    return (
      <EmptyState title={`Loading ${title.toLowerCase()}`} description="Please wait." />
    );
  }

  if (staffQuery.isError) {
    return (
      <EmptyState
        title="Could not load staff"
        description={parseErrorMessage(staffQuery.error) || "Please refresh and try again."}
      />
    );
  }

  const showForm = canManage && (showCreateForm || Boolean(editing));

  return (
    <div className="space-y-6">
      {listCategory && canManage && !editing ? (
        <div className="rounded-xl border border-sky-200 bg-sky-50 px-4 py-3 text-sm text-sky-900">
          Showing <strong>{title}</strong> only. New staff created here are saved under this role
          and appear in this list. Use <strong>Module Access</strong> on a row to enable/disable ERP
          modules for that login.
        </div>
      ) : null}

      {showForm ? (
        <Card>
          <CardHeader>
            <CardTitle>
              {editing ? "Edit non-teaching staff" : "Create non-teaching staff"}
            </CardTitle>
          </CardHeader>
          <CardContent className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            <div className="md:col-span-2 xl:col-span-3">
              <p className="text-sm font-medium text-slate-700">Personal information</p>
            </div>
            <FormField label="Employee ID">
              <Input
                value={form.staffId}
                onChange={(e) => setForm((c) => ({ ...c, staffId: e.target.value }))}
              />
            </FormField>
            <FormField label="Full name">
              <Input
                value={form.fullName}
                onChange={(e) => setForm((c) => ({ ...c, fullName: e.target.value }))}
              />
            </FormField>
            <FormField label="Gender">
              <Select
                value={form.gender}
                onChange={(e) => setForm((c) => ({ ...c, gender: e.target.value }))}
              >
                <option value="Male">Male</option>
                <option value="Female">Female</option>
                <option value="Other">Other</option>
              </Select>
            </FormField>
            <FormField label="Date of birth (BS)">
              <NepaliDateField
                value={form.dateOfBirthBs ?? ""}
                onChange={(value) => setForm((c) => ({ ...c, dateOfBirthBs: value }))}
              />
            </FormField>
            <FormField label="Phone number">
              <Input
                value={form.phone}
                onChange={(e) => setForm((c) => ({ ...c, phone: e.target.value }))}
              />
            </FormField>
            <FormField label="Email address (Login ID)">
              <Input
                type="email"
                value={form.email ?? ""}
                onChange={(e) => setForm((c) => ({ ...c, email: e.target.value }))}
                placeholder="Used as login ID"
              />
            </FormField>
            <FormField label="Emergency contact name">
              <Input
                value={form.emergencyContactName ?? ""}
                onChange={(e) =>
                  setForm((c) => ({ ...c, emergencyContactName: e.target.value }))
                }
              />
            </FormField>
            <FormField label="Emergency contact phone">
              <Input
                value={form.emergencyContactPhone ?? ""}
                onChange={(e) =>
                  setForm((c) => ({ ...c, emergencyContactPhone: e.target.value }))
                }
              />
            </FormField>
            <FormField label="Profile photo">
              <div className="space-y-2">
                <label className="inline-flex cursor-pointer items-center gap-2 rounded-xl border border-slate-300 px-3 py-2 text-sm">
                  <Upload className="h-4 w-4" />
                  {isUploading ? "Uploading..." : "Upload photo"}
                  <input
                    type="file"
                    accept="image/jpeg,image/png,image/webp"
                    className="hidden"
                    disabled={isUploading}
                    onChange={handlePhotoUpload}
                  />
                </label>
                {staffPhotoSrc(form.photoUrl) ? (
                  <img
                    src={staffPhotoSrc(form.photoUrl)}
                    alt="Staff preview"
                    className="h-20 w-20 rounded-lg object-cover"
                  />
                ) : null}
              </div>
            </FormField>
            <div className="md:col-span-2 xl:col-span-3">
              <AddressFields
                value={form.address}
                onChange={(address) => setForm((c) => ({ ...c, address }))}
              />
            </div>

            <div className="md:col-span-2 xl:col-span-3 pt-2">
              <p className="text-sm font-medium text-slate-700">Employment information</p>
            </div>
            <FormField label="Staff role">
              <Select
                value={form.category}
                disabled={Boolean(listCategory) && !editing}
                onChange={(e) => {
                  const next = e.target.value as CollegeStaffCategory;
                  setForm((c) => ({
                    ...c,
                    category: next,
                    designation: COLLEGE_STAFF_CATEGORY_LABELS[next]
                      .replace(/s$/, "")
                      .replace(/ \/ .*$/, ""),
                  }));
                }}
              >
                {COLLEGE_STAFF_CATEGORIES.map((cat) => (
                  <option key={cat} value={cat}>
                    {COLLEGE_STAFF_CATEGORY_LABELS[cat]}
                  </option>
                ))}
              </Select>
              {listCategory && !editing ? (
                <p className="mt-1 text-xs text-slate-500">
                  Locked to this tab&apos;s role. Switch to &quot;All Staff&quot; to
                  pick any role.
                </p>
              ) : null}
            </FormField>
            {form.category === "OTHER" ? (
              <FormField label="Custom role">
                <Input
                  value={form.customRoleLabel ?? ""}
                  onChange={(e) => setForm((c) => ({ ...c, customRoleLabel: e.target.value }))}
                />
              </FormField>
            ) : null}
            <FormField label="Department">
              <Input
                value={form.department ?? ""}
                onChange={(e) => setForm((c) => ({ ...c, department: e.target.value }))}
              />
            </FormField>
            <FormField label="Designation">
              <Input
                value={form.designation}
                onChange={(e) => setForm((c) => ({ ...c, designation: e.target.value }))}
              />
            </FormField>
            <FormField label="Joining date (BS)">
              <NepaliDateField
                value={form.joinedDateBs}
                onChange={(value) => setForm((c) => ({ ...c, joinedDateBs: value }))}
              />
            </FormField>
            <FormField label="Employment type">
              <Select
                value={form.employmentType}
                onChange={(e) =>
                  setForm((c) => ({
                    ...c,
                    employmentType: e.target.value as CollegeStaffInput["employmentType"],
                  }))
                }
              >
                {EMPLOYMENT_TYPES.map((type) => (
                  <option key={type} value={type}>
                    {type.replace(/_/g, " ")}
                  </option>
                ))}
              </Select>
            </FormField>
            <FormField label="Employment status">
              <Select
                value={form.status}
                onChange={(e) =>
                  setForm((c) => ({
                    ...c,
                    status: e.target.value as CollegeStaffInput["status"],
                  }))
                }
              >
                <option value="ACTIVE">Active</option>
                <option value="INACTIVE">Inactive</option>
              </Select>
            </FormField>
            <FormField label="Qualification">
              <Input
                value={form.qualification ?? ""}
                onChange={(e) => setForm((c) => ({ ...c, qualification: e.target.value }))}
              />
            </FormField>
            <FormField label="Experience (years)">
              <NumberInput
                value={form.experienceYears ?? 0}
                onValueChange={(value) =>
                  setForm((c) => ({ ...c, experienceYears: value ?? 0 }))
                }
              />
            </FormField>
            <FormField label="Salary NPR (optional)">
              <NumberInput
                value={form.basicSalaryNpr}
                onValueChange={(value) =>
                  setForm((c) => ({ ...c, basicSalaryNpr: value ?? 0 }))
                }
              />
            </FormField>
            <div className="md:col-span-2 xl:col-span-3">
              <FormField label="Remarks">
                <Textarea
                  value={form.remarks ?? ""}
                  onChange={(e) => setForm((c) => ({ ...c, remarks: e.target.value }))}
                />
              </FormField>
            </div>

            <div className="md:col-span-2 xl:col-span-3 pt-2">
              <p className="text-sm font-medium text-slate-700">Login information</p>
              <p className="text-xs text-slate-500">
                Email is the login ID. ERP role:{" "}
                <strong>{categoryLoginRoleLabel(form.category)}</strong>.
                {editing
                  ? " Leave password blank to keep the current password. Use Reset password / Resend credentials for a new emailed password."
                  : " Credentials are emailed automatically on create."}
              </p>
            </div>
            {editing ? (
              <FormField label="New password (optional)">
                <Input
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="Leave blank to keep current password"
                  autoComplete="new-password"
                />
              </FormField>
            ) : (
              <>
                <label className="flex items-center gap-2 rounded-xl border border-slate-200 px-3 py-2 text-sm md:col-span-2">
                  <input
                    type="checkbox"
                    checked={autoGeneratePassword}
                    onChange={(e) => setAutoGeneratePassword(e.target.checked)}
                  />
                  Auto-generate password
                </label>
                {!autoGeneratePassword ? (
                  <FormField label="Manual password">
                    <Input
                      type="password"
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      placeholder="Min 6 characters"
                      autoComplete="new-password"
                    />
                  </FormField>
                ) : null}
              </>
            )}

            <div className="flex flex-wrap gap-2 md:col-span-2 xl:col-span-3">
              {editing ? (
                <Button
                  variant="outline"
                  disabled={saveMutation.isPending}
                  onClick={() => {
                    setEditing(null);
                    setForm(createDefaultStaff(listCategory ?? "OFFICE_ASSISTANT"));
                    setPassword("");
                    setAutoGeneratePassword(true);
                  }}
                >
                  Cancel
                </Button>
              ) : null}
              <Button
                disabled={saveMutation.isPending}
                onClick={() => {
                  if (!editing && !autoGeneratePassword && password.trim().length < 6) {
                    toast.error("Password must be at least 6 characters");
                    return;
                  }
                  if (editing && password.trim() && password.trim().length < 6) {
                    toast.error("New password must be at least 6 characters");
                    return;
                  }
                  const parsed = collegeStaffSchema.safeParse({
                    ...sanitizeStaffFormNumbers(form),
                    enableLogin: true,
                    password: editing
                      ? password.trim() || undefined
                      : autoGeneratePassword
                        ? undefined
                        : password.trim() || undefined,
                  });
                  if (!parsed.success) {
                    toast.error(parsed.error.issues[0]?.message ?? "Invalid staff details");
                    return;
                  }
                  void saveMutation.mutateAsync(parsed.data);
                }}
              >
                {saveMutation.isPending
                  ? "Saving..."
                  : editing
                    ? "Update staff"
                    : "Create staff"}
              </Button>
            </div>
          </CardContent>
        </Card>
      ) : null}

      {canManage && (accessStaff?.user?._id || editing?.user?._id) ? (
        <div className="space-y-2">
          {accessStaff && !editing ? (
            <div className="flex justify-end">
              <Button size="sm" variant="outline" onClick={() => setAccessStaff(null)}>
                Close module access
              </Button>
            </div>
          ) : null}
          <ModuleAccessControlPanel
            userId={(accessStaff?.user?._id || editing?.user?._id)!}
            userName={
              accessStaff?.fullName ||
              editing?.fullName ||
              accessStaff?.user?.fullName ||
              editing?.user?.fullName
            }
          />
        </div>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle>{title}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
            <FormField label="Search">
              <Input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="ID, name, email, phone"
              />
            </FormField>
            <FormField label="Employment status">
              <Select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
                <option value="">All</option>
                <option value="ACTIVE">Active</option>
                <option value="INACTIVE">Inactive</option>
              </Select>
            </FormField>
            <FormField label="Account status">
              <Select
                value={accountStatusFilter}
                onChange={(e) => setAccountStatusFilter(e.target.value)}
              >
                <option value="">All accounts</option>
                <option value="ACTIVE">Login active</option>
                <option value="INACTIVE">Login inactive</option>
              </Select>
            </FormField>
            <FormField label="Department">
              <Select
                value={departmentFilter}
                onChange={(e) => setDepartmentFilter(e.target.value)}
              >
                <option value="">All departments</option>
                {departmentOptions.map((d) => (
                  <option key={d} value={d}>
                    {d}
                  </option>
                ))}
              </Select>
            </FormField>
          </div>

          {staffList.length === 0 ? (
            <EmptyState
              title={listCategory ? `No ${title.toLowerCase()} yet` : "No staff found"}
              description={
                listCategory
                  ? `Create someone with this role using the form above (role is fixed for this tab). People created under another role appear in that tab or under All Staff.`
                  : "Use the form above: choose Staff role, fill details, and credentials are emailed on create. Teachers are under the Teachers tab."
              }
            />
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHead>
                  <tr>
                    <Th>Photo</Th>
                    <Th>Employee ID</Th>
                    <Th>Name</Th>
                    <Th>Role</Th>
                    <Th>Department</Th>
                    <Th>Designation</Th>
                    <Th>Email / Login</Th>
                    <Th>Phone</Th>
                    <Th>Status</Th>
                    <Th>Email delivery</Th>
                    {canManage ? <Th>Actions</Th> : null}
                  </tr>
                </TableHead>
                <TableBody>
                  {staffList.map((staff) => (
                    <tr key={staff._id}>
                      <Td>
                        {staffPhotoSrc(staff.photoUrl) ? (
                          <img
                            src={staffPhotoSrc(staff.photoUrl)}
                            alt={staff.fullName}
                            className="h-10 w-10 rounded-full object-cover"
                          />
                        ) : (
                          <div className="flex h-10 w-10 items-center justify-center rounded-full bg-slate-100 text-xs text-slate-500">
                            {(staff.fullName || "?").slice(0, 1)}
                          </div>
                        )}
                      </Td>
                      <Td>{staff.staffId}</Td>
                      <Td className="font-medium">{staff.fullName}</Td>
                      <Td className="text-xs">
                        {categoryDisplayLabel(staff.category, staff.customRoleLabel)}
                      </Td>
                      <Td>{staff.department ?? "—"}</Td>
                      <Td>{staff.designation}</Td>
                      <Td className="text-xs">{staff.user?.email ?? staff.email ?? "—"}</Td>
                      <Td>{staff.phone}</Td>
                      <Td>
                        <div className="flex flex-col gap-1">
                          <Badge
                            className={
                              staff.status === "ACTIVE"
                                ? "bg-emerald-100 text-emerald-800"
                                : "bg-slate-100 text-slate-600"
                            }
                          >
                            {staff.status === "ACTIVE" ? "Employed" : "Inactive"}
                          </Badge>
                          <Badge
                            className={
                              staff.user?.isActive
                                ? "bg-sky-100 text-sky-800"
                                : "bg-slate-100 text-slate-600"
                            }
                          >
                            Login {staff.user?.isActive ? "on" : "off"}
                          </Badge>
                        </div>
                      </Td>
                      <Td>
                        <Badge
                          className={
                            emailStatusStyle[staff.credentialsEmailStatus ?? "PENDING"] ?? ""
                          }
                          title={staff.credentialsEmailError || undefined}
                        >
                          {staff.credentialsEmailStatus ?? "PENDING"}
                        </Badge>
                      </Td>
                      {canManage ? (
                        <Td>
                          <div className="flex flex-wrap justify-end gap-1">
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() => {
                                setViewing(staff);
                                setEditing(null);
                              }}
                            >
                              <Eye className="mr-1 h-3.5 w-3.5" />
                              View
                            </Button>
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() => {
                                loadStaff(staff);
                                window.scrollTo({ top: 0, behavior: "smooth" });
                              }}
                            >
                              Edit
                            </Button>
                            <Button
                              size="sm"
                              variant="outline"
                              disabled={!staff.user?._id}
                              title={
                                staff.user?._id
                                  ? "Enable or disable ERP modules for this login"
                                  : "No login account linked — edit staff and ensure email/login is set"
                              }
                              onClick={() => {
                                if (!staff.user?._id) {
                                  toast.error(
                                    "This staff member has no login account. Edit them with a login email first.",
                                  );
                                  return;
                                }
                                setAccessStaff(staff);
                                setEditing(null);
                                setViewing(null);
                                window.scrollTo({ top: 0, behavior: "smooth" });
                              }}
                            >
                              Module Access
                            </Button>
                            {staff.status === "ACTIVE" ? (
                              <Button
                                size="sm"
                                variant="secondary"
                                disabled={statusMutation.isPending}
                                onClick={() =>
                                  statusMutation.mutate({ id: staff._id, status: "INACTIVE" })
                                }
                              >
                                Deactivate
                              </Button>
                            ) : (
                              <Button
                                size="sm"
                                variant="secondary"
                                disabled={statusMutation.isPending}
                                onClick={() =>
                                  statusMutation.mutate({ id: staff._id, status: "ACTIVE" })
                                }
                              >
                                Activate
                              </Button>
                            )}
                            <Button
                              size="sm"
                              variant="secondary"
                              disabled={
                                !staff.user ||
                                resetPasswordMutation.isPending ||
                                resendMutation.isPending
                              }
                              onClick={() => {
                                if (
                                  confirm(
                                    "Generate a new password and email login credentials to this staff member?",
                                  )
                                ) {
                                  resetPasswordMutation.mutate(staff._id);
                                }
                              }}
                            >
                              Reset password
                            </Button>
                            <Button
                              size="sm"
                              variant="secondary"
                              disabled={
                                !staff.user ||
                                resetPasswordMutation.isPending ||
                                resendMutation.isPending
                              }
                              onClick={() => {
                                if (
                                  confirm(
                                    "Resend login credentials? A new password will be generated and emailed.",
                                  )
                                ) {
                                  resendMutation.mutate(staff._id);
                                }
                              }}
                            >
                              Resend credentials
                            </Button>
                            <Button
                              size="sm"
                              variant="destructive"
                              disabled={deleteMutation.isPending}
                              onClick={() => {
                                if (
                                  confirm(
                                    `Delete staff "${staff.fullName}"? Their login will be deactivated.`,
                                  )
                                ) {
                                  deleteMutation.mutate(staff._id);
                                }
                              }}
                            >
                              Delete
                            </Button>
                          </div>
                        </Td>
                      ) : null}
                    </tr>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      {viewing ? (
        <Card>
          <CardHeader className="flex flex-row items-center justify-between">
            <CardTitle>Staff profile</CardTitle>
            <Button variant="outline" size="sm" onClick={() => setViewing(null)}>
              Close
            </Button>
          </CardHeader>
          <CardContent className="grid gap-4 md:grid-cols-[140px_1fr]">
            <div>
              {staffPhotoSrc(viewing.photoUrl) ? (
                <img
                  src={staffPhotoSrc(viewing.photoUrl)}
                  alt={viewing.fullName}
                  className="h-32 w-32 rounded-2xl object-cover"
                />
              ) : (
                <div className="flex h-32 w-32 items-center justify-center rounded-2xl bg-slate-100 text-2xl text-slate-500">
                  {(viewing.fullName || "?").slice(0, 1)}
                </div>
              )}
            </div>
            <div className="grid gap-2 text-sm md:grid-cols-2">
              {[
                ["Employee ID", viewing.staffId],
                ["Full name", viewing.fullName],
                ["Email / Login ID", viewing.user?.email ?? viewing.email ?? "—"],
                ["Phone", viewing.phone],
                ["Gender", viewing.gender],
                ["Date of birth", viewing.dateOfBirthBs ?? "—"],
                [
                  "Staff role",
                  categoryDisplayLabel(viewing.category, viewing.customRoleLabel),
                ],
                ["ERP login role", viewing.user?.role ?? categoryLoginRoleLabel(viewing.category)],
                ["Department", viewing.department ?? "—"],
                ["Designation", viewing.designation],
                ["Joining date", viewing.joinedDateBs],
                ["Qualification", viewing.qualification ?? "—"],
                ["Experience", `${viewing.experienceYears ?? 0} years`],
                ["Employment status", viewing.status],
                ["Account status", viewing.user?.isActive ? "Active" : "Inactive"],
                [
                  "Email delivery",
                  viewing.credentialsEmailError
                    ? `${viewing.credentialsEmailStatus ?? "PENDING"} (${viewing.credentialsEmailError})`
                    : (viewing.credentialsEmailStatus ?? "PENDING"),
                ],
                ["Salary", formatCurrencyNpr(viewing.basicSalaryNpr)],
                [
                  "Emergency contact",
                  [viewing.emergencyContactName, viewing.emergencyContactPhone]
                    .filter(Boolean)
                    .join(" · ") || "—",
                ],
                [
                  "Address",
                  [
                    viewing.address?.streetAddress,
                    viewing.address?.municipality,
                    viewing.address?.district,
                    viewing.address?.province,
                  ]
                    .filter(Boolean)
                    .join(", ") || "—",
                ],
                ["Remarks", viewing.remarks ?? "—"],
              ].map(([label, value]) => (
                <div key={label as string}>
                  <p className="text-xs uppercase tracking-wide text-slate-500">{label}</p>
                  <p className="font-medium text-slate-900">{value}</p>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
};
