import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ERP_MODULES,
  EXTRA_ADMIN_MODULE_KEYS,
  LEADERSHIP_DESIGNATIONS,
  MODULE_ACCESS_TEACHER_EXTRA_GROUPS,
  MODULE_ACCESS_UI_GROUPS,
  TEACHER_BASELINE_MODULE_KEYS,
  buildPresetModuleAccess,
  buildTeacherBaselineModuleAccess,
  type ErpModuleKey,
  type ModuleAccessMode,
  type ModulePermissionAction,
  type UserRole,
} from "@phit-erp/shared";
import {
  BookOpen,
  Briefcase,
  Check,
  Eye,
  EyeOff,
  Lock,
  Save,
  Shield,
  Sparkles,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { Button } from "components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "components/ui/card";
import { Input } from "components/ui/input";
import { Select } from "components/ui/select";
import { LoadingState } from "components/shared/LoadingState";
import { api, unwrap } from "lib/api";
import { cn, parseErrorMessage } from "lib/utils";

interface ModuleAccessResponse {
  userId: string;
  fullName?: string;
  email?: string;
  employeeId?: string;
  role?: string;
  designation?: string;
  secondaryRoles?: UserRole[];
  /** False until an admin saves a custom map for this user */
  configured?: boolean;
  moduleAccess: Record<ErpModuleKey, ModuleAccessMode>;
  moduleActions: Record<ErpModuleKey, ModulePermissionAction[]>;
  modules: Array<{
    key: ErpModuleKey;
    label: string;
    description: string;
    mode: ModuleAccessMode;
    actions: ModulePermissionAction[];
    availableActions: ModulePermissionAction[];
  }>;
  groups?: Array<{
    id: string;
    title: string;
    description: string;
    keys: ErpModuleKey[];
  }>;
  leadershipDesignations?: string[];
}

interface ModuleAccessControlPanelProps {
  userId: string;
  userName?: string;
  compact?: boolean;
  readOnly?: boolean;
}

const MODE_OPTIONS: Array<{
  value: ModuleAccessMode;
  label: string;
  short: string;
  hint: string;
  icon: typeof EyeOff;
}> = [
  {
    value: "NONE",
    label: "Hidden",
    short: "Off",
    hint: "Not shown in their menu",
    icon: EyeOff,
  },
  {
    value: "READ_ONLY",
    label: "View only",
    short: "View",
    hint: "Can open and read, cannot change",
    icon: Eye,
  },
  {
    value: "WRITE",
    label: "Full access",
    short: "Manage",
    hint: "Can use and update this section",
    icon: Check,
  },
];

const SECONDARY_ROLE_OPTIONS: Array<{ value: UserRole; label: string; hint: string }> = [
  { value: "TEACHER", label: "Also teaches", hint: "Teacher portal tools" },
  { value: "LABORATORY_STAFF", label: "Lab in-charge", hint: "Laboratory console" },
  { value: "LIBRARY_STAFF", label: "Library staff", hint: "Library console" },
  { value: "ACCOUNTANT", label: "Accounting", hint: "Finance console role" },
  { value: "CASHIER", label: "Cashier", hint: "Cashier tools" },
  { value: "AUDITOR", label: "Auditor", hint: "Audit access" },
  { value: "PRINCIPAL", label: "Principal portal", hint: "Principal dashboard" },
];

const ROW_COPY: Partial<Record<ErpModuleKey, { label: string; hint: string }>> = {
  staff: {
    label: "Staff Management",
    hint: "College Staff page — office staff and the Teachers tab",
  },
  teachers: {
    label: "Teachers",
    hint: "Create and edit teachers (Staff Management → Teachers)",
  },
  parents: {
    label: "Parent Management",
    hint: "Link parents to students",
  },
  "academic-structure": {
    label: "Academic Structure",
    hint: "Batches, years, classes, and subjects",
  },
  "examinations-college": {
    label: "Examination Management — College",
    hint: "College exams, routines, marks, and results",
  },
  "examinations-ctevt": {
    label: "Examination Management — CTEVT",
    hint: "CTEVT registration and exam fees",
  },
  "teacher-attendance": {
    label: "Teacher Attendance",
    hint: "HR sheet for teaching staff (not classroom attendance)",
  },
  "staff-attendance": {
    label: "Staff Attendance",
    hint: "HR sheet for office staff",
  },
  "field-duty": {
    label: "Field Management",
    hint: "Field postings, hospital rosters, and field attendance",
  },
  accounts: {
    label: "Accounting",
    hint: "Journals, ledgers, and fee collection",
  },
  "finance-management": {
    label: "Finance Management",
    hint: "Institution finance archive (separate from Accounting)",
  },
  fees: { label: "Fee structures", hint: "Fee types and structures" },
  hr: { label: "HR & Payroll", hint: "Leave and salary" },
  library: { label: "Library Management", hint: "Full library console" },
  laboratory: { label: "Laboratory Management", hint: "Full laboratory console" },
  transport: { label: "Transport", hint: "Routes and vehicles" },
  banners: { label: "Banners", hint: "Dashboard banners" },
  reports: { label: "Reports", hint: "Exports and IEMIS reports" },
  settings: { label: "Settings", hint: "Institution settings" },
  complaints: { label: "Complaints", hint: "Complaint management" },
};

const LEADERSHIP_PRESET_KEYS: ErpModuleKey[] = [
  "teachers",
  "staff",
  "academic-structure",
  "examinations-college",
  "teacher-attendance",
  "staff-attendance",
  "reports",
];

const TEACHING_MY_WORK_PREVIEW = [
  "My Students",
  "My Attendance",
  "My Examinations",
  "Session / Lesson / Log Book",
  "Assignments",
  "My Timetable",
  "Notices",
];

const moduleLabel = (key: ErpModuleKey): string =>
  ROW_COPY[key]?.label ?? ERP_MODULES.find((m) => m.key === key)?.label ?? key;

const moduleDescription = (key: ErpModuleKey): string =>
  ROW_COPY[key]?.hint ?? ERP_MODULES.find((m) => m.key === key)?.description ?? "";

export const ModuleAccessControlPanel = ({
  userId,
  userName,
  compact = false,
  readOnly = false,
}: ModuleAccessControlPanelProps) => {
  const queryClient = useQueryClient();
  const [draftAccess, setDraftAccess] = useState<
    Record<string, ModuleAccessMode>
  >({});
  const [secondaryRoles, setSecondaryRoles] = useState<UserRole[]>([]);
  const [designation, setDesignation] = useState("");
  const [customDesignation, setCustomDesignation] = useState("");
  const [reason, setReason] = useState("");
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [dirty, setDirty] = useState(false);

  const accessQuery = useQuery({
    queryKey: ["users", userId, "module-access"],
    queryFn: () =>
      unwrap<ModuleAccessResponse>(api.get(`/users/${userId}/module-access`)),
    enabled: Boolean(userId),
  });

  useEffect(() => {
    if (!accessQuery.data) return;
    setDraftAccess({ ...accessQuery.data.moduleAccess });
    setSecondaryRoles([...(accessQuery.data.secondaryRoles ?? [])]);
    const des = accessQuery.data.designation ?? "";
    if (
      des &&
      !(LEADERSHIP_DESIGNATIONS as readonly string[]).includes(des)
    ) {
      setDesignation("Other");
      setCustomDesignation(des);
    } else {
      setDesignation(des);
      setCustomDesignation("");
    }
    setDirty(false);
  }, [accessQuery.data]);

  const primaryRole = (accessQuery.data?.role ?? "") as UserRole | "";
  const isPrimaryTeacher = primaryRole === "TEACHER";

  /** When enabling "Also teaches", turn on teaching modules in the draft. */
  const ensureTeacherModulesInDraft = () => {
    setDraftAccess((current) => {
      const next = { ...current };
      const baseline = buildTeacherBaselineModuleAccess();
      for (const key of TEACHER_BASELINE_MODULE_KEYS) {
        if (next[key] === "NONE" || !next[key]) {
          next[key] = baseline[key] ?? "WRITE";
        }
      }
      return next;
    });
  };

  /** When enabling Accounting / Cashier / Auditor / Principal secondary role. */
  const ensureFinanceModulesInDraft = (role: UserRole) => {
    setDraftAccess((current) => {
      const next = { ...current };
      if (next.accounts === "NONE" || !next.accounts) {
        next.accounts =
          role === "AUDITOR" || role === "PRINCIPAL" ? "READ_ONLY" : "WRITE";
      }
      if (next.dashboard === "NONE" || !next.dashboard) {
        next.dashboard = "WRITE";
      }
      if (next.profile === "NONE" || !next.profile) {
        next.profile = "WRITE";
      }
      return next;
    });
  };

  const saveMutation = useMutation({
    mutationFn: (payload: {
      moduleAccess: Record<string, ModuleAccessMode>;
      moduleActions: Record<string, ModulePermissionAction[]>;
      secondaryRoles: UserRole[];
      designation: string | null;
      reason?: string;
    }) => unwrap(api.put(`/users/${userId}/module-access`, payload)),
    onSuccess: async () => {
      toast.success(
        "Access saved. They will see the selected sections after they refresh or sign in again.",
      );
      setReason("");
      setDirty(false);
      await queryClient.invalidateQueries({
        queryKey: ["users", userId, "module-access"],
      });
      await queryClient.invalidateQueries({ queryKey: ["auth", "me"] });
      await queryClient.refetchQueries({ queryKey: ["auth", "me"] });
      await queryClient.invalidateQueries({ queryKey: ["teachers"] });
      await queryClient.invalidateQueries({ queryKey: ["college-staff"] });
    },
    onError: (error) => toast.error(parseErrorMessage(error)),
  });

  const configured = Boolean(accessQuery.data?.configured);
  const groups = isPrimaryTeacher
    ? MODULE_ACCESS_TEACHER_EXTRA_GROUPS
    : accessQuery.data?.groups?.length
      ? accessQuery.data.groups
      : MODULE_ACCESS_UI_GROUPS;

  const setMode = (key: string, mode: ModuleAccessMode) => {
    setDirty(true);
    setDraftAccess((current) => ({ ...current, [key]: mode }));
  };

  const setGroupMode = (keys: ErpModuleKey[], mode: ModuleAccessMode) => {
    setDirty(true);
    setDraftAccess((current) => {
      const next = { ...current };
      for (const key of keys) next[key] = mode;
      return next;
    });
  };

  const applyQuickStart = (preset: "NO_ACCESS" | "READ_ONLY" | "FULL_ACCESS") => {
    setDirty(true);
    if (preset === "NO_ACCESS" && (isPrimaryTeacher || secondaryRoles.includes("TEACHER"))) {
      setDraftAccess(buildTeacherBaselineModuleAccess());
      return;
    }
    setDraftAccess(buildPresetModuleAccess(preset));
  };

  const applyLeadershipPreset = () => {
    setDirty(true);
    setDraftAccess((current) => {
      const next = {
        ...buildTeacherBaselineModuleAccess(),
        ...current,
      };
      for (const key of EXTRA_ADMIN_MODULE_KEYS) {
        if (key === "hostel" || key === "user-management" || key === "inventory") {
          next[key] = "NONE";
          continue;
        }
        next[key] = LEADERSHIP_PRESET_KEYS.includes(key) ? "WRITE" : "NONE";
      }
      return next;
    });
  };

  const extraEnabled = useMemo(() => {
    return (EXTRA_ADMIN_MODULE_KEYS as readonly ErpModuleKey[]).filter((key) => {
      if (key === "hostel" || key === "user-management" || key === "inventory") {
        return false;
      }
      const mode = draftAccess[key] ?? "NONE";
      return mode === "WRITE" || mode === "READ_ONLY";
    });
  }, [draftAccess]);

  const enabledModules = useMemo(() => {
    const keys = isPrimaryTeacher
      ? extraEnabled
      : ERP_MODULES.filter((m) => {
          if (
            m.key === "dashboard" ||
            m.key === "profile" ||
            m.key === "hostel"
          ) {
            return false;
          }
          const mode = draftAccess[m.key] ?? "NONE";
          return mode === "WRITE" || mode === "READ_ONLY";
        }).map((m) => m.key as ErpModuleKey);
    return keys.map((key) => ({
      key,
      label: moduleLabel(key),
      mode: (draftAccess[key] ?? "NONE") as ModuleAccessMode,
    }));
  }, [draftAccess, extraEnabled, isPrimaryTeacher]);

  const counts = useMemo(() => {
    let manage = 0;
    let view = 0;
    let hidden = 0;
    for (const group of groups) {
      for (const key of group.keys) {
        const mode = draftAccess[key] ?? "NONE";
        if (mode === "WRITE") manage += 1;
        else if (mode === "READ_ONLY") view += 1;
        else hidden += 1;
      }
    }
    return { manage, view, hidden };
  }, [groups, draftAccess]);

  const handleSave = () => {
    const resolvedDesignation =
      designation === "Other"
        ? customDesignation.trim() || null
        : designation.trim() || null;

    // Always send a complete map so missing keys stay Hidden (NONE)
    const accessPayload: Record<string, ModuleAccessMode> = {};
    for (const mod of ERP_MODULES) {
      if (mod.key === "dashboard" || mod.key === "profile") {
        // Keep self-service always available
        const mode = draftAccess[mod.key];
        accessPayload[mod.key] =
          mode === "NONE" || !mode ? "READ_ONLY" : mode;
        continue;
      }
      accessPayload[mod.key] =
        (draftAccess[mod.key] as ModuleAccessMode | undefined) ?? "NONE";
    }

    saveMutation.mutate({
      moduleAccess: accessPayload,
      moduleActions: {},
      secondaryRoles,
      designation: resolvedDesignation,
      reason: reason.trim() || undefined,
    });
  };

  if (accessQuery.isLoading) return <LoadingState />;
  if (accessQuery.isError) {
    return (
      <Card>
        <CardContent className="pt-6 text-sm text-rose-700">
          Could not load module access for this user. Check your connection and try again.
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className={cn(compact && "border-slate-200 shadow-none")}>
      <CardHeader className="space-y-3 pb-3">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <CardTitle className="flex items-center gap-2 text-base">
              <Shield className="h-5 w-5 text-brand-600" />
              Module access
            </CardTitle>
            <p className="mt-1 max-w-2xl text-sm text-slate-600">
              {userName ? (
                <>
                  Three steps: set their <strong>job title</strong>, keep teaching
                  tools as they are, then turn on extra{" "}
                  <strong>Administration</strong> sections for{" "}
                  <strong>{userName}</strong>.
                </>
              ) : (
                <>
                  Set job title, then turn on only the Administration sections
                  they should see. Hidden sections do not appear in their menu.
                </>
              )}
            </p>
          </div>
          <div className="flex flex-wrap gap-2 text-xs">
            <span className="rounded-full bg-emerald-50 px-2.5 py-1 font-medium text-emerald-800">
              {counts.manage} manage
            </span>
            <span className="rounded-full bg-amber-50 px-2.5 py-1 font-medium text-amber-900">
              {counts.view} view
            </span>
            <span className="rounded-full bg-slate-100 px-2.5 py-1 font-medium text-slate-600">
              {counts.hidden} hidden
            </span>
          </div>
        </div>

        {!configured ? (
          <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-950">
            <p className="font-medium">Not saved yet</p>
            <p className="mt-1 text-amber-900/90">
              {isPrimaryTeacher
                ? "Teaching tools stay on. Use the Administration list below only for extra college duties (for example Vice Principal). Job title is a name tag — it does not open any menu by itself."
                : accessQuery.data?.role === "COLLEGE_ADMIN"
                  ? "This Administrator currently has full access. Save below to limit which sections they can open."
                  : "They currently see menus from their job role only. Save below to add or limit Administration sections."}
            </p>
          </div>
        ) : (
          <div className="rounded-xl border border-emerald-200 bg-emerald-50/70 px-4 py-3 text-sm text-emerald-950">
            <p className="font-medium">Saved access is active</p>
            <p className="mt-1 text-emerald-900/90">
              They must refresh or sign in again to see menu changes.
            </p>
          </div>
        )}
      </CardHeader>

      <CardContent className="space-y-6">
        <section className="rounded-2xl border border-slate-200 p-4">
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
            Step 1 · Who they are
          </p>
          <div className="mt-3 grid gap-3 sm:grid-cols-2">
            <div>
              <p className="mb-1 text-sm font-medium text-slate-700">
                Account role
              </p>
              <p className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-800">
                {primaryRole.replaceAll("_", " ") || "—"}
              </p>
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium text-slate-700">
                Job title (name tag only)
              </label>
              <Select
                value={designation}
                disabled={readOnly}
                onChange={(event) => {
                  setDirty(true);
                  setDesignation(event.target.value);
                }}
              >
                <option value="">— Not set —</option>
                {(
                  accessQuery.data?.leadershipDesignations ??
                  LEADERSHIP_DESIGNATIONS
                ).map((label) => (
                  <option key={label} value={label}>
                    {label}
                  </option>
                ))}
              </Select>
              {designation === "Other" ? (
                <Input
                  className="mt-2"
                  placeholder="Custom title"
                  value={customDesignation}
                  disabled={readOnly}
                  onChange={(event) => {
                    setDirty(true);
                    setCustomDesignation(event.target.value);
                  }}
                />
              ) : null}
            </div>
          </div>
          <p className="mt-2 text-xs text-amber-800">
            Vice Principal / Principal / Coordinator does <strong>not</strong>{" "}
            open Administration by itself. Turn on sections in step 3.
          </p>
        </section>

        {isPrimaryTeacher || secondaryRoles.includes("TEACHER") ? (
          <section className="rounded-2xl border border-sky-200 bg-sky-50/60 p-4">
            <p className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-sky-800">
              <BookOpen className="h-3.5 w-3.5" />
              Step 2 · Teaching (My Work) — always on
            </p>
            <p className="mt-2 text-sm text-sky-950">
              They keep their own teaching menu. You do not turn these off here.
            </p>
            <ul className="mt-2 flex flex-wrap gap-1.5">
              {TEACHING_MY_WORK_PREVIEW.map((label) => (
                <li
                  key={label}
                  className="rounded-full bg-white px-2.5 py-1 text-xs font-medium text-sky-900 ring-1 ring-sky-100"
                >
                  {label}
                </li>
              ))}
            </ul>
          </section>
        ) : null}

        <section className="space-y-3">
          <div>
            <p className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-slate-500">
              <Briefcase className="h-3.5 w-3.5" />
              {isPrimaryTeacher
                ? "Step 3 · Extra Administration"
                : "Administration sections"}
            </p>
            <p className="mt-1 text-sm text-slate-600">
              <strong>Off</strong> = hidden. <strong>View</strong> = read only.{" "}
              <strong>Manage</strong> = can change. Only View/Manage appear in
              their Administration menu.
            </p>
            {isPrimaryTeacher ? (
              <p className="mt-1 text-xs text-slate-500">
                If you turn on <strong>any</strong> section below, they also get
                separate Administration screens for Student Management, Academic
                Management (approvals), and Timetable Management — in addition to
                My Work.
              </p>
            ) : null}
          </div>

          {!readOnly ? (
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-xs font-medium uppercase tracking-wide text-slate-500">
                Quick start
              </span>
              {isPrimaryTeacher ? (
                <>
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    onClick={() => applyQuickStart("NO_ACCESS")}
                  >
                    <Lock className="mr-1.5 h-3.5 w-3.5" />
                    Teacher only
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    onClick={() => applyLeadershipPreset()}
                  >
                    <Shield className="mr-1.5 h-3.5 w-3.5" />
                    Typical VP / Principal
                  </Button>
                </>
              ) : (
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  onClick={() => applyQuickStart("NO_ACCESS")}
                >
                  <Lock className="mr-1.5 h-3.5 w-3.5" />
                  Start from none
                </Button>
              )}
              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={() => applyQuickStart("READ_ONLY")}
              >
                <Eye className="mr-1.5 h-3.5 w-3.5" />
                View everything
              </Button>
              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={() => applyQuickStart("FULL_ACCESS")}
              >
                <Sparkles className="mr-1.5 h-3.5 w-3.5" />
                Full access
              </Button>
            </div>
          ) : null}

          <div className="flex flex-wrap gap-4 rounded-xl border border-slate-200 bg-slate-50/80 px-3 py-2 text-xs text-slate-600">
            {MODE_OPTIONS.map((opt) => {
              const Icon = opt.icon;
              return (
                <span key={opt.value} className="inline-flex items-center gap-1.5">
                  <Icon className="h-3.5 w-3.5" />
                  <strong className="text-slate-800">{opt.label}</strong>
                  <span className="text-slate-500">— {opt.hint}</span>
                </span>
              );
            })}
          </div>
        </section>

        {/* Grouped modules */}
        <div className="space-y-4">
          {groups.map((group) => (
            <section
              key={group.id}
              className="overflow-hidden rounded-2xl border border-slate-200"
            >
              <div className="flex flex-wrap items-start justify-between gap-2 border-b border-slate-100 bg-slate-50 px-4 py-3">
                <div>
                  <h3 className="text-sm font-semibold text-slate-900">
                    {group.title}
                  </h3>
                  <p className="text-xs text-slate-500">{group.description}</p>
                </div>
                {!readOnly ? (
                  <div className="flex flex-wrap gap-1">
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      className="h-7 px-2 text-[11px]"
                      onClick={() => setGroupMode(group.keys, "NONE")}
                    >
                      All off
                    </Button>
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      className="h-7 px-2 text-[11px]"
                      onClick={() => setGroupMode(group.keys, "READ_ONLY")}
                    >
                      All view
                    </Button>
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      className="h-7 px-2 text-[11px]"
                      onClick={() => setGroupMode(group.keys, "WRITE")}
                    >
                      All manage
                    </Button>
                  </div>
                ) : null}
              </div>
              <ul className="divide-y divide-slate-100">
                {group.keys.map((key) => {
                  const mode = (draftAccess[key] ?? "NONE") as ModuleAccessMode;
                  const isFieldDuty = key === "field-duty";
                  return (
                    <li
                      key={key}
                      className="flex flex-col gap-2 px-4 py-3"
                    >
                      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                        <div className="min-w-0">
                          <p className="text-sm font-medium text-slate-900">
                            {moduleLabel(key)}
                          </p>
                          {/* Modules with no description skip the line entirely
                              rather than leaving an empty row. */}
                          {!compact && moduleDescription(key) ? (
                            <p className="line-clamp-1 text-xs text-slate-500">
                              {moduleDescription(key)}
                            </p>
                          ) : null}
                        </div>
                        <div
                          className="inline-flex shrink-0 rounded-xl border border-slate-200 bg-white p-0.5"
                          role="group"
                          aria-label={`${moduleLabel(key)} access level`}
                        >
                          {MODE_OPTIONS.map((opt) => {
                            const active = mode === opt.value;
                            return (
                              <button
                                key={opt.value}
                                type="button"
                                disabled={readOnly}
                                onClick={() => setMode(key, opt.value)}
                                className={cn(
                                  "rounded-lg px-3 py-1.5 text-xs font-medium transition",
                                  active &&
                                    opt.value === "NONE" &&
                                    "bg-slate-800 text-white shadow-sm",
                                  active &&
                                    opt.value === "READ_ONLY" &&
                                    "bg-amber-500 text-white shadow-sm",
                                  active &&
                                    opt.value === "WRITE" &&
                                    "bg-emerald-600 text-white shadow-sm",
                                  !active &&
                                    "text-slate-600 hover:bg-slate-50",
                                  readOnly && "cursor-default opacity-80",
                                )}
                              >
                                {opt.short}
                              </button>
                            );
                          })}
                        </div>
                      </div>
                      {isFieldDuty && mode === "WRITE" && !readOnly ? (
                        <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs text-emerald-950">
                          <strong>Full Field Management</strong> — this person can
                          create postings &amp; hospital rosters, assign
                          coordinators/students, take &amp; unlock attendance, manage
                          hospitals/departments/shifts, and open monitoring. Same
                          tools as admin for Field Management only.
                        </div>
                      ) : null}
                      {isFieldDuty && mode === "READ_ONLY" && !readOnly ? (
                        <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-950">
                          View only — they can open Field Management menus and
                          registers but cannot create rosters or mark attendance
                          (unless assigned as a field coordinator on a posting).
                        </div>
                      ) : null}
                    </li>
                  );
                })}
              </ul>
            </section>
          ))}
        </div>

        <div className="rounded-2xl border border-brand-100 bg-brand-50/40 px-4 py-3">
          <p className="text-sm font-semibold text-slate-900">
            Preview of their menu after save
          </p>
          <div
            className={cn(
              "mt-3 grid gap-4",
              isPrimaryTeacher || secondaryRoles.includes("TEACHER")
                ? "sm:grid-cols-2"
                : "",
            )}
          >
            {isPrimaryTeacher || secondaryRoles.includes("TEACHER") ? (
              <div>
                <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                  My Work
                </p>
                <ul className="mt-2 flex flex-wrap gap-1.5">
                  {TEACHING_MY_WORK_PREVIEW.map((label) => (
                    <li
                      key={label}
                      className="rounded-full bg-sky-100 px-2.5 py-1 text-xs font-medium text-sky-900"
                    >
                      {label}
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
            <div>
              <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                Administration
              </p>
              {enabledModules.length === 0 && extraEnabled.length === 0 ? (
                <p className="mt-2 text-sm text-slate-600">
                  None yet — only their normal job menu.
                </p>
              ) : (
                <ul className="mt-2 flex flex-wrap gap-1.5">
                  {isPrimaryTeacher && extraEnabled.length > 0 ? (
                    <>
                      <li className="rounded-full bg-emerald-100 px-2.5 py-1 text-xs font-medium text-emerald-900">
                        Student Management
                      </li>
                      <li className="rounded-full bg-emerald-100 px-2.5 py-1 text-xs font-medium text-emerald-900">
                        Academic Management
                      </li>
                      <li className="rounded-full bg-emerald-100 px-2.5 py-1 text-xs font-medium text-emerald-900">
                        Timetable Management
                      </li>
                    </>
                  ) : null}
                  {enabledModules.map((m) => (
                    <li
                      key={m.key}
                      className={cn(
                        "rounded-full px-2.5 py-1 text-xs font-medium",
                        m.mode === "WRITE"
                          ? "bg-emerald-100 text-emerald-900"
                          : "bg-amber-100 text-amber-950",
                      )}
                    >
                      {m.label}
                      <span className="ml-1 opacity-70">
                        · {m.mode === "WRITE" ? "manage" : "view"}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        </div>

        {/* Advanced */}
        <div className="rounded-2xl border border-slate-200">
          <button
            type="button"
            className="flex w-full items-center justify-between px-4 py-3 text-left text-sm font-medium text-slate-800"
            onClick={() => setShowAdvanced((v) => !v)}
          >
            Advanced options
            <span className="text-xs font-normal text-slate-500">
              {showAdvanced ? "Hide" : "Extra roles, audit note"}
            </span>
          </button>
          {showAdvanced ? (
            <div className="space-y-4 border-t border-slate-100 px-4 py-4">
              <div className="grid gap-3 sm:grid-cols-2">
                <div>
                  <label className="mb-1 block text-sm font-medium text-slate-700">
                    Note for audit log
                  </label>
                  <Input
                    value={reason}
                    disabled={readOnly}
                    onChange={(event) => {
                      setDirty(true);
                      setReason(event.target.value);
                    }}
                    placeholder="Optional reason for this change"
                  />
                </div>
              </div>

              <div>
                <p className="text-sm font-medium text-slate-800">
                  Extra job roles (optional)
                </p>
                <p className="mt-0.5 text-xs text-slate-500">
                  Use when one person has two jobs on the same login (for
                  example Principal who also teaches). Teaching tools stay
                  available for teacher accounts when you save access.
                </p>
                {isPrimaryTeacher ? (
                  <p className="mt-2 rounded-lg border border-sky-200 bg-sky-50 px-3 py-2 text-xs text-sky-900">
                    This account is already a <strong>Teacher</strong>. Set job
                    title (Vice Principal, Principal, …) at the top if needed —
                    teaching modules stay on after you save. Check extra roles
                    only if they also need another portal (lab, library, etc.).
                  </p>
                ) : null}
                <div className="mt-3 grid gap-2 sm:grid-cols-2">
                  {SECONDARY_ROLE_OPTIONS.map((option) => {
                    // Primary role already covers this — show as fixed on
                    const isPrimary = option.value === primaryRole;
                    const checked =
                      isPrimary || secondaryRoles.includes(option.value);
                    return (
                      <label
                        key={option.value}
                        className={cn(
                          "flex cursor-pointer items-start gap-2 rounded-xl border px-3 py-2 text-sm",
                          checked
                            ? "border-brand-300 bg-brand-50/40"
                            : "border-slate-200 bg-white",
                          (readOnly || isPrimary) && "cursor-default",
                        )}
                      >
                        <input
                          type="checkbox"
                          className="mt-0.5 h-4 w-4 rounded border-slate-300"
                          checked={checked}
                          disabled={readOnly || isPrimary}
                          onChange={(event) => {
                            setDirty(true);
                            if (event.target.checked) {
                              setSecondaryRoles((current) =>
                                Array.from(
                                  new Set([...current, option.value]),
                                ),
                              );
                              if (option.value === "TEACHER") {
                                ensureTeacherModulesInDraft();
                              }
                              if (
                                option.value === "ACCOUNTANT" ||
                                option.value === "CASHIER" ||
                                option.value === "AUDITOR" ||
                                option.value === "PRINCIPAL"
                              ) {
                                ensureFinanceModulesInDraft(option.value);
                              }
                            } else {
                              setSecondaryRoles((current) =>
                                current.filter((r) => r !== option.value),
                              );
                            }
                          }}
                        />
                        <span>
                          <span className="block font-medium text-slate-900">
                            {option.label}
                            {isPrimary ? " (primary role)" : ""}
                          </span>
                          <span className="block text-xs text-slate-500">
                            {option.hint}
                          </span>
                        </span>
                      </label>
                    );
                  })}
                </div>
              </div>
            </div>
          ) : null}
        </div>

        {!readOnly ? (
          <div className="flex flex-wrap items-center justify-between gap-2 border-t border-slate-100 pt-4">
            <p className="text-xs text-slate-500">
              {dirty
                ? "You have unsaved changes."
                : configured
                  ? "All changes are saved."
                  : "Save to apply custom access for this account."}
            </p>
            <div className="flex flex-wrap gap-2">
              <Button
                type="button"
                variant="outline"
                onClick={() => {
                  if (accessQuery.data) {
                    setDraftAccess({ ...accessQuery.data.moduleAccess });
                    setSecondaryRoles([
                      ...(accessQuery.data.secondaryRoles ?? []),
                    ]);
                    const des = accessQuery.data.designation ?? "";
                    if (
                      des &&
                      !(LEADERSHIP_DESIGNATIONS as readonly string[]).includes(
                        des,
                      )
                    ) {
                      setDesignation("Other");
                      setCustomDesignation(des);
                    } else {
                      setDesignation(des);
                      setCustomDesignation("");
                    }
                    setDirty(false);
                  }
                }}
              >
                Discard
              </Button>
              <Button
                type="button"
                onClick={handleSave}
                disabled={saveMutation.isPending || (!dirty && configured)}
              >
                <Save className="mr-1.5 h-4 w-4" />
                {saveMutation.isPending ? "Saving…" : "Save access"}
              </Button>
            </div>
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
};
