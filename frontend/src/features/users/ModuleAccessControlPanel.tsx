import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ERP_MODULES,
  type ErpModuleKey,
  type ModuleAccessMode,
} from "@phit-erp/shared";
import { Shield } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { Button } from "components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "components/ui/card";
import { LoadingState } from "components/shared/LoadingState";
import { api, unwrap } from "lib/api";
import { parseErrorMessage } from "lib/utils";

interface ModuleAccessResponse {
  userId: string;
  fullName?: string;
  email?: string;
  employeeId?: string;
  role?: string;
  moduleAccess: Record<ErpModuleKey, ModuleAccessMode>;
  modules: Array<{
    key: ErpModuleKey;
    label: string;
    description: string;
    mode: ModuleAccessMode;
  }>;
}

interface ModuleAccessControlPanelProps {
  userId: string;
  userName?: string;
  /** Compact mode for embedding inside forms */
  compact?: boolean;
  readOnly?: boolean;
}

export const ModuleAccessControlPanel = ({
  userId,
  userName,
  compact = false,
  readOnly = false,
}: ModuleAccessControlPanelProps) => {
  const queryClient = useQueryClient();
  const [draft, setDraft] = useState<Record<string, ModuleAccessMode>>({});

  const accessQuery = useQuery({
    queryKey: ["users", userId, "module-access"],
    queryFn: () =>
      unwrap<ModuleAccessResponse>(api.get(`/users/${userId}/module-access`)),
    enabled: Boolean(userId),
  });

  useEffect(() => {
    if (accessQuery.data?.moduleAccess) {
      setDraft({ ...accessQuery.data.moduleAccess });
    }
  }, [accessQuery.data?.moduleAccess]);

  const saveMutation = useMutation({
    mutationFn: (moduleAccess: Record<string, ModuleAccessMode>) =>
      unwrap(api.put(`/users/${userId}/module-access`, { moduleAccess })),
    onSuccess: async () => {
      toast.success("Module access updated");
      await queryClient.invalidateQueries({
        queryKey: ["users", userId, "module-access"],
      });
      // Refresh auth me so the affected user sees changes on next /me (if same session N/A)
      await queryClient.invalidateQueries({ queryKey: ["auth", "me"] });
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
            mode: (draft[m.key] ?? "WRITE") as ModuleAccessMode,
          })),
    [accessQuery.data?.modules, draft],
  );

  const enabledCount = modules.filter(
    (m) => (draft[m.key] ?? m.mode) === "WRITE",
  ).length;

  const setAll = (mode: ModuleAccessMode) => {
    const next: Record<string, ModuleAccessMode> = {};
    for (const m of ERP_MODULES) next[m.key] = mode;
    setDraft(next);
  };

  const toggle = (key: string, enabled: boolean) => {
    setDraft((current) => ({
      ...current,
      [key]: enabled ? "WRITE" : "READ_ONLY",
    }));
  };

  if (accessQuery.isLoading) return <LoadingState />;
  if (accessQuery.isError) {
    return (
      <Card>
        <CardContent className="pt-6 text-sm text-rose-700">
          Could not load module access for this user.
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className={compact ? "border-slate-200 shadow-none" : undefined}>
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center gap-2 text-base">
          <Shield className="h-5 w-5 text-brand-600" />
          Module Access Control
        </CardTitle>
        <p className="text-sm text-slate-600">
          {userName ? `${userName} · ` : ""}
          Enable = full create/edit/delete. Disable = read-only (login still
          works). {enabledCount}/{modules.length} modules enabled for writing.
        </p>
      </CardHeader>
      <CardContent className="space-y-4">
        {!readOnly ? (
          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={() => setAll("WRITE")}
            >
              Enable all
            </Button>
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={() => setAll("READ_ONLY")}
            >
              Disable all (read-only)
            </Button>
          </div>
        ) : null}

        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {modules.map((mod) => {
            const mode = (draft[mod.key] ?? mod.mode) as ModuleAccessMode;
            const enabled = mode === "WRITE";
            return (
              <label
                key={mod.key}
                className={`flex cursor-pointer items-start gap-3 rounded-xl border p-3 transition ${
                  enabled
                    ? "border-emerald-200 bg-emerald-50/40"
                    : "border-slate-200 bg-slate-50"
                } ${readOnly ? "cursor-default opacity-90" : "hover:border-brand-300"}`}
              >
                <input
                  type="checkbox"
                  className="mt-1 h-4 w-4 rounded border-slate-300"
                  checked={enabled}
                  disabled={readOnly}
                  onChange={(event) => toggle(mod.key, event.target.checked)}
                />
                <span className="min-w-0">
                  <span className="block text-sm font-medium text-slate-900">
                    {mod.label}
                  </span>
                  <span className="block text-xs text-slate-500">
                    {enabled ? "Read & Write" : "Read only"}
                  </span>
                  {!compact ? (
                    <span className="mt-0.5 block text-xs text-slate-400 line-clamp-2">
                      {mod.description}
                    </span>
                  ) : null}
                </span>
              </label>
            );
          })}
        </div>

        {!readOnly ? (
          <div className="flex justify-end">
            <Button
              type="button"
              onClick={() => saveMutation.mutate(draft)}
              disabled={saveMutation.isPending}
            >
              {saveMutation.isPending ? "Saving…" : "Save module access"}
            </Button>
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
};
