import { useMemo, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import {
  DEFAULT_ACADEMIC_YEAR_BS,
  type AcademicPromotionPreview,
  type AcademicPromotionRecord
} from "@phit-erp/shared";
import { ArrowRight, History, RotateCcw, ShieldCheck, Users } from "lucide-react";
import { toast } from "sonner";
import { EmptyState } from "components/shared/EmptyState";
import { FormField } from "components/shared/FormField";
import { PageHeader } from "components/shared/PageHeader";
import { Badge } from "components/ui/badge";
import { Button } from "components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "components/ui/card";
import { Input } from "components/ui/input";
import { Table, TableBody, Td, Th, TableHead } from "components/ui/table";
import { useIsTenantAdmin } from "hooks/useNormalizedRole";
import { api, unwrap } from "lib/api";
import { queryClient } from "lib/queryClient";
import { parseErrorMessage } from "lib/utils";

const statusBadgeClass = (status: string): string => {
  if (status === "COMPLETED") return "bg-emerald-100 text-emerald-800";
  if (status === "ROLLED_BACK") return "bg-amber-100 text-amber-800";
  return "bg-slate-100 text-slate-700";
};

export const AcademicPromotionManager = () => {
  const canManage = useIsTenantAdmin();
  const [academicSessionBs, setAcademicSessionBs] = useState(DEFAULT_ACADEMIC_YEAR_BS);
  const [remarks, setRemarks] = useState("");
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [rollbackRemarks, setRollbackRemarks] = useState("");

  const previewQuery = useQuery({
    queryKey: ["academic-promotion-preview", academicSessionBs],
    queryFn: () =>
      unwrap<AcademicPromotionPreview>(
        api.get("/academic-promotion/preview", { params: { academicSessionBs } })
      )
  });

  const historyQuery = useQuery({
    queryKey: ["academic-promotion-history"],
    queryFn: () => unwrap<AcademicPromotionRecord[]>(api.get("/academic-promotion/history"))
  });

  const invalidateAll = async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ["academic-promotion-preview"] }),
      queryClient.invalidateQueries({ queryKey: ["academic-promotion-history"] }),
      queryClient.invalidateQueries({ queryKey: ["students"] }),
      queryClient.invalidateQueries({ queryKey: ["batches"] }),
      queryClient.invalidateQueries({ queryKey: ["years"] }),
      queryClient.invalidateQueries({ queryKey: ["dashboard"] })
    ]);
  };

  const executeMutation = useMutation({
    mutationFn: async () =>
      unwrap<{
        promotion: AcademicPromotionRecord;
        feeStructuresCreated: number;
        notificationMessage: string;
      }>(
        api.post("/academic-promotion/execute", {
          academicSessionBs,
          remarks: remarks.trim() || undefined
        })
      ),
    onSuccess: async (result) => {
      toast.success(result.notificationMessage.replace(/\n/g, " · "));
      setConfirmOpen(false);
      setRemarks("");
      await invalidateAll();
    },
    onError: (error) => toast.error(parseErrorMessage(error))
  });

  const rollbackMutation = useMutation({
    mutationFn: async () =>
      unwrap<{ promotion: AcademicPromotionRecord; restoredStudents: number }>(
        api.post("/academic-promotion/rollback", {
          remarks: rollbackRemarks.trim() || undefined
        })
      ),
    onSuccess: async (result) => {
      toast.success(`Promotion rolled back. ${result.restoredStudents} student(s) restored.`);
      setRollbackRemarks("");
      await invalidateAll();
    },
    onError: (error) => toast.error(parseErrorMessage(error))
  });

  const preview = previewQuery.data;
  const history = historyQuery.data ?? [];
  const latestCompleted = useMemo(
    () => history.find((item) => item.status === "COMPLETED"),
    [history]
  );

  return (
    <div className="space-y-6">
      <PageHeader
        title="Academic Promotion"
        description="One-click yearly progression: promote every eligible batch, move final-year students to Passed Out / Alumni, and keep full academic history."
      />

      <Card className="border-brand-200 bg-gradient-to-br from-slate-50 to-white">
        <CardHeader className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <CardTitle className="flex items-center gap-2 text-xl">
              <ShieldCheck className="h-5 w-5 text-brand-600" />
              Promote Academic Year
            </CardTitle>
            <p className="mt-1 text-sm text-slate-600">
              Detects all active batches automatically. Student IDs, admission numbers, fees, attendance,
              and exam history are preserved.
            </p>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-4 md:grid-cols-2">
            <FormField label="Academic Session (BS)">
              <Input
                value={academicSessionBs}
                onChange={(event) => setAcademicSessionBs(event.target.value)}
                placeholder="2083/2084"
              />
            </FormField>
            <FormField label="Remarks (optional)">
              <Input
                value={remarks}
                onChange={(event) => setRemarks(event.target.value)}
                placeholder="End of session promotion"
                disabled={!canManage}
              />
            </FormField>
          </div>

          <div className="flex flex-wrap gap-3">
            <Button
              type="button"
              variant="outline"
              onClick={() => void previewQuery.refetch()}
              disabled={previewQuery.isFetching}
            >
              {previewQuery.isFetching ? "Refreshing preview…" : "Refresh Preview"}
            </Button>
            {canManage ? (
              <Button
                type="button"
                size="lg"
                className="min-w-[220px]"
                disabled={!preview?.canPromote || executeMutation.isPending}
                onClick={() => setConfirmOpen(true)}
              >
                {executeMutation.isPending ? "Promoting…" : "Promote Academic Year"}
              </Button>
            ) : (
              <p className="text-sm text-slate-500">Only Super Admin and Admin can execute promotions.</p>
            )}
          </div>

          {previewQuery.isError ? (
            <p className="text-sm text-red-600">{parseErrorMessage(previewQuery.error)}</p>
          ) : null}

          {preview ? (
            <div className="space-y-4">
              <div className="grid gap-3 sm:grid-cols-3">
                <div className="rounded-2xl border border-slate-200 bg-white p-4">
                  <p className="text-xs uppercase tracking-wide text-slate-500">Eligible Students</p>
                  <p className="mt-1 flex items-center gap-2 text-2xl font-semibold text-slate-900">
                    <Users className="h-5 w-5 text-brand-600" />
                    {preview.totalStudents}
                  </p>
                </div>
                <div className="rounded-2xl border border-slate-200 bg-white p-4">
                  <p className="text-xs uppercase tracking-wide text-slate-500">Batches Detected</p>
                  <p className="mt-1 text-2xl font-semibold text-slate-900">{preview.batchesDetected}</p>
                </div>
                <div className="rounded-2xl border border-slate-200 bg-white p-4">
                  <p className="text-xs uppercase tracking-wide text-slate-500">Session</p>
                  <p className="mt-1 text-2xl font-semibold text-slate-900">{preview.academicSessionBs}</p>
                </div>
              </div>

              {preview.validationErrors.length > 0 ? (
                <div className="rounded-2xl border border-red-200 bg-red-50 p-4 text-sm text-red-800">
                  <p className="font-semibold">Validation errors (no changes will be applied)</p>
                  <ul className="mt-2 list-disc space-y-1 pl-5">
                    {preview.validationErrors.map((error) => (
                      <li key={error}>{error}</li>
                    ))}
                  </ul>
                </div>
              ) : null}

              {preview.validationWarnings.length > 0 ? (
                <div className="rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
                  <p className="font-semibold">Warnings</p>
                  <ul className="mt-2 list-disc space-y-1 pl-5">
                    {preview.validationWarnings.map((warning) => (
                      <li key={warning}>{warning}</li>
                    ))}
                  </ul>
                </div>
              ) : null}

              <div className="overflow-hidden rounded-2xl border border-slate-200">
                <div className="border-b border-slate-200 bg-slate-50 px-4 py-3">
                  <h3 className="font-semibold text-slate-900">Promotion Summary</h3>
                </div>
                {preview.groups.length === 0 ? (
                  <div className="p-6">
                    <EmptyState
                      title="No eligible promotions"
                      description="Active batches with promotable students will appear here."
                    />
                  </div>
                ) : (
                  <Table>
                    <TableHead>
                      <tr>
                        <Th>Batch</Th>
                        <Th>Current Year</Th>
                        <Th></Th>
                        <Th>Next Status</Th>
                        <Th>Students</Th>
                        <Th>Outcome</Th>
                      </tr>
                    </TableHead>
                    <TableBody>
                      {preview.groups.map((group) => (
                        <tr key={`${group.batchId}-${group.previousLevel}-${group.outcome}`}>
                          <Td className="font-medium">{group.batchName}</Td>
                          <Td>{group.previousYearName}</Td>
                          <Td>
                            <ArrowRight className="h-4 w-4 text-slate-400" />
                          </Td>
                          <Td>{group.newYearName}</Td>
                          <Td>{group.studentCount}</Td>
                          <Td>
                            <Badge
                              className={
                                group.outcome === "PASSED_OUT"
                                  ? "bg-amber-100 text-amber-800"
                                  : "bg-emerald-100 text-emerald-800"
                              }
                            >
                              {group.outcome === "PASSED_OUT" ? "Passed Out / Alumni" : "Promote"}
                            </Badge>
                          </Td>
                        </tr>
                      ))}
                      <tr className="bg-slate-50 font-semibold">
                        <Td colSpan={4}>Total Students</Td>
                        <Td>{preview.totalStudents}</Td>
                        <Td></Td>
                      </tr>
                    </TableBody>
                  </Table>
                )}
              </div>
            </div>
          ) : previewQuery.isLoading ? (
            <p className="text-sm text-slate-500">Loading promotion preview…</p>
          ) : null}
        </CardContent>
      </Card>

      {confirmOpen && preview ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/50 p-4">
          <Card className="w-full max-w-lg shadow-2xl">
            <CardHeader>
              <CardTitle>Confirm Promotion</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <p className="text-sm text-slate-600">
                You are about to promote <strong>{preview.totalStudents}</strong> student(s) across{" "}
                <strong>{preview.batchesDetected}</strong> batch(es) for session{" "}
                <strong>{preview.academicSessionBs}</strong>. This runs in a single transaction.
              </p>
              <ul className="max-h-48 space-y-2 overflow-y-auto text-sm text-slate-700">
                {preview.groups.map((group) => (
                  <li
                    key={`confirm-${group.batchId}-${group.previousLevel}`}
                    className="rounded-xl border border-slate-200 px-3 py-2"
                  >
                    <span className="font-medium">{group.batchName}</span>: {group.previousYearName} →{" "}
                    {group.newYearName} ({group.studentCount})
                  </li>
                ))}
              </ul>
              <div className="flex justify-end gap-2">
                <Button type="button" variant="outline" onClick={() => setConfirmOpen(false)}>
                  Cancel
                </Button>
                <Button
                  type="button"
                  disabled={executeMutation.isPending}
                  onClick={() => void executeMutation.mutateAsync()}
                >
                  {executeMutation.isPending ? "Confirming…" : "Confirm Promotion"}
                </Button>
              </div>
            </CardContent>
          </Card>
        </div>
      ) : null}

      <Card>
        <CardHeader className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <CardTitle className="flex items-center gap-2">
            <History className="h-5 w-5" />
            Promotion History
          </CardTitle>
          {canManage && latestCompleted ? (
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
              <Input
                className="sm:w-56"
                placeholder="Rollback remarks"
                value={rollbackRemarks}
                onChange={(event) => setRollbackRemarks(event.target.value)}
              />
              <Button
                type="button"
                variant="outline"
                disabled={rollbackMutation.isPending}
                onClick={() => {
                  const confirmed = window.confirm(
                    `Roll back the most recent promotion for session ${latestCompleted.academicSessionBs}? This restores academic year and student status for ${latestCompleted.totalStudents} student(s).`
                  );
                  if (confirmed) {
                    void rollbackMutation.mutateAsync();
                  }
                }}
              >
                <RotateCcw className="mr-2 h-4 w-4" />
                {rollbackMutation.isPending ? "Rolling back…" : "Rollback Latest"}
              </Button>
            </div>
          ) : null}
        </CardHeader>
        <CardContent>
          {history.length === 0 ? (
            <EmptyState
              title="No promotion history"
              description="Completed promotions will appear here with full audit details."
            />
          ) : (
            <Table>
              <TableHead>
                <tr>
                  <Th>Date</Th>
                  <Th>Session</Th>
                  <Th>Students</Th>
                  <Th>Promoted By</Th>
                  <Th>Status</Th>
                  <Th>Summary</Th>
                </tr>
              </TableHead>
              <TableBody>
                {history.map((item) => (
                  <tr key={item._id}>
                    <Td className="whitespace-nowrap">
                      {new Date(item.promotionDate).toLocaleString()}
                    </Td>
                    <Td>{item.academicSessionBs}</Td>
                    <Td>{item.totalStudents}</Td>
                    <Td>{item.promotedByName}</Td>
                    <Td>
                      <Badge className={statusBadgeClass(item.status)}>{item.status}</Badge>
                      {item.rolledBackAt ? (
                        <p className="mt-1 text-xs text-slate-500">
                          Rolled back {new Date(item.rolledBackAt).toLocaleString()}
                          {item.rolledBackByName ? ` by ${item.rolledBackByName}` : ""}
                        </p>
                      ) : null}
                    </Td>
                    <Td className="max-w-xs text-sm text-slate-600">
                      {item.groups
                        .map(
                          (group) =>
                            `${group.batchName}: ${group.previousYearName} → ${group.newYearName} (${group.studentCount})`
                        )
                        .join(" · ")}
                      {item.remarks ? (
                        <p className="mt-1 text-xs text-slate-500">Remarks: {item.remarks}</p>
                      ) : null}
                    </Td>
                  </tr>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
};
