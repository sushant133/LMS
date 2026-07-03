import { useMemo, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import {
  COLLEGE_YEAR_NAMES,
  academicSubjectSchema,
  batchSchema,
  type AcademicSubjectInput,
  type BatchInput,
  type BatchRecord,
  type SubjectRecord,
  type YearRecord
} from "@nepal-school-erp/shared";
import { toast } from "sonner";
import { EmptyState } from "components/shared/EmptyState";
import { FormField } from "components/shared/FormField";
import { PageHeader } from "components/shared/PageHeader";
import { Button } from "components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "components/ui/card";
import { Input } from "components/ui/input";
import { Select } from "components/ui/select";
import { Table, TableBody, Td, Th, TableHead } from "components/ui/table";
import { api, unwrap } from "lib/api";
import { filterYearsByBatch } from "lib/academicStructureUtils";
import { queryClient } from "lib/queryClient";
import { parseErrorMessage } from "lib/utils";

const defaultBatchValue: BatchInput = {
  name: "",
  academicYearBs: "2083/2084",
  isActive: true
};

const defaultSubjectValue: AcademicSubjectInput = {
  name: "",
  code: "",
  classIds: [],
  yearIds: []
};

export const CollegeAcademicManager = () => {
  const [batchForm, setBatchForm] = useState<BatchInput>(defaultBatchValue);
  const [subjectForm, setSubjectForm] = useState<AcademicSubjectInput>(defaultSubjectValue);
  const [selectedBatchId, setSelectedBatchId] = useState("");
  const [editingBatchId, setEditingBatchId] = useState<string | null>(null);
  const [editingSubjectId, setEditingSubjectId] = useState<string | null>(null);

  const batchesQuery = useQuery({
    queryKey: ["batches"],
    queryFn: () => unwrap<BatchRecord[]>(api.get("/academics/batches"))
  });
  const yearsQuery = useQuery({
    queryKey: ["years"],
    queryFn: () => unwrap<YearRecord[]>(api.get("/academics/years"))
  });
  const subjectsQuery = useQuery({
    queryKey: ["subjects"],
    queryFn: () => unwrap<SubjectRecord[]>(api.get("/academics/subjects"))
  });
  const refreshAcademicQueries = async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ["batches"] }),
      queryClient.invalidateQueries({ queryKey: ["years"] }),
      queryClient.invalidateQueries({ queryKey: ["subjects"] })
    ]);
  };

  const batchMutation = useMutation({
    mutationFn: async (payload: BatchInput) =>
      editingBatchId
        ? unwrap<BatchRecord>(api.put(`/academics/batches/${editingBatchId}`, payload))
        : unwrap<BatchRecord>(api.post("/academics/batches", payload)),
    onSuccess: async () => {
      toast.success(editingBatchId ? "Batch updated" : "Batch created with 1st–3rd Year");
      setBatchForm(defaultBatchValue);
      setEditingBatchId(null);
      await refreshAcademicQueries();
    },
    onError: (error) => toast.error(parseErrorMessage(error))
  });

  const subjectMutation = useMutation({
    mutationFn: async (payload: AcademicSubjectInput) =>
      editingSubjectId
        ? unwrap<SubjectRecord>(api.put(`/academics/subjects/${editingSubjectId}`, payload))
        : unwrap<SubjectRecord>(api.post("/academics/subjects", payload)),
    onSuccess: async () => {
      toast.success(editingSubjectId ? "Subject updated" : "Subject created");
      setSubjectForm(defaultSubjectValue);
      setEditingSubjectId(null);
      await refreshAcademicQueries();
    },
    onError: (error) => toast.error(parseErrorMessage(error))
  });

  const deleteEntity = async (path: string, queryKey: string) => {
    try {
      await api.delete(path);
      toast.success("Deleted successfully");
      await queryClient.invalidateQueries({ queryKey: [queryKey] });
    } catch (error) {
      toast.error(parseErrorMessage(error));
    }
  };

  const batches = batchesQuery.data ?? [];
  const years = yearsQuery.data ?? [];
  const subjects = subjectsQuery.data ?? [];
  const yearsForSelectedBatch = useMemo(
    () => filterYearsByBatch(years, selectedBatchId),
    [years, selectedBatchId]
  );

  const yearsByBatch = useMemo(() => {
    const map = new Map<string, YearRecord[]>();
    for (const batch of batches) {
      map.set(batch._id, years.filter((year) => year.batchId === batch._id).sort((a, b) => a.level - b.level));
    }
    return map;
  }, [batches, years]);

  const yearNameById = useMemo(() => new Map(years.map((year) => [year._id, year.name])), [years]);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Academic Setup"
        description="Configure batches, years, and year-wise subjects for Diploma/Health Assistant programs."
      />

      <div className="grid gap-6 xl:grid-cols-3">
        <Card>
          <CardHeader>
            <CardTitle>Batches</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <form
              className="space-y-3"
              onSubmit={(event) => {
                event.preventDefault();
                const parsed = batchSchema.safeParse(batchForm);
                if (!parsed.success) {
                  toast.error(parsed.error.issues[0]?.message ?? "Validation failed");
                  return;
                }
                void batchMutation.mutateAsync(parsed.data);
              }}
            >
              <FormField label="Batch Name">
                <Input
                  placeholder="e.g. Batch 2082, Batch A"
                  value={batchForm.name}
                  onChange={(event) => setBatchForm((current) => ({ ...current, name: event.target.value }))}
                />
              </FormField>
              <FormField label="Academic Year (BS)">
                <Input
                  value={batchForm.academicYearBs}
                  onChange={(event) => setBatchForm((current) => ({ ...current, academicYearBs: event.target.value }))}
                />
              </FormField>
              <Button className="w-full" type="submit">
                {editingBatchId ? "Update Batch" : "Create Batch"}
              </Button>
            </form>

            {batches.length === 0 ? (
              <EmptyState
                title="No batches"
                description="Create a batch to automatically provision 1st, 2nd, and 3rd Year groups."
              />
            ) : (
              <div className="space-y-3">
                {batches.map((item) => (
                  <div key={item._id} className="rounded-2xl border border-slate-200 p-4">
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <h3 className="font-semibold text-slate-900">{item.name}</h3>
                        <p className="text-sm text-slate-500">{item.academicYearBs}</p>
                        <ul className="mt-2 space-y-1 text-sm text-slate-600">
                          {(yearsByBatch.get(item._id) ?? []).map((year) => (
                            <li key={year._id}>• {year.name}</li>
                          ))}
                        </ul>
                      </div>
                      <div className="flex gap-2">
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => {
                            setEditingBatchId(item._id);
                            setBatchForm({
                              name: item.name,
                              academicYearBs: item.academicYearBs,
                              isActive: item.isActive
                            });
                          }}
                        >
                          Edit
                        </Button>
                        <Button
                          size="sm"
                          variant="destructive"
                          onClick={() => void deleteEntity(`/academics/batches/${item._id}`, "batches")}
                        >
                          Delete
                        </Button>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Years</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <FormField label="Select Batch">
              <Select value={selectedBatchId} onChange={(event) => setSelectedBatchId(event.target.value)}>
                <option value="">Select batch</option>
                {batches.map((batch) => (
                  <option key={batch._id} value={batch._id}>
                    {batch.name}
                  </option>
                ))}
              </Select>
            </FormField>

            {selectedBatchId ? (
              <div className="space-y-3">
                {(yearsForSelectedBatch.length > 0 ? yearsForSelectedBatch : COLLEGE_YEAR_NAMES.map((name, index) => ({ name, level: index + 1 }))).map(
                  (year) => (
                    <div key={"_id" in year ? year._id : year.name} className="rounded-2xl border border-slate-200 p-4">
                      <h3 className="font-semibold text-slate-900">{year.name}</h3>
                      <p className="text-sm text-slate-500">Auto-created with each batch</p>
                    </div>
                  )
                )}
              </div>
            ) : (
              <EmptyState title="Select a batch" description="Years are automatically created when you add a batch." />
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Subjects</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <form
              className="space-y-3"
              onSubmit={(event) => {
                event.preventDefault();
                const parsed = academicSubjectSchema.safeParse(subjectForm);
                if (!parsed.success) {
                  toast.error(parsed.error.issues[0]?.message ?? "Validation failed");
                  return;
                }
                void subjectMutation.mutateAsync(parsed.data);
              }}
            >
              <FormField label="Subject Name">
                <Input value={subjectForm.name} onChange={(event) => setSubjectForm((current) => ({ ...current, name: event.target.value }))} />
              </FormField>
              <FormField label="Code">
                <Input value={subjectForm.code} onChange={(event) => setSubjectForm((current) => ({ ...current, code: event.target.value }))} />
              </FormField>
              <FormField label="Year">
                <Select
                  value={subjectForm.yearIds[0] ?? ""}
                  onChange={(event) =>
                    setSubjectForm((current) => ({
                      ...current,
                      yearIds: event.target.value ? [event.target.value] : []
                    }))
                  }
                >
                  <option value="">Select year</option>
                  {years.map((year) => (
                    <option key={year._id} value={year._id}>
                      {batches.find((batch) => batch._id === year.batchId)?.name ?? "Batch"} — {year.name}
                    </option>
                  ))}
                </Select>
              </FormField>
              <Button className="w-full" type="submit">
                {editingSubjectId ? "Update Subject" : "Create Subject"}
              </Button>
            </form>

            <div className="overflow-x-auto">
              <Table>
                <TableHead>
                  <tr>
                    <Th>Subject</Th>
                    <Th>Year</Th>
                    <Th />
                  </tr>
                </TableHead>
                <TableBody>
                  {subjects.map((subject) => (
                    <tr key={subject._id}>
                      <Td>
                        <div className="font-medium">{subject.name}</div>
                        <div className="text-xs text-slate-500">{subject.code}</div>
                      </Td>
                      <Td>{subject.yearIds.map((yearId) => yearNameById.get(yearId) ?? yearId).join(", ")}</Td>
                      <Td className="text-right">
                        <div className="flex justify-end gap-2">
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => {
                              setEditingSubjectId(subject._id);
                              setSubjectForm({
                                name: subject.name,
                                code: subject.code,
                                classIds: [],
                                yearIds: subject.yearIds ?? []
                              });
                            }}
                          >
                            Edit
                          </Button>
                          <Button size="sm" variant="destructive" onClick={() => void deleteEntity(`/academics/subjects/${subject._id}`, "subjects")}>
                            Delete
                          </Button>
                        </div>
                      </Td>
                    </tr>
                  ))}
                </TableBody>
              </Table>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
};