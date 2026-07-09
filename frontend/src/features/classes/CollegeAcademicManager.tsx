import { useMemo, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import {
  COLLEGE_YEAR_NAMES,
  batchSchema,
  type BatchInput,
  type BatchRecord,
  type SubjectRecord,
  type YearRecord,
} from "@phit-erp/shared";
import { toast } from "sonner";
import { EmptyState } from "components/shared/EmptyState";
import { FormField } from "components/shared/FormField";
import { PageHeader } from "components/shared/PageHeader";
import { Badge } from "components/ui/badge";
import { Button } from "components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "components/ui/card";
import { Input } from "components/ui/input";
import { Select } from "components/ui/select";
import { Table, TableBody, Td, Th, TableHead } from "components/ui/table";
import { api, unwrap } from "lib/api";
import { filterYearsByBatch } from "lib/academicStructureUtils";
import { queryClient } from "lib/queryClient";
import { parseErrorMessage } from "lib/utils";
import { AcademicPromotionManager } from "./AcademicPromotionManager";
import { MasterSubjectManager } from "./MasterSubjectManager";
import { useIsTenantAdmin } from "hooks/useNormalizedRole";

const defaultBatchValue: BatchInput = {
  name: "",
  academicYearBs: "2083/2084",
  isActive: true,
};

export const CollegeAcademicManager = () => {
  const canManage = useIsTenantAdmin();
  const [batchForm, setBatchForm] = useState<BatchInput>(defaultBatchValue);
  const [selectedBatchId, setSelectedBatchId] = useState("");
  const [editingBatchId, setEditingBatchId] = useState<string | null>(null);
  const [pendingMasterEditId, setPendingMasterEditId] = useState<string | null>(
    null,
  );

  const batchesQuery = useQuery({
    queryKey: ["batches"],
    queryFn: () => unwrap<BatchRecord[]>(api.get("/academics/batches")),
  });
  const yearsQuery = useQuery({
    queryKey: ["years"],
    queryFn: () => unwrap<YearRecord[]>(api.get("/academics/years")),
  });
  const subjectsQuery = useQuery({
    queryKey: ["subjects"],
    queryFn: () => unwrap<SubjectRecord[]>(api.get("/academics/subjects")),
  });
  const refreshAcademicQueries = async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ["batches"] }),
      queryClient.invalidateQueries({ queryKey: ["years"] }),
      queryClient.invalidateQueries({ queryKey: ["subjects"] }),
      queryClient.invalidateQueries({ queryKey: ["master-subjects"] }),
    ]);
  };

  const batchMutation = useMutation({
    mutationFn: async (payload: BatchInput) =>
      editingBatchId
        ? unwrap<BatchRecord>(
            api.put(`/academics/batches/${editingBatchId}`, payload),
          )
        : unwrap<BatchRecord>(api.post("/academics/batches", payload)),
    onSuccess: async () => {
      toast.success(
        editingBatchId
          ? "Batch updated"
          : "Batch created with years and curriculum subjects",
      );
      setBatchForm(defaultBatchValue);
      setEditingBatchId(null);
      await refreshAcademicQueries();
    },
    onError: (error) => toast.error(parseErrorMessage(error)),
  });

  const removeMasterSubject = async (
    masterSubjectId: string,
    subjectName: string,
  ) => {
    const confirmed = window.confirm(
      `Remove "${subjectName}" from the master curriculum?\n\nThis removes the subject from all batches if it is not in use.`,
    );
    if (!confirmed) {
      return;
    }

    try {
      await api.delete(`/academics/master-subjects/${masterSubjectId}`);
      toast.success("Subject removed from master curriculum");
      await refreshAcademicQueries();
    } catch (error) {
      toast.error(parseErrorMessage(error));
    }
  };

  const deleteEntity = async (path: string, queryKey: string) => {
    try {
      await api.delete(path);
      toast.success("Deleted successfully");
      await queryClient.invalidateQueries({ queryKey: [queryKey] });
      if (queryKey === "batches") {
        await queryClient.invalidateQueries({ queryKey: ["subjects"] });
      }
    } catch (error) {
      toast.error(parseErrorMessage(error));
    }
  };

  const batches = batchesQuery.data ?? [];
  const years = yearsQuery.data ?? [];
  const subjects = subjectsQuery.data ?? [];
  const yearsForSelectedBatch = useMemo(
    () => filterYearsByBatch(years, selectedBatchId),
    [years, selectedBatchId],
  );

  const yearsByBatch = useMemo(() => {
    const map = new Map<string, YearRecord[]>();
    for (const batch of batches) {
      map.set(
        batch._id,
        years
          .filter((year) => year.batchId === batch._id)
          .sort((a, b) => a.level - b.level),
      );
    }
    return map;
  }, [batches, years]);

  const batchSubjectsByYear = useMemo(() => {
    const map = new Map<string, SubjectRecord[]>();
    for (const year of yearsForSelectedBatch) {
      map.set(
        year._id,
        subjects.filter(
          (subject) =>
            (subject.yearIds ?? []).includes(year._id) &&
            subject.isActive !== false,
        ),
      );
    }
    return map;
  }, [yearsForSelectedBatch, subjects]);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Academic Setup"
        description="Manage the fixed HA curriculum once, then create batches that automatically inherit year-wise subjects. Use Academic Promotion at the bottom for one-click yearly progression."
      />

      <MasterSubjectManager
        canManage={canManage}
        pendingEditId={pendingMasterEditId}
        onPendingEditHandled={() => setPendingMasterEditId(null)}
      />

      <div className="grid gap-6 xl:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Batches</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {canManage ? (
              <form
                className="space-y-3"
                onSubmit={(event) => {
                  event.preventDefault();
                  const parsed = batchSchema.safeParse(batchForm);
                  if (!parsed.success) {
                    toast.error(
                      parsed.error.issues[0]?.message ?? "Validation failed",
                    );
                    return;
                  }
                  void batchMutation.mutateAsync(parsed.data);
                }}
              >
                <FormField label="Batch Name">
                  <Input
                    placeholder="e.g. Batch 2083"
                    value={batchForm.name}
                    onChange={(event) =>
                      setBatchForm((current) => ({
                        ...current,
                        name: event.target.value,
                      }))
                    }
                  />
                </FormField>
                <FormField label="Academic Year (BS)">
                  <Input
                    value={batchForm.academicYearBs}
                    onChange={(event) =>
                      setBatchForm((current) => ({
                        ...current,
                        academicYearBs: event.target.value,
                      }))
                    }
                  />
                </FormField>
                <Button className="w-full" type="submit">
                  {editingBatchId ? "Update Batch" : "Create Batch"}
                </Button>
              </form>
            ) : null}

            {batches.length === 0 ? (
              <EmptyState
                title="No batches"
                description="Create a batch to automatically provision 1st, 2nd, and 3rd Year groups with master subjects."
              />
            ) : (
              <div className="space-y-3">
                {batches.map((item) => (
                  <div
                    key={item._id}
                    className="rounded-2xl border border-slate-200 p-4"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <h3 className="font-semibold text-slate-900">
                          {item.name}
                        </h3>
                        <p className="text-sm text-slate-500">
                          {item.academicYearBs}
                        </p>
                        <ul className="mt-2 space-y-1 text-sm text-slate-600">
                          {(yearsByBatch.get(item._id) ?? []).map((year) => (
                            <li key={year._id}>• {year.name}</li>
                          ))}
                        </ul>
                      </div>
                      {canManage ? (
                        <div className="flex gap-2">
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => {
                              setEditingBatchId(item._id);
                              setBatchForm({
                                name: item.name,
                                academicYearBs: item.academicYearBs,
                                isActive: item.isActive,
                              });
                            }}
                          >
                            Edit
                          </Button>
                          <Button
                            size="sm"
                            variant="destructive"
                            onClick={() =>
                              void deleteEntity(
                                `/academics/batches/${item._id}`,
                                "batches",
                              )
                            }
                          >
                            Delete
                          </Button>
                        </div>
                      ) : null}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Batch Subjects</CardTitle>
            <p className="text-sm text-slate-500">
              Auto-assigned from the Master Subject List. Use Edit or Remove to
              manage subjects in the master curriculum.
            </p>
          </CardHeader>
          <CardContent className="space-y-4">
            <FormField label="Select Batch">
              <Select
                value={selectedBatchId}
                onChange={(event) => setSelectedBatchId(event.target.value)}
              >
                <option value="">Select batch</option>
                {batches.map((batch) => (
                  <option key={batch._id} value={batch._id}>
                    {batch.name}
                  </option>
                ))}
              </Select>
            </FormField>

            {selectedBatchId ? (
              <div className="space-y-4">
                {(yearsForSelectedBatch.length > 0
                  ? yearsForSelectedBatch
                  : []
                ).map((year) => {
                  const yearSubjects = batchSubjectsByYear.get(year._id) ?? [];

                  return (
                    <div
                      key={year._id}
                      className="rounded-2xl border border-slate-200 p-4"
                    >
                      <h3 className="font-semibold text-slate-900">
                        {year.name}
                      </h3>
                      {yearSubjects.length === 0 ? (
                        <p className="mt-2 text-sm text-slate-500">
                          No subjects assigned yet. Add subjects to the Master
                          Subject List.
                        </p>
                      ) : (
                        <div className="mt-3 overflow-x-auto">
                          <Table>
                            <TableHead>
                              <tr>
                                <Th>Subject</Th>
                                <Th>Marks</Th>
                                <Th>Status</Th>
                                <Th className="text-right">Actions</Th>
                              </tr>
                            </TableHead>
                            <TableBody>
                              {yearSubjects.map((subject) => (
                                <tr key={subject._id}>
                                  <Td>
                                    <div className="font-medium">
                                      {subject.name}
                                    </div>
                                    <div className="text-xs text-slate-500">
                                      {subject.code}
                                    </div>
                                  </Td>
                                  <Td className="text-sm text-slate-600">
                                    Pass {subject.passMarks} / Full{" "}
                                    {subject.fullMarks}
                                  </Td>
                                  <Td>
                                    <Badge
                                      className={
                                        subject.isActive === false
                                          ? "bg-slate-100 text-slate-600"
                                          : undefined
                                      }
                                    >
                                      {subject.isActive === false
                                        ? "Inactive"
                                        : "Active"}
                                    </Badge>
                                  </Td>
                                  <Td className="text-right">
                                    {subject.masterSubjectId ? (
                                      <div className="flex justify-end gap-2">
                                        <Button
                                          size="sm"
                                          variant="outline"
                                          onClick={() =>
                                            setPendingMasterEditId(
                                              subject.masterSubjectId!,
                                            )
                                          }
                                        >
                                          Edit
                                        </Button>
                                        <Button
                                          size="sm"
                                          variant="destructive"
                                          onClick={() =>
                                            void removeMasterSubject(
                                              subject.masterSubjectId!,
                                              subject.name,
                                            )
                                          }
                                        >
                                          Remove
                                        </Button>
                                      </div>
                                    ) : (
                                      <span className="text-xs text-slate-500">
                                        Legacy subject
                                      </span>
                                    )}
                                  </Td>
                                </tr>
                              ))}
                            </TableBody>
                          </Table>
                        </div>
                      )}
                    </div>
                  );
                })}
                {yearsForSelectedBatch.length === 0 ? (
                  <p className="text-sm text-slate-500">
                    Years are auto-created with each batch (
                    {COLLEGE_YEAR_NAMES.join(", ")}).
                  </p>
                ) : null}
              </div>
            ) : (
              <EmptyState
                title="Select a batch"
                description="View the subjects automatically assigned to each year from the master curriculum."
              />
            )}
          </CardContent>
        </Card>
      </div>

      <AcademicPromotionManager />
    </div>
  );
};
