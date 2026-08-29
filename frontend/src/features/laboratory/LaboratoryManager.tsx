import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { getTodayBs } from "@munatech/nepali-datepicker";
import { Link } from "react-router-dom";
import {
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
  ChevronLeft,
  ChevronRight,
  ClipboardList,
  FileBarChart2,
  FlaskConical,
  LayoutDashboard,
  Package,
  PackagePlus,
  Pencil,
  Printer,
  ShoppingCart,
  Trash2,
  UserPlus,
  Users,
} from "lucide-react";
import { toast } from "sonner";
import { FormField } from "components/shared/FormField";
import { ModuleReadOnlyBanner } from "components/shared/ModuleReadOnlyBanner";
import { NepaliDateField } from "components/shared/NepaliDateField";
import { PageHeader } from "components/shared/PageHeader";
import { useAuth } from "features/auth/AuthProvider";
import { useCanEditOrDeleteRecords, useIsGrantedAdmin, useModuleAccess } from "hooks/useModuleAccess";

import { LaboratoryAllotPanel } from "features/laboratory/LaboratoryAllotPanel";
import { LaboratoryPrintInventoryPanel } from "features/laboratory/LaboratoryPrintInventoryPanel";
import { StockStatusBadge } from "features/library/StockStatusBadge";
import { Badge } from "components/ui/badge";
import { Button } from "components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "components/ui/card";
import { Input } from "components/ui/input";
import { NumberInput } from "components/ui/number-input";
import { Select } from "components/ui/select";
import { Textarea } from "components/ui/textarea";
import { StickyTableScroll } from "components/ui/StickyTableScroll";
import { Table, TableBody, Td, Th, TableHead } from "components/ui/table";
import { api, unwrap } from "lib/api";
import { getPrintInstitutionBranding } from "lib/printBranding";
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
  LABORATORY_YEAR_LEVELS,
  printLabList,
  reportTypeOptions,
  requestStatusStyles,
  rowsToCsv,
  stockActionOptions,
  type LabTab,
  type LaboratoryYearLevel,
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
  { id: "allot", label: "Allot Laboratory", icon: UserPlus, adminOnly: true },
  { id: "inventory", label: "Inventory", icon: Package },
  { id: "print-inventory", label: "Print inventory", icon: Printer },
  { id: "requests", label: "Required Items", icon: ClipboardList },
  { id: "issues", label: "Issue & Return", icon: Beaker },
  { id: "reports", label: "Reports", icon: FileBarChart2 },
  { id: "staff", label: "Staff", icon: Users, adminOnly: true },
];

type TeacherOption = { _id: string; user: { fullName: string } };

export const LaboratoryManager = () => {
  const { user } = useAuth();
  const isAdmin = useIsGrantedAdmin("laboratory");
  const canEditDelete =
    useCanEditOrDeleteRecords() || user?.role === "LABORATORY_STAFF";
  const isTeacher = user?.role === "TEACHER" && !isAdmin;
  const { canWrite: labModuleWrite, isReadOnly: labReadOnly } =
    useModuleAccess("laboratory");
  /** Full lab inventory/meta management: Admin or Lab Staff with write access. */
  const canManageLabsMeta =
    labModuleWrite && (isAdmin || user?.role === "LABORATORY_STAFF");
  /**
   * Allotted lab teachers can view inventory and submit/edit required-item
   * requests without Module Access write — allotment is independent.
   */
  const canRequestLabItems = canManageLabsMeta || isTeacher;

  useEffect(() => {
    if (!isAdmin) return;
    const interceptor = api.interceptors.request.use((config) => {
      const url = String(config.url ?? "");
      if (url.includes("/laboratory")) {
        config.params = { ...(config.params ?? {}), adminScope: "1" };
      }
      return config;
    });
    return () => {
      api.interceptors.request.eject(interceptor);
    };
  }, [isAdmin]);

  const [tab, setTab] = useState<LabTab>("dashboard");
  const [labForm, setLabForm] = useState<LaboratoryInput>(defaultLabForm);
  const [editingLabId, setEditingLabId] = useState<string | null>(null);
  const [equipmentForm, setEquipmentForm] =
    useState<LaboratoryEquipmentInput>(defaultEquipmentForm);
  const [editingEquipmentId, setEditingEquipmentId] = useState<string | null>(null);
  const [issueForm, setIssueForm] = useState(defaultIssueForm);
  const [requestForm, setRequestForm] = useState<StockRequestFormState>(defaultRequestForm);
  const [editingRequestId, setEditingRequestId] = useState<string | null>(null);
  const [staffForm, setStaffForm] = useState<ModuleStaffInput>({
    fullName: "",
    email: "",
    phone: "",
  });
  const [search, setSearch] = useState("");
  const [labFilter, setLabFilter] = useState("");
  const [itemKindFilter, setItemKindFilter] = useState("");
  const [yearFilter, setYearFilter] = useState<"ALL" | LaboratoryYearLevel>("ALL");
  const [stockStatusFilter, setStockStatusFilter] = useState("");
  /** Inventory condition filter (e.g. DAMAGED from dashboard) */
  const [conditionFilter, setConditionFilter] = useState("");
  const [requestStatusFilter, setRequestStatusFilter] = useState("");
  /** "" | ACTIVE (issued+overdue) | ISSUED | OVERDUE | RETURNED */
  const [issueStatusFilter, setIssueStatusFilter] = useState("");
  const [newCategoryName, setNewCategoryName] = useState("");
  const [selectedLabForCategories, setSelectedLabForCategories] = useState("");
  const [stockAction, setStockAction] = useState({
    equipmentId: "",
    type: "INCREASE",
    quantity: 1,
    notes: "",
  });
  /** 0 = Update stock, 1 = Equipment inventory — left/right slider panels */
  const [inventorySlide, setInventorySlide] = useState<0 | 1>(1);
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
    queryKey: [
      "laboratory-equipment",
      labFilter,
      search,
      itemKindFilter,
      yearFilter,
      stockStatusFilter,
      conditionFilter,
    ],
    queryFn: () =>
      unwrap<LaboratoryEquipmentRecord[]>(
        api.get("/laboratory/equipment", {
          params: {
            laboratoryId: labFilter || undefined,
            search: search || undefined,
            itemKind: itemKindFilter || undefined,
            yearLevel: yearFilter !== "ALL" ? yearFilter : undefined,
            stockStatus: stockStatusFilter || undefined,
            condition: conditionFilter || undefined,
          },
        }),
      ),
  });

  /** Open Inventory with optional stock/condition filter (from dashboard cards). */
  const openInventory = (opts?: {
    stockStatus?: string;
    condition?: string;
  }) => {
    // Clear other filters so the card only shows that slice of inventory
    setLabFilter("");
    setSearch("");
    setItemKindFilter("");
    setYearFilter("ALL");
    setStockStatusFilter(opts?.stockStatus ?? "");
    setConditionFilter(opts?.condition ?? "");
    setEditingEquipmentId(null);
    setInventorySlide(1);
    setTab("inventory");
    // Scroll to inventory results after paint
    window.setTimeout(() => {
      document
        .getElementById("lab-inventory-results")
        ?.scrollIntoView({ behavior: "smooth", block: "start" });
    }, 80);
  };

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
    mutationFn: (id: string) => {
      // Always use today's BS date — never Gregorian ISO (Zod rejects it)
      const today = getTodayBs();
      const returnedDateBs = `${today.year}-${String(today.month).padStart(2, "0")}-${String(today.day).padStart(2, "0")}`;
      return unwrap(
        api.put(`/laboratory/issues/${id}/return`, {
          returnedDateBs,
        }),
      );
    },
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
      setEditingRequestId(null);
      await invalidateLab();
    },
    onError: (e) => toast.error(parseErrorMessage(e)),
  });

  const updateRequest = useMutation({
    mutationFn: ({
      id,
      payload,
    }: {
      id: string;
      payload: StockRequestFormState;
    }) => unwrap(api.put(`/laboratory/stock-requests/${id}`, payload)),
    onSuccess: async () => {
      toast.success("Required item updated");
      setRequestForm(defaultRequestForm);
      setEditingRequestId(null);
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

  const deleteRequest = useMutation({
    mutationFn: (id: string) =>
      unwrap(api.delete(`/laboratory/stock-requests/${id}`)),
    onSuccess: async () => {
      toast.success("Required item removed from the list");
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

  /**
   * Inventory list — always enforce stock/condition filters client-side too,
   * so dashboard card clicks never show the wrong slice even if the API lags.
   */
  const equipment = useMemo(() => {
    let list = equipmentQuery.data ?? [];
    if (stockStatusFilter === "LOW_STOCK") {
      // Dashboard "Low Stock Items" = low + critical (not out of stock)
      list = list.filter(
        (item) =>
          item.status === "LOW_STOCK" || item.status === "CRITICAL_STOCK",
      );
    } else if (stockStatusFilter === "OUT_OF_STOCK") {
      list = list.filter((item) => item.status === "OUT_OF_STOCK");
    } else if (stockStatusFilter === "AVAILABLE") {
      list = list.filter((item) => item.status === "AVAILABLE");
    } else if (stockStatusFilter === "CRITICAL_STOCK") {
      list = list.filter((item) => item.status === "CRITICAL_STOCK");
    }
    if (conditionFilter) {
      list = list.filter((item) => item.condition === conditionFilter);
    }
    return list;
  }, [conditionFilter, equipmentQuery.data, stockStatusFilter]);

  const inventoryFilterLabel = useMemo(() => {
    if (conditionFilter === "DAMAGED") return "Damaged items only";
    if (stockStatusFilter === "OUT_OF_STOCK") return "Out of stock only";
    if (stockStatusFilter === "LOW_STOCK")
      return "Low stock & critical stock only";
    if (stockStatusFilter === "CRITICAL_STOCK") return "Critical stock only";
    if (stockStatusFilter === "AVAILABLE") return "Available stock only";
    if (conditionFilter)
      return `Condition: ${conditionFilter.replace(/_/g, " ")}`;
    return "";
  }, [conditionFilter, stockStatusFilter]);

  const requests = useMemo(() => {
    const list = requestsQuery.data ?? [];
    // Client-side OPEN filter if API is older
    if (requestStatusFilter === "OPEN") {
      return list.filter((r) =>
        ["PENDING", "APPROVED", "PURCHASED"].includes(r.status),
      );
    }
    return list;
  }, [requestStatusFilter, requestsQuery.data]);

  const issues = useMemo(() => {
    const list = issuesQuery.data ?? [];
    if (issueStatusFilter === "ACTIVE") {
      return list.filter(
        (i) => i.status === "ISSUED" || i.status === "OVERDUE",
      );
    }
    if (issueStatusFilter) {
      return list.filter((i) => i.status === issueStatusFilter);
    }
    return list;
  }, [issueStatusFilter, issuesQuery.data]);

  const [printingLabList, setPrintingLabList] = useState(false);

  const printLaboratoriesList = () => {
    if (labOptions.length === 0) {
      toast.error("No laboratories to print");
      return;
    }
    setPrintingLabList(true);
    try {
      printLabList({
        title: "Laboratory Management — Laboratories",
        subtitle: `${labOptions.length} laborator${labOptions.length === 1 ? "y" : "ies"} with full details`,
        columns: [
          "Name",
          "Year",
          "Code",
          "Department",
          "Location / Room",
          "In-Charge",
          "Program",
          "Type",
          "Status",
        ],
        rows: labOptions.map((lab) => [
          lab.name ?? "—",
          lab.yearLevel ?? "All Years",
          lab.code?.trim() || "—",
          lab.department?.trim() || "—",
          [lab.location, lab.roomNumber].filter(Boolean).join(" / ") || "—",
          lab.inChargeTeacherName?.trim() || "—",
          lab.academicProgram?.trim() || "—",
          lab.type ?? "—",
          lab.isActive ? "Active" : "Inactive",
        ]),
        monoColumnIndexes: [2],
      });
      toast.success("Print dialog opening — choose printer or Save as PDF");
    } catch (e) {
      toast.error(parseErrorMessage(e) || "Could not print laboratories");
    } finally {
      window.setTimeout(() => setPrintingLabList(false), 400);
    }
  };

  const printRequiredItemsList = () => {
    if (requests.length === 0) {
      toast.error("No required items to print");
      return;
    }
    setPrintingLabList(true);
    try {
      const labName = labFilter
        ? labOptions.find((l) => l._id === labFilter)?.name
        : null;
      const statusPart = requestStatusFilter
        ? requestStatusFilter === "OPEN"
          ? "open (pending/approved/purchased)"
          : requestStatusFilter
        : "all statuses";
      printLabList({
        title: "Laboratory — Required items / purchase workflow",
        subtitle: [
          labName ? `Lab: ${labName}` : "All laboratories",
          `Status: ${statusPart}`,
        ].join(" · "),
        columns: [
          "Lab",
          "Equipment",
          "Category",
          "Current",
          "Min",
          "Required",
          "Priority",
          "Requested by",
          "Date",
          "Status",
        ],
        rows: requests.map((req) => [
          req.laboratoryName ?? "—",
          `${req.equipmentName ?? "—"}${req.autoGenerated ? " (Auto low-stock)" : ""}`,
          req.itemKind === "DISPOSABLE"
            ? "Disposable"
            : "Non-Disposable",
          String(req.currentStock ?? 0),
          String(req.minimumStock ?? 0),
          String(req.requiredQuantity ?? 0),
          String(req.priority ?? "—"),
          req.requestedByName ?? "—",
          req.requestDateBs ?? "—",
          req.status ?? "—",
        ]),
      });
      toast.success("Print dialog opening — choose printer or Save as PDF");
    } catch (e) {
      toast.error(parseErrorMessage(e) || "Could not print required items");
    } finally {
      window.setTimeout(() => setPrintingLabList(false), 400);
    }
  };

  const printEquipmentIssuesList = () => {
    if (issues.length === 0) {
      toast.error("No equipment issues to print");
      return;
    }
    setPrintingLabList(true);
    try {
      const statusLabel =
        issueStatusFilter === "ACTIVE"
          ? "Currently issued / overdue"
          : issueStatusFilter || "All issues";
      printLabList({
        title: "Laboratory — Equipment issues",
        subtitle: `Filter: ${statusLabel}`,
        columns: [
          "Item",
          "Lab",
          "Teacher",
          "Qty",
          "Issued",
          "Due",
          "Returned",
          "Status",
        ],
        rows: issues.map((issue) => [
          issue.equipmentName ?? "—",
          issue.laboratoryName ?? "—",
          issue.teacherName ?? "—",
          String(issue.quantity ?? 0),
          issue.issuedDateBs ?? "—",
          issue.dueDateBs ?? "—",
          issue.returnedDateBs ?? "—",
          issue.status ?? "—",
        ]),
      });
      toast.success("Print dialog opening — choose printer or Save as PDF");
    } catch (e) {
      toast.error(parseErrorMessage(e) || "Could not print equipment issues");
    } finally {
      window.setTimeout(() => setPrintingLabList(false), 400);
    }
  };

  const beginEditLab = (lab: LaboratoryRecord) => {
    setEditingLabId(lab._id);
    setLabForm({
      type: lab.type,
      customName: lab.customName ?? "",
      name: lab.name,
      code: lab.code ?? "",
      yearLevel: lab.yearLevel ?? "All Years",
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
      yearLevel: item.yearLevel ?? "All Years",
      brand: item.brand ?? "",
      equipmentModel: item.equipmentModel ?? "",
      unit: item.unit ?? "pcs",
      quantity: item.quantity,
      minimumStockLevel: item.minimumStockLevel ?? 0,
      maximumStockLevel: item.maximumStockLevel ?? 0,
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
    setEditingRequestId(null);
    setRequestForm({
      laboratoryId: item.laboratoryId,
      equipmentId: item._id,
      equipmentName: item.name,
      categoryName: item.categoryName ?? "",
      itemKind: item.itemKind ?? "NON_DISPOSABLE",
      currentStock: item.availableQuantity,
      minimumStock: item.minimumStockLevel ?? 0,
      requiredQuantity: Math.max(
        1,
        item.requiredQuantity ||
          (item.maximumStockLevel > 0
            ? Math.max(0, item.maximumStockLevel - item.availableQuantity)
            : item.minimumStockLevel) ||
          1,
      ),
      priority:
        item.status === "OUT_OF_STOCK" || item.status === "CRITICAL_STOCK" ? "HIGH" : "MEDIUM",
      remarks: "",
    });
  };

  const beginEditRequest = (req: LaboratoryStockRequestRecord) => {
    setTab("requests");
    setEditingRequestId(req._id);
    setRequestForm({
      laboratoryId: req.laboratoryId,
      equipmentId: req.equipmentId ?? "",
      equipmentName: req.equipmentName ?? "",
      categoryName: req.categoryName ?? "",
      itemKind: req.itemKind ?? "NON_DISPOSABLE",
      currentStock: req.currentStock ?? 0,
      minimumStock: req.minimumStock ?? 0,
      requiredQuantity: req.requiredQuantity ?? 1,
      priority: req.priority ?? "MEDIUM",
      remarks: req.adminNotes ?? "",
    });
    // Scroll form into view on smaller screens
    requestAnimationFrame(() => {
      document
        .getElementById("lab-stock-request-form")
        ?.scrollIntoView({ behavior: "smooth", block: "start" });
    });
  };

  const cancelEditRequest = () => {
    setEditingRequestId(null);
    setRequestForm(defaultRequestForm);
  };

  const canEditRequest = (req: LaboratoryStockRequestRecord): boolean => {
    if (isAdmin) return true;
    if (!canRequestLabItems) return false;
    return req.status !== "RECEIVED" && req.status !== "REJECTED";
  };

  const beginStockAdjust = (item: LaboratoryEquipmentRecord) => {
    setStockAction({
      equipmentId: item._id,
      type: "INCREASE",
      quantity: 1,
      notes: "",
    });
    // Open Update stock panel in the left–right slider
    setInventorySlide(0);
    requestAnimationFrame(() => {
      document.getElementById("lab-inventory-slider")?.scrollIntoView({
        behavior: "smooth",
        block: "start",
      });
    });
  };

  const selectedStockItem = useMemo(
    () => equipment.find((item) => item._id === stockAction.equipmentId) ?? null,
    [equipment, stockAction.equipmentId],
  );

  return (
    <div className="min-w-0 space-y-6">
      <PageHeader
        title="Laboratory Management"
        description={
          isTeacher
            ? "View inventory for laboratories allotted to you and submit required-item requests for Admin approval."
            : "Create laboratories, allot labs to practical teachers, manage inventories, stock requests, and reports."
        }
      />
      {/* Teachers use lab allotment (not module write) for inventory view + requests */}
      <ModuleReadOnlyBanner show={labReadOnly && !isTeacher} />

      <div className="flex min-w-0 flex-wrap gap-2">
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
          {/* Original card shape — click only (no taller layout / hint lines) */}
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
            {(
              [
                {
                  label: "Total Laboratories",
                  value: dashboardQuery.data?.totalLaboratories ?? 0,
                  onClick: () => setTab("labs"),
                },
                {
                  label: "Total Equipment",
                  value: dashboardQuery.data?.totalEquipment ?? 0,
                  onClick: () => openInventory(),
                },
                {
                  label: "Available Units",
                  value: dashboardQuery.data?.availableEquipment ?? 0,
                  onClick: () => openInventory({ stockStatus: "AVAILABLE" }),
                },
                {
                  label: "Low Stock Items",
                  value: dashboardQuery.data?.lowStockItemsCount ?? 0,
                  onClick: () => openInventory({ stockStatus: "LOW_STOCK" }),
                },
                {
                  label: "Out of Stock",
                  value: dashboardQuery.data?.outOfStockItemsCount ?? 0,
                  onClick: () => openInventory({ stockStatus: "OUT_OF_STOCK" }),
                },
                {
                  label: "Damaged Items",
                  value: dashboardQuery.data?.damagedItemsCount ?? 0,
                  onClick: () => openInventory({ condition: "DAMAGED" }),
                },
                {
                  label: "Pending Requests",
                  value: dashboardQuery.data?.pendingRequestsCount ?? 0,
                  onClick: () => {
                    setLabFilter("");
                    // OPEN = PENDING + APPROVED + PURCHASED (matches dashboard count)
                    setRequestStatusFilter("OPEN");
                    setTab("requests");
                    window.setTimeout(() => {
                      document
                        .getElementById("lab-requests-list")
                        ?.scrollIntoView({ behavior: "smooth", block: "start" });
                    }, 80);
                  },
                },
                {
                  label: "Issued Units",
                  value: dashboardQuery.data?.issuedEquipment ?? 0,
                  onClick: () => {
                    setIssueStatusFilter("ACTIVE");
                    setTab("issues");
                    window.setTimeout(() => {
                      document
                        .getElementById("lab-issues-list")
                        ?.scrollIntoView({ behavior: "smooth", block: "start" });
                    }, 80);
                  },
                },
              ] as const
            ).map((stat) => (
              <Card
                key={stat.label}
                role="button"
                tabIndex={0}
                className="cursor-pointer bg-[linear-gradient(135deg,_white_0%,_#eef3fb_100%)] transition hover:shadow-md"
                onClick={stat.onClick}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    stat.onClick();
                  }
                }}
              >
                <CardContent className="py-6">
                  <p className="text-sm text-slate-500">{stat.label}</p>
                  <p className="text-3xl font-semibold text-slate-900">
                    {stat.value}
                  </p>
                </CardContent>
              </Card>
            ))}
          </div>

          {dashboardQuery.data?.scopedToAssignedLabs ? (
            <div className="flex items-start gap-2 rounded-xl border border-sky-200 bg-sky-50 px-4 py-3 text-sm text-sky-900">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
              {(dashboardQuery.data.totalLaboratories ?? 0) === 0
                ? "No laboratory is allotted to you yet. Ask Admin to use Laboratory Management → Allot Laboratory (or Teachers → Assignments)."
                : "Showing only laboratories allotted to you. You can view inventory and submit Required items requests for Admin approval."}
            </div>
          ) : null}

          <div className="grid min-w-0 gap-6 xl:grid-cols-2">
            <Card className="min-w-0 overflow-hidden">
              <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-2">
                <CardTitle>Low / critical / out of stock</CardTitle>
                <div className="flex flex-wrap gap-1">
                  <Button
                    size="sm"
                    variant="secondary"
                    onClick={() => openInventory({ stockStatus: "LOW_STOCK" })}
                  >
                    Low stock
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() =>
                      openInventory({ stockStatus: "OUT_OF_STOCK" })
                    }
                  >
                    Out of stock
                  </Button>
                </div>
              </CardHeader>
              <CardContent className="min-w-0">
                {(dashboardQuery.data?.lowStockItems ?? []).length === 0 ? (
                  <p className="py-6 text-center text-sm text-slate-500">
                    No low or out-of-stock items.
                  </p>
                ) : (
                  <div className="max-w-full overflow-x-auto overscroll-x-contain [scrollbar-width:thin]">
                    <Table className="w-full min-w-[560px]">
                      <TableHead>
                        <tr>
                          <Th className="whitespace-nowrap">Item</Th>
                          <Th className="whitespace-nowrap">Lab</Th>
                          <Th className="whitespace-nowrap">Available</Th>
                          <Th className="whitespace-nowrap">Min</Th>
                          <Th className="whitespace-nowrap">Status</Th>
                        </tr>
                      </TableHead>
                      <TableBody>
                        {(dashboardQuery.data?.lowStockItems ?? []).map(
                          (item) => (
                            <tr
                              key={item._id}
                              className="cursor-pointer hover:bg-slate-50"
                              onClick={() =>
                                openInventory({
                                  stockStatus:
                                    item.status === "OUT_OF_STOCK"
                                      ? "OUT_OF_STOCK"
                                      : "LOW_STOCK",
                                })
                              }
                            >
                              <Td className="whitespace-nowrap font-medium">
                                {item.name}
                              </Td>
                              <Td className="whitespace-nowrap">
                                {item.laboratoryName ?? "—"}
                              </Td>
                              <Td className="whitespace-nowrap">
                                {item.availableQuantity}
                              </Td>
                              <Td className="whitespace-nowrap">
                                {item.minimumStockLevel ?? 0}
                              </Td>
                              <Td className="whitespace-nowrap">
                                <StockStatusBadge status={item.status} />
                              </Td>
                            </tr>
                          ),
                        )}
                      </TableBody>
                    </Table>
                  </div>
                )}
              </CardContent>
            </Card>

            <Card className="min-w-0 overflow-hidden">
              <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-2">
                <CardTitle>Recently updated inventory</CardTitle>
                <Button
                  size="sm"
                  variant="secondary"
                  onClick={() => openInventory()}
                >
                  View inventory
                </Button>
              </CardHeader>
              <CardContent className="min-w-0">
                {(dashboardQuery.data?.recentlyUpdated ?? []).length === 0 ? (
                  <p className="py-6 text-center text-sm text-slate-500">
                    No equipment yet.
                  </p>
                ) : (
                  <div className="max-w-full overflow-x-auto overscroll-x-contain [scrollbar-width:thin]">
                    <Table className="w-full min-w-[480px]">
                      <TableHead>
                        <tr>
                          <Th className="whitespace-nowrap">Item</Th>
                          <Th className="whitespace-nowrap">Lab</Th>
                          <Th className="whitespace-nowrap">Available</Th>
                          <Th className="whitespace-nowrap">Status</Th>
                        </tr>
                      </TableHead>
                      <TableBody>
                        {(dashboardQuery.data?.recentlyUpdated ?? []).map(
                          (item) => (
                            <tr
                              key={item._id}
                              className="cursor-pointer hover:bg-slate-50"
                              onClick={() => openInventory()}
                            >
                              <Td className="whitespace-nowrap font-medium">
                                {item.name}
                              </Td>
                              <Td className="whitespace-nowrap">
                                {item.laboratoryName ?? "—"}
                              </Td>
                              <Td className="whitespace-nowrap">
                                {item.availableQuantity}
                              </Td>
                              <Td className="whitespace-nowrap">
                                <StockStatusBadge status={item.status} />
                              </Td>
                            </tr>
                          ),
                        )}
                      </TableBody>
                    </Table>
                  </div>
                )}
              </CardContent>
            </Card>
          </div>
        </div>
      )}

      {tab === "labs" && (
        <div className="grid min-w-0 gap-6 xl:grid-cols-[minmax(0,380px)_minmax(0,1fr)]">
          {canManageLabsMeta ? (
            <Card className="min-w-0">
              <CardHeader>
                <CardTitle>{editingLabId ? "Edit laboratory" : "Create laboratory"}</CardTitle>
              </CardHeader>
              <CardContent className="min-w-0 space-y-3">
                <FormField label="Laboratory name *">
                  <Input
                    value={labForm.name || labForm.customName || ""}
                    onChange={(e) =>
                      setLabForm((c) => ({
                        ...c,
                        name: e.target.value,
                        customName: e.target.value,
                      }))
                    }
                    placeholder="e.g. Anatomy Lab, Microbiology Lab, Nursing Skills Lab"
                  />
                </FormField>
                <FormField label="Year *">
                  <Select
                    value={labForm.yearLevel ?? "1st Year"}
                    onChange={(e) =>
                      setLabForm((c) => ({
                        ...c,
                        yearLevel: e.target.value as LaboratoryYearLevel,
                      }))
                    }
                  >
                    {LABORATORY_YEAR_LEVELS.map((year) => (
                      <option key={year} value={year}>
                        {year}
                      </option>
                    ))}
                  </Select>
                  <p className="mt-1 break-words text-xs text-slate-500">
                    Assign this lab to 1st, 2nd, or 3rd Year (or All Years for shared labs).
                  </p>
                </FormField>
                <FormField label="Equipment groups template (optional)">
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
                  <p className="mt-1 break-words text-xs text-slate-500">
                    This does not change the lab name. It only adds default equipment groups
                    (e.g. Glassware, Chemicals) when the lab is created. Use{" "}
                    <strong>General / Custom</strong> for HA or medical labs.
                  </p>
                </FormField>
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
                    placeholder="e.g. Health Assistant Program"
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
                  <p className="mt-1 break-words text-xs text-slate-500">
                    One primary in-charge for this lab. To give one teacher{" "}
                    <strong>many labs</strong> (same login), use{" "}
                    <Link to="/teachers" className="font-medium text-brand-700 underline">
                      Teachers → Assignments → Laboratory assignments
                    </Link>
                    .
                  </p>
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
                      const name = (labForm.name || labForm.customName || "").trim();
                      if (!name) {
                        return toast.error("Please enter a laboratory name");
                      }
                      const payload = {
                        ...labForm,
                        name,
                        customName: name,
                        // Prefer OTHER so the typed name is always the lab title
                        type: labForm.type || "OTHER",
                      };
                      const parsed = laboratorySchema.safeParse(payload);
                      if (!parsed.success) {
                        return toast.error(
                          parsed.error.issues[0]?.message ?? "Invalid laboratory details",
                        );
                      }
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
            <Card className="min-w-0">
              <CardContent className="break-words py-8 text-sm text-slate-600">
                You can view laboratories assigned to you. Contact an administrator to change lab
                details or reassign in-charge.
              </CardContent>
            </Card>
          )}

          <div className="min-w-0 space-y-6">
            <Card className="min-w-0">
              <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-3">
                <CardTitle>Laboratories</CardTitle>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  disabled={labOptions.length === 0 || printingLabList}
                  onClick={printLaboratoriesList}
                  title="Print laboratories list with details"
                >
                  <Printer className="mr-1.5 h-4 w-4" />
                  {printingLabList && tab === "labs" ? "Printing…" : "Print"}
                </Button>
              </CardHeader>
              <CardContent className="min-w-0">
                {/*
                  Horizontal slider on small/medium screens. min-w-0 on ancestors is required
                  so overflow-x-auto actually scrolls instead of expanding past the card
                  (main uses overflow-x-clip which otherwise clips Edit/Status).
                */}
                <div className="max-w-full overflow-x-auto overscroll-x-contain [scrollbar-width:thin]">
                  <Table className="w-full min-w-[980px]">
                    <TableHead>
                      <tr>
                        <Th className="w-14 whitespace-nowrap text-center">S.N.</Th>
                        <Th className="whitespace-nowrap">Name</Th>
                        <Th className="whitespace-nowrap">Year</Th>
                        <Th className="whitespace-nowrap">Code</Th>
                        <Th className="whitespace-nowrap">Department</Th>
                        <Th className="whitespace-nowrap">Location</Th>
                        <Th className="whitespace-nowrap">In-Charge</Th>
                        <Th className="whitespace-nowrap">Status</Th>
                        {canManageLabsMeta ? (
                          <Th className="whitespace-nowrap text-right">Actions</Th>
                        ) : null}
                      </tr>
                    </TableHead>
                    <TableBody>
                      {labOptions.map((lab, index) => (
                        <tr key={lab._id}>
                          <Td className="whitespace-nowrap text-center tabular-nums text-slate-500">
                            {index + 1}
                          </Td>
                          <Td className="font-medium whitespace-nowrap">{lab.name}</Td>
                          <Td className="whitespace-nowrap">
                            <Badge className="bg-indigo-100 text-indigo-800">
                              {lab.yearLevel ?? "All Years"}
                            </Badge>
                          </Td>
                          <Td className="whitespace-nowrap">{lab.code ?? "—"}</Td>
                          <Td className="whitespace-nowrap">{lab.department ?? "—"}</Td>
                          <Td className="whitespace-nowrap">
                            {[lab.location, lab.roomNumber].filter(Boolean).join(" / ") || "—"}
                          </Td>
                          <Td className="whitespace-nowrap">
                            {lab.inChargeTeacherName ?? "—"}
                          </Td>
                          <Td className="whitespace-nowrap">
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
                          {canEditDelete ? (
                            <Td className="whitespace-nowrap text-right">
                              <div className="inline-flex gap-2">
                                <Button
                                  size="sm"
                                  variant="secondary"
                                  onClick={() => beginEditLab(lab)}
                                >
                                  Edit
                                </Button>
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
                              </div>
                            </Td>
                          ) : null}
                        </tr>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              </CardContent>
            </Card>

            {canManageLabsMeta ? (
              <Card className="min-w-0">
                <CardHeader>
                  <CardTitle>Manage categories</CardTitle>
                </CardHeader>
                <CardContent className="min-w-0 space-y-3">
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
                  <div className="flex min-w-0 flex-col gap-2 sm:flex-row">
                    <Input
                      className="min-w-0 flex-1"
                      placeholder="New category name"
                      value={newCategoryName}
                      onChange={(e) => setNewCategoryName(e.target.value)}
                    />
                    <Button
                      className="shrink-0"
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
        <div className="space-y-6" id="lab-inventory-results">
          {inventoryFilterLabel ? (
            <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-brand-200 bg-brand-50/90 px-4 py-3 text-sm text-brand-950">
              <p>
                <span className="font-semibold">Showing:</span>{" "}
                {inventoryFilterLabel}
                <span className="text-brand-800">
                  {" "}
                  · {equipment.length} item
                  {equipment.length === 1 ? "" : "s"}
                </span>
              </p>
              <Button
                size="sm"
                variant="outline"
                onClick={() => {
                  setLabFilter("");
                  setSearch("");
                  setItemKindFilter("");
                  setYearFilter("ALL");
                  setStockStatusFilter("");
                  setConditionFilter("");
                }}
              >
                Show all equipment
              </Button>
            </div>
          ) : null}

          {/* Filters */}
          <Card className="border-slate-200 bg-[linear-gradient(135deg,_white_0%,_#f8fafc_100%)]">
            <CardContent className="grid gap-3 py-4 md:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-6">
              <FormField label="Laboratory">
                <Select value={labFilter} onChange={(e) => setLabFilter(e.target.value)}>
                  <option value="">All laboratories</option>
                  {labOptions.map((lab) => (
                    <option key={lab._id} value={lab._id}>
                      {lab.yearLevel ? `[${lab.yearLevel}] ` : ""}
                      {lab.name}
                    </option>
                  ))}
                </Select>
              </FormField>
              <FormField label="Year">
                <Select
                  value={yearFilter}
                  onChange={(e) =>
                    setYearFilter(e.target.value as "ALL" | LaboratoryYearLevel)
                  }
                >
                  <option value="ALL">All years</option>
                  {LABORATORY_YEAR_LEVELS.map((year) => (
                    <option key={year} value={year}>
                      {year}
                    </option>
                  ))}
                </Select>
              </FormField>
              <FormField label="Search">
                <Input
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Name, code, brand…"
                />
              </FormField>
              <FormField label="Category">
                <Select value={itemKindFilter} onChange={(e) => setItemKindFilter(e.target.value)}>
                  <option value="">All categories</option>
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
                  onChange={(e) => {
                    setStockStatusFilter(e.target.value);
                    if (e.target.value) setConditionFilter("");
                  }}
                >
                  <option value="">All statuses</option>
                  <option value="AVAILABLE">Available only</option>
                  <option value="LOW_STOCK">Low / Critical stock only</option>
                  <option value="CRITICAL_STOCK">Critical stock only</option>
                  <option value="OUT_OF_STOCK">Out of stock only</option>
                </Select>
              </FormField>
              <FormField label="Condition">
                <Select
                  value={conditionFilter}
                  onChange={(e) => {
                    setConditionFilter(e.target.value);
                    if (e.target.value) setStockStatusFilter("");
                  }}
                >
                  <option value="">All conditions</option>
                  {conditionOptions.map((opt) => (
                    <option key={opt.value} value={opt.value}>
                      {opt.label}
                    </option>
                  ))}
                </Select>
              </FormField>
            </CardContent>
            {(stockStatusFilter ||
              conditionFilter ||
              labFilter ||
              search ||
              itemKindFilter ||
              yearFilter !== "ALL") && (
              <div className="flex flex-wrap items-center justify-between gap-2 border-t border-slate-100 px-6 py-2">
                <p className="text-xs text-slate-500">
                  Filters active
                  {inventoryFilterLabel ? ` · ${inventoryFilterLabel}` : ""}
                  {labFilter ? " · laboratory selected" : ""}
                  {search ? ` · search “${search}”` : ""}
                </p>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => {
                    setLabFilter("");
                    setSearch("");
                    setItemKindFilter("");
                    setYearFilter("ALL");
                    setStockStatusFilter("");
                    setConditionFilter("");
                  }}
                >
                  Clear filters
                </Button>
              </div>
            )}
          </Card>

          {isTeacher && !canManageLabsMeta ? (
            <div className="rounded-xl border border-sky-200 bg-sky-50/80 px-4 py-3 text-sm text-sky-950">
              You can view inventory for laboratories allotted to you and submit{" "}
              <strong>Required items</strong> requests. Admin / Super Admin
              approve and process purchases. Stock updates and equipment setup are
              managed by Lab Staff or Admin.
            </div>
          ) : null}

          <div
            className={cn(
              "grid min-w-0 gap-6",
              canManageLabsMeta
                ? "xl:grid-cols-[minmax(0,380px)_minmax(0,1fr)]"
                : "grid-cols-1",
            )}
          >
            {/* Add / Edit equipment — staff & admin only */}
            {canManageLabsMeta ? (
            <Card className="h-fit xl:sticky xl:top-4">
              <CardHeader className="border-b border-slate-100 pb-3">
                <CardTitle className="flex items-center gap-2 text-base">
                  <PackagePlus className="h-5 w-5 text-brand-600" />
                  {editingEquipmentId ? "Edit equipment" : "Add equipment"}
                </CardTitle>
                <p className="text-xs text-slate-500">
                  Register new items or update equipment details for a laboratory.
                </p>
              </CardHeader>
              <CardContent className="max-h-[72vh] space-y-3 overflow-y-auto pt-4 pr-1">
                <FormField label="Laboratory *">
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
                <FormField label="Category *">
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
                <FormField label="Year *">
                  <Select
                    value={equipmentForm.yearLevel ?? "1st Year"}
                    onChange={(e) =>
                      setEquipmentForm((c) => ({
                        ...c,
                        yearLevel: e.target.value as LaboratoryYearLevel,
                      }))
                    }
                  >
                    {LABORATORY_YEAR_LEVELS.map((year) => (
                      <option key={year} value={year}>
                        {year}
                      </option>
                    ))}
                  </Select>
                </FormField>
                <FormField label="Lab group">
                  <Select
                    value={equipmentForm.categoryId}
                    onChange={(e) =>
                      setEquipmentForm((c) => ({ ...c, categoryId: e.target.value }))
                    }
                  >
                    <option value="">Select lab group / subcategory</option>
                    {categories.map((cat) => (
                      <option key={cat._id} value={cat._id}>
                        {cat.name}
                      </option>
                    ))}
                  </Select>
                </FormField>
                <FormField label="Equipment name *">
                  <Input
                    value={equipmentForm.name}
                    onChange={(e) => setEquipmentForm((c) => ({ ...c, name: e.target.value }))}
                    placeholder="e.g. Microscope, Beaker 250ml"
                  />
                </FormField>
                <FormField label="Item code">
                  <Input
                    value={equipmentForm.itemCode ?? ""}
                    onChange={(e) => setEquipmentForm((c) => ({ ...c, itemCode: e.target.value }))}
                    placeholder="Leave blank to auto-generate"
                  />
                </FormField>
                <div className="grid grid-cols-2 gap-3">
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
                <div className="grid grid-cols-2 gap-3">
                  <FormField label="Unit">
                    <Input
                      value={equipmentForm.unit ?? "pcs"}
                      onChange={(e) => setEquipmentForm((c) => ({ ...c, unit: e.target.value }))}
                      placeholder="pcs, ml, set"
                    />
                  </FormField>
                  <FormField label="Quantity *">
                    <NumberInput
                      min={0}
                      value={Number.isFinite(equipmentForm.quantity) ? equipmentForm.quantity : 0}
                      onChange={(e) =>
                        setEquipmentForm((c) => ({
                          ...c,
                          quantity: Number.isFinite(e.target.valueAsNumber)
                            ? e.target.valueAsNumber
                            : 0,
                        }))
                      }
                    />
                  </FormField>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <FormField label="Minimum stock level">
                    <NumberInput
                      min={0}
                      value={
                        Number.isFinite(equipmentForm.minimumStockLevel)
                          ? (equipmentForm.minimumStockLevel ?? 0)
                          : 0
                      }
                      onChange={(e) =>
                        setEquipmentForm((c) => ({
                          ...c,
                          minimumStockLevel: Number.isFinite(e.target.valueAsNumber)
                            ? e.target.valueAsNumber
                            : 0,
                        }))
                      }
                    />
                  </FormField>
                  <FormField label="Maximum stock level">
                    <NumberInput
                      min={0}
                      value={
                        Number.isFinite(equipmentForm.maximumStockLevel)
                          ? (equipmentForm.maximumStockLevel ?? 0)
                          : 0
                      }
                      onChange={(e) =>
                        setEquipmentForm((c) => ({
                          ...c,
                          maximumStockLevel: Number.isFinite(e.target.valueAsNumber)
                            ? e.target.valueAsNumber
                            : 0,
                        }))
                      }
                    />
                  </FormField>
                </div>
                <FormField label="Storage (rack / shelf)">
                  <Input
                    value={equipmentForm.storageLocation ?? ""}
                    onChange={(e) =>
                      setEquipmentForm((c) => ({ ...c, storageLocation: e.target.value }))
                    }
                    placeholder="e.g. Shelf A-2"
                  />
                </FormField>
                <div className="grid grid-cols-2 gap-3">
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
                <div className="grid grid-cols-2 gap-3">
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
                      min={0}
                      value={
                        Number.isFinite(equipmentForm.purchaseCost)
                          ? (equipmentForm.purchaseCost ?? 0)
                          : 0
                      }
                      onChange={(e) =>
                        setEquipmentForm((c) => ({
                          ...c,
                          purchaseCost: Number.isFinite(e.target.valueAsNumber)
                            ? e.target.valueAsNumber
                            : 0,
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
                    rows={2}
                  />
                </FormField>
                <FormField label="Remarks">
                  <Textarea
                    value={equipmentForm.remarks ?? ""}
                    onChange={(e) => setEquipmentForm((c) => ({ ...c, remarks: e.target.value }))}
                    rows={2}
                  />
                </FormField>
                <div className="sticky bottom-0 flex flex-wrap gap-2 border-t border-slate-100 bg-white pt-3">
                  <Button
                    className="flex-1"
                    disabled={saveEquipment.isPending}
                    onClick={() => {
                      const parsed = laboratoryEquipmentSchema.safeParse(equipmentForm);
                      if (!parsed.success) {
                        return toast.error(
                          parsed.error.issues[0]?.message ?? "Invalid equipment details",
                        );
                      }
                      saveEquipment.mutate(parsed.data);
                    }}
                  >
                    {editingEquipmentId ? "Save changes" : "Add equipment"}
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
            ) : null}

            {/* Left–right slider: Update stock ↔ Equipment inventory (staff/admin).
                Allotted teachers only see the inventory list + Request. */}
            <div
              id="lab-inventory-slider"
              className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm"
            >
              {canManageLabsMeta ? (
              <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 bg-slate-50/80 px-3 py-2.5">
                <div className="flex flex-wrap items-center gap-1 rounded-xl bg-white p-1 shadow-sm ring-1 ring-slate-200">
                  <button
                    type="button"
                    onClick={() => setInventorySlide(0)}
                    className={cn(
                      "rounded-lg px-3 py-1.5 text-xs font-semibold transition",
                      inventorySlide === 0
                        ? "bg-brand-600 text-white shadow-sm"
                        : "text-slate-600 hover:bg-slate-100",
                    )}
                  >
                    Update stock
                  </button>
                  <button
                    type="button"
                    onClick={() => setInventorySlide(1)}
                    className={cn(
                      "rounded-lg px-3 py-1.5 text-xs font-semibold transition",
                      inventorySlide === 1
                        ? "bg-brand-600 text-white shadow-sm"
                        : "text-slate-600 hover:bg-slate-100",
                    )}
                  >
                    Equipment inventory
                  </button>
                </div>
                <div className="flex items-center gap-1.5">
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    className="h-8 w-8 p-0"
                    title="Previous panel"
                    aria-label="Previous panel"
                    disabled={inventorySlide === 0}
                    onClick={() => setInventorySlide(0)}
                  >
                    <ChevronLeft className="h-4 w-4" />
                  </Button>
                  <span className="min-w-[4.5rem] text-center text-[11px] font-medium tabular-nums text-slate-500">
                    {inventorySlide + 1} / 2
                  </span>
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    className="h-8 w-8 p-0"
                    title="Next panel"
                    aria-label="Next panel"
                    disabled={inventorySlide === 1}
                    onClick={() => setInventorySlide(1)}
                  >
                    <ChevronRight className="h-4 w-4" />
                  </Button>
                </div>
              </div>
              ) : null}

              <div className="relative overflow-hidden">
                <div
                  className={cn(
                    "flex transition-transform duration-300 ease-out",
                    canManageLabsMeta ? "w-[200%]" : "w-full",
                  )}
                  style={{
                    transform: canManageLabsMeta
                      ? `translateX(-${inventorySlide * 50}%)`
                      : "translateX(0)",
                  }}
                >
                  {/* Panel 1: Update stock (staff / admin only) */}
                  {canManageLabsMeta ? (
                  <div className="w-1/2 shrink-0 px-1 sm:px-0">
                    <Card
                      id="lab-update-stock"
                      className="border-0 shadow-none"
                    >
                      <CardHeader className="border-b border-slate-100 bg-[linear-gradient(135deg,_#eef3fb_0%,_white_100%)] pb-3">
                        <CardTitle className="flex items-center gap-2 text-base">
                          <Package className="h-5 w-5 text-brand-600" />
                          Update stock
                        </CardTitle>
                        <p className="text-xs text-slate-500">
                          Increase, reduce, consume, or mark damaged / lost /
                          maintenance. Use the arrow or open{" "}
                          <strong>Equipment inventory</strong> to pick an item,
                          then click <strong>Stock</strong>.
                        </p>
                      </CardHeader>
                      <CardContent className="space-y-4 pt-4">
                        {selectedStockItem ? (
                          <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-brand-100 bg-brand-50/60 px-4 py-3">
                            <div className="min-w-0">
                              <p className="font-medium text-slate-900">
                                {selectedStockItem.name}
                              </p>
                              <p className="text-xs text-slate-600">
                                {selectedStockItem.itemCode} ·{" "}
                                {selectedStockItem.laboratoryName ?? "Lab"} ·{" "}
                                {selectedStockItem.categoryName ?? "—"}
                              </p>
                            </div>
                            <div className="flex flex-wrap gap-3 text-center text-sm">
                              <div className="rounded-lg bg-white px-3 py-1.5 shadow-sm">
                                <p className="text-[10px] uppercase tracking-wide text-slate-500">
                                  Total
                                </p>
                                <p className="font-semibold text-slate-900">
                                  {selectedStockItem.quantity}
                                </p>
                              </div>
                              <div className="rounded-lg bg-white px-3 py-1.5 shadow-sm">
                                <p className="text-[10px] uppercase tracking-wide text-slate-500">
                                  Available
                                </p>
                                <p className="font-semibold text-emerald-700">
                                  {selectedStockItem.availableQuantity}
                                </p>
                              </div>
                              <div className="rounded-lg bg-white px-3 py-1.5 shadow-sm">
                                <p className="text-[10px] uppercase tracking-wide text-slate-500">
                                  Issued
                                </p>
                                <p className="font-semibold text-sky-700">
                                  {selectedStockItem.issuedQuantity ?? 0}
                                </p>
                              </div>
                              <div className="rounded-lg bg-white px-3 py-1.5 shadow-sm">
                                <p className="text-[10px] uppercase tracking-wide text-slate-500">
                                  Min / Max
                                </p>
                                <p className="font-semibold text-slate-900">
                                  {selectedStockItem.minimumStockLevel ?? 0}
                                  {" / "}
                                  {(selectedStockItem.maximumStockLevel ?? 0) > 0
                                    ? selectedStockItem.maximumStockLevel
                                    : "—"}
                                </p>
                              </div>
                              <div className="flex items-center">
                                <StockStatusBadge
                                  status={selectedStockItem.status}
                                />
                              </div>
                            </div>
                          </div>
                        ) : (
                          <div className="rounded-xl border border-dashed border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-500">
                            Select equipment from the dropdown, or slide right to{" "}
                            <button
                              type="button"
                              className="font-semibold text-brand-700 underline-offset-2 hover:underline"
                              onClick={() => setInventorySlide(1)}
                            >
                              Equipment inventory
                            </button>{" "}
                            and click Stock.
                          </div>
                        )}

                        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                          <FormField label="Equipment *">
                            <Select
                              value={stockAction.equipmentId}
                              onChange={(e) =>
                                setStockAction((c) => ({
                                  ...c,
                                  equipmentId: e.target.value,
                                }))
                              }
                            >
                              <option value="">Select item</option>
                              {equipment.map((item) => (
                                <option key={item._id} value={item._id}>
                                  {item.name} · {item.availableQuantity} avail.
                                </option>
                              ))}
                            </Select>
                          </FormField>
                          <FormField label="Action *">
                            <Select
                              value={stockAction.type}
                              onChange={(e) =>
                                setStockAction((c) => ({
                                  ...c,
                                  type: e.target.value,
                                }))
                              }
                            >
                              {stockActionOptions.map((opt) => (
                                <option key={opt.value} value={opt.value}>
                                  {opt.label}
                                </option>
                              ))}
                            </Select>
                          </FormField>
                          <FormField label="Quantity *">
                            <NumberInput
                              min={1}
                              value={
                                Number.isFinite(stockAction.quantity)
                                  ? stockAction.quantity
                                  : 1
                              }
                              onChange={(e) =>
                                setStockAction((c) => ({
                                  ...c,
                                  quantity: Number.isFinite(e.target.valueAsNumber)
                                    ? Math.max(1, e.target.valueAsNumber)
                                    : 1,
                                }))
                              }
                            />
                          </FormField>
                          <FormField label="Notes">
                            <Input
                              value={stockAction.notes}
                              onChange={(e) =>
                                setStockAction((c) => ({
                                  ...c,
                                  notes: e.target.value,
                                }))
                              }
                              placeholder="Optional reason"
                            />
                          </FormField>
                        </div>
                        <div className="flex flex-wrap items-center gap-2">
                          <Button
                            disabled={
                              !stockAction.equipmentId ||
                              stockAction.quantity < 1 ||
                              adjustStock.isPending
                            }
                            onClick={() => adjustStock.mutate()}
                          >
                            {adjustStock.isPending
                              ? "Updating…"
                              : "Apply stock change"}
                          </Button>
                          {stockAction.equipmentId ? (
                            <Button
                              variant="secondary"
                              onClick={() =>
                                setStockAction({
                                  equipmentId: "",
                                  type: "INCREASE",
                                  quantity: 1,
                                  notes: "",
                                })
                              }
                            >
                              Clear selection
                            </Button>
                          ) : null}
                          <Button
                            type="button"
                            variant="outline"
                            className="ml-auto"
                            onClick={() => setInventorySlide(1)}
                          >
                            Equipment inventory
                            <ChevronRight className="ml-1 h-4 w-4" />
                          </Button>
                        </div>
                      </CardContent>
                    </Card>
                  </div>
                  ) : null}

                  {/* Panel 2: Equipment inventory */}
                  <div
                    className={cn(
                      "shrink-0 px-1 sm:px-0",
                      canManageLabsMeta ? "w-1/2" : "w-full",
                    )}
                  >
                    <Card className="border-0 shadow-none">
                      <CardHeader className="space-y-3 border-b border-slate-100 pb-3">
                        <div className="flex flex-row flex-wrap items-center justify-between gap-3">
                          <div>
                            <CardTitle className="text-base">
                              Equipment inventory
                            </CardTitle>
                            <p className="mt-0.5 text-xs text-slate-500">
                              {equipmentQuery.isLoading
                                ? "Loading…"
                                : `${equipment.length} item${equipment.length === 1 ? "" : "s"}`}
                              {labFilter
                                ? ` · ${
                                    labOptions.find((l) => l._id === labFilter)
                                      ?.name ?? "selected lab"
                                  }`
                                : " · all laboratories"}
                            </p>
                          </div>
                          <Button
                            type="button"
                            size="sm"
                            variant="outline"
                            onClick={() => setInventorySlide(0)}
                          >
                            <ChevronLeft className="mr-1 h-4 w-4" />
                            Update stock
                          </Button>
                        </div>
                        <div className="flex flex-wrap items-end gap-2">
                          <div className="min-w-[12rem] flex-1">
                            <label className="mb-1 block text-xs font-medium text-slate-600">
                              Filter by laboratory
                            </label>
                            <Select
                              value={labFilter}
                              onChange={(e) => setLabFilter(e.target.value)}
                            >
                              <option value="">All laboratories</option>
                              {labOptions.map((lab) => (
                                <option key={lab._id} value={lab._id}>
                                  {lab.yearLevel ? `[${lab.yearLevel}] ` : ""}
                                  {lab.name}
                                </option>
                              ))}
                            </Select>
                          </div>
                          {labFilter ? (
                            <Button
                              type="button"
                              size="sm"
                              variant="outline"
                              className="h-10"
                              onClick={() => setLabFilter("")}
                            >
                              Clear lab
                            </Button>
                          ) : null}
                        </div>
                      </CardHeader>
                      <CardContent className="p-0">
                        {equipmentQuery.isLoading ? (
                          <div className="px-6 py-12 text-center text-sm text-slate-500">
                            Loading equipment…
                          </div>
                        ) : equipment.length === 0 ? (
                          <div className="px-6 py-12 text-center">
                            <Package className="mx-auto h-10 w-10 text-slate-300" />
                            <p className="mt-3 font-medium text-slate-700">
                              No equipment found
                            </p>
                            <p className="mt-1 text-sm text-slate-500">
                              Add equipment using the form on the left, or clear
                              filters.
                            </p>
                          </div>
                        ) : (
                          <StickyTableScroll
                            header={
                              <Table className="w-full min-w-[1100px] table-fixed">
                                <colgroup>
                                  <col className="w-[5%]" />
                                  <col className="w-[18%]" />
                                  <col className="w-[11%]" />
                                  <col className="w-[8%]" />
                                  <col className="w-[7%]" />
                                  <col className="w-[7%]" />
                                  <col className="w-[6%]" />
                                  <col className="w-[6%]" />
                                  <col className="w-[8%]" />
                                  <col className="w-[8%]" />
                                  <col className="w-[16%]" />
                                </colgroup>
                                <TableHead>
                                  <tr>
                                    <Th className="bg-slate-50 text-center">S.N.</Th>
                                    <Th className="bg-slate-50">Item</Th>
                                    <Th className="bg-slate-50">Lab</Th>
                                    <Th className="bg-slate-50">Code</Th>
                                    <Th className="bg-slate-50 text-right">
                                      Total
                                    </Th>
                                    <Th className="bg-slate-50 text-right">
                                      Avail.
                                    </Th>
                                    <Th className="bg-slate-50 text-right">
                                      Min
                                    </Th>
                                    <Th className="bg-slate-50 text-right">
                                      Max
                                    </Th>
                                    <Th className="bg-slate-50">Condition</Th>
                                    <Th className="bg-slate-50">Stock</Th>
                                    <Th className="bg-slate-50 text-right">
                                      Actions
                                    </Th>
                                  </tr>
                                </TableHead>
                              </Table>
                            }
                            body={
                              <Table className="w-full min-w-[1100px] table-fixed">
                                <colgroup>
                                  <col className="w-[5%]" />
                                  <col className="w-[18%]" />
                                  <col className="w-[11%]" />
                                  <col className="w-[8%]" />
                                  <col className="w-[7%]" />
                                  <col className="w-[7%]" />
                                  <col className="w-[6%]" />
                                  <col className="w-[6%]" />
                                  <col className="w-[8%]" />
                                  <col className="w-[8%]" />
                                  <col className="w-[16%]" />
                                </colgroup>
                                <TableBody>
                                  {equipment.map((item, index) => {
                                    const isSelected =
                                      stockAction.equipmentId === item._id;
                                    return (
                                      <tr
                                        key={item._id}
                                        className={cn(
                                          "transition-colors",
                                          isSelected && "bg-brand-50/70",
                                        )}
                                      >
                                        <Td className="text-center tabular-nums text-slate-500">
                                          {index + 1}
                                        </Td>
                                        <Td>
                                          <div className="flex flex-wrap items-center gap-2">
                                            <span className="font-medium text-slate-900">
                                              {item.name}
                                            </span>
                                            <Badge className="bg-indigo-100 text-indigo-800">
                                              {item.yearLevel ?? "All Years"}
                                            </Badge>
                                          </div>
                                          <div className="mt-0.5 text-xs text-slate-500">
                                            {item.itemKind === "DISPOSABLE"
                                              ? "Disposable / Destroyable"
                                              : "Non-Disposable / Non-Destroyable"}
                                            {item.categoryName
                                              ? ` · ${item.categoryName}`
                                              : ""}
                                            {item.storageLocation
                                              ? ` · ${item.storageLocation}`
                                              : ""}
                                          </div>
                                        </Td>
                                        <Td className="text-sm text-slate-700">
                                          {item.laboratoryName ?? "—"}
                                        </Td>
                                        <Td className="font-mono text-xs text-slate-600">
                                          {item.itemCode || "—"}
                                        </Td>
                                        <Td className="text-right tabular-nums">
                                          {item.quantity}
                                        </Td>
                                        <Td className="text-right tabular-nums font-medium text-emerald-700">
                                          {item.availableQuantity}
                                        </Td>
                                        <Td className="text-right tabular-nums text-slate-600">
                                          {item.minimumStockLevel ?? 0}
                                        </Td>
                                        <Td className="text-right tabular-nums text-slate-600">
                                          {(item.maximumStockLevel ?? 0) > 0
                                            ? item.maximumStockLevel
                                            : "—"}
                                        </Td>
                                        <Td className="text-sm">
                                          {item.condition ?? "—"}
                                        </Td>
                                        <Td>
                                          <StockStatusBadge
                                            status={item.status}
                                          />
                                        </Td>
                                        <Td className="text-right">
                                          <div className="flex flex-wrap justify-end gap-1">
                                            {canManageLabsMeta ? (
                                              <Button
                                                size="sm"
                                                variant={
                                                  isSelected
                                                    ? "default"
                                                    : "secondary"
                                                }
                                                title="Adjust stock"
                                                onClick={() =>
                                                  beginStockAdjust(item)
                                                }
                                              >
                                                <Package className="mr-1 h-3.5 w-3.5" />
                                                Stock
                                              </Button>
                                            ) : null}
                                            {canEditDelete ? (
                                              <Button
                                                size="sm"
                                                variant="secondary"
                                                title="Edit equipment"
                                                onClick={() =>
                                                  beginEditEquipment(item)
                                                }
                                              >
                                                <Pencil className="mr-1 h-3.5 w-3.5" />
                                                Edit
                                              </Button>
                                            ) : null}
                                            {canRequestLabItems ? (
                                              <Button
                                                size="sm"
                                                variant="secondary"
                                                title="Create purchase request for this item"
                                                onClick={() =>
                                                  fillRequestFromEquipment(item)
                                                }
                                              >
                                                <ShoppingCart className="mr-1 h-3.5 w-3.5" />
                                                Request
                                              </Button>
                                            ) : null}
                                            {canEditDelete ? (
                                              <Button
                                                size="sm"
                                                variant="outline"
                                                className="border-rose-200 text-rose-700 hover:bg-rose-50"
                                                title="Delete equipment"
                                                disabled={
                                                  deleteEquipment.isPending
                                                }
                                                onClick={() => {
                                                  if (
                                                    confirm(
                                                      `Delete equipment "${item.name}" (${item.itemCode || "no code"})?\n\nThis cannot be undone. Items with active issues cannot be deleted.`,
                                                    )
                                                  ) {
                                                    deleteEquipment.mutate(
                                                      item._id,
                                                    );
                                                  }
                                                }}
                                              >
                                                <Trash2 className="mr-1 h-3.5 w-3.5" />
                                                Delete
                                              </Button>
                                            ) : null}
                                          </div>
                                        </Td>
                                      </tr>
                                    );
                                  })}
                                </TableBody>
                              </Table>
                            }
                          />
                        )}
                      </CardContent>
                    </Card>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {tab === "requests" && (
        <div className="space-y-6">
          <div className="grid min-w-0 gap-6 xl:grid-cols-[minmax(0,360px)_minmax(0,1fr)]">
            <Card id="lab-stock-request-form">
              <CardHeader>
                <CardTitle>
                  {editingRequestId ? "Edit required item" : "Submit stock request"}
                </CardTitle>
                {editingRequestId ? (
                  <p className="mt-1 text-xs text-slate-500">
                    Update fields below, then save. Workflow status (approve / receive) is
                    managed from the list actions.
                  </p>
                ) : isTeacher ? (
                  <p className="mt-1 text-xs text-slate-500">
                    Request items needed for your allotted laboratory. Admin / Super Admin
                    receive the request and handle approve / purchase / receive — same
                    workflow as Lab Staff.
                  </p>
                ) : null}
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
                        itemKind: item?.itemKind ?? c.itemKind,
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
                <FormField label="Category (disposable type)">
                  <Select
                    value={requestForm.itemKind}
                    onChange={(e) =>
                      setRequestForm((c) => ({
                        ...c,
                        itemKind: e.target.value as StockRequestFormState["itemKind"],
                      }))
                    }
                  >
                    {itemKindOptions.map((opt) => (
                      <option key={opt.value} value={opt.value}>
                        {opt.label}
                      </option>
                    ))}
                  </Select>
                  <p className="mt-1 text-xs text-slate-500">
                    Disposable / Destroyable or Non-Disposable / Non-Destroyable — shown on the
                    required items list.
                  </p>
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
                <div className="flex flex-wrap gap-2">
                  <Button
                    disabled={createRequest.isPending || updateRequest.isPending}
                    onClick={() => {
                      const parsed = laboratoryStockRequestSchema.safeParse(requestForm);
                      if (!parsed.success) {
                        return toast.error(
                          parsed.error.issues[0]?.message ?? "Invalid request details",
                        );
                      }
                      const payload: StockRequestFormState = {
                        ...requestForm,
                        ...parsed.data,
                        equipmentId: parsed.data.equipmentId ?? "",
                        categoryName: parsed.data.categoryName ?? "",
                        itemKind: parsed.data.itemKind ?? requestForm.itemKind,
                        remarks: parsed.data.remarks ?? "",
                      };
                      if (editingRequestId) {
                        updateRequest.mutate({ id: editingRequestId, payload });
                      } else {
                        createRequest.mutate(payload);
                      }
                    }}
                  >
                    {editingRequestId
                      ? updateRequest.isPending
                        ? "Saving…"
                        : "Save changes"
                      : createRequest.isPending
                        ? "Submitting…"
                        : "Submit request"}
                  </Button>
                  {editingRequestId ? (
                    <Button
                      type="button"
                      variant="outline"
                      disabled={updateRequest.isPending}
                      onClick={cancelEditRequest}
                    >
                      Cancel edit
                    </Button>
                  ) : null}
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="space-y-3">
                <div className="flex flex-row flex-wrap items-start justify-between gap-3">
                  <div>
                    <CardTitle>Required items / purchase workflow</CardTitle>
                    <p className="mt-1 text-xs text-slate-500">
                      {requestsQuery.isLoading
                        ? "Loading…"
                        : `${requests.length} request${requests.length === 1 ? "" : "s"}`}
                      {labFilter
                        ? ` · ${
                            labOptions.find((l) => l._id === labFilter)?.name ??
                            "selected lab"
                          }`
                        : " · all laboratories"}
                      {requestStatusFilter
                        ? ` · status: ${
                            requestStatusFilter === "OPEN"
                              ? "open (pending/approved/purchased)"
                              : requestStatusFilter
                          }`
                        : ""}
                    </p>
                  </div>
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    className="shrink-0"
                    disabled={requests.length === 0 || printingLabList}
                    onClick={printRequiredItemsList}
                    title="Print required items list"
                  >
                    <Printer className="mr-1.5 h-4 w-4" />
                    {printingLabList && tab === "requests" ? "Printing…" : "Print"}
                  </Button>
                </div>
                <div className="flex flex-wrap items-end gap-2">
                  <div className="min-w-[12rem] flex-1 sm:flex-none sm:w-56">
                    <label className="mb-1 block text-xs font-medium text-slate-600">
                      Laboratory
                    </label>
                    <Select
                      value={labFilter}
                      onChange={(e) => setLabFilter(e.target.value)}
                    >
                      <option value="">All laboratories</option>
                      {labOptions.map((lab) => (
                        <option key={lab._id} value={lab._id}>
                          {lab.yearLevel ? `[${lab.yearLevel}] ` : ""}
                          {lab.name}
                        </option>
                      ))}
                    </Select>
                  </div>
                  <div className="min-w-[10rem] flex-1 sm:flex-none sm:w-44">
                    <label className="mb-1 block text-xs font-medium text-slate-600">
                      Status
                    </label>
                    <Select
                      value={requestStatusFilter}
                      onChange={(e) => setRequestStatusFilter(e.target.value)}
                    >
                      <option value="">All statuses</option>
                      <option value="OPEN">Open (pending / approved / purchased)</option>
                      <option value="PENDING">Pending only</option>
                      <option value="APPROVED">Approved</option>
                      <option value="PURCHASED">Purchased</option>
                      <option value="RECEIVED">Received</option>
                      <option value="REJECTED">Rejected</option>
                    </Select>
                  </div>
                  {labFilter || requestStatusFilter ? (
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      className="h-10"
                      onClick={() => {
                        setLabFilter("");
                        setRequestStatusFilter("");
                      }}
                    >
                      Clear filters
                    </Button>
                  ) : null}
                </div>
              </CardHeader>
              <CardContent className="p-0" id="lab-requests-list">
                {requests.length === 0 ? (
                  <div className="px-6 py-12 text-center text-sm text-slate-500">
                    No stock requests match this filter.
                    {labFilter || requestStatusFilter
                      ? " Try another laboratory or status."
                      : ""}
                  </div>
                ) : (
                  <StickyTableScroll
                    header={
                      <Table className="w-full min-w-[1280px] table-fixed">
                        <colgroup>
                          <col className="w-[4%]" />
                          <col className="w-[10%]" />
                          <col className="w-[14%]" />
                          <col className="w-[12%]" />
                          <col className="w-[5%]" />
                          <col className="w-[5%]" />
                          <col className="w-[6%]" />
                          <col className="w-[6%]" />
                          <col className="w-[10%]" />
                          <col className="w-[7%]" />
                          <col className="w-[7%]" />
                          {isAdmin || canRequestLabItems ? (
                            <col className="w-[14%]" />
                          ) : null}
                        </colgroup>
                        <TableHead>
                          <tr>
                            <Th className="bg-slate-50 text-center">S.N.</Th>
                            <Th className="bg-slate-50">Lab</Th>
                            <Th className="bg-slate-50">Equipment</Th>
                            <Th className="bg-slate-50">Category</Th>
                            <Th className="bg-slate-50">Current</Th>
                            <Th className="bg-slate-50">Min</Th>
                            <Th className="bg-slate-50">Required</Th>
                            <Th className="bg-slate-50">Priority</Th>
                            <Th className="bg-slate-50">Requested by</Th>
                            <Th className="bg-slate-50">Date</Th>
                            <Th className="bg-slate-50">Status</Th>
                            {isAdmin || canRequestLabItems ? (
                              <Th className="bg-slate-50 text-right">Actions</Th>
                            ) : null}
                          </tr>
                        </TableHead>
                      </Table>
                    }
                    body={
                      <Table className="w-full min-w-[1280px] table-fixed">
                        <colgroup>
                          <col className="w-[4%]" />
                          <col className="w-[10%]" />
                          <col className="w-[14%]" />
                          <col className="w-[12%]" />
                          <col className="w-[5%]" />
                          <col className="w-[5%]" />
                          <col className="w-[6%]" />
                          <col className="w-[6%]" />
                          <col className="w-[10%]" />
                          <col className="w-[7%]" />
                          <col className="w-[7%]" />
                          {isAdmin || canRequestLabItems ? (
                            <col className="w-[14%]" />
                          ) : null}
                        </colgroup>
                        <TableBody>
                          {requests.map((req, index) => (
                            <tr
                              key={req._id}
                              className={
                                editingRequestId === req._id
                                  ? "bg-brand-50/70 hover:bg-brand-50"
                                  : "bg-white hover:bg-slate-50/80"
                              }
                            >
                              <Td className="text-center tabular-nums text-slate-500">
                                {index + 1}
                              </Td>
                              <Td>{req.laboratoryName ?? "—"}</Td>
                              <Td>
                                <div className="font-medium">
                                  {req.equipmentName}
                                </div>
                                <div className="text-xs text-slate-500">
                                  {req.autoGenerated
                                    ? "Auto low-stock"
                                    : "Manual"}
                                  {req.categoryName
                                    ? ` · ${req.categoryName}`
                                    : ""}
                                </div>
                              </Td>
                              <Td>
                                <Badge
                                  className={
                                    req.itemKind === "DISPOSABLE"
                                      ? "bg-orange-100 text-orange-900"
                                      : "bg-sky-100 text-sky-900"
                                  }
                                >
                                  {req.itemKind === "DISPOSABLE"
                                    ? "Disposable / Destroyable"
                                    : "Non-Disposable / Non-Destroyable"}
                                </Badge>
                              </Td>
                              <Td>{req.currentStock}</Td>
                              <Td>{req.minimumStock}</Td>
                              <Td>{req.requiredQuantity}</Td>
                              <Td>{req.priority}</Td>
                              <Td>{req.requestedByName ?? "—"}</Td>
                              <Td>{req.requestDateBs}</Td>
                              <Td>
                                <Badge
                                  className={requestStatusStyles[req.status]}
                                >
                                  {req.status}
                                </Badge>
                              </Td>
                              {isAdmin || canRequestLabItems ? (
                                <Td className="whitespace-nowrap text-right">
                                  <div className="inline-flex flex-wrap items-center justify-end gap-1">
                                    {canEditRequest(req) ? (
                                      <Button
                                        size="sm"
                                        variant="secondary"
                                        disabled={
                                          updateRequest.isPending ||
                                          createRequest.isPending
                                        }
                                        title="Edit this required item"
                                        onClick={() => beginEditRequest(req)}
                                      >
                                        {editingRequestId === req._id
                                          ? "Editing…"
                                          : "Edit"}
                                      </Button>
                                    ) : null}
                                    {isAdmin && req.status === "PENDING" ? (
                                      <>
                                        <Button
                                          size="sm"
                                          variant="secondary"
                                          onClick={() =>
                                            updateRequestStatus.mutate({
                                              id: req._id,
                                              status: "APPROVED",
                                            })
                                          }
                                        >
                                          Approve
                                        </Button>
                                        <Button
                                          size="sm"
                                          variant="secondary"
                                          onClick={() =>
                                            updateRequestStatus.mutate({
                                              id: req._id,
                                              status: "REJECTED",
                                            })
                                          }
                                        >
                                          Reject
                                        </Button>
                                      </>
                                    ) : null}
                                    {isAdmin && req.status === "APPROVED" ? (
                                      <Button
                                        size="sm"
                                        variant="secondary"
                                        onClick={() =>
                                          updateRequestStatus.mutate({
                                            id: req._id,
                                            status: "PURCHASED",
                                          })
                                        }
                                      >
                                        Purchased
                                      </Button>
                                    ) : null}
                                    {isAdmin &&
                                    (req.status === "PURCHASED" ||
                                      req.status === "APPROVED") ? (
                                      <Button
                                        size="sm"
                                        onClick={() =>
                                          updateRequestStatus.mutate({
                                            id: req._id,
                                            status: "RECEIVED",
                                            receivedQuantity:
                                              req.requiredQuantity,
                                          })
                                        }
                                      >
                                        Received
                                      </Button>
                                    ) : null}
                                    {canEditDelete ? (
                                      <Button
                                        size="sm"
                                        variant="destructive"
                                        disabled={deleteRequest.isPending}
                                        title="Remove this required item from the list"
                                        onClick={() => {
                                          const label =
                                            req.equipmentName || "this request";
                                          if (
                                            !window.confirm(
                                              `Delete required item “${label}”?\n\nThis removes it from the purchase workflow list.${
                                                req.autoGenerated &&
                                                (req.status === "PENDING" ||
                                                  req.status === "APPROVED" ||
                                                  req.status === "PURCHASED")
                                                  ? "\n\nNote: Auto low-stock items may reappear if inventory is still below minimum."
                                                  : ""
                                              }`,
                                            )
                                          ) {
                                            return;
                                          }
                                          if (editingRequestId === req._id) {
                                            cancelEditRequest();
                                          }
                                          deleteRequest.mutate(req._id);
                                        }}
                                      >
                                        Delete
                                      </Button>
                                    ) : null}
                                  </div>
                                </Td>
                              ) : null}
                            </tr>
                          ))}
                        </TableBody>
                      </Table>
                    }
                  />
                )}
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

          <Card id="lab-issues-list">
            <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-2">
              <div>
                <CardTitle>Equipment issues</CardTitle>
                {issueStatusFilter ? (
                  <p className="mt-1 text-xs text-brand-800">
                    Showing:{" "}
                    {issueStatusFilter === "ACTIVE"
                      ? "Currently issued / overdue only"
                      : issueStatusFilter}
                    {" · "}
                    {issues.length} row{issues.length === 1 ? "" : "s"}
                  </p>
                ) : null}
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <Select
                  className="w-auto min-w-[160px]"
                  value={issueStatusFilter}
                  onChange={(e) => setIssueStatusFilter(e.target.value)}
                >
                  <option value="">All issues</option>
                  <option value="ACTIVE">Issued + overdue</option>
                  <option value="ISSUED">Issued only</option>
                  <option value="OVERDUE">Overdue only</option>
                  <option value="RETURNED">Returned only</option>
                </Select>
                {issueStatusFilter ? (
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => setIssueStatusFilter("")}
                  >
                    Clear
                  </Button>
                ) : null}
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  disabled={issues.length === 0 || printingLabList}
                  onClick={printEquipmentIssuesList}
                  title="Print equipment issues list"
                >
                  <Printer className="mr-1.5 h-4 w-4" />
                  {printingLabList && tab === "issues" ? "Printing…" : "Print"}
                </Button>
              </div>
            </CardHeader>
            <CardContent className="min-w-0">
              <div className="max-w-full overflow-x-auto overscroll-x-contain [scrollbar-width:thin]">
                <Table className="w-full min-w-[960px]">
                  <TableHead>
                    <tr>
                      <Th className="w-14 whitespace-nowrap text-center">S.N.</Th>
                      <Th className="whitespace-nowrap">Item</Th>
                      <Th className="whitespace-nowrap">Lab</Th>
                      <Th className="whitespace-nowrap">Teacher</Th>
                      <Th className="whitespace-nowrap">Qty</Th>
                      <Th className="whitespace-nowrap">Issued</Th>
                      <Th className="whitespace-nowrap">Due</Th>
                      <Th className="whitespace-nowrap">Returned</Th>
                      <Th className="whitespace-nowrap">Status</Th>
                      <Th className="whitespace-nowrap text-right">Actions</Th>
                    </tr>
                  </TableHead>
                  <TableBody>
                    {issues.length === 0 ? (
                      <tr>
                        <Td
                          colSpan={10}
                          className="py-10 text-center text-sm text-slate-500"
                        >
                          No issues match this filter.
                        </Td>
                      </tr>
                    ) : null}
                    {issues.map((issue, index) => (
                      <tr key={issue._id}>
                        <Td className="whitespace-nowrap text-center tabular-nums text-slate-500">
                          {index + 1}
                        </Td>
                        <Td className="whitespace-nowrap">
                          {issue.equipmentName ?? "—"}
                        </Td>
                        <Td className="whitespace-nowrap">
                          {issue.laboratoryName ?? "—"}
                        </Td>
                        <Td className="whitespace-nowrap">
                          {issue.teacherName ?? "—"}
                        </Td>
                        <Td className="whitespace-nowrap">{issue.quantity}</Td>
                        <Td className="whitespace-nowrap">{issue.issuedDateBs}</Td>
                        <Td className="whitespace-nowrap">{issue.dueDateBs}</Td>
                        <Td className="whitespace-nowrap">
                          {issue.returnedDateBs ?? "—"}
                        </Td>
                        <Td className="whitespace-nowrap">
                          <Badge className={issueStatusStyles[issue.status] ?? ""}>
                            {issue.status}
                          </Badge>
                        </Td>
                        <Td className="whitespace-nowrap text-right">
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
              </div>
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
                  {(() => {
                    const branding = getPrintInstitutionBranding();
                    return (
                      <div className="mb-3 border-b border-slate-300 pb-2 text-center">
                        <p className="text-sm font-bold uppercase tracking-wide text-slate-900">
                          {branding.name || "Institution"}
                        </p>
                        {branding.address ? (
                          <p className="mt-0.5 text-xs text-slate-600">
                            {branding.address}
                          </p>
                        ) : null}
                        <p className="mt-1 text-sm font-semibold text-slate-800">
                          {reportTypeOptions.find(
                            (r) => r.value === reportData.reportType,
                          )?.label ?? reportData.reportType}
                        </p>
                      </div>
                    );
                  })()}
                  <p className="mb-3 text-sm text-slate-500">
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
        <div className="grid min-w-0 gap-6 xl:grid-cols-[minmax(0,360px)_minmax(0,1fr)]">
          <Card className="min-w-0">
            <CardHeader>
              <CardTitle>Create laboratory staff</CardTitle>
            </CardHeader>
            <CardContent className="min-w-0 space-y-3">
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

          <Card className="min-w-0">
            <CardHeader>
              <CardTitle>Laboratory staff accounts</CardTitle>
            </CardHeader>
            <CardContent className="min-w-0">
              <div className="max-w-full overflow-x-auto overscroll-x-contain [scrollbar-width:thin]">
                <Table className="w-full min-w-[640px]">
                  <TableHead>
                    <tr>
                      <Th className="w-14 whitespace-nowrap text-center">S.N.</Th>
                      <Th className="whitespace-nowrap">Name</Th>
                      <Th className="whitespace-nowrap">Email</Th>
                      <Th className="whitespace-nowrap">Phone</Th>
                      <Th className="whitespace-nowrap">Status</Th>
                    </tr>
                  </TableHead>
                  <TableBody>
                    {(staffQuery.data ?? []).map((member, index) => (
                      <tr key={member._id}>
                        <Td className="whitespace-nowrap text-center tabular-nums text-slate-500">
                          {index + 1}
                        </Td>
                        <Td className="whitespace-nowrap">{member.fullName}</Td>
                        <Td className="whitespace-nowrap">{member.email}</Td>
                        <Td className="whitespace-nowrap">{member.phone ?? "—"}</Td>
                        <Td className="whitespace-nowrap">
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
              </div>
            </CardContent>
          </Card>
        </div>
      )}

      {tab === "print-inventory" && <LaboratoryPrintInventoryPanel />}

      {tab === "allot" && isAdmin ? <LaboratoryAllotPanel /> : null}
    </div>
  );
};
