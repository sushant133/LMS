import { useMemo, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import {
  canManageInstitution,
  laboratoryEquipmentSchema,
  laboratoryIssueSchema,
  laboratorySchema,
  laboratoryStockRequestSchema,
  moduleStaffSchema,
  type LaboratoryCategoryRecord,
  type LaboratoryDashboardResponse,
  type LaboratoryEquipmentInput,
  type LaboratoryEquipmentRecord,
  type LaboratoryInput,
  type LaboratoryIssueRecord,
  type LaboratoryRecord,
  type LaboratoryReportResponse,
  type LaboratoryReportType,
  type LaboratoryStockRequestRecord,
  type LaboratoryStockRequestStatus,
  type ModuleStaffInput,
  type UserProfile,
} from "@phit-erp/shared";
import {
  AlertTriangle,
  Beaker,
  ClipboardList,
  FileBarChart2,
  FlaskConical,
  LayoutDashboard,
  Package,
  Users,
} from "lucide-react";
import { toast } from "sonner";
import { FormField } from "components/shared/FormField";
import { ModuleReadOnlyBanner } from "components/shared/ModuleReadOnlyBanner";
import { NepaliDateField } from "components/shared/NepaliDateField";
import { PageHeader } from "components/shared/PageHeader";
import { useAuth } from "features/auth/AuthProvider";
import { useModuleAccess } from "hooks/useModuleAccess";
import { StockStatusBadge } from "features/library/StockStatusBadge";
import { Badge } from "components/ui/badge";
import { Button } from "components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "components/ui/card";
import { Input } from "components/ui/input";
import { NumberInput } from "components/ui/number-input";
import { Select } from "components/ui/select";
import { Textarea } from "components/ui/textarea";
import { Table, TableBody, Td, Th, TableHead } from "components/ui/table";
import { api, unwrap } from "lib/api";
import { queryClient } from "lib/queryClient";
import { cn, parseErrorMessage } from "lib/utils";
import {
  conditionOptions,
  defaultEquipmentForm,
  defaultIssueForm,
  defaultLabForm,
  defaultRequestForm,
  equipmentStatusOptions,
  exportElementToPdf,
  exportRowsToExcel,
  issueStatusStyles,
  itemKindOptions,
  labTypeOptions,
  reportTypeOptions,
  requestStatusStyles,
  rowsToCsv,
  stockActionOptions,
  type LabTab,
  type StockRequestFormState,
  downloadCsv,
} from "./labUtils";

const tabs: Array<{
  id: LabTab;
  label: string;
  icon: typeof LayoutDashboard;
  adminOnly?: boolean;
}> = [
  { id: "dashboard", label: "Dashboard", icon: LayoutDashboard },
  { id: "labs", label: "Laboratories", icon: FlaskConical },
  { id: "inventory", label: "Inventory", icon: Package },
  { id: "requests", label: "Required Items", icon: ClipboardList },
  { id: "issues", label: "Issue & Return", icon: Beaker },
  { id: "reports", label: "Reports", icon: FileBarChart2 },
  { id: "staff", label: "Staff", icon: Users, adminOnly: true },
];

type TeacherOption = { _id: string; user: { fullName: string } };

export const LaboratoryManager = () => {
  const { user } = useAuth();
  const isAdmin = canManageInstitution(user?.role ?? "");
  const isTeacher = user?.role === "TEACHER";
  const { canWrite: labModuleWrite, isReadOnly: labReadOnly } =
    useModuleAccess("laboratory");
  const canManageLabsMeta =
    labModuleWrite && (isAdmin || user?.role === "LABORATORY_STAFF");

  const [tab, setTab] = useState<LabTab>("dashboard");
  const [labForm, setLabForm] = useState<LaboratoryInput>(defaultLabForm);
  const [editingLabId, setEditingLabId] = useState<string | null>(null);
  const [equipmentForm, setEquipmentForm] =
    useState<LaboratoryEquipmentInput>(defaultEquipmentForm);
  const [editingEquipmentId, setEditingEquipmentId] = useState<string | null>(null);
  const [issueForm, setIssueForm] = useState(defaultIssueForm);
  const [requestForm, setRequestForm] = useState<StockRequestFormState>(defaultRequestForm);
  const [staffForm, setStaffForm] = useState<ModuleStaffInput>({
    fullName: "",
    email: "",
    phone: "",
  });
  const [search, setSearch] = useState("");
  const [labFilter, setLabFilter] = useState("");
  const [itemKindFilter, setItemKindFilter] = useState("");
  const [stockStatusFilter, setStockStatusFilter] = useState("");
  const [requestStatusFilter, setRequestStatusFilter] = useState("");
  const [newCategoryName, setNewCategoryName] = useState("");
  const [selectedLabForCategories, setSelectedLabForCategories] = useState("");
  const [stockAction, setStockAction] = useState({
    equipmentId: "",
    type: "INCREASE",
    quantity: 1,
    notes: "",
  });
  const [reportType, setReportType] = useState<LaboratoryReportType>("LABORATORY_INVENTORY");
  const [reportLabId, setReportLabId] = useState("");
  const [reportData, setReportData] = useState<LaboratoryReportResponse | null>(null);

  const invalidateLab = async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ["laboratory-labs"] }),
      queryClient.invalidateQueries({ queryKey: ["laboratory-equipment"] }),
      queryClient.invalidateQueries({ queryKey: ["laboratory-issues"] }),
      queryClient.invalidateQueries({ queryKey: ["laboratory-dashboard"] }),
      queryClient.invalidateQueries({ queryKey: ["laboratory-categories"] }),
      queryClient.invalidateQueries({ queryKey: ["laboratory-stock-requests"] }),
    ]);
  };

  const dashboardQuery = useQuery({
    queryKey: ["laboratory-dashboard"],
    queryFn: () => unwrap<LaboratoryDashboardResponse>(api.get("/laboratory/dashboard")),
    enabled: tab === "dashboard",
  });

  const labsQuery = useQuery({
    queryKey: ["laboratory-labs"],
    queryFn: () => unwrap<LaboratoryRecord[]>(api.get("/laboratory/labs")),
  });

  const equipmentQuery = useQuery({
    queryKey: ["laboratory-equipment", labFilter, search, itemKindFilter, stockStatusFilter],
    queryFn: () =>
      unwrap<LaboratoryEquipmentRecord[]>(
        api.get("/laboratory/equipment", {
          params: {
            laboratoryId: labFilter || undefined,
            search: search || undefined,
            itemKind: itemKindFilter || undefined,
            stockStatus: stockStatusFilter || undefined,
          },
        }),
      ),
  });

  const issuesQuery = useQuery({
    queryKey: ["laboratory-issues"],
    queryFn: () => unwrap<LaboratoryIssueRecord[]>(api.get("/laboratory/issues")),
    enabled: tab === "issues",
  });

  const requestsQuery = useQuery({
    queryKey: ["laboratory-stock-requests", requestStatusFilter, labFilter],
    queryFn: () =>
      unwrap<LaboratoryStockRequestRecord[]>(
        api.get("/laboratory/stock-requests", {
          params: {
            status: requestStatusFilter || undefined,
            laboratoryId: labFilter || undefined,
          },
        }),
      ),
    enabled: tab === "requests" || tab === "dashboard",
  });

  const teachersQuery = useQuery({
    queryKey: ["teachers"],
    queryFn: () => unwrap<TeacherOption[]>(api.get("/teachers")),
    enabled: canManageLabsMeta || tab === "issues" || tab === "labs",
  });

  const staffQuery = useQuery({
    queryKey: ["laboratory-staff"],
    queryFn: () => unwrap<UserProfile[]>(api.get("/laboratory/staff")),
    enabled: isAdmin && tab === "staff",
  });

  const categoriesQuery = useQuery({
    queryKey: [
      "laboratory-categories",
      equipmentForm.laboratoryId || selectedLabForCategories,
    ],
    queryFn: () =>
      unwrap<LaboratoryCategoryRecord[]>(
        api.get(
          `/laboratory/labs/${equipmentForm.laboratoryId || selectedLabForCategories}/categories`,
        ),
      ),
    enabled: Boolean(equipmentForm.laboratoryId || selectedLabForCategories),
  });

  const createOrUpdateLab = useMutation({
    mutationFn: (payload: LaboratoryInput) =>
      editingLabId
        ? unwrap(api.put(`/laboratory/labs/${editingLabId}`, payload))
        : unwrap(api.post("/laboratory/labs", payload)),
    onSuccess: async () => {
      toast.success(editingLabId ? "Laboratory updated" : "Laboratory created");
      setLabForm(defaultLabForm);
      setEditingLabId(null);
      await invalidateLab();
    },
    onError: (e) => toast.error(parseErrorMessage(e)),
  });

  const deleteLab = useMutation({
    mutationFn: (id: string) => unwrap(api.delete(`/laboratory/labs/${id}`)),
    onSuccess: async () => {
      toast.success("Laboratory deleted");
      await invalidateLab();
    },
    onError: (e) => toast.error(parseErrorMessage(e)),
  });

  const saveEquipment = useMutation({
    mutationFn: (payload: LaboratoryEquipmentInput) =>
      editingEquipmentId
        ? unwrap(api.put(`/laboratory/equipment/${editingEquipmentId}`, payload))
        : unwrap(api.post("/laboratory/equipment", payload)),
    onSuccess: async () => {
      toast.success(editingEquipmentId ? "Equipment updated" : "Equipment added");
      setEquipmentForm(defaultEquipmentForm);
      setEditingEquipmentId(null);
      await invalidateLab();
    },
    onError: (e) => toast.error(parseErrorMessage(e)),
  });

  const deleteEquipment = useMutation({
    mutationFn: (id: string) => unwrap(api.delete(`/laboratory/equipment/${id}`)),
    onSuccess: async () => {
      toast.success("Equipment deleted");
      await invalidateLab();
    },
    onError: (e) => toast.error(parseErrorMessage(e)),
  });

  const adjustStock = useMutation({
    mutationFn: () =>
      unwrap(
        api.post(`/laboratory/equipment/${stockAction.equipmentId}/stock`, {
          type: stockAction.type,
          quantity: stockAction.quantity,
          notes: stockAction.notes,
        }),
      ),
    onSuccess: async () => {
      toast.success("Stock updated");
      setStockAction({ equipmentId: "", type: "INCREASE", quantity: 1, notes: "" });
      await invalidateLab();
    },
    onError: (e) => toast.error(parseErrorMessage(e)),
  });

  const issueEquipment = useMutation({
    mutationFn: (payload: typeof defaultIssueForm) =>
      unwrap(api.post("/laboratory/issues", payload)),
    onSuccess: async () => {
      toast.success("Equipment issued");
      setIssueForm(defaultIssueForm);
      await invalidateLab();
    },
    onError: (e) => toast.error(parseErrorMessage(e)),
  });

  const returnEquipment = useMutation({
    mutationFn: (id: string) =>
      unwrap(
        api.put(`/laboratory/issues/${id}/return`, {
          returnedDateBs: issueForm.issuedDateBs || new Date().toISOString().slice(0, 10),
        }),
      ),
    onSuccess: async () => {
      toast.success("Equipment returned");
      await invalidateLab();
    },
    onError: (e) => toast.error(parseErrorMessage(e)),
  });

  const createCategory = useMutation({
    mutationFn: ({ labId, name }: { labId: string; name: string }) =>
      unwrap(api.post(`/laboratory/labs/${labId}/categories`, { name })),
    onSuccess: async () => {
      toast.success("Category added");
      setNewCategoryName("");
      await queryClient.invalidateQueries({ queryKey: ["laboratory-categories"] });
    },
    onError: (e) => toast.error(parseErrorMessage(e)),
  });

  const createRequest = useMutation({
    mutationFn: (payload: StockRequestFormState) =>
      unwrap(api.post("/laboratory/stock-requests", payload)),
    onSuccess: async () => {
      toast.success("Stock request submitted");
      setRequestForm(defaultRequestForm);
      await invalidateLab();
    },
    onError: (e) => toast.error(parseErrorMessage(e)),
  });

  const updateRequestStatus = useMutation({
    mutationFn: ({
      id,
      status,
      receivedQuantity,
    }: {
      id: string;
      status: LaboratoryStockRequestStatus;
      receivedQuantity?: number;
    }) =>
      unwrap(
        api.put(`/laboratory/stock-requests/${id}/status`, {
          status,
          receivedQuantity,
        }),
      ),
    onSuccess: async () => {
      toast.success("Request updated");
      await invalidateLab();
    },
    onError: (e) => toast.error(parseErrorMessage(e)),
  });

  const createStaff = useMutation({
    mutationFn: (payload: ModuleStaffInput) =>
      unwrap<{
        loginEmail?: string;
        defaultPassword?: string;
        credentialsEmail?: import("lib/credentialsEmail").CredentialsEmailResult;
      }>(api.post("/laboratory/staff", payload)),
    onSuccess: async (data) => {
      const { toastCredentialCreateResult } = await import("lib/credentialsEmail");
      toastCredentialCreateResult(data ?? {}, {
        successTitle: "Laboratory staff created successfully",
      });
      setStaffForm({ fullName: "", email: "", phone: "" });
      await queryClient.invalidateQueries({ queryKey: ["laboratory-staff"] });
    },
    onError: (e) => toast.error(parseErrorMessage(e)),
  });

  const loadReport = useMutation({
    mutationFn: () =>
      unwrap<LaboratoryReportResponse>(
        api.get("/laboratory/reports", {
          params: {
            reportType,
            laboratoryId: reportLabId || undefined,
            format: "json",
          },
        }),
      ),
    onSuccess: (data) => {
      setReportData(data);
      toast.success("Report generated");
    },
    onError: (e) => toast.error(parseErrorMessage(e)),
  });

  const visibleTabs = tabs.filter((item) => !item.adminOnly || isAdmin);
  const categories = categoriesQuery.data ?? [];
  const labOptions = useMemo(() => labsQuery.data ?? [], [labsQuery.data]);
  const equipment = equipmentQuery.data ?? [];
  const requests = requestsQuery.data ?? [];

  const beginEditLab = (lab: LaboratoryRecord) => {
    setEditingLabId(lab._id);
    setLabForm({
      type: lab.type,
      customName: lab.customName ?? "",
      name: lab.name,
      code: lab.code ?? "",
      department: lab.department ?? "",
      academicProgram: lab.academicProgram ?? "",
      description: lab.description ?? "",
      location: lab.location ?? "",
      roomNumber: lab.roomNumber ?? "",
      inChargeTeacherId: lab.inChargeTeacherId ?? "",
      remarks: lab.remarks ?? "",
      isActive: lab.isActive,
    });
  };

  const beginEditEquipment = (item: LaboratoryEquipmentRecord) => {
    setEditingEquipmentId(item._id);
    setEquipmentForm({
      laboratoryId: item.laboratoryId,
      categoryId: item.categoryId,
      name: item.name,
      itemCode: item.itemCode,
      itemKind: item.itemKind ?? "NON_DISPOSABLE",
      brand: item.brand ?? "",
      equipmentModel: item.equipmentModel ?? "",
      unit: item.unit ?? "pcs",
      quantity: item.quantity,
      minimumStockLevel: item.minimumStockLevel ?? 0,
      purchaseDateBs: item.purchaseDateBs ?? "",
      supplier: item.supplier ?? "",
      purchaseCost: item.purchaseCost ?? 0,
      storageLocation: item.storageLocation ?? "",
      condition: item.condition ?? "GOOD",
      equipmentStatus: item.equipmentStatus ?? "AVAILABLE",
      description: item.description ?? "",
      remarks: item.remarks ?? "",
    });
  };

  const fillRequestFromEquipment = (item: LaboratoryEquipmentRecord) => {
    setTab("requests");
    setRequestForm({
      laboratoryId: item.laboratoryId,
      equipmentId: item._id,
      equipmentName: item.name,
      categoryName: item.categoryName ?? "",
      currentStock: item.availableQuantity,
      minimumStock: item.minimumStockLevel ?? 0,
      requiredQuantity: Math.max(1, item.requiredQuantity || item.minimumStockLevel || 1),
      priority:
        item.status === "OUT_OF_STOCK" || item.status === "CRITICAL_STOCK" ? "HIGH" : "MEDIUM",
      remarks: "",
    });
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title="Laboratory Management"
        description={
          isTeacher
            ? "Manage inventory for your assigned laboratories, track stock, and submit replenishment requests."
            : "Create laboratories, assign in-charge teachers, manage independent inventories, stock requests, and reports."
        }
      />
      <ModuleReadOnlyBanner show={labReadOnly} />

      <div className="flex flex-wrap gap-2">
        {visibleTabs.map((item) => {
          const Icon = item.icon;
          return (
            <Button
              key={item.id}
              variant={tab === item.id ? "default" : "secondary"}
              size="sm"
              onClick={() => setTab(item.id)}
              className={cn(tab === item.id && "bg-brand-600 hover:bg-brand-700")}
            >
              <Icon className="mr-2 h-4 w-4" />
              {item.label}
            </Button>
          );
        })}
      </div>

      {tab === "dashboard" && (
        <div className="space-y-6">
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
            {[
              { label: "Total Laboratories", value: dashboardQuery.data?.totalLaboratories ?? 0 },
              { label: "Total Equipment", value: dashboardQuery.data?.totalEquipment ?? 0 },
              { label: "Available Units", value: dashboardQuery.data?.availableEquipment ?? 0 },
              { label: "Low Stock Items", value: dashboardQuery.data?.lowStockItemsCount ?? 0 },
              { label: "Out of Stock", value: dashboardQuery.data?.outOfStockItemsCount ?? 0 },
              { label: "Damaged Items", value: dashboardQuery.data?.damagedItemsCount ?? 0 },
              { label: "Pending Requests", value: dashboardQuery.data?.pendingRequestsCount ?? 0 },
              { label: "Issued Units", value: dashboardQuery.data?.issuedEquipment ?? 0 },
            ].map((stat) => (
              <Card
                key={stat.label}
                className="bg-[linear-gradient(135deg,_white_0%,_#eef3fb_100%)]"
              >
                <CardContent className="py-6">
                  <p className="text-sm text-slate-500">{stat.label}</p>
                  <p className="text-3xl font-semibold text-slate-900">{stat.value}</p>
                </CardContent>
              </Card>
            ))}
          </div>

          {dashboardQuery.data?.scopedToAssignedLabs ? (
            <div className="flex items-start gap-2 rounded-xl border border-sky-200 bg-sky-50 px-4 py-3 text-sm text-sky-900">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
              {(dashboardQuery.data.totalLaboratories ?? 0) === 0
                ? "You are not assigned as Laboratory In-Charge for any laboratory yet. Ask an administrator to assign you."
                : "Showing metrics only for laboratories assigned to you as Laboratory In-Charge."}
            </div>
          ) : null}

          <div className="grid gap-6 xl:grid-cols-2">
            <Card>
              <CardHeader>
                <CardTitle>Low / critical stock</CardTitle>
              </CardHeader>
              <CardContent>
                <Table>
                  <TableHead>
                    <tr>
                      <Th>Item</Th>
                      <Th>Lab</Th>
                      <Th>Available</Th>
                      <Th>Min</Th>
                      <Th>Status</Th>
                    </tr>
                  </TableHead>
                  <TableBody>
                    {(dashboardQuery.data?.lowStockItems ?? []).map((item) => (
                      <tr key={item._id}>
                        <Td className="font-medium">{item.name}</Td>
                        <Td>{item.laboratoryName ?? "—"}</Td>
                        <Td>{item.availableQuantity}</Td>
                        <Td>{item.minimumStockLevel ?? 0}</Td>
                        <Td>
                          <StockStatusBadge status={item.status} />
                        </Td>
                      </tr>
                    ))}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Recently updated inventory</CardTitle>
              </CardHeader>
              <CardContent>
                <Table>
                  <TableHead>
                    <tr>
                      <Th>Item</Th>
                      <Th>Lab</Th>
                      <Th>Available</Th>
                      <Th>Status</Th>
                    </tr>
                  </TableHead>
                  <TableBody>
                    {(dashboardQuery.data?.recentlyUpdated ?? []).map((item) => (
                      <tr key={item._id}>
                        <Td className="font-medium">{item.name}</Td>
                        <Td>{item.laboratoryName ?? "—"}</Td>
                        <Td>{item.availableQuantity}</Td>
                        <Td>
                          <StockStatusBadge status={item.status} />
                        </Td>
                      </tr>
                    ))}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          </div>
        </div>
      )}

      {tab === "labs" && (
        <div className="grid gap-6 xl:grid-cols-[380px_1fr]">
          {canManageLabsMeta ? (
            <Card>
              <CardHeader>
                <CardTitle>{editingLabId ? "Edit laboratory" : "Create laboratory"}</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                <FormField label="Laboratory type">
                  <Select
                    value={labForm.type}
                    onChange={(e) =>
                      setLabForm((c) => ({
                        ...c,
                        type: e.target.value as LaboratoryInput["type"],
                      }))
                    }
                  >
                    {labTypeOptions.map((opt) => (
                      <option key={opt.value} value={opt.value}>
                        {opt.label}
                      </option>
                    ))}
                  </Select>
                </FormField>
                {(labForm.type === "OTHER" || editingLabId) && (
                  <FormField label="Laboratory name">
                    <Input
                      value={labForm.name || labForm.customName || ""}
                      onChange={(e) =>
                        setLabForm((c) => ({
                          ...c,
                          name: e.target.value,
                          customName: e.target.value,
                        }))
                      }
                    />
                  </FormField>
                )}
                <FormField label="Laboratory code (optional)">
                  <Input
                    value={labForm.code ?? ""}
                    onChange={(e) => setLabForm((c) => ({ ...c, code: e.target.value }))}
                    placeholder="Auto-generated if empty"
                  />
                </FormField>
                <FormField label="Department / Faculty">
                  <Input
                    value={labForm.department ?? ""}
                    onChange={(e) => setLabForm((c) => ({ ...c, department: e.target.value }))}
                  />
                </FormField>
                <FormField label="Academic program (optional)">
                  <Input
                    value={labForm.academicProgram ?? ""}
                    onChange={(e) =>
                      setLabForm((c) => ({ ...c, academicProgram: e.target.value }))
                    }
                  />
                </FormField>
                <FormField label="Location">
                  <Input
                    value={labForm.location ?? ""}
                    onChange={(e) => setLabForm((c) => ({ ...c, location: e.target.value }))}
                  />
                </FormField>
                <FormField label="Room number">
                  <Input
                    value={labForm.roomNumber ?? ""}
                    onChange={(e) => setLabForm((c) => ({ ...c, roomNumber: e.target.value }))}
                  />
                </FormField>
                <FormField label="Laboratory in-charge (teacher)">
                  <Select
                    value={labForm.inChargeTeacherId ?? ""}
                    onChange={(e) =>
                      setLabForm((c) => ({ ...c, inChargeTeacherId: e.target.value }))
                    }
                  >
                    <option value="">Unassigned</option>
                    {(teachersQuery.data ?? []).map((t) => (
                      <option key={t._id} value={t._id}>
                        {t.user.fullName}
                      </option>
                    ))}
                  </Select>
                </FormField>
                <FormField label="Description">
                  <Textarea
                    value={labForm.description ?? ""}
                    onChange={(e) => setLabForm((c) => ({ ...c, description: e.target.value }))}
                  />
                </FormField>
                <FormField label="Remarks">
                  <Textarea
                    value={labForm.remarks ?? ""}
                    onChange={(e) => setLabForm((c) => ({ ...c, remarks: e.target.value }))}
                  />
                </FormField>
                <label className="flex items-center gap-2 text-sm text-slate-700">
                  <input
                    type="checkbox"
                    checked={labForm.isActive}
                    onChange={(e) => setLabForm((c) => ({ ...c, isActive: e.target.checked }))}
                  />
                  Active
                </label>
                <div className="flex flex-wrap gap-2">
                  <Button
                    onClick={() => {
                      const parsed = laboratorySchema.safeParse(labForm);
                      if (!parsed.success) return toast.error("Invalid laboratory details");
                      createOrUpdateLab.mutate(parsed.data);
                    }}
                  >
                    {editingLabId ? "Save changes" : "Create laboratory"}
                  </Button>
                  {editingLabId ? (
                    <Button
                      variant="secondary"
                      onClick={() => {
                        setEditingLabId(null);
                        setLabForm(defaultLabForm);
                      }}
                    >
                      Cancel
                    </Button>
                  ) : null}
                </div>
              </CardContent>
            </Card>
          ) : (
            <Card>
              <CardContent className="py-8 text-sm text-slate-600">
                You can view laboratories assigned to you. Contact an administrator to change lab
                details or reassign in-charge.
              </CardContent>
            </Card>
          )}

          <div className="space-y-6">
            <Card>
              <CardHeader>
                <CardTitle>Laboratories</CardTitle>
              </CardHeader>
              <CardContent>
                <Table>
                  <TableHead>
                    <tr>
                      <Th>Name</Th>
                      <Th>Code</Th>
                      <Th>Department</Th>
                      <Th>Location</Th>
                      <Th>In-Charge</Th>
                      <Th>Status</Th>
                      {canManageLabsMeta ? <Th /> : null}
                    </tr>
                  </TableHead>
                  <TableBody>
                    {labOptions.map((lab) => (
                      <tr key={lab._id}>
                        <Td className="font-medium">{lab.name}</Td>
                        <Td>{lab.code ?? "—"}</Td>
                        <Td>{lab.department ?? "—"}</Td>
                        <Td>
                          {[lab.location, lab.roomNumber].filter(Boolean).join(" / ") || "—"}
                        </Td>
                        <Td>{lab.inChargeTeacherName ?? "—"}</Td>
                        <Td>
                          <Badge
                            className={
                              lab.isActive
                                ? "bg-brand-100 text-brand-800"
                                : "bg-slate-100 text-slate-600"
                            }
                          >
                            {lab.isActive ? "Active" : "Inactive"}
                          </Badge>
                        </Td>
                        {canManageLabsMeta ? (
                          <Td className="space-x-2 whitespace-nowrap">
                            <Button size="sm" variant="secondary" onClick={() => beginEditLab(lab)}>
                              Edit
                            </Button>
                            {isAdmin ? (
                              <Button
                                size="sm"
                                variant="secondary"
                                onClick={() => {
                                  if (confirm(`Delete laboratory "${lab.name}"?`)) {
                                    deleteLab.mutate(lab._id);
                                  }
                                }}
                              >
                                Delete
                              </Button>
                            ) : null}
                          </Td>
                        ) : null}
                      </tr>
                    ))}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>

            {canManageLabsMeta ? (
              <Card>
                <CardHeader>
                  <CardTitle>Manage categories</CardTitle>
                </CardHeader>
                <CardContent className="space-y-3">
                  <FormField label="Laboratory">
                    <Select
                      value={selectedLabForCategories}
                      onChange={(e) => setSelectedLabForCategories(e.target.value)}
                    >
                      <option value="">Select laboratory</option>
                      {labOptions.map((lab) => (
                        <option key={lab._id} value={lab._id}>
                          {lab.name}
                        </option>
                      ))}
                    </Select>
                  </FormField>
                  <div className="flex gap-2">
                    <Input
                      placeholder="New category name"
                      value={newCategoryName}
                      onChange={(e) => setNewCategoryName(e.target.value)}
                    />
                    <Button
                      variant="secondary"
                      disabled={!selectedLabForCategories || !newCategoryName.trim()}
                      onClick={() =>
                        createCategory.mutate({
                          labId: selectedLabForCategories,
                          name: newCategoryName.trim(),
                        })
                      }
                    >
                      Add
                    </Button>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {categories.map((cat) => (
                      <Badge key={cat._id} className="bg-slate-100 text-slate-700">
                        {cat.name}
                      </Badge>
                    ))}
                  </div>
                </CardContent>
              </Card>
            ) : null}
          </div>
        </div>
      )}

      {tab === "inventory" && (
        <div className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle>Search & filter</CardTitle>
            </CardHeader>
            <CardContent className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
              <FormField label="Laboratory">
                <Select value={labFilter} onChange={(e) => setLabFilter(e.target.value)}>
                  <option value="">All laboratories</option>
                  {labOptions.map((lab) => (
                    <option key={lab._id} value={lab._id}>
                      {lab.name}
                    </option>
                  ))}
                </Select>
              </FormField>
              <FormField label="Search">
                <Input
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Name, code, brand..."
                />
              </FormField>
              <FormField label="Item kind">
                <Select value={itemKindFilter} onChange={(e) => setItemKindFilter(e.target.value)}>
                  <option value="">All kinds</option>
                  {itemKindOptions.map((opt) => (
                    <option key={opt.value} value={opt.value}>
                      {opt.label}
                    </option>
                  ))}
                </Select>
              </FormField>
              <FormField label="Stock status">
                <Select
                  value={stockStatusFilter}
                  onChange={(e) => setStockStatusFilter(e.target.value)}
                >
                  <option value="">All statuses</option>
                  <option value="AVAILABLE">Available</option>
                  <option value="LOW_STOCK">Low Stock</option>
                  <option value="CRITICAL_STOCK">Critical Stock</option>
                  <option value="OUT_OF_STOCK">Out of Stock</option>
                </Select>
              </FormField>
            </CardContent>
          </Card>

          <div className="grid gap-6 xl:grid-cols-[400px_1fr]">
            <Card>
              <CardHeader>
                <CardTitle>
                  {editingEquipmentId ? "Edit equipment" : "Add equipment"}
                </CardTitle>
              </CardHeader>
              <CardContent className="max-h-[70vh] space-y-3 overflow-y-auto pr-1">
                <FormField label="Laboratory">
                  <Select
                    value={equipmentForm.laboratoryId}
                    onChange={(e) =>
                      setEquipmentForm((c) => ({
                        ...c,
                        laboratoryId: e.target.value,
                        categoryId: "",
                      }))
                    }
                  >
                    <option value="">Select laboratory</option>
                    {labOptions.map((lab) => (
                      <option key={lab._id} value={lab._id}>
                        {lab.name}
                      </option>
                    ))}
                  </Select>
                </FormField>
                <FormField label="Category">
                  <Select
                    value={equipmentForm.categoryId}
                    onChange={(e) =>
                      setEquipmentForm((c) => ({ ...c, categoryId: e.target.value }))
                    }
                  >
                    <option value="">Select category</option>
                    {categories.map((cat) => (
                      <option key={cat._id} value={cat._id}>
                        {cat.name}
                      </option>
                    ))}
                  </Select>
                </FormField>
                <FormField label="Equipment name">
                  <Input
                    value={equipmentForm.name}
                    onChange={(e) => setEquipmentForm((c) => ({ ...c, name: e.target.value }))}
                  />
                </FormField>
                <FormField label="Equipment code (optional)">
                  <Input
                    value={equipmentForm.itemCode ?? ""}
                    onChange={(e) => setEquipmentForm((c) => ({ ...c, itemCode: e.target.value }))}
                    placeholder="Auto-generated if empty"
                  />
                </FormField>
                <FormField label="Category kind">
                  <Select
                    value={equipmentForm.itemKind}
                    onChange={(e) =>
                      setEquipmentForm((c) => ({
                        ...c,
                        itemKind: e.target.value as LaboratoryEquipmentInput["itemKind"],
                      }))
                    }
                  >
                    {itemKindOptions.map((opt) => (
                      <option key={opt.value} value={opt.value}>
                        {opt.label}
                      </option>
                    ))}
                  </Select>
                </FormField>
                <div className="grid grid-cols-2 gap-2">
                  <FormField label="Brand">
                    <Input
                      value={equipmentForm.brand ?? ""}
                      onChange={(e) => setEquipmentForm((c) => ({ ...c, brand: e.target.value }))}
                    />
                  </FormField>
                  <FormField label="Model">
                    <Input
                      value={equipmentForm.equipmentModel ?? ""}
                      onChange={(e) =>
                        setEquipmentForm((c) => ({ ...c, equipmentModel: e.target.value }))
                      }
                    />
                  </FormField>
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <FormField label="Unit">
                    <Input
                      value={equipmentForm.unit ?? "pcs"}
                      onChange={(e) => setEquipmentForm((c) => ({ ...c, unit: e.target.value }))}
                    />
                  </FormField>
                  <FormField label="Quantity">
                    <NumberInput
                      value={equipmentForm.quantity}
                      onChange={(e) =>
                        setEquipmentForm((c) => ({
                          ...c,
                          quantity: e.target.valueAsNumber,
                        }))
                      }
                    />
                  </FormField>
                </div>
                <FormField label="Minimum stock level">
                  <NumberInput
                    value={equipmentForm.minimumStockLevel ?? 0}
                    onChange={(e) =>
                      setEquipmentForm((c) => ({
                        ...c,
                        minimumStockLevel: e.target.valueAsNumber,
                      }))
                    }
                  />
                </FormField>
                <FormField label="Storage location (rack/shelf)">
                  <Input
                    value={equipmentForm.storageLocation ?? ""}
                    onChange={(e) =>
                      setEquipmentForm((c) => ({ ...c, storageLocation: e.target.value }))
                    }
                  />
                </FormField>
                <div className="grid grid-cols-2 gap-2">
                  <FormField label="Condition">
                    <Select
                      value={equipmentForm.condition}
                      onChange={(e) =>
                        setEquipmentForm((c) => ({
                          ...c,
                          condition: e.target
                            .value as LaboratoryEquipmentInput["condition"],
                        }))
                      }
                    >
                      {conditionOptions.map((opt) => (
                        <option key={opt.value} value={opt.value}>
                          {opt.label}
                        </option>
                      ))}
                    </Select>
                  </FormField>
                  <FormField label="Status">
                    <Select
                      value={equipmentForm.equipmentStatus}
                      onChange={(e) =>
                        setEquipmentForm((c) => ({
                          ...c,
                          equipmentStatus: e.target
                            .value as LaboratoryEquipmentInput["equipmentStatus"],
                        }))
                      }
                    >
                      {equipmentStatusOptions.map((opt) => (
                        <option key={opt.value} value={opt.value}>
                          {opt.label}
                        </option>
                      ))}
                    </Select>
                  </FormField>
                </div>
                <FormField label="Purchase date (BS)">
                  <NepaliDateField
                    value={equipmentForm.purchaseDateBs ?? ""}
                    onChange={(v) => setEquipmentForm((c) => ({ ...c, purchaseDateBs: v }))}
                  />
                </FormField>
                <div className="grid grid-cols-2 gap-2">
                  <FormField label="Supplier">
                    <Input
                      value={equipmentForm.supplier ?? ""}
                      onChange={(e) =>
                        setEquipmentForm((c) => ({ ...c, supplier: e.target.value }))
                      }
                    />
                  </FormField>
                  <FormField label="Purchase cost">
                    <NumberInput
                      value={equipmentForm.purchaseCost ?? 0}
                      onChange={(e) =>
                        setEquipmentForm((c) => ({
                          ...c,
                          purchaseCost: e.target.valueAsNumber,
                        }))
                      }
                    />
                  </FormField>
                </div>
                <FormField label="Description">
                  <Textarea
                    value={equipmentForm.description ?? ""}
                    onChange={(e) =>
                      setEquipmentForm((c) => ({ ...c, description: e.target.value }))
                    }
                  />
                </FormField>
                <FormField label="Remarks">
                  <Textarea
                    value={equipmentForm.remarks ?? ""}
                    onChange={(e) => setEquipmentForm((c) => ({ ...c, remarks: e.target.value }))}
                  />
                </FormField>
                <div className="flex flex-wrap gap-2">
                  <Button
                    onClick={() => {
                      const parsed = laboratoryEquipmentSchema.safeParse(equipmentForm);
                      if (!parsed.success) return toast.error("Invalid equipment details");
                      saveEquipment.mutate(parsed.data);
                    }}
                  >
                    {editingEquipmentId ? "Save equipment" : "Add equipment"}
                  </Button>
                  {editingEquipmentId ? (
                    <Button
                      variant="secondary"
                      onClick={() => {
                        setEditingEquipmentId(null);
                        setEquipmentForm(defaultEquipmentForm);
                      }}
                    >
                      Cancel
                    </Button>
                  ) : null}
                </div>
              </CardContent>
            </Card>

            <div className="space-y-6">
              <Card>
                <CardHeader>
                  <CardTitle>Update stock</CardTitle>
                </CardHeader>
                <CardContent className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
                  <FormField label="Equipment">
                    <Select
                      value={stockAction.equipmentId}
                      onChange={(e) =>
                        setStockAction((c) => ({ ...c, equipmentId: e.target.value }))
                      }
                    >
                      <option value="">Select item</option>
                      {equipment.map((item) => (
                        <option key={item._id} value={item._id}>
                          {item.name} ({item.availableQuantity} avail.)
                        </option>
                      ))}
                    </Select>
                  </FormField>
                  <FormField label="Action">
                    <Select
                      value={stockAction.type}
                      onChange={(e) => setStockAction((c) => ({ ...c, type: e.target.value }))}
                    >
                      {stockActionOptions.map((opt) => (
                        <option key={opt.value} value={opt.value}>
                          {opt.label}
                        </option>
                      ))}
                    </Select>
                  </FormField>
                  <FormField label="Quantity">
                    <NumberInput
                      value={stockAction.quantity}
                      onChange={(e) =>
                        setStockAction((c) => ({
                          ...c,
                          quantity: e.target.valueAsNumber,
                        }))
                      }
                    />
                  </FormField>
                  <FormField label="Notes">
                    <Input
                      value={stockAction.notes}
                      onChange={(e) => setStockAction((c) => ({ ...c, notes: e.target.value }))}
                    />
                  </FormField>
                  <div className="flex items-end">
                    <Button
                      disabled={!stockAction.equipmentId || stockAction.quantity < 1}
                      onClick={() => adjustStock.mutate()}
                    >
                      Apply stock change
                    </Button>
                  </div>
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle>Equipment inventory</CardTitle>
                </CardHeader>
                <CardContent className="overflow-x-auto">
                  <Table>
                    <TableHead>
                      <tr>
                        <Th>Item</Th>
                        <Th>Lab</Th>
                        <Th>Kind</Th>
                        <Th>Code</Th>
                        <Th>Qty</Th>
                        <Th>Available</Th>
                        <Th>Min</Th>
                        <Th>Condition</Th>
                        <Th>Stock</Th>
                        <Th />
                      </tr>
                    </TableHead>
                    <TableBody>
                      {equipment.map((item) => (
                        <tr key={item._id}>
                          <Td className="font-medium">
                            <div>{item.name}</div>
                            <div className="text-xs text-slate-500">
                              {item.categoryName ?? "—"}
                              {item.storageLocation ? ` · ${item.storageLocation}` : ""}
                            </div>
                          </Td>
                          <Td>{item.laboratoryName ?? "—"}</Td>
                          <Td className="text-xs">
                            {item.itemKind === "DISPOSABLE" ? "Disposable" : "Durable"}
                          </Td>
                          <Td>{item.itemCode}</Td>
                          <Td>{item.quantity}</Td>
                          <Td>{item.availableQuantity}</Td>
                          <Td>{item.minimumStockLevel ?? 0}</Td>
                          <Td>{item.condition ?? "—"}</Td>
                          <Td>
                            <StockStatusBadge status={item.status} />
                          </Td>
                          <Td className="space-x-1 whitespace-nowrap">
                            <Button
                              size="sm"
                              variant="secondary"
                              onClick={() => beginEditEquipment(item)}
                            >
                              Edit
                            </Button>
                            <Button
                              size="sm"
                              variant="secondary"
                              onClick={() => fillRequestFromEquipment(item)}
                            >
                              Request
                            </Button>
                            <Button
                              size="sm"
                              variant="secondary"
                              onClick={() => {
                                if (confirm(`Delete "${item.name}"?`)) {
                                  deleteEquipment.mutate(item._id);
                                }
                              }}
                            >
                              Delete
                            </Button>
                          </Td>
                        </tr>
                      ))}
                    </TableBody>
                  </Table>
                </CardContent>
              </Card>
            </div>
          </div>
        </div>
      )}

      {tab === "requests" && (
        <div className="space-y-6">
          <div className="grid gap-6 xl:grid-cols-[360px_1fr]">
            <Card>
              <CardHeader>
                <CardTitle>Submit stock request</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                <FormField label="Laboratory">
                  <Select
                    value={requestForm.laboratoryId}
                    onChange={(e) =>
                      setRequestForm((c) => ({ ...c, laboratoryId: e.target.value }))
                    }
                  >
                    <option value="">Select laboratory</option>
                    {labOptions.map((lab) => (
                      <option key={lab._id} value={lab._id}>
                        {lab.name}
                      </option>
                    ))}
                  </Select>
                </FormField>
                <FormField label="Equipment (optional link)">
                  <Select
                    value={requestForm.equipmentId}
                    onChange={(e) => {
                      const item = equipment.find((eq) => eq._id === e.target.value);
                      setRequestForm((c) => ({
                        ...c,
                        equipmentId: e.target.value,
                        equipmentName: item?.name ?? c.equipmentName,
                        categoryName: item?.categoryName ?? c.categoryName,
                        currentStock: item?.availableQuantity ?? c.currentStock,
                        minimumStock: item?.minimumStockLevel ?? c.minimumStock,
                        laboratoryId: item?.laboratoryId ?? c.laboratoryId,
                      }));
                    }}
                  >
                    <option value="">Manual / new item</option>
                    {equipment.map((item) => (
                      <option key={item._id} value={item._id}>
                        {item.name}
                      </option>
                    ))}
                  </Select>
                </FormField>
                <FormField label="Equipment name">
                  <Input
                    value={requestForm.equipmentName}
                    onChange={(e) =>
                      setRequestForm((c) => ({ ...c, equipmentName: e.target.value }))
                    }
                  />
                </FormField>
                <FormField label="Required quantity">
                  <NumberInput
                    value={requestForm.requiredQuantity}
                    onChange={(e) =>
                      setRequestForm((c) => ({
                        ...c,
                        requiredQuantity: e.target.valueAsNumber,
                      }))
                    }
                  />
                </FormField>
                <FormField label="Priority">
                  <Select
                    value={requestForm.priority}
                    onChange={(e) =>
                      setRequestForm((c) => ({
                        ...c,
                        priority: e.target.value as typeof c.priority,
                      }))
                    }
                  >
                    <option value="LOW">Low</option>
                    <option value="MEDIUM">Medium</option>
                    <option value="HIGH">High</option>
                    <option value="CRITICAL">Critical</option>
                  </Select>
                </FormField>
                <FormField label="Remarks">
                  <Textarea
                    value={requestForm.remarks}
                    onChange={(e) => setRequestForm((c) => ({ ...c, remarks: e.target.value }))}
                  />
                </FormField>
                <Button
                  onClick={() => {
                    const parsed = laboratoryStockRequestSchema.safeParse(requestForm);
                    if (!parsed.success) return toast.error("Invalid request details");
                    createRequest.mutate({
                      ...requestForm,
                      ...parsed.data,
                      equipmentId: parsed.data.equipmentId ?? "",
                      categoryName: parsed.data.categoryName ?? "",
                      remarks: parsed.data.remarks ?? "",
                    });
                  }}
                >
                  Submit request
                </Button>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="flex flex-row items-center justify-between gap-3">
                <CardTitle>Required items / purchase workflow</CardTitle>
                <Select
                  value={requestStatusFilter}
                  onChange={(e) => setRequestStatusFilter(e.target.value)}
                  className="w-40"
                >
                  <option value="">All statuses</option>
                  <option value="PENDING">Pending</option>
                  <option value="APPROVED">Approved</option>
                  <option value="PURCHASED">Purchased</option>
                  <option value="RECEIVED">Received</option>
                  <option value="REJECTED">Rejected</option>
                </Select>
              </CardHeader>
              <CardContent className="overflow-x-auto">
                <Table>
                  <TableHead>
                    <tr>
                      <Th>Lab</Th>
                      <Th>Equipment</Th>
                      <Th>Current</Th>
                      <Th>Min</Th>
                      <Th>Required</Th>
                      <Th>Priority</Th>
                      <Th>Requested by</Th>
                      <Th>Date</Th>
                      <Th>Status</Th>
                      {isAdmin ? <Th>Actions</Th> : null}
                    </tr>
                  </TableHead>
                  <TableBody>
                    {requests.map((req) => (
                      <tr key={req._id}>
                        <Td>{req.laboratoryName ?? "—"}</Td>
                        <Td>
                          <div className="font-medium">{req.equipmentName}</div>
                          <div className="text-xs text-slate-500">
                            {req.autoGenerated ? "Auto low-stock" : "Manual"}
                            {req.categoryName ? ` · ${req.categoryName}` : ""}
                          </div>
                        </Td>
                        <Td>{req.currentStock}</Td>
                        <Td>{req.minimumStock}</Td>
                        <Td>{req.requiredQuantity}</Td>
                        <Td>{req.priority}</Td>
                        <Td>{req.requestedByName ?? "—"}</Td>
                        <Td>{req.requestDateBs}</Td>
                        <Td>
                          <Badge className={requestStatusStyles[req.status]}>{req.status}</Badge>
                        </Td>
                        {isAdmin ? (
                          <Td className="space-x-1 whitespace-nowrap">
                            {req.status === "PENDING" ? (
                              <>
                                <Button
                                  size="sm"
                                  variant="secondary"
                                  onClick={() =>
                                    updateRequestStatus.mutate({ id: req._id, status: "APPROVED" })
                                  }
                                >
                                  Approve
                                </Button>
                                <Button
                                  size="sm"
                                  variant="secondary"
                                  onClick={() =>
                                    updateRequestStatus.mutate({ id: req._id, status: "REJECTED" })
                                  }
                                >
                                  Reject
                                </Button>
                              </>
                            ) : null}
                            {req.status === "APPROVED" ? (
                              <Button
                                size="sm"
                                variant="secondary"
                                onClick={() =>
                                  updateRequestStatus.mutate({ id: req._id, status: "PURCHASED" })
                                }
                              >
                                Purchased
                              </Button>
                            ) : null}
                            {req.status === "PURCHASED" || req.status === "APPROVED" ? (
                              <Button
                                size="sm"
                                onClick={() =>
                                  updateRequestStatus.mutate({
                                    id: req._id,
                                    status: "RECEIVED",
                                    receivedQuantity: req.requiredQuantity,
                                  })
                                }
                              >
                                Received
                              </Button>
                            ) : null}
                          </Td>
                        ) : null}
                      </tr>
                    ))}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          </div>
        </div>
      )}

      {tab === "issues" && (
        <div className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle>Issue equipment to teacher</CardTitle>
            </CardHeader>
            <CardContent className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
              <FormField label="Equipment">
                <Select
                  value={issueForm.equipmentId}
                  onChange={(e) => setIssueForm((c) => ({ ...c, equipmentId: e.target.value }))}
                >
                  <option value="">Select equipment</option>
                  {equipment
                    .filter((item) => item.availableQuantity > 0)
                    .map((item) => (
                      <option key={item._id} value={item._id}>
                        {item.name} ({item.availableQuantity} available)
                      </option>
                    ))}
                </Select>
              </FormField>
              <FormField label="Teacher">
                <Select
                  value={issueForm.teacherId}
                  onChange={(e) => setIssueForm((c) => ({ ...c, teacherId: e.target.value }))}
                >
                  <option value="">Select teacher</option>
                  {(teachersQuery.data ?? []).map((t) => (
                    <option key={t._id} value={t._id}>
                      {t.user.fullName}
                    </option>
                  ))}
                </Select>
              </FormField>
              <FormField label="Quantity">
                <NumberInput
                  value={issueForm.quantity}
                  onChange={(e) =>
                    setIssueForm((c) => ({ ...c, quantity: e.target.valueAsNumber }))
                  }
                />
              </FormField>
              <FormField label="Issued (BS)">
                <NepaliDateField
                  value={issueForm.issuedDateBs}
                  onChange={(v) => setIssueForm((c) => ({ ...c, issuedDateBs: v }))}
                />
              </FormField>
              <FormField label="Due (BS)">
                <NepaliDateField
                  value={issueForm.dueDateBs}
                  onChange={(v) => setIssueForm((c) => ({ ...c, dueDateBs: v }))}
                />
              </FormField>
              <div className="flex items-end">
                <Button
                  onClick={() => {
                    const parsed = laboratoryIssueSchema.safeParse(issueForm);
                    if (!parsed.success) return toast.error("Invalid issue details");
                    issueEquipment.mutate(parsed.data);
                  }}
                >
                  Issue equipment
                </Button>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Equipment issues</CardTitle>
            </CardHeader>
            <CardContent>
              <Table>
                <TableHead>
                  <tr>
                    <Th>Item</Th>
                    <Th>Lab</Th>
                    <Th>Teacher</Th>
                    <Th>Qty</Th>
                    <Th>Issued</Th>
                    <Th>Due</Th>
                    <Th>Returned</Th>
                    <Th>Status</Th>
                    <Th />
                  </tr>
                </TableHead>
                <TableBody>
                  {(issuesQuery.data ?? []).map((issue) => (
                    <tr key={issue._id}>
                      <Td>{issue.equipmentName ?? "—"}</Td>
                      <Td>{issue.laboratoryName ?? "—"}</Td>
                      <Td>{issue.teacherName ?? "—"}</Td>
                      <Td>{issue.quantity}</Td>
                      <Td>{issue.issuedDateBs}</Td>
                      <Td>{issue.dueDateBs}</Td>
                      <Td>{issue.returnedDateBs ?? "—"}</Td>
                      <Td>
                        <Badge className={issueStatusStyles[issue.status] ?? ""}>
                          {issue.status}
                        </Badge>
                      </Td>
                      <Td>
                        {issue.status !== "RETURNED" ? (
                          <Button
                            size="sm"
                            variant="secondary"
                            onClick={() => returnEquipment.mutate(issue._id)}
                          >
                            Return
                          </Button>
                        ) : null}
                      </Td>
                    </tr>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </div>
      )}

      {tab === "reports" && (
        <div className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle>Generate report</CardTitle>
            </CardHeader>
            <CardContent className="grid gap-3 md:grid-cols-3">
              <FormField label="Report type">
                <Select
                  value={reportType}
                  onChange={(e) => setReportType(e.target.value as LaboratoryReportType)}
                >
                  {reportTypeOptions.map((opt) => (
                    <option key={opt.value} value={opt.value}>
                      {opt.label}
                    </option>
                  ))}
                </Select>
              </FormField>
              <FormField label="Laboratory (optional)">
                <Select value={reportLabId} onChange={(e) => setReportLabId(e.target.value)}>
                  <option value="">All laboratories</option>
                  {labOptions.map((lab) => (
                    <option key={lab._id} value={lab._id}>
                      {lab.name}
                    </option>
                  ))}
                </Select>
              </FormField>
              <div className="flex items-end gap-2">
                <Button onClick={() => loadReport.mutate()}>Generate</Button>
                <Button
                  variant="secondary"
                  disabled={!reportData?.rows?.length}
                  onClick={() => {
                    if (!reportData) return;
                    downloadCsv(
                      `lab-report-${reportType.toLowerCase()}.csv`,
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
                        `lab-report-${reportType.toLowerCase()}.xlsx`,
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
                        "lab-report-preview",
                        `lab-report-${reportType.toLowerCase()}.pdf`,
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
                  {reportTypeOptions.find((r) => r.value === reportData.reportType)?.label ??
                    reportData.reportType}
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div id="lab-report-preview" className="overflow-x-auto bg-white p-2">
                  <p className="mb-3 text-sm text-slate-500">
                    Generated {new Date(reportData.generatedAt).toLocaleString()} ·{" "}
                    {reportData.summary?.rowCount ?? reportData.rows.length} rows
                    {reportData.summary?.totalValuation != null
                      ? ` · Valuation: ${reportData.summary.totalValuation}`
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
      )}

      {tab === "staff" && isAdmin && (
        <div className="grid gap-6 xl:grid-cols-[360px_1fr]">
          <Card>
            <CardHeader>
              <CardTitle>Create laboratory staff</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <FormField label="Full name">
                <Input
                  value={staffForm.fullName}
                  onChange={(e) => setStaffForm((c) => ({ ...c, fullName: e.target.value }))}
                />
              </FormField>
              <FormField label="Email">
                <Input
                  value={staffForm.email}
                  onChange={(e) => setStaffForm((c) => ({ ...c, email: e.target.value }))}
                />
              </FormField>
              <FormField label="Phone">
                <Input
                  value={staffForm.phone}
                  onChange={(e) => setStaffForm((c) => ({ ...c, phone: e.target.value }))}
                />
              </FormField>
              <Button
                onClick={() => {
                  const parsed = moduleStaffSchema.safeParse(staffForm);
                  if (!parsed.success) return toast.error("Invalid staff details");
                  createStaff.mutate(parsed.data);
                }}
              >
                Create account
              </Button>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Laboratory staff accounts</CardTitle>
            </CardHeader>
            <CardContent>
              <Table>
                <TableHead>
                  <tr>
                    <Th>Name</Th>
                    <Th>Email</Th>
                    <Th>Phone</Th>
                    <Th>Status</Th>
                  </tr>
                </TableHead>
                <TableBody>
                  {(staffQuery.data ?? []).map((member) => (
                    <tr key={member._id}>
                      <Td>{member.fullName}</Td>
                      <Td>{member.email}</Td>
                      <Td>{member.phone ?? "—"}</Td>
                      <Td>
                        <Badge
                          className={
                            member.isActive
                              ? "bg-brand-100 text-brand-800"
                              : "bg-slate-100 text-slate-600"
                          }
                        >
                          {member.isActive ? "Active" : "Inactive"}
                        </Badge>
                      </Td>
                    </tr>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  );
};
