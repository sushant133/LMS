import { useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import {
  COLLEGE_YEAR_NAMES,
  masterSubjectSchema,
  type MasterSubjectInput,
  type MasterSubjectRecord
} from "@nepal-school-erp/shared";
import { toast } from "sonner";
import { EmptyState } from "components/shared/EmptyState";
import { FormField } from "components/shared/FormField";
import { Badge } from "components/ui/badge";
import { Button } from "components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "components/ui/card";
import { Input } from "components/ui/input";
import { Select } from "components/ui/select";
import { Table, TableBody, Td, Th, TableHead } from "components/ui/table";
import { api, unwrap } from "lib/api";
import { queryClient } from "lib/queryClient";
import { parseErrorMessage } from "lib/utils";

const defaultMasterSubjectValue: MasterSubjectInput = {
  name: "",
  code: "",
  yearLevel: 1,
  creditHours: undefined,
  theoryMarks: 70,
  practicalMarks: 30,
  internalMarks: undefined,
  passMarks: 35,
  fullMarks: 100,
  isActive: true
};

interface MasterSubjectManagerProps {
  pendingEditId?: string | null;
  onPendingEditHandled?: () => void;
}

export const MasterSubjectManager = ({ pendingEditId, onPendingEditHandled }: MasterSubjectManagerProps) => {
  const formRef = useRef<HTMLDivElement>(null);
  const [form, setForm] = useState<MasterSubjectInput>(defaultMasterSubjectValue);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);

  const masterSubjectsQuery = useQuery({
    queryKey: ["master-subjects"],
    queryFn: () => unwrap<MasterSubjectRecord[]>(api.get("/academics/master-subjects"))
  });

  const refreshQueries = async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ["master-subjects"] }),
      queryClient.invalidateQueries({ queryKey: ["subjects"] })
    ]);
  };

  const mutation = useMutation({
    mutationFn: async (payload: MasterSubjectInput) =>
      editingId
        ? unwrap<MasterSubjectRecord>(api.put(`/academics/master-subjects/${editingId}`, payload))
        : unwrap<MasterSubjectRecord>(api.post("/academics/master-subjects", payload)),
    onSuccess: async () => {
      toast.success(
        editingId
          ? "Master subject updated across all batches"
          : "Master subject created and assigned to all batches"
      );
      setForm(defaultMasterSubjectValue);
      setEditingId(null);
      setShowForm(false);
      await refreshQueries();
    },
    onError: (error) => toast.error(parseErrorMessage(error))
  });

  const reconcileCurriculum = async () => {
    try {
      const result = await unwrap<{
        masterSubjectsCreated: number;
        subjectsLinked: number;
        batchesProcessed: number;
      }>(api.post("/academics/master-subjects/reconcile"));
      toast.success("Curriculum synced across all batches", {
        description: `${result.batchesProcessed} batch(es) processed`
      });
      await refreshQueries();
    } catch (error) {
      toast.error(parseErrorMessage(error));
    }
  };

  const startEditing = (subject: MasterSubjectRecord) => {
    setEditingId(subject._id);
    setShowForm(true);
    setForm({
      name: subject.name,
      code: subject.code,
      yearLevel: subject.yearLevel,
      creditHours: subject.creditHours,
      theoryMarks: subject.theoryMarks,
      practicalMarks: subject.practicalMarks,
      internalMarks: subject.internalMarks,
      passMarks: subject.passMarks,
      fullMarks: subject.fullMarks,
      isActive: subject.isActive
    });
    formRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  const deleteMasterSubject = async (subject: MasterSubjectRecord) => {
    const confirmed = window.confirm(
      `Remove "${subject.name}" from the master curriculum?\n\nThis deletes the subject from all batches if it is not in use. Subjects used in attendance, exams, or results cannot be deleted — deactivate them instead.`
    );
    if (!confirmed) {
      return;
    }

    try {
      await api.delete(`/academics/master-subjects/${subject._id}`);
      toast.success("Master subject removed");
      if (editingId === subject._id) {
        resetForm();
      }
      await refreshQueries();
    } catch (error) {
      toast.error(parseErrorMessage(error));
    }
  };

  const toggleSubjectStatus = async (subject: MasterSubjectRecord) => {
    try {
      await unwrap<MasterSubjectRecord>(
        api.put(`/academics/master-subjects/${subject._id}`, {
          name: subject.name,
          code: subject.code,
          yearLevel: subject.yearLevel,
          creditHours: subject.creditHours,
          theoryMarks: subject.theoryMarks,
          practicalMarks: subject.practicalMarks,
          internalMarks: subject.internalMarks,
          passMarks: subject.passMarks,
          fullMarks: subject.fullMarks,
          isActive: !subject.isActive
        })
      );
      toast.success(subject.isActive ? "Subject deactivated" : "Subject activated");
      await refreshQueries();
    } catch (error) {
      toast.error(parseErrorMessage(error));
    }
  };

  const masterSubjects = masterSubjectsQuery.data ?? [];

  useEffect(() => {
    if (!pendingEditId || !masterSubjects.length) {
      return;
    }

    const subject = masterSubjects.find((item) => item._id === pendingEditId);
    if (subject) {
      startEditing(subject);
    }
    onPendingEditHandled?.();
  }, [pendingEditId, masterSubjects]);

  const subjectsByYear = useMemo(() => {
    const grouped = new Map<number, MasterSubjectRecord[]>();
    for (const level of [1, 2, 3]) {
      grouped.set(
        level,
        masterSubjects.filter((subject) => subject.yearLevel === level).sort((a, b) => a.name.localeCompare(b.name))
      );
    }
    return grouped;
  }, [masterSubjects]);

  const resetForm = () => {
    setEditingId(null);
    setShowForm(false);
    setForm(defaultMasterSubjectValue);
  };

  const editingSubject = editingId ? masterSubjects.find((subject) => subject._id === editingId) : null;

  return (
    <Card>
      <CardHeader className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <CardTitle>Master Subject List</CardTitle>
          <p className="text-sm text-slate-500">
            Define the fixed HA curriculum once. Subjects are organized by year and automatically assigned to every batch.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button
            type="button"
            onClick={() => {
              setEditingId(null);
              setForm(defaultMasterSubjectValue);
              setShowForm(true);
              requestAnimationFrame(() => {
                formRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
              });
            }}
          >
            Add Subject
          </Button>
          <Button type="button" variant="outline" onClick={() => void reconcileCurriculum()}>
            Sync All Batches
          </Button>
        </div>
      </CardHeader>
      <CardContent className="space-y-6">
        {showForm ? (
          <div ref={formRef} className="rounded-2xl border border-emerald-200 bg-emerald-50/40 p-4">
            {editingSubject ? (
              <p className="mb-4 text-sm font-medium text-emerald-900">
                Editing: {editingSubject.name} ({editingSubject.code}) — changes apply to all batches
              </p>
            ) : (
              <p className="mb-4 text-sm text-slate-600">Add a new subject to the master curriculum.</p>
            )}
            <form
              className="grid gap-3 md:grid-cols-2 xl:grid-cols-4"
              onSubmit={(event) => {
            event.preventDefault();
            const parsed = masterSubjectSchema.safeParse(form);
            if (!parsed.success) {
              toast.error(parsed.error.issues[0]?.message ?? "Validation failed");
              return;
            }
            void mutation.mutateAsync(parsed.data);
          }}
        >
          <FormField label="Subject Name">
            <Input value={form.name} onChange={(event) => setForm((current) => ({ ...current, name: event.target.value }))} />
          </FormField>
          <FormField label="Subject Code">
            <Input value={form.code} onChange={(event) => setForm((current) => ({ ...current, code: event.target.value }))} />
          </FormField>
          <FormField label="Year">
            <Select
              value={String(form.yearLevel)}
              onChange={(event) => setForm((current) => ({ ...current, yearLevel: Number(event.target.value) }))}
            >
              {COLLEGE_YEAR_NAMES.map((name, index) => (
                <option key={name} value={index + 1}>
                  {name}
                </option>
              ))}
            </Select>
          </FormField>
          <FormField label="Credit Hours (Optional)">
            <Input
              type="number"
              min={0}
              value={form.creditHours ?? ""}
              onChange={(event) =>
                setForm((current) => ({
                  ...current,
                  creditHours: Number.isNaN(event.target.valueAsNumber) ? undefined : event.target.valueAsNumber
                }))
              }
            />
          </FormField>
          <FormField label="Theory Marks">
            <Input
              type="number"
              min={0}
              value={form.theoryMarks}
              onChange={(event) => setForm((current) => ({ ...current, theoryMarks: event.target.valueAsNumber }))}
            />
          </FormField>
          <FormField label="Practical Marks (Optional)">
            <Input
              type="number"
              min={0}
              value={form.practicalMarks ?? ""}
              onChange={(event) =>
                setForm((current) => ({
                  ...current,
                  practicalMarks: Number.isNaN(event.target.valueAsNumber) ? undefined : event.target.valueAsNumber
                }))
              }
            />
          </FormField>
          <FormField label="Internal Marks (Optional)">
            <Input
              type="number"
              min={0}
              value={form.internalMarks ?? ""}
              onChange={(event) =>
                setForm((current) => ({
                  ...current,
                  internalMarks: Number.isNaN(event.target.valueAsNumber) ? undefined : event.target.valueAsNumber
                }))
              }
            />
          </FormField>
          <FormField label="Pass Marks">
            <Input
              type="number"
              min={0}
              value={form.passMarks}
              onChange={(event) => setForm((current) => ({ ...current, passMarks: event.target.valueAsNumber }))}
            />
          </FormField>
          <FormField label="Full Marks">
            <Input
              type="number"
              min={1}
              value={form.fullMarks}
              onChange={(event) => setForm((current) => ({ ...current, fullMarks: event.target.valueAsNumber }))}
            />
          </FormField>
          <FormField label="Status">
            <Select
              value={form.isActive ? "active" : "inactive"}
              onChange={(event) => setForm((current) => ({ ...current, isActive: event.target.value === "active" }))}
            >
              <option value="active">Active</option>
              <option value="inactive">Inactive</option>
            </Select>
          </FormField>
          <div className="flex items-end gap-2 md:col-span-2 xl:col-span-4">
            <Button type="submit">{editingId ? "Update Master Subject" : "Add Master Subject"}</Button>
            <Button type="button" variant="outline" onClick={resetForm}>
              Cancel
            </Button>
          </div>
            </form>
          </div>
        ) : null}

        {masterSubjects.length === 0 ? (
          <EmptyState
            title="No master subjects"
            description="Add subjects for each year level. They will be assigned automatically when you create a batch."
          />
        ) : (
          <div className="space-y-6">
            {COLLEGE_YEAR_NAMES.map((yearName, index) => {
              const yearLevel = index + 1;
              const yearSubjects = subjectsByYear.get(yearLevel) ?? [];

              return (
                <div key={yearName} className="space-y-3">
                  <h3 className="text-sm font-semibold uppercase tracking-wide text-slate-500">{yearName}</h3>
                  <div className="overflow-x-auto rounded-2xl border border-slate-200">
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
                        {yearSubjects.length === 0 ? (
                          <tr>
                            <Td colSpan={4} className="text-center text-sm text-slate-500">
                              No subjects for {yearName}
                            </Td>
                          </tr>
                        ) : (
                          yearSubjects.map((subject) => (
                            <tr
                              key={subject._id}
                              className={editingId === subject._id ? "bg-emerald-50/60" : undefined}
                            >
                              <Td>
                                <div className="font-medium">{subject.name}</div>
                                <div className="text-xs text-slate-500">{subject.code}</div>
                                {subject.creditHours ? (
                                  <div className="text-xs text-slate-500">{subject.creditHours} credit hours</div>
                                ) : null}
                              </Td>
                              <Td className="text-sm text-slate-600">
                                <div>Theory: {subject.theoryMarks}</div>
                                {subject.practicalMarks != null ? <div>Practical: {subject.practicalMarks}</div> : null}
                                {subject.internalMarks != null ? <div>Internal: {subject.internalMarks}</div> : null}
                                <div>
                                  Pass {subject.passMarks} / Full {subject.fullMarks}
                                </div>
                              </Td>
                              <Td>
                                <Badge className={subject.isActive ? undefined : "bg-slate-100 text-slate-600"}>
                                  {subject.isActive ? "Active" : "Inactive"}
                                </Badge>
                              </Td>
                              <Td className="text-right">
                                <div className="flex flex-wrap justify-end gap-2">
                                  <Button size="sm" variant="outline" onClick={() => startEditing(subject)}>
                                    Edit
                                  </Button>
                                  <Button
                                    size="sm"
                                    variant="outline"
                                    onClick={() => void toggleSubjectStatus(subject)}
                                  >
                                    {subject.isActive ? "Deactivate" : "Activate"}
                                  </Button>
                                  <Button
                                    size="sm"
                                    variant="destructive"
                                    onClick={() => void deleteMasterSubject(subject)}
                                  >
                                    Remove
                                  </Button>
                                </div>
                              </Td>
                            </tr>
                          ))
                        )}
                      </TableBody>
                    </Table>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </CardContent>
    </Card>
  );
};