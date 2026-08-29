import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import {
  PARENT_RELATIONSHIPS,
  createParentFromStudentSchema,
  normalizeParentPortalAccess,
  parentChildLinkSchema,
  type CreateParentFromStudentInput,
  type ParentChildLinkInput,
  type ParentFromStudentRelationship,
  type ParentPortalAccessMap,
  type ParentPortalAccessResponse,
  type StudentParentCandidatesResponse,
} from "@phit-erp/shared";
import { toast } from "sonner";
import {
  PortalLoginFields,
  validatePortalPassword,
} from "components/shared/PortalLoginFields";
import { FormField } from "components/shared/FormField";
import { StudentNameLink } from "components/shared/StudentNameLink";
import { PageHeader } from "components/shared/PageHeader";
import { Badge } from "components/ui/badge";
import { Button } from "components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "components/ui/card";
import { Input } from "components/ui/input";
import { Select } from "components/ui/select";
import { Table, TableBody, Td, Th, TableHead } from "components/ui/table";
import { api, unwrap } from "lib/api";
import { queryClient } from "lib/queryClient";
import { parseErrorMessage } from "lib/utils";
import { useCanEditOrDeleteRecords, useCanManageGrantedModule } from "hooks/useModuleAccess";

type ParentLinkRecord = {
  _id: string;
  parentUserId?: {
    _id: string;
    fullName: string;
    email: string;
    phone?: string;
    createdAt?: string;
  };
  studentId?: {
    _id: string;
    admissionNumber?: string;
    user: { fullName: string };
  };
  relationship: string;
  status?: string;
  studentRegistrationNumber?: string;
  createdAt?: string;
};

type ParentUserRecord = {
  _id: string;
  fullName: string;
  email: string;
  phone?: string;
  isActive?: boolean;
  createdAt?: string;
};

type PendingRegistrationRecord = ParentLinkRecord;

const relationshipLabels: Record<ParentFromStudentRelationship, string> = {
  FATHER: "Father",
  MOTHER: "Mother",
  GUARDIAN: "Guardian",
};

export const ParentLinkManager = () => {
  const canManage = useCanManageGrantedModule("parents");
  const canEditDelete = useCanEditOrDeleteRecords();
  const [selectedStudentId, setSelectedStudentId] = useState("");
  const [customLoginByRelationship, setCustomLoginByRelationship] = useState<
    Record<ParentFromStudentRelationship, string>
  >({
    FATHER: "",
    MOTHER: "",
    GUARDIAN: "",
  });
  const [passwordByRelationship, setPasswordByRelationship] = useState<
    Record<ParentFromStudentRelationship, string>
  >({
    FATHER: "",
    MOTHER: "",
    GUARDIAN: "",
  });
  const [confirmPasswordByRelationship, setConfirmPasswordByRelationship] =
    useState<Record<ParentFromStudentRelationship, string>>({
      FATHER: "",
      MOTHER: "",
      GUARDIAN: "",
    });
  const [manualForm, setManualForm] = useState<ParentChildLinkInput>({
    parentUserId: "",
    studentId: "",
    relationship: "GUARDIAN",
    isPrimary: true,
  });

  const parentsQuery = useQuery({
    queryKey: ["parent-users"],
    queryFn: () => unwrap<ParentUserRecord[]>(api.get("/parent/users")),
  });

  const [editingParentId, setEditingParentId] = useState<string | null>(null);
  const [editForm, setEditForm] = useState({
    fullName: "",
    email: "",
    phone: "",
    password: "",
    confirmPassword: "",
    isActive: true,
  });
  const studentsQuery = useQuery({
    queryKey: ["students"],
    queryFn: () =>
      unwrap<
        Array<{
          _id: string;
          user: { fullName: string };
          admissionNumber: string;
        }>
      >(api.get("/students")),
  });
  const candidatesQuery = useQuery({
    queryKey: ["parent-candidates", selectedStudentId],
    queryFn: () =>
      unwrap<StudentParentCandidatesResponse>(
        api.get(`/parent/students/${selectedStudentId}/candidates`),
      ),
    enabled: Boolean(selectedStudentId),
  });
  const linksQuery = useQuery({
    queryKey: ["parent-links"],
    queryFn: () => unwrap<ParentLinkRecord[]>(api.get("/parent/links")),
  });
  const [accessParentId, setAccessParentId] = useState("");
  const [portalDraft, setPortalDraft] = useState<ParentPortalAccessMap | null>(
    null,
  );
  const [useSchoolDefaults, setUseSchoolDefaults] = useState(true);

  /** School-wide defaults (fallback when a parent has no personal override). */
  const schoolDefaultsQuery = useQuery({
    queryKey: ["parent-portal-access", "school-defaults"],
    queryFn: () =>
      unwrap<ParentPortalAccessResponse>(api.get("/parent/portal-access")),
    enabled: canManage,
  });

  /** Per-parent access for the selected parent. */
  const parentAccessQuery = useQuery({
    queryKey: ["parent-portal-access", "user", accessParentId],
    queryFn: () =>
      unwrap<ParentPortalAccessResponse>(
        api.get(`/parent/users/${accessParentId}/portal-access`),
      ),
    enabled: canManage && Boolean(accessParentId),
  });

  useEffect(() => {
    if (!accessParentId) {
      setPortalDraft(null);
      setUseSchoolDefaults(true);
      return;
    }
    if (parentAccessQuery.data) {
      setPortalDraft(
        normalizeParentPortalAccess(parentAccessQuery.data.modules),
      );
      setUseSchoolDefaults(parentAccessQuery.data.useSchoolDefaults !== false);
    }
  }, [accessParentId, parentAccessQuery.data]);

  const saveSchoolDefaults = useMutation({
    mutationFn: (modules: ParentPortalAccessMap) =>
      unwrap<ParentPortalAccessResponse>(
        api.put("/parent/portal-access", { modules }),
      ),
    onSuccess: async () => {
      toast.success("School default parent access updated");
      await queryClient.invalidateQueries({
        queryKey: ["parent-portal-access"],
      });
    },
    onError: (error) => toast.error(parseErrorMessage(error)),
  });

  const saveParentAccess = useMutation({
    mutationFn: (payload: {
      parentUserId: string;
      modules?: ParentPortalAccessMap;
      useSchoolDefaults?: boolean;
    }) =>
      unwrap<ParentPortalAccessResponse>(
        api.put(`/parent/users/${payload.parentUserId}/portal-access`, {
          modules: payload.modules,
          useSchoolDefaults: payload.useSchoolDefaults,
        }),
      ),
    onSuccess: async (data) => {
      toast.success(
        data.useSchoolDefaults
          ? "Parent uses school defaults"
          : "Parent portal access saved",
      );
      setPortalDraft(normalizeParentPortalAccess(data.modules));
      setUseSchoolDefaults(data.useSchoolDefaults !== false);
      await queryClient.invalidateQueries({
        queryKey: ["parent-portal-access"],
      });
      await queryClient.invalidateQueries({ queryKey: ["parent-portal"] });
    },
    onError: (error) => toast.error(parseErrorMessage(error)),
  });

  const pendingQuery = useQuery({
    queryKey: ["parent-registrations-pending"],
    queryFn: () =>
      unwrap<PendingRegistrationRecord[]>(
        api.get("/parent/registrations/pending"),
      ),
  });

  const invalidateParentData = async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ["parent-links"] }),
      queryClient.invalidateQueries({ queryKey: ["parent-users"] }),
      queryClient.invalidateQueries({ queryKey: ["parent-candidates"] }),
      queryClient.invalidateQueries({
        queryKey: ["parent-registrations-pending"],
      }),
    ]);
  };

  const approveRegistration = useMutation({
    mutationFn: (id: string) =>
      unwrap(api.post(`/parent/registrations/${id}/approve`)),
    onSuccess: async () => {
      toast.success("Parent registration approved");
      await invalidateParentData();
    },
    onError: (error) => toast.error(parseErrorMessage(error)),
  });

  const rejectRegistration = useMutation({
    mutationFn: ({ id, reason }: { id: string; reason?: string }) =>
      unwrap(
        api.post(`/parent/registrations/${id}/reject`, {
          rejectionReason: reason,
        }),
      ),
    onSuccess: async () => {
      toast.success("Parent registration rejected");
      await invalidateParentData();
    },
    onError: (error) => toast.error(parseErrorMessage(error)),
  });

  const createFromStudent = useMutation({
    mutationFn: (payload: CreateParentFromStudentInput) =>
      unwrap<{
        loginEmail: string;
        defaultPassword?: string;
        createdUser: boolean;
        credentialsEmail?: import("lib/credentialsEmail").CredentialsEmailResult;
      }>(api.post("/parent/profiles/from-student", payload)),
    onSuccess: async (data) => {
      if (data.createdUser) {
        const { toastCredentialCreateResult } =
          await import("lib/credentialsEmail");
        toastCredentialCreateResult(data, {
          successTitle: "Parent portal account created and linked",
        });
      } else {
        toast.success("Parent linked to student portal", {
          description: `Linked to existing account: ${data.loginEmail}`,
        });
      }
      await invalidateParentData();
    },
    onError: (error) => toast.error(parseErrorMessage(error)),
  });

  const createLink = useMutation({
    mutationFn: (payload: ParentChildLinkInput) =>
      unwrap(api.post("/parent/links", payload)),
    onSuccess: async () => {
      toast.success("Parent linked to student");
      await invalidateParentData();
    },
    onError: (error) => toast.error(parseErrorMessage(error)),
  });

  const deleteLink = useMutation({
    mutationFn: (id: string) => unwrap(api.delete(`/parent/links/${id}`)),
    onSuccess: async () => {
      toast.success("Parent link removed");
      await invalidateParentData();
    },
    onError: (error) => toast.error(parseErrorMessage(error)),
  });

  const updateParent = useMutation({
    mutationFn: ({
      id,
      payload,
    }: {
      id: string;
      payload: {
        fullName: string;
        email: string;
        phone?: string;
        password?: string;
        isActive: boolean;
      };
    }) => unwrap<ParentUserRecord>(api.put(`/parent/users/${id}`, payload)),
    onSuccess: async () => {
      toast.success("Parent account updated");
      setEditingParentId(null);
      await invalidateParentData();
    },
    onError: (error) => toast.error(parseErrorMessage(error)),
  });

  const deleteParent = useMutation({
    mutationFn: (id: string) => unwrap(api.delete(`/parent/users/${id}`)),
    onSuccess: async (_data, id) => {
      toast.success("Parent account deleted");
      if (editingParentId === id) setEditingParentId(null);
      if (accessParentId === id) setAccessParentId("");
      await invalidateParentData();
    },
    onError: (error) => toast.error(parseErrorMessage(error)),
  });

  const startEditParent = (parent: ParentUserRecord) => {
    setEditingParentId(parent._id);
    setEditForm({
      fullName: parent.fullName ?? "",
      email: parent.email ?? "",
      phone: parent.phone ?? "",
      password: "",
      confirmPassword: "",
      isActive: parent.isActive !== false,
    });
  };

  const submitEditParent = () => {
    if (!editingParentId) return;
    if (!editForm.fullName.trim()) {
      toast.error("Full name is required");
      return;
    }
    if (!editForm.email.trim()) {
      toast.error("Login ID is required");
      return;
    }
    if (editForm.password.trim()) {
      const passwordError = validatePortalPassword(
        editForm.password,
        editForm.confirmPassword,
      );
      if (passwordError) {
        toast.error(passwordError);
        return;
      }
    }
    updateParent.mutate({
      id: editingParentId,
      payload: {
        fullName: editForm.fullName.trim(),
        email: editForm.email.trim(),
        phone: editForm.phone.trim() || undefined,
        password: editForm.password.trim() || undefined,
        isActive: editForm.isActive,
      },
    });
  };

  const selectedStudent = useMemo(
    () =>
      (studentsQuery.data ?? []).find(
        (student) => student._id === selectedStudentId,
      ),
    [studentsQuery.data, selectedStudentId],
  );

  const handleCreateFromStudent = (
    relationship: ParentFromStudentRelationship,
  ) => {
    if (!selectedStudentId) {
      toast.error("Select a student first");
      return;
    }

    const password = passwordByRelationship[relationship];
    const confirmPassword = confirmPasswordByRelationship[relationship];
    const passwordError = validatePortalPassword(password, confirmPassword);
    if (passwordError) {
      toast.error(passwordError);
      return;
    }

    const candidate = candidatesQuery.data?.candidates.find(
      (item) => item.relationship === relationship,
    );
    const payload = {
      studentId: selectedStudentId,
      relationship,
      email:
        customLoginByRelationship[relationship].trim() ||
        candidate?.suggestedLoginId ||
        undefined,
      password: password.trim() || undefined,
      isPrimary: relationship === "GUARDIAN",
    };

    const parsed = createParentFromStudentSchema.safeParse(payload);
    if (!parsed.success) {
      toast.error("Invalid parent profile details");
      return;
    }

    createFromStudent.mutate(parsed.data);
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title="Parent Management"
        description="Manage parent accounts, student-related module access, student links, and registrations (College Admin & Super Admin)."
      />

      {canManage ? (
        <Card>
          <CardHeader>
            <CardTitle>Parent accounts</CardTitle>
            <p className="mt-1 text-sm text-slate-500">
              Edit or delete parent login accounts. Use{" "}
              <strong>Modules</strong> for student-account access only
              (attendance, fees, homework, examination, etc.).
            </p>
          </CardHeader>
          <CardContent className="space-y-4">
            {(parentsQuery.data ?? []).length === 0 ? (
              <p className="text-sm text-slate-500">
                No parent accounts yet. Create one from student details or
                approve a self-registration.
              </p>
            ) : (
              <div className="overflow-x-auto">
                <Table>
                  <TableHead>
                    <tr>
                      <Th>Name</Th>
                      <Th>Login ID</Th>
                      <Th>Phone</Th>
                      <Th>Status</Th>
                      <Th className="text-right">Actions</Th>
                    </tr>
                  </TableHead>
                  <TableBody>
                    {(parentsQuery.data ?? []).map((parent) => {
                      const active = parent.isActive !== false;
                      return (
                        <tr key={parent._id}>
                          <Td className="font-medium text-slate-900">
                            {parent.fullName}
                          </Td>
                          <Td className="font-mono text-sm">{parent.email}</Td>
                          <Td>{parent.phone || "—"}</Td>
                          <Td>
                            <Badge
                              className={
                                active
                                  ? "bg-emerald-100 text-emerald-800"
                                  : "bg-rose-100 text-rose-800"
                              }
                            >
                              {active ? "Active" : "Disabled"}
                            </Badge>
                          </Td>
                          <Td>
                            <div className="flex flex-wrap justify-end gap-1.5">
                              <Button
                                type="button"
                                size="sm"
                                variant="outline"
                                onClick={() => {
                                  setAccessParentId(parent._id);
                                  document
                                    .getElementById("parent-module-access")
                                    ?.scrollIntoView({ behavior: "smooth" });
                                }}
                              >
                                Modules
                              </Button>
                              {canEditDelete ? (
                              <>
                              <Button
                                type="button"
                                size="sm"
                                variant="outline"
                                onClick={() => startEditParent(parent)}
                              >
                                Edit
                              </Button>
                              <Button
                                type="button"
                                size="sm"
                                variant="destructive"
                                disabled={deleteParent.isPending}
                                onClick={() => {
                                  if (
                                    !window.confirm(
                                      `Permanently delete parent account "${parent.fullName}" (${parent.email})?\n\nThis removes their login and all student links. This cannot be undone.`,
                                    )
                                  ) {
                                    return;
                                  }
                                  deleteParent.mutate(parent._id);
                                }}
                              >
                                Delete
                              </Button>
                              </>
                              ) : null}
                            </div>
                          </Td>
                        </tr>
                      );
                    })}
                  </TableBody>
                </Table>
              </div>
            )}

            {editingParentId ? (
              <div className="rounded-xl border border-slate-200 bg-slate-50 p-4 space-y-3">
                <p className="text-sm font-semibold text-slate-900">
                  Edit parent account
                </p>
                <div className="grid gap-3 md:grid-cols-2">
                  <FormField label="Full name">
                    <Input
                      value={editForm.fullName}
                      onChange={(e) =>
                        setEditForm((c) => ({ ...c, fullName: e.target.value }))
                      }
                    />
                  </FormField>
                  <FormField label="Login ID">
                    <Input
                      value={editForm.email}
                      onChange={(e) =>
                        setEditForm((c) => ({ ...c, email: e.target.value }))
                      }
                    />
                  </FormField>
                  <FormField label="Phone">
                    <Input
                      value={editForm.phone}
                      onChange={(e) =>
                        setEditForm((c) => ({ ...c, phone: e.target.value }))
                      }
                    />
                  </FormField>
                  <FormField label="Account status">
                    <Select
                      value={editForm.isActive ? "ACTIVE" : "DISABLED"}
                      onChange={(e) =>
                        setEditForm((c) => ({
                          ...c,
                          isActive: e.target.value === "ACTIVE",
                        }))
                      }
                    >
                      <option value="ACTIVE">Active (can log in)</option>
                      <option value="DISABLED">Disabled (cannot log in)</option>
                    </Select>
                  </FormField>
                </div>
                <PortalLoginFields
                  email={editForm.email}
                  password={editForm.password}
                  confirmPassword={editForm.confirmPassword}
                  onPasswordChange={(value) =>
                    setEditForm((c) => ({ ...c, password: value }))
                  }
                  onConfirmPasswordChange={(value) =>
                    setEditForm((c) => ({ ...c, confirmPassword: value }))
                  }
                  showReset={false}
                />
                <div className="flex flex-wrap gap-2">
                  <Button
                    type="button"
                    size="sm"
                    disabled={updateParent.isPending}
                    onClick={submitEditParent}
                  >
                    {updateParent.isPending ? "Saving…" : "Save changes"}
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    onClick={() => setEditingParentId(null)}
                  >
                    Cancel
                  </Button>
                </div>
              </div>
            ) : null}
          </CardContent>
        </Card>
      ) : null}

      {canManage ? (
        <Card id="parent-module-access">
          <CardHeader>
            <CardTitle>Parent module access (student accounts only)</CardTitle>
            <p className="mt-1 text-sm text-slate-500">
              Parents only get access to their linked children&apos;s student
              account data — attendance, fees, homework, examination, timetable,
              library, and related alerts. Staff ERP modules are never included.
              Super Admin and College Admin can set school defaults or custom
              access per parent.
            </p>
          </CardHeader>
          <CardContent className="space-y-5">
            <FormField label="Select parent">
              <Select
                value={accessParentId}
                onChange={(e) => setAccessParentId(e.target.value)}
              >
                <option value="">Choose a parent account…</option>
                {(parentsQuery.data ?? []).map((parent) => (
                  <option key={parent._id} value={parent._id}>
                    {parent.fullName} ({parent.email})
                  </option>
                ))}
              </Select>
            </FormField>

            {!accessParentId ? (
              <p className="text-sm text-slate-500">
                Select a parent above to view and edit their portal modules.
              </p>
            ) : parentAccessQuery.isLoading || !portalDraft ? (
              <p className="text-sm text-slate-500">
                Loading access for this parent…
              </p>
            ) : (
              <>
                <div className="flex flex-wrap items-center gap-3 rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm">
                  <div className="min-w-0 flex-1">
                    <p className="font-medium text-slate-900">
                      {parentAccessQuery.data?.parentName ?? "Parent"}
                    </p>
                    <p className="text-xs text-slate-500">
                      {parentAccessQuery.data?.parentEmail}
                      {useSchoolDefaults
                        ? " · Using school defaults"
                        : " · Custom access"}
                    </p>
                  </div>
                  <label className="flex items-center gap-2 text-sm text-slate-700">
                    <input
                      type="checkbox"
                      checked={useSchoolDefaults}
                      onChange={(e) => {
                        const next = e.target.checked;
                        setUseSchoolDefaults(next);
                        if (next && parentAccessQuery.data?.schoolDefaults) {
                          setPortalDraft(
                            normalizeParentPortalAccess(
                              parentAccessQuery.data.schoolDefaults,
                            ),
                          );
                        }
                      }}
                    />
                    Use school defaults
                  </label>
                </div>

                <div
                  className={
                    useSchoolDefaults
                      ? "pointer-events-none grid gap-3 opacity-60 sm:grid-cols-2 xl:grid-cols-3"
                      : "grid gap-3 sm:grid-cols-2 xl:grid-cols-3"
                  }
                >
                  {(parentAccessQuery.data?.meta ?? []).map((item) => (
                    <label
                      key={item.key}
                      className="flex cursor-pointer items-start gap-3 rounded-xl border border-slate-200 bg-white px-3 py-3 text-sm hover:bg-slate-50"
                    >
                      <input
                        type="checkbox"
                        className="mt-1"
                        disabled={useSchoolDefaults}
                        checked={portalDraft[item.key] !== false}
                        onChange={(e) =>
                          setPortalDraft((current) =>
                            current
                              ? { ...current, [item.key]: e.target.checked }
                              : current,
                          )
                        }
                      />
                      <span>
                        <span className="font-medium text-slate-900">
                          {item.label}
                        </span>
                        <span className="mt-0.5 block text-xs text-slate-500">
                          {item.description}
                        </span>
                      </span>
                    </label>
                  ))}
                </div>

                <div className="flex flex-wrap gap-2">
                  {!useSchoolDefaults ? (
                    <>
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        onClick={() => {
                          const allOn = { ...portalDraft };
                          for (const key of Object.keys(allOn) as Array<
                            keyof ParentPortalAccessMap
                          >) {
                            allOn[key] = true;
                          }
                          setPortalDraft(allOn);
                        }}
                      >
                        Enable all
                      </Button>
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        onClick={() => {
                          const allOff = { ...portalDraft };
                          for (const key of Object.keys(allOff) as Array<
                            keyof ParentPortalAccessMap
                          >) {
                            allOff[key] = key === "overview";
                          }
                          setPortalDraft(allOff);
                        }}
                      >
                        Minimal
                      </Button>
                    </>
                  ) : null}
                  <Button
                    type="button"
                    size="sm"
                    disabled={saveParentAccess.isPending}
                    onClick={() => {
                      if (useSchoolDefaults) {
                        saveParentAccess.mutate({
                          parentUserId: accessParentId,
                          useSchoolDefaults: true,
                        });
                        return;
                      }
                      if (!portalDraft) return;
                      saveParentAccess.mutate({
                        parentUserId: accessParentId,
                        modules: portalDraft,
                        useSchoolDefaults: false,
                      });
                    }}
                  >
                    {saveParentAccess.isPending
                      ? "Saving…"
                      : useSchoolDefaults
                        ? "Save (use school defaults)"
                        : "Save this parent's access"}
                  </Button>
                </div>
              </>
            )}

            {/* School defaults editor */}
            <details className="rounded-xl border border-slate-200 bg-slate-50/50">
              <summary className="cursor-pointer px-4 py-3 text-sm font-medium text-slate-800">
                School defaults (for parents without custom access)
              </summary>
              <div className="space-y-3 border-t border-slate-200 px-4 py-3">
                <p className="text-xs text-slate-500">
                  These apply to every parent who is set to “Use school
                  defaults”. Edit and save defaults separately from individual
                  parents.
                </p>
                {schoolDefaultsQuery.isLoading || !schoolDefaultsQuery.data ? (
                  <p className="text-sm text-slate-500">Loading defaults…</p>
                ) : (
                  <>
                    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
                      {schoolDefaultsQuery.data.meta.map((item) => (
                        <label
                          key={`default-${item.key}`}
                          className="flex cursor-pointer items-start gap-3 rounded-xl border border-slate-200 bg-white px-3 py-3 text-sm"
                        >
                          <input
                            type="checkbox"
                            className="mt-1"
                            checked={
                              schoolDefaultsQuery.data!.modules[item.key] !==
                              false
                            }
                            onChange={(e) => {
                              const next = normalizeParentPortalAccess({
                                ...schoolDefaultsQuery.data!.modules,
                                [item.key]: e.target.checked,
                              });
                              // Optimistic local update via query cache
                              queryClient.setQueryData(
                                ["parent-portal-access", "school-defaults"],
                                {
                                  ...schoolDefaultsQuery.data!,
                                  modules: next,
                                  meta: schoolDefaultsQuery.data!.meta.map(
                                    (m) =>
                                      m.key === item.key
                                        ? { ...m, enabled: e.target.checked }
                                        : m,
                                  ),
                                },
                              );
                            }}
                          />
                          <span>
                            <span className="font-medium text-slate-900">
                              {item.label}
                            </span>
                          </span>
                        </label>
                      ))}
                    </div>
                    <Button
                      type="button"
                      size="sm"
                      disabled={saveSchoolDefaults.isPending}
                      onClick={() => {
                        if (!schoolDefaultsQuery.data?.modules) return;
                        saveSchoolDefaults.mutate(
                          normalizeParentPortalAccess(
                            schoolDefaultsQuery.data.modules,
                          ),
                        );
                      }}
                    >
                      {saveSchoolDefaults.isPending
                        ? "Saving…"
                        : "Save school defaults"}
                    </Button>
                  </>
                )}
              </div>
            </details>
          </CardContent>
        </Card>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle>Pending parent self-registrations</CardTitle>
          <p className="text-sm text-slate-500">
            Parents who registered from the login page using a student
            registration number. Approve to activate their portal account and
            link them to the student.
          </p>
        </CardHeader>
        <CardContent>
          {pendingQuery.isLoading ? (
            <p className="text-sm text-slate-500">
              Loading pending registrations…
            </p>
          ) : (pendingQuery.data ?? []).length === 0 ? (
            <p className="text-sm text-slate-500">
              No pending parent registrations.
            </p>
          ) : (
            <Table>
              <TableHead>
                <tr>
                  <Th>Parent</Th>
                  <Th>Student</Th>
                  <Th>Reg. No.</Th>
                  <Th>Relationship</Th>
                  <Th>Submitted</Th>
                  <Th>Actions</Th>
                </tr>
              </TableHead>
              <TableBody>
                {(pendingQuery.data ?? []).map((row) => (
                  <tr key={row._id}>
                    <Td>
                      <div>
                        <p className="font-medium">
                          {row.parentUserId?.fullName ?? "—"}
                        </p>
                        <p className="text-xs text-slate-500">
                          {row.parentUserId?.email}
                        </p>
                        {row.parentUserId?.phone ? (
                          <p className="text-xs text-slate-500">
                            {row.parentUserId.phone}
                          </p>
                        ) : null}
                      </div>
                    </Td>
                    <Td>
                      {row.studentId?._id && row.studentId.user?.fullName ? (
                        <StudentNameLink
                          studentId={row.studentId._id}
                          name={row.studentId.user.fullName}
                        />
                      ) : (
                        "—"
                      )}
                    </Td>
                    <Td className="font-mono text-xs">
                      {row.studentRegistrationNumber ??
                        row.studentId?.admissionNumber ??
                        "—"}
                    </Td>
                    <Td>{row.relationship}</Td>
                    <Td>
                      {row.createdAt
                        ? new Date(row.createdAt).toLocaleString()
                        : "—"}
                    </Td>
                    <Td>
                      {canManage ? (
                        <div className="flex flex-wrap gap-2">
                          <Button
                            size="sm"
                            className="bg-brand-600 hover:bg-brand-700"
                            disabled={approveRegistration.isPending}
                            onClick={() => approveRegistration.mutate(row._id)}
                          >
                            Approve
                          </Button>
                          <Button
                            size="sm"
                            variant="outline"
                            disabled={rejectRegistration.isPending}
                            onClick={() => {
                              const reason = window.prompt(
                                "Rejection reason (optional):",
                              );
                              rejectRegistration.mutate({
                                id: row._id,
                                reason: reason ?? undefined,
                              });
                            }}
                          >
                            Reject
                          </Button>
                        </div>
                      ) : (
                        "—"
                      )}
                    </Td>
                  </tr>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {canManage ? (
        <Card>
          <CardHeader>
            <CardTitle>Create parent from student details</CardTitle>
            <p className="text-sm text-slate-500">
              Select a student to use father, mother, or guardian information
              from their admission record. A portal account is created
              automatically and linked to the student.
            </p>
          </CardHeader>
          <CardContent className="space-y-4">
            <FormField label="Student">
              <Select
                value={selectedStudentId}
                onChange={(event) => {
                  setSelectedStudentId(event.target.value);
                  setCustomLoginByRelationship({
                    FATHER: "",
                    MOTHER: "",
                    GUARDIAN: "",
                  });
                  setPasswordByRelationship({
                    FATHER: "",
                    MOTHER: "",
                    GUARDIAN: "",
                  });
                  setConfirmPasswordByRelationship({
                    FATHER: "",
                    MOTHER: "",
                    GUARDIAN: "",
                  });
                }}
              >
                <option value="">Select student</option>
                {(studentsQuery.data ?? []).map((student) => (
                  <option key={student._id} value={student._id}>
                    {student.user.fullName} ({student.admissionNumber})
                  </option>
                ))}
              </Select>
            </FormField>

            {!selectedStudentId ? (
              <p className="text-sm text-slate-500">
                Choose a student to preview parent profiles available from their
                record.
              </p>
            ) : candidatesQuery.isLoading ? (
              <p className="text-sm text-slate-500">Loading parent details…</p>
            ) : (
              <div className="grid gap-4">
                {(candidatesQuery.data?.candidates ?? []).map((candidate) => (
                  <div
                    key={candidate.relationship}
                    className="rounded-2xl border border-slate-200 p-4"
                  >
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div>
                        <div className="flex items-center gap-2">
                          <p className="font-semibold text-slate-900">
                            {relationshipLabels[candidate.relationship]}
                          </p>
                          {candidate.isLinked ? (
                            <Badge>Linked</Badge>
                          ) : (
                            <Badge className="bg-slate-100 text-slate-600">
                              Not linked
                            </Badge>
                          )}
                        </div>
                        <p className="mt-1 text-sm text-slate-600">
                          {candidate.fullName}
                        </p>
                        <p className="text-sm text-slate-500">
                          {candidate.phone || "No phone on student record"}
                        </p>
                        <p className="mt-2 text-xs text-slate-500">
                          Suggested login ID:{" "}
                          <span className="font-mono">
                            {candidate.suggestedLoginId}
                          </span>
                        </p>
                        {candidate.existingParentEmail ? (
                          <p className="text-xs text-slate-500">
                            Existing parent account:{" "}
                            {candidate.existingParentEmail}
                          </p>
                        ) : null}
                      </div>
                      <Button
                        disabled={
                          candidate.isLinked || createFromStudent.isPending
                        }
                        onClick={() =>
                          handleCreateFromStudent(candidate.relationship)
                        }
                      >
                        {candidate.isLinked
                          ? "Already linked"
                          : "Create & link parent"}
                      </Button>
                    </div>

                    {!candidate.isLinked ? (
                      <div className="mt-4 space-y-3">
                        <FormField label="Custom login ID (optional)">
                          <Input
                            value={
                              customLoginByRelationship[candidate.relationship]
                            }
                            placeholder={candidate.suggestedLoginId}
                            onChange={(event) =>
                              setCustomLoginByRelationship((current) => ({
                                ...current,
                                [candidate.relationship]: event.target.value,
                              }))
                            }
                          />
                        </FormField>
                        <PortalLoginFields
                          email={
                            customLoginByRelationship[candidate.relationship] ||
                            candidate.suggestedLoginId
                          }
                          password={
                            passwordByRelationship[candidate.relationship]
                          }
                          confirmPassword={
                            confirmPasswordByRelationship[
                              candidate.relationship
                            ]
                          }
                          onPasswordChange={(value) =>
                            setPasswordByRelationship((current) => ({
                              ...current,
                              [candidate.relationship]: value,
                            }))
                          }
                          onConfirmPasswordChange={(value) =>
                            setConfirmPasswordByRelationship((current) => ({
                              ...current,
                              [candidate.relationship]: value,
                            }))
                          }
                        />
                      </div>
                    ) : null}
                  </div>
                ))}
              </div>
            )}

            {selectedStudent ? (
              <p className="text-xs text-slate-500">
                Parent portal for {selectedStudent.user.fullName} will show
                attendance, fees, homework, and notices after linking.
              </p>
            ) : null}
          </CardContent>
        </Card>
      ) : null}

      {canManage ? (
        <Card>
          <CardHeader>
            <CardTitle>Manual link (existing parent account)</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-4 md:grid-cols-2">
            <FormField label="Parent">
              <Select
                value={manualForm.parentUserId}
                onChange={(event) =>
                  setManualForm((current) => ({
                    ...current,
                    parentUserId: event.target.value,
                  }))
                }
              >
                <option value="">Select parent</option>
                {(parentsQuery.data ?? []).map((parent) => (
                  <option key={parent._id} value={parent._id}>
                    {parent.fullName} ({parent.email})
                  </option>
                ))}
              </Select>
            </FormField>
            <FormField label="Student">
              <Select
                value={manualForm.studentId}
                onChange={(event) =>
                  setManualForm((current) => ({
                    ...current,
                    studentId: event.target.value,
                  }))
                }
              >
                <option value="">Select student</option>
                {(studentsQuery.data ?? []).map((student) => (
                  <option key={student._id} value={student._id}>
                    {student.user.fullName}
                  </option>
                ))}
              </Select>
            </FormField>
            <FormField label="Relationship">
              <Select
                value={manualForm.relationship}
                onChange={(event) =>
                  setManualForm((current) => ({
                    ...current,
                    relationship: event.target
                      .value as ParentChildLinkInput["relationship"],
                  }))
                }
              >
                {PARENT_RELATIONSHIPS.map((relationship) => (
                  <option key={relationship} value={relationship}>
                    {relationship}
                  </option>
                ))}
              </Select>
            </FormField>
            <div className="flex items-end">
              <Button
                onClick={() => {
                  const parsed = parentChildLinkSchema.safeParse(manualForm);
                  if (!parsed.success) {
                    toast.error("Invalid link");
                    return;
                  }
                  createLink.mutate(parsed.data);
                }}
              >
                Create link
              </Button>
            </div>
          </CardContent>
        </Card>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle>Existing links</CardTitle>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHead>
              <tr>
                <Th>Parent</Th>
                <Th>Student</Th>
                <Th>Relationship</Th>
                <Th>Status</Th>
                <Th>Actions</Th>
              </tr>
            </TableHead>
            <TableBody>
              {(linksQuery.data ?? []).length === 0 ? (
                <tr>
                  <Td colSpan={5}>No parent links yet.</Td>
                </tr>
              ) : (
                (linksQuery.data ?? []).map((link) => (
                  <tr key={link._id}>
                    <Td>
                      {link.parentUserId?.fullName ? (
                        <div>
                          <p className="font-medium">
                            {link.parentUserId.fullName}
                          </p>
                          <p className="text-xs text-slate-500">
                            {link.parentUserId.email}
                          </p>
                        </div>
                      ) : (
                        "—"
                      )}
                    </Td>
                    <Td>
                      {link.studentId?._id && link.studentId.user?.fullName ? (
                        <StudentNameLink
                          studentId={link.studentId._id}
                          name={link.studentId.user.fullName}
                        />
                      ) : (
                        "—"
                      )}
                    </Td>
                    <Td>{link.relationship}</Td>
                    <Td>
                      {link.status === "PENDING" ? (
                        <Badge className="bg-amber-100 text-amber-800">
                          Pending
                        </Badge>
                      ) : link.status === "REJECTED" ? (
                        <Badge className="bg-red-100 text-red-700">
                          Rejected
                        </Badge>
                      ) : (
                        <Badge className="bg-brand-100 text-brand-800">
                          Approved
                        </Badge>
                      )}
                    </Td>
                    <Td>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => deleteLink.mutate(link._id)}
                      >
                        Remove
                      </Button>
                    </Td>
                  </tr>
                ))
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
};
