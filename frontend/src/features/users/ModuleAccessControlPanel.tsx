import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ERP_MODULES,
  LEADERSHIP_DESIGNATIONS,
  MODULE_ACCESS_UI_GROUPS,
  buildPresetModuleAccess,
  type ErpModuleKey,
  type ModuleAccessMode,
  type ModulePermissionAction,
  type UserRole,
} from "@phit-erp/shared";
import { Check, Eye, EyeOff, Lock, Save, Shield, Sparkles } from "lucide-react";
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

const moduleLabel = (key: ErpModuleKey): string =>
  ERP_MODULES.find((m) => m.key === key)?.label ?? key;

const moduleDescription = (key: ErpModuleKey): string =>
  ERP_MODULES.find((m) => m.key === key)?.description ?? "";

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
  const groups = accessQuery.data?.groups?.length
    ? accessQuery.data.groups
    : MODULE_ACCESS_UI_GROUPS;

  const setMode = (key: string, mode: ModuleAccessMode) => {
    setDirty(true);
    setDraftAccess((current) => ({ ...current, [key]: mode }));
  };

  const applyQuickStart = (preset: "NO_ACCESS" | "READ_ONLY" | "FULL_ACCESS") => {
    setDirty(true);
    setDraftAccess(buildPresetModuleAccess(preset));
  };

  const enabledModules = useMemo(() => {
    return ERP_MODULES.filter((m) => {
      if (m.key === "dashboard" || m.key === "profile") return false;
      const mode = draftAccess[m.key] ?? "NONE";
      return mode === "WRITE" || mode === "READ_ONLY";
    });
  }, [draftAccess]);

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
                  Choose which admin sections <strong>{userName}</strong> can open
                  on their login. Only sections set to <strong>View</strong> or{" "}
                  <strong>Manage</strong> appear in their menu.
                </>
              ) : (
                <>
                  Choose which admin sections this person can open. Only sections
                  set to <strong>View</strong> or <strong>Manage</strong> appear
                  in their menu.
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
            <p className="font-medium">Access not customized yet</p>
            <p className="mt-1 text-amber-900/90">
              Right now they only see menus from their job role. Save the options
              below to control exactly which admin sections they get.
            </p>
          </div>
        ) : (
          <div className="rounded-xl border border-emerald-200 bg-emerald-50/70 px-4 py-3 text-sm text-emerald-950">
            <p className="font-medium">Custom access is active</p>
            <p className="mt-1 text-emerald-900/90">
              Their menu only includes the sections you allow below (plus their
              personal tools such as dashboard and profile).
            </p>
          </div>
        )}
      </CardHeader>

      <CardContent className="space-y-6">
        {/* Quick start */}
        {!readOnly ? (
          <div className="flex flex-wrap items-center gap-2">
            <span className="mr-1 text-xs font-medium uppercase tracking-wide text-slate-500">
              Quick start
            </span>
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={() => applyQuickStart("NO_ACCESS")}
            >
              <Lock className="mr-1.5 h-3.5 w-3.5" />
              Start from none
            </Button>
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

        {/* Legend */}
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

        {/* Grouped modules */}
        <div className="space-y-4">
          {groups.map((group) => (
            <section
              key={group.id}
              className="overflow-hidden rounded-2xl border border-slate-200"
            >
              <div className="border-b border-slate-100 bg-slate-50 px-4 py-3">
                <h3 className="text-sm font-semibold text-slate-900">
                  {group.title}
                </h3>
                <p className="text-xs text-slate-500">{group.description}</p>
              </div>
              <ul className="divide-y divide-slate-100">
                {group.keys.map((key) => {
                  const mode = (draftAccess[key] ?? "NONE") as ModuleAccessMode;
                  return (
                    <li
                      key={key}
                      className="flex flex-col gap-3 px-4 py-3 sm:flex-row sm:items-center sm:justify-between"
                    >
                      <div className="min-w-0">
                        <p className="text-sm font-medium text-slate-900">
                          {moduleLabel(key)}
                        </p>
                        {!compact ? (
                          <p className="text-xs text-slate-500 line-clamp-1">
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
                    </li>
                  );
                })}
              </ul>
            </section>
          ))}
        </div>

        {/* Live preview of what they will see */}
        <div className="rounded-2xl border border-brand-100 bg-brand-50/40 px-4 py-3">
          <p className="text-sm font-semibold text-slate-900">
            What they will see in the menu
          </p>
          {enabledModules.length === 0 ? (
            <p className="mt-1 text-sm text-slate-600">
              No admin sections yet — only their normal role tools (dashboard,
              profile, etc.).
            </p>
          ) : (
            <ul className="mt-2 flex flex-wrap gap-2">
              {enabledModules.map((m) => {
                const mode = draftAccess[m.key] ?? "NONE";
                return (
                  <li
                    key={m.key}
                    className={cn(
                      "rounded-full px-2.5 py-1 text-xs font-medium",
                      mode === "WRITE"
                        ? "bg-emerald-100 text-emerald-900"
                        : "bg-amber-100 text-amber-950",
                    )}
                  >
                    {m.label}
                    <span className="ml-1 opacity-70">
                      · {mode === "WRITE" ? "manage" : "view"}
                    </span>
                  </li>
                );
              })}
            </ul>
          )}
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
              {showAdvanced ? "Hide" : "Job title, extra roles, audit note"}
            </span>
          </button>
          {showAdvanced ? (
            <div className="space-y-4 border-t border-slate-100 px-4 py-4">
              <div className="grid gap-3 sm:grid-cols-2">
                <div>
                  <label className="mb-1 block text-sm font-medium text-slate-700">
                    Job title (display only)
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
                  <p className="mt-1 text-xs text-slate-500">
                    Title does not grant permissions by itself.
                  </p>
                </div>
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
                  Only when they need a second portal on the same login (for
                  example a principal who also teaches). Prefer module toggles
                  above for admin sections.
                </p>
                <div className="mt-3 grid gap-2 sm:grid-cols-2">
                  {SECONDARY_ROLE_OPTIONS.map((option) => {
                    const checked = secondaryRoles.includes(option.value);
                    return (
                      <label
                        key={option.value}
                        className={cn(
                          "flex cursor-pointer items-start gap-2 rounded-xl border px-3 py-2 text-sm",
                          checked
                            ? "border-brand-300 bg-brand-50/40"
                            : "border-slate-200 bg-white",
                          readOnly && "cursor-default",
                        )}
                      >
                        <input
                          type="checkbox"
                          className="mt-0.5 h-4 w-4 rounded border-slate-300"
                          checked={checked}
                          disabled={readOnly}
                          onChange={(event) => {
                            setDirty(true);
                            setSecondaryRoles((current) =>
                              event.target.checked
                                ? Array.from(
                                    new Set([...current, option.value]),
                                  )
                                : current.filter((r) => r !== option.value),
                            );
                          }}
                        />
                        <span>
                          <span className="block font-medium text-slate-900">
                            {option.label}
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
