import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ERP_MODULES,
  LEADERSHIP_DESIGNATIONS,
  MODULE_PERMISSION_ACTION_LABELS,
  MODULE_PERMISSION_ACTIONS,
  buildPresetModuleAccess,
  type ErpModuleKey,
  type ModuleAccessMode,
  type ModulePermissionAction,
  type PermissionPreset,
  type UserRole,
} from "@phit-erp/shared";
import { ChevronDown, ChevronRight, Shield } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { Button } from "components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "components/ui/card";
import { Input } from "components/ui/input";
import { Select } from "components/ui/select";
import { LoadingState } from "components/shared/LoadingState";
import { api, unwrap } from "lib/api";
import { parseErrorMessage } from "lib/utils";

interface ModuleAccessResponse {
  userId: string;
  fullName?: string;
  email?: string;
  employeeId?: string;
  role?: string;
  designation?: string;
  secondaryRoles?: UserRole[];
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
  leadershipDesignations?: string[];
}

interface ModuleAccessControlPanelProps {
  userId: string;
  userName?: string;
  compact?: boolean;
  readOnly?: boolean;
}

const SECONDARY_ROLE_OPTIONS: Array<{ value: UserRole; label: string }> = [
  { value: "TEACHER", label: "Teaching (Teacher portal features)" },
  { value: "LABORATORY_STAFF", label: "Laboratory In-Charge" },
  { value: "LIBRARY_STAFF", label: "Library Staff" },
  { value: "ACCOUNTANT", label: "Accounting" },
  { value: "CASHIER", label: "Cashier" },
  { value: "AUDITOR", label: "Auditor" },
  { value: "PRINCIPAL", label: "Principal (login role portal)" },
  { value: "COLLEGE_STAFF", label: "College Staff" },
  { value: "COLLEGE_VIEWER", label: "College Viewer (read institution)" },
];

const MODE_LABEL: Record<ModuleAccessMode, string> = {
  NONE: "No Access",
  READ_ONLY: "Read Only",
  WRITE: "Full (Write)",
};

const MODE_STYLE: Record<ModuleAccessMode, string> = {
  NONE: "border-slate-200 bg-slate-50 text-slate-500",
  READ_ONLY: "border-amber-200 bg-amber-50/50 text-amber-900",
  WRITE: "border-emerald-200 bg-emerald-50/40 text-emerald-900",
};

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
  const [draftActions, setDraftActions] = useState<
    Record<string, ModulePermissionAction[]>
  >({});
  const [secondaryRoles, setSecondaryRoles] = useState<UserRole[]>([]);
  const [designation, setDesignation] = useState("");
  const [customDesignation, setCustomDesignation] = useState("");
  const [reason, setReason] = useState("");
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [activePreset, setActivePreset] = useState<PermissionPreset | "">("");

  const accessQuery = useQuery({
    queryKey: ["users", userId, "module-access"],
    queryFn: () =>
      unwrap<ModuleAccessResponse>(api.get(`/users/${userId}/module-access`)),
    enabled: Boolean(userId),
  });

  useEffect(() => {
    if (!accessQuery.data) return;
    setDraftAccess({ ...accessQuery.data.moduleAccess });
    setDraftActions({ ...(accessQuery.data.moduleActions ?? {}) });
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
  }, [accessQuery.data]);

  const saveMutation = useMutation({
    mutationFn: (payload: {
      moduleAccess: Record<string, ModuleAccessMode>;
      moduleActions: Record<string, ModulePermissionAction[]>;
      secondaryRoles: UserRole[];
      designation: string | null;
      reason?: string;
    }) =>
      unwrap(api.put(`/users/${userId}/module-access`, payload)),
    onSuccess: async () => {
      toast.success(
        "Department access & permissions updated. Designation will appear on the teacher account after they refresh or re-login.",
      );
      setReason("");
      setActivePreset("");
      await queryClient.invalidateQueries({
        queryKey: ["users", userId, "module-access"],
      });
      // Refresh current session (if admin edited themselves) and teacher list
      await queryClient.invalidateQueries({ queryKey: ["auth", "me"] });
      await queryClient.refetchQueries({ queryKey: ["auth", "me"] });
      await queryClient.invalidateQueries({ queryKey: ["teachers"] });
    },
    onError: (error) => toast.error(parseErrorMessage(error)),
  });

  const modules = useMemo(
    () =>
      accessQuery.data?.modules?.length
        ? accessQuery.data.modules
        : ERP_MODULES.map((m) => ({
            key: m.key,
            label: m.label,
            description: m.description,
            mode: (draftAccess[m.key] ?? "WRITE") as ModuleAccessMode,
            actions: (draftActions[m.key] ??
              MODULE_PERMISSION_ACTIONS) as ModulePermissionAction[],
            availableActions: (m.availableActions ??
              MODULE_PERMISSION_ACTIONS) as ModulePermissionAction[],
          })),
    [accessQuery.data?.modules, draftAccess, draftActions],
  );

  const counts = useMemo(() => {
    let write = 0;
    let read = 0;
    let none = 0;
    for (const m of modules) {
      const mode = draftAccess[m.key] ?? m.mode;
      if (mode === "WRITE") write += 1;
      else if (mode === "READ_ONLY") read += 1;
      else none += 1;
    }
    return { write, read, none, total: modules.length };
  }, [modules, draftAccess]);

  const applyPreset = (preset: PermissionPreset) => {
    setActivePreset(preset);
    if (preset === "CUSTOM") return;
    const map = buildPresetModuleAccess(preset);
    setDraftAccess(map);
    // Clear granular overrides so mode defaults apply
    const cleared: Record<string, ModulePermissionAction[]> = {};
    for (const key of Object.keys(map)) {
      cleared[key] = [];
    }
    setDraftActions(cleared);
  };

  const setMode = (key: string, mode: ModuleAccessMode) => {
    setActivePreset("CUSTOM");
    setDraftAccess((current) => ({ ...current, [key]: mode }));
    if (mode === "NONE") {
      setDraftActions((current) => ({ ...current, [key]: [] }));
    }
  };

  const toggleAction = (
    key: string,
    action: ModulePermissionAction,
    enabled: boolean,
  ) => {
    setActivePreset("CUSTOM");
    setDraftActions((current) => {
      const mode = draftAccess[key] ?? "WRITE";
      const available: ModulePermissionAction[] = [
        ...(modules.find((m) => m.key === key)?.availableActions ??
          MODULE_PERMISSION_ACTIONS),
      ];
      const existing = current[key] ?? [];
      const base: ModulePermissionAction[] =
        existing.length > 0
          ? [...existing]
          : mode === "READ_ONLY"
            ? (["view", "print", "export"] as ModulePermissionAction[])
            : mode === "WRITE"
              ? available
              : [];
      const next = enabled
        ? Array.from(new Set([...base, action]))
        : base.filter((a) => a !== action);
      return { ...current, [key]: next };
    });
    // Ensure mode supports the action
    if (enabled) {
      setDraftAccess((current) => {
        const mode = current[key] ?? "WRITE";
        if (mode === "NONE") return { ...current, [key]: "WRITE" };
        if (
          mode === "READ_ONLY" &&
          action !== "view" &&
          action !== "print" &&
          action !== "export"
        ) {
          return { ...current, [key]: "WRITE" };
        }
        return current;
      });
    }
  };

  const toggleSecondaryRole = (role: UserRole, enabled: boolean) => {
    setSecondaryRoles((current) =>
      enabled
        ? Array.from(new Set([...current, role]))
        : current.filter((r) => r !== role),
    );
  };

  const handleSave = () => {
    const resolvedDesignation =
      designation === "Other"
        ? customDesignation.trim() || null
        : designation.trim() || null;

    // Ensure every known module has a mode. Missing → No Access (not granted).
    const accessPayload: Record<string, ModuleAccessMode> = {};
    for (const mod of ERP_MODULES) {
      accessPayload[mod.key] =
        (draftAccess[mod.key] as ModuleAccessMode | undefined) ?? "NONE";
    }

    // Only send non-empty action arrays (empty = use mode defaults on server)
    const actionsPayload: Record<string, ModulePermissionAction[]> = {};
    for (const [key, actions] of Object.entries(draftActions)) {
      if (actions && actions.length > 0) {
        actionsPayload[key] = actions;
      }
    }

    saveMutation.mutate({
      moduleAccess: accessPayload,
      moduleActions: actionsPayload,
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
          Could not load department access for this user.
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className={compact ? "border-slate-200 shadow-none" : undefined}>
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center gap-2 text-base">
          <Shield className="h-5 w-5 text-brand-600" />
          Department Access &amp; Permission Management
        </CardTitle>
        <p className="text-sm text-slate-600">
          {userName ? `${userName} · ` : ""}
          Designation is a job title only and does not grant access. Only
          modules set to <strong>Full Access</strong> or{" "}
          <strong>Read Only</strong> appear in this person&apos;s sidebar.
          Modules set to <strong>No Access</strong> are completely hidden.
          Tip: use the <strong>No Access</strong> preset first, then open only
          the departments they need.
        </p>
        <p className="text-xs text-slate-500">
          Write: {counts.write} · Read only: {counts.read} · No access:{" "}
          {counts.none} / {counts.total} departments
        </p>
      </CardHeader>
      <CardContent className="space-y-5">
        {/* Designation */}
        <div className="grid gap-3 rounded-xl border border-slate-200 bg-slate-50/80 p-3 sm:grid-cols-2">
          <div>
            <label className="mb-1 block text-sm font-medium text-slate-700">
              Designation (position title only)
            </label>
            <Select
              value={designation}
              disabled={readOnly}
              onChange={(event) => setDesignation(event.target.value)}
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
                placeholder="Custom designation"
                value={customDesignation}
                disabled={readOnly}
                onChange={(event) => setCustomDesignation(event.target.value)}
              />
            ) : null}
            <p className="mt-1 text-xs text-slate-500">
              Changing designation never changes permissions automatically.
            </p>
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium text-slate-700">
              Reason for change (audit log)
            </label>
            <Input
              value={reason}
              disabled={readOnly}
              onChange={(event) => setReason(event.target.value)}
              placeholder="Optional note for audit trail"
            />
          </div>
        </div>

        {/* Presets */}
        {!readOnly ? (
          <div>
            <p className="mb-2 text-sm font-medium text-slate-800">
              Permission presets
            </p>
            <div className="flex flex-wrap gap-2">
              {(
                [
                  ["FULL_ACCESS", "Full Access"],
                  ["READ_ONLY", "Read Only"],
                  ["NO_ACCESS", "No Access"],
                  ["CUSTOM", "Custom Access"],
                ] as const
              ).map(([preset, label]) => (
                <Button
                  key={preset}
                  type="button"
                  size="sm"
                  variant={activePreset === preset ? "default" : "outline"}
                  onClick={() => applyPreset(preset)}
                >
                  {label}
                </Button>
              ))}
            </div>
          </div>
        ) : null}

        {/* Multi-role secondary responsibilities */}
        <div className="rounded-xl border border-brand-100 bg-brand-50/30 p-3">
          <p className="text-sm font-medium text-slate-800">
            Multi-role responsibilities (same login)
          </p>
          <p className="mt-0.5 text-xs text-slate-500">
            Enable extra portals/features without creating a second account.
            Example: Principal who also teaches → enable Teaching.
          </p>
          <div className="mt-3 grid gap-2 sm:grid-cols-2">
            {SECONDARY_ROLE_OPTIONS.map((option) => {
              const checked = secondaryRoles.includes(option.value);
              return (
                <label
                  key={option.value}
                  className={`flex cursor-pointer items-center gap-2 rounded-lg border px-3 py-2 text-sm ${
                    checked
                      ? "border-brand-300 bg-white"
                      : "border-slate-200 bg-white/70"
                  } ${readOnly ? "cursor-default" : ""}`}
                >
                  <input
                    type="checkbox"
                    className="h-4 w-4 rounded border-slate-300"
                    checked={checked}
                    disabled={readOnly}
                    onChange={(event) =>
                      toggleSecondaryRole(option.value, event.target.checked)
                    }
                  />
                  {option.label}
                </label>
              );
            })}
          </div>
        </div>

        {/* Department matrix */}
        <div className="space-y-2">
          <p className="text-sm font-medium text-slate-800">
            Department permission matrix
          </p>
          {modules.map((mod) => {
            const mode = (draftAccess[mod.key] ?? mod.mode) as ModuleAccessMode;
            const isOpen = Boolean(expanded[mod.key]);
            const available: ModulePermissionAction[] = mod.availableActions
              ?.length
              ? [...mod.availableActions]
              : [...MODULE_PERMISSION_ACTIONS];
            const storedActions = draftActions[mod.key] ?? [];
            const currentActions: ModulePermissionAction[] =
              storedActions.length > 0
                ? storedActions
                : mode === "NONE"
                  ? []
                  : mode === "READ_ONLY"
                    ? (["view", "print", "export"] as ModulePermissionAction[])
                    : available;

            return (
              <div
                key={mod.key}
                className={`rounded-xl border ${MODE_STYLE[mode]}`}
              >
                <div className="flex flex-wrap items-center gap-2 p-3">
                  <button
                    type="button"
                    className="flex min-w-0 flex-1 items-center gap-2 text-left"
                    onClick={() =>
                      setExpanded((current) => ({
                        ...current,
                        [mod.key]: !current[mod.key],
                      }))
                    }
                  >
                    {isOpen ? (
                      <ChevronDown className="h-4 w-4 shrink-0" />
                    ) : (
                      <ChevronRight className="h-4 w-4 shrink-0" />
                    )}
                    <span className="min-w-0">
                      <span className="block text-sm font-semibold text-slate-900">
                        {mod.label}
                      </span>
                      {!compact ? (
                        <span className="block text-xs opacity-80 line-clamp-1">
                          {mod.description}
                        </span>
                      ) : null}
                    </span>
                  </button>
                  <Select
                    className="max-w-[9.5rem]"
                    value={mode}
                    disabled={readOnly}
                    onChange={(event) =>
                      setMode(
                        mod.key,
                        event.target.value as ModuleAccessMode,
                      )
                    }
                  >
                    <option value="WRITE">Full Access</option>
                    <option value="READ_ONLY">Read Only</option>
                    <option value="NONE">No Access</option>
                  </Select>
                </div>

                {isOpen && mode !== "NONE" ? (
                  <div className="border-t border-black/5 px-3 pb-3 pt-2">
                    <p className="mb-2 text-xs font-medium text-slate-600">
                      Granular actions ({MODE_LABEL[mode]})
                    </p>
                    <div className="flex flex-wrap gap-2">
                      {available.map((action) => {
                        const checked = currentActions.includes(action);
                        const blockedByReadOnly =
                          mode === "READ_ONLY" &&
                          action !== "view" &&
                          action !== "print" &&
                          action !== "export";
                        return (
                          <label
                            key={action}
                            className={`inline-flex items-center gap-1.5 rounded-lg border bg-white/80 px-2 py-1 text-xs ${
                              blockedByReadOnly
                                ? "cursor-not-allowed opacity-40"
                                : "cursor-pointer"
                            }`}
                          >
                            <input
                              type="checkbox"
                              className="h-3.5 w-3.5 rounded border-slate-300"
                              checked={checked && !blockedByReadOnly}
                              disabled={readOnly || blockedByReadOnly}
                              onChange={(event) =>
                                toggleAction(
                                  mod.key,
                                  action,
                                  event.target.checked,
                                )
                              }
                            />
                            {MODULE_PERMISSION_ACTION_LABELS[action] ?? action}
                          </label>
                        );
                      })}
                    </div>
                  </div>
                ) : null}
              </div>
            );
          })}
        </div>

        {!readOnly ? (
          <div className="flex flex-wrap items-center justify-end gap-2 border-t border-slate-100 pt-4">
            <Button
              type="button"
              variant="outline"
              onClick={() => {
                if (accessQuery.data) {
                  setDraftAccess({ ...accessQuery.data.moduleAccess });
                  setDraftActions({
                    ...(accessQuery.data.moduleActions ?? {}),
                  });
                  setSecondaryRoles([
                    ...(accessQuery.data.secondaryRoles ?? []),
                  ]);
                  setActivePreset("");
                }
              }}
            >
              Reset
            </Button>
            <Button
              type="button"
              onClick={handleSave}
              disabled={saveMutation.isPending}
            >
              {saveMutation.isPending
                ? "Saving…"
                : "Save department access"}
            </Button>
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
};
