import { useMemo, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import {
  canManageInstitution,
  laboratoryEquipmentSchema,
  laboratoryIssueSchema,
  laboratorySchema,
  moduleStaffSchema,
  type LaboratoryCategoryRecord,
  type LaboratoryDashboardResponse,
  type LaboratoryEquipmentInput,
  type LaboratoryEquipmentRecord,
  type LaboratoryInput,
  type LaboratoryIssueRecord,
  type LaboratoryRecord,
  type ModuleStaffInput,
  type UserProfile,
} from "@phit-erp/shared";
import {
  Beaker,
  FlaskConical,
  LayoutDashboard,
  Package,
  Users,
} from "lucide-react";
import { toast } from "sonner";
import { FormField } from "components/shared/FormField";
import { NepaliDateField } from "components/shared/NepaliDateField";
import { PageHeader } from "components/shared/PageHeader";
import { useAuth } from "features/auth/AuthProvider";
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

type Tab = "dashboard" | "labs" | "inventory" | "issues" | "staff";

const labTypeOptions = [
  { value: "COMPUTER", label: "Computer Lab" },
  { value: "PHYSICS", label: "Physics Lab" },
  { value: "CHEMISTRY", label: "Chemistry Lab" },
  { value: "BIOLOGY", label: "Biology Lab" },
  { value: "OTHER", label: "Other (Custom Lab)" },
];

const defaultLab: LaboratoryInput = {
  type: "COMPUTER",
  customName: "",
  isActive: true,
};
const defaultEquipment: LaboratoryEquipmentInput = {
  laboratoryId: "",
  categoryId: "",
  name: "",
  itemCode: "",
  quantity: 1,
  description: "",
};
const defaultIssue = {
  equipmentId: "",
  teacherId: "",
  quantity: 1,
  issuedDateBs: "",
  dueDateBs: "",
};
const defaultStaff: ModuleStaffInput = { fullName: "", email: "", phone: "" };

const issueStatusStyles: Record<string, string> = {
  ISSUED: "bg-sky-100 text-sky-800",
  RETURNED: "bg-brand-100 text-brand-800",
  OVERDUE: "bg-rose-100 text-rose-800",
};

const tabs: Array<{
  id: Tab;
  label: string;
  icon: typeof LayoutDashboard;
  adminOnly?: boolean;
}> = [
  { id: "dashboard", label: "Dashboard", icon: LayoutDashboard },
  { id: "labs", label: "Laboratories", icon: FlaskConical },
  { id: "inventory", label: "Inventory", icon: Package },
  { id: "issues", label: "Issue & Return", icon: Beaker },
  { id: "staff", label: "Staff", icon: Users, adminOnly: true },
];

export const LaboratoryManager = () => {
  const { user } = useAuth();
  const isAdmin = canManageInstitution(user?.role ?? "");
  const [tab, setTab] = useState<Tab>("dashboard");
  const [labForm, setLabForm] = useState<LaboratoryInput>(defaultLab);
  const [equipmentForm, setEquipmentForm] =
    useState<LaboratoryEquipmentInput>(defaultEquipment);
  const [issueForm, setIssueForm] = useState(defaultIssue);
  const [staffForm, setStaffForm] = useState<ModuleStaffInput>(defaultStaff);
  const [search, setSearch] = useState("");
  const [labFilter, setLabFilter] = useState("");
  const [newCategoryName, setNewCategoryName] = useState("");
  const [selectedLabForCategories, setSelectedLabForCategories] = useState("");

  const dashboardQuery = useQuery({
    queryKey: ["laboratory-dashboard"],
    queryFn: () =>
      unwrap<LaboratoryDashboardResponse>(api.get("/laboratory/dashboard")),
    enabled: tab === "dashboard",
  });

  const labsQuery = useQuery({
    queryKey: ["laboratory-labs"],
    queryFn: () => unwrap<LaboratoryRecord[]>(api.get("/laboratory/labs")),
  });

  const equipmentQuery = useQuery({
    queryKey: ["laboratory-equipment", labFilter, search],
    queryFn: () =>
      unwrap<LaboratoryEquipmentRecord[]>(
        api.get("/laboratory/equipment", {
          params: {
            laboratoryId: labFilter || undefined,
            search: search || undefined,
          },
        }),
      ),
  });

  const issuesQuery = useQuery({
    queryKey: ["laboratory-issues"],
    queryFn: () =>
      unwrap<LaboratoryIssueRecord[]>(api.get("/laboratory/issues")),
  });

  const teachersQuery = useQuery({
    queryKey: ["teachers"],
    queryFn: () =>
      unwrap<Array<{ _id: string; user: { fullName: string } }>>(
        api.get("/teachers"),
      ),
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

  const invalidateLab = async () => {
    await queryClient.invalidateQueries({ queryKey: ["laboratory-labs"] });
    await queryClient.invalidateQueries({ queryKey: ["laboratory-equipment"] });
    await queryClient.invalidateQueries({ queryKey: ["laboratory-issues"] });
    await queryClient.invalidateQueries({ queryKey: ["laboratory-dashboard"] });
    await queryClient.invalidateQueries({
      queryKey: ["laboratory-categories"],
    });
  };

  const createLab = useMutation({
    mutationFn: (payload: LaboratoryInput) =>
      unwrap(api.post("/laboratory/labs", payload)),
    onSuccess: async () => {
      toast.success("Laboratory created with default categories");
      setLabForm(defaultLab);
      await invalidateLab();
    },
    onError: (e) => toast.error(parseErrorMessage(e)),
  });

  const createEquipment = useMutation({
    mutationFn: (payload: LaboratoryEquipmentInput) =>
      unwrap(api.post("/laboratory/equipment", payload)),
    onSuccess: async () => {
      toast.success("Equipment added");
      setEquipmentForm(defaultEquipment);
      await invalidateLab();
    },
    onError: (e) => toast.error(parseErrorMessage(e)),
  });

  const issueEquipment = useMutation({
    mutationFn: (payload: typeof defaultIssue) =>
      unwrap(api.post("/laboratory/issues", payload)),
    onSuccess: async () => {
      toast.success("Equipment issued");
      setIssueForm(defaultIssue);
      await invalidateLab();
    },
    onError: (e) => toast.error(parseErrorMessage(e)),
  });

  const returnEquipment = useMutation({
    mutationFn: (id: string) =>
      unwrap(
        api.put(`/laboratory/issues/${id}/return`, {
          returnedDateBs: issueForm.issuedDateBs || "2082-01-01",
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
      await queryClient.invalidateQueries({
        queryKey: ["laboratory-categories"],
      });
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
      const { toastCredentialCreateResult } =
        await import("lib/credentialsEmail");
      toastCredentialCreateResult(data ?? {}, {
        successTitle: "Laboratory staff created successfully",
      });
      setStaffForm(defaultStaff);
      await queryClient.invalidateQueries({ queryKey: ["laboratory-staff"] });
    },
    onError: (e) => toast.error(parseErrorMessage(e)),
  });

  const visibleTabs = tabs.filter((item) => !item.adminOnly || isAdmin);
  const categories = categoriesQuery.data ?? [];

  const labOptions = useMemo(() => labsQuery.data ?? [], [labsQuery.data]);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Laboratory"
        description="Create laboratories, manage equipment inventory, and issue items to teachers."
      />

      <div className="flex flex-wrap gap-2">
        {visibleTabs.map((item) => {
          const Icon = item.icon;
          return (
            <Button
              key={item.id}
              variant={tab === item.id ? "default" : "secondary"}
              size="sm"
              onClick={() => setTab(item.id)}
              className={cn(
                tab === item.id && "bg-brand-600 hover:bg-brand-700",
              )}
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
              {
                label: "Total Equipment",
                value: dashboardQuery.data?.totalEquipment ?? 0,
              },
              {
                label: "Available",
                value: dashboardQuery.data?.availableEquipment ?? 0,
              },
              {
                label: "Issued",
                value: dashboardQuery.data?.issuedEquipment ?? 0,
              },
              {
                label: "Remaining Stock",
                value: dashboardQuery.data?.remainingStock ?? 0,
              },
            ].map((stat) => (
              <Card
                key={stat.label}
                className="bg-[linear-gradient(135deg,_white_0%,_#eef3fb_100%)]"
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

          <Card>
            <CardHeader>
              <CardTitle>Low stock items</CardTitle>
            </CardHeader>
            <CardContent>
              <Table>
                <TableHead>
                  <tr>
                    <Th>Item</Th>
                    <Th>Laboratory</Th>
                    <Th>Available</Th>
                    <Th>Status</Th>
                  </tr>
                </TableHead>
                <TableBody>
                  {(dashboardQuery.data?.lowStockItems ?? []).map((item) => (
                    <tr key={item._id}>
                      <Td>{item.name}</Td>
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
      )}

      {tab === "labs" && (
        <div className="grid gap-6 xl:grid-cols-[360px_1fr]">
          <Card>
            <CardHeader>
              <CardTitle>Create laboratory</CardTitle>
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
              {labForm.type === "OTHER" ? (
                <FormField label="Custom name">
                  <Input
                    value={labForm.customName}
                    onChange={(e) =>
                      setLabForm((c) => ({ ...c, customName: e.target.value }))
                    }
                  />
                </FormField>
              ) : null}
              <Button
                onClick={() => {
                  const parsed = laboratorySchema.safeParse(labForm);
                  if (!parsed.success)
                    return toast.error("Invalid laboratory details");
                  createLab.mutate(parsed.data);
                }}
              >
                Create laboratory
              </Button>
              <p className="text-xs text-slate-500">
                Suitable inventory categories are created automatically.
              </p>
            </CardContent>
          </Card>

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
                      <Th>Type</Th>
                      <Th>Status</Th>
                    </tr>
                  </TableHead>
                  <TableBody>
                    {labOptions.map((lab) => (
                      <tr key={lab._id}>
                        <Td className="font-medium">{lab.name}</Td>
                        <Td>{lab.type}</Td>
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
                      </tr>
                    ))}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Manage categories</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                <FormField label="Laboratory">
                  <Select
                    value={selectedLabForCategories}
                    onChange={(e) =>
                      setSelectedLabForCategories(e.target.value)
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
                <div className="flex gap-2">
                  <Input
                    placeholder="New category name"
                    value={newCategoryName}
                    onChange={(e) => setNewCategoryName(e.target.value)}
                  />
                  <Button
                    variant="secondary"
                    disabled={
                      !selectedLabForCategories || !newCategoryName.trim()
                    }
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
                    <Badge
                      key={cat._id}
                      className="bg-slate-100 text-slate-700"
                    >
                      {cat.name}
                    </Badge>
                  ))}
                </div>
              </CardContent>
            </Card>
          </div>
        </div>
      )}

      {tab === "inventory" && (
        <div className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle>Search & filter</CardTitle>
            </CardHeader>
            <CardContent className="grid gap-3 md:grid-cols-2">
              <FormField label="Laboratory">
                <Select
                  value={labFilter}
                  onChange={(e) => setLabFilter(e.target.value)}
                >
                  <option value="">All laboratories</option>
                  {labOptions.map((lab) => (
                    <option key={lab._id} value={lab._id}>
                      {lab.name}
                    </option>
                  ))}
                </Select>
              </FormField>
              <FormField label="Search by name or code">
                <Input
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="e.g. Microscope"
                />
              </FormField>
            </CardContent>
          </Card>

          <div className="grid gap-6 xl:grid-cols-[360px_1fr]">
            <Card>
              <CardHeader>
                <CardTitle>Add equipment</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
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
                      setEquipmentForm((c) => ({
                        ...c,
                        categoryId: e.target.value,
                      }))
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
                <FormField label="Item name">
                  <Input
                    value={equipmentForm.name}
                    onChange={(e) =>
                      setEquipmentForm((c) => ({ ...c, name: e.target.value }))
                    }
                  />
                </FormField>
                <FormField label="Item code">
                  <Input
                    value={equipmentForm.itemCode}
                    onChange={(e) =>
                      setEquipmentForm((c) => ({
                        ...c,
                        itemCode: e.target.value,
                      }))
                    }
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
                <FormField label="Description (optional)">
                  <Textarea
                    value={equipmentForm.description}
                    onChange={(e) =>
                      setEquipmentForm((c) => ({
                        ...c,
                        description: e.target.value,
                      }))
                    }
                  />
                </FormField>
                <Button
                  onClick={() => {
                    const parsed =
                      laboratoryEquipmentSchema.safeParse(equipmentForm);
                    if (!parsed.success)
                      return toast.error("Invalid equipment details");
                    createEquipment.mutate(parsed.data);
                  }}
                >
                  Add equipment
                </Button>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Equipment inventory</CardTitle>
              </CardHeader>
              <CardContent>
                <Table>
                  <TableHead>
                    <tr>
                      <Th>Item</Th>
                      <Th>Lab</Th>
                      <Th>Category</Th>
                      <Th>Code</Th>
                      <Th>Qty</Th>
                      <Th>Available</Th>
                      <Th>Issued</Th>
                      <Th>Status</Th>
                    </tr>
                  </TableHead>
                  <TableBody>
                    {(equipmentQuery.data ?? []).map((item) => (
                      <tr key={item._id}>
                        <Td className="font-medium">{item.name}</Td>
                        <Td>{item.laboratoryName ?? "—"}</Td>
                        <Td>{item.categoryName ?? "—"}</Td>
                        <Td>{item.itemCode}</Td>
                        <Td>{item.quantity}</Td>
                        <Td>{item.availableQuantity}</Td>
                        <Td>{item.issuedQuantity}</Td>
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
                  onChange={(e) =>
                    setIssueForm((c) => ({ ...c, equipmentId: e.target.value }))
                  }
                >
                  <option value="">Select equipment</option>
                  {(equipmentQuery.data ?? [])
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
                  onChange={(e) =>
                    setIssueForm((c) => ({ ...c, teacherId: e.target.value }))
                  }
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
                    setIssueForm((c) => ({
                      ...c,
                      quantity: e.target.valueAsNumber,
                    }))
                  }
                />
              </FormField>
              <FormField label="Issued (BS)">
                <NepaliDateField
                  value={issueForm.issuedDateBs}
                  onChange={(v) =>
                    setIssueForm((c) => ({ ...c, issuedDateBs: v }))
                  }
                />
              </FormField>
              <FormField label="Due (BS)">
                <NepaliDateField
                  value={issueForm.dueDateBs}
                  onChange={(v) =>
                    setIssueForm((c) => ({ ...c, dueDateBs: v }))
                  }
                />
              </FormField>
              <div className="flex items-end">
                <Button
                  onClick={() => {
                    const parsed = laboratoryIssueSchema.safeParse(issueForm);
                    if (!parsed.success)
                      return toast.error("Invalid issue details");
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
                      <Td>{issue.teacherName ?? "—"}</Td>
                      <Td>{issue.quantity}</Td>
                      <Td>{issue.issuedDateBs}</Td>
                      <Td>{issue.dueDateBs}</Td>
                      <Td>{issue.returnedDateBs ?? "—"}</Td>
                      <Td>
                        <Badge
                          className={issueStatusStyles[issue.status] ?? ""}
                        >
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
                  onChange={(e) =>
                    setStaffForm((c) => ({ ...c, fullName: e.target.value }))
                  }
                />
              </FormField>
              <FormField label="Email">
                <Input
                  value={staffForm.email}
                  onChange={(e) =>
                    setStaffForm((c) => ({ ...c, email: e.target.value }))
                  }
                />
              </FormField>
              <FormField label="Phone">
                <Input
                  value={staffForm.phone}
                  onChange={(e) =>
                    setStaffForm((c) => ({ ...c, phone: e.target.value }))
                  }
                />
              </FormField>
              <Button
                onClick={() => {
                  const parsed = moduleStaffSchema.safeParse(staffForm);
                  if (!parsed.success)
                    return toast.error("Invalid staff details");
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
