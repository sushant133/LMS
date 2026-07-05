import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { DAYS_OF_WEEK, isInstitutionAdmin, timetableSlotSchema, type TimetableSlotInput } from "@phit-erp/shared";
import { toast } from "sonner";
import { useAuth } from "features/auth/AuthProvider";
import { FormField } from "components/shared/FormField";
import { PageHeader } from "components/shared/PageHeader";
import { Button } from "components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "components/ui/card";
import { Input } from "components/ui/input";
import { Select } from "components/ui/select";
import { Table, TableBody, Td, Th, TableHead } from "components/ui/table";
import { useIsCollege } from "hooks/useInstitutionType";
import { useTeacherScope } from "hooks/useTeacherScope";
import { getAcademicLabels } from "lib/academicStructureUtils";
import { api, unwrap } from "lib/api";
import { queryClient } from "lib/queryClient";
import {
  filterSectionsByClass,
  filterSubjectsByClass,
  filterSubjectsByYear,
  filterYearsByBatch,
  hasSingleOption,
  type ScopeOption
} from "lib/teacherScopeUtils";
import { parseErrorMessage } from "lib/utils";

const defaultSlot: TimetableSlotInput = {
  classId: "",
  sectionId: "",
  batchId: "",
  yearId: "",
  dayOfWeek: 1,
  periodNumber: 1,
  subjectId: "",
  teacherId: "",
  room: "",
  startTime: "10:00",
  endTime: "10:45",
  academicYearBs: "2083/2084"
};

export const TimetableManager = () => {
  const { user } = useAuth();
  const isTeacher = user?.role === "TEACHER";
  const isAdmin = isInstitutionAdmin(user?.role ?? "");
  const isCollege = useIsCollege();
  const labels = getAcademicLabels(isCollege ? "COLLEGE" : "SCHOOL");
  const teacherScopeQuery = useTeacherScope(isTeacher);

  const [form, setForm] = useState<TimetableSlotInput>(defaultSlot);

  const classesQuery = useQuery({
    queryKey: ["classes"],
    queryFn: () => unwrap<ScopeOption[]>(api.get("/academics/classes")),
    enabled: isAdmin && !isCollege
  });
  const sectionsQuery = useQuery({
    queryKey: ["sections", form.classId],
    queryFn: () => unwrap<ScopeOption[]>(api.get("/academics/sections", { params: { classId: form.classId } })),
    enabled: isAdmin && !isCollege && Boolean(form.classId)
  });
  const batchesQuery = useQuery({
    queryKey: ["batches"],
    queryFn: () => unwrap<ScopeOption[]>(api.get("/academics/batches")),
    enabled: isAdmin && isCollege
  });
  const yearsQuery = useQuery({
    queryKey: ["years", form.batchId],
    queryFn: () => unwrap<ScopeOption[]>(api.get("/academics/years", { params: { batchId: form.batchId } })),
    enabled: isAdmin && isCollege && Boolean(form.batchId)
  });
  const subjectsQuery = useQuery({
    queryKey: ["subjects"],
    queryFn: () => unwrap<ScopeOption[]>(api.get("/academics/subjects")),
    enabled: isAdmin
  });
  const teachersQuery = useQuery({
    queryKey: ["teachers"],
    queryFn: () => unwrap<Array<{ _id: string; user: { fullName: string } }>>(api.get("/teachers")),
    enabled: isAdmin
  });

  const primaryOptions: ScopeOption[] = isCollege
    ? isTeacher
      ? (teacherScopeQuery.data?.batches ?? [])
      : (batchesQuery.data ?? [])
    : isTeacher
      ? (teacherScopeQuery.data?.classes ?? [])
      : (classesQuery.data ?? []);

  const secondaryOptions: ScopeOption[] = isCollege
    ? isTeacher
      ? (teacherScopeQuery.data?.years ?? [])
      : (yearsQuery.data ?? [])
    : isTeacher
      ? (teacherScopeQuery.data?.sections ?? [])
      : (sectionsQuery.data ?? []);

  const subjects = isTeacher ? (teacherScopeQuery.data?.subjects ?? []) : (subjectsQuery.data ?? []);
  const teacherId = isTeacher ? (teacherScopeQuery.data?.scope.teacherId ?? "") : form.teacherId;

  const primaryId = isCollege ? form.batchId ?? "" : form.classId ?? "";
  const secondaryId = isCollege ? form.yearId ?? "" : form.sectionId ?? "";

  const filteredSections = useMemo(() => filterSectionsByClass(secondaryOptions, form.classId ?? ""), [form.classId, secondaryOptions]);
  const filteredYears = useMemo(() => filterYearsByBatch(secondaryOptions, form.batchId ?? ""), [form.batchId, secondaryOptions]);
  const filteredSubjects = useMemo(
    () => (isCollege ? filterSubjectsByYear(subjects, form.yearId ?? "") : filterSubjectsByClass(subjects, form.classId ?? "")),
    [form.classId, form.yearId, isCollege, subjects]
  );

  useEffect(() => {
    if (!isTeacher || !teacherScopeQuery.data) return;
    setForm((current) => ({ ...current, teacherId: teacherScopeQuery.data!.scope.teacherId }));
  }, [isTeacher, teacherScopeQuery.data]);

  useEffect(() => {
    if (!isTeacher || primaryOptions.length !== 1) return;
    const nextId = primaryOptions[0]!._id;
    if (isCollege) {
      if (form.batchId !== nextId) {
        setForm((current) => ({ ...current, batchId: nextId, yearId: "", subjectId: "" }));
      }
    } else if (form.classId !== nextId) {
      setForm((current) => ({ ...current, classId: nextId, sectionId: "", subjectId: "" }));
    }
  }, [form.batchId, form.classId, isCollege, isTeacher, primaryOptions]);

  useEffect(() => {
    if (!isTeacher || !primaryId) return;
    const scopedSecondary = isCollege ? filteredYears : filteredSections;
    if (scopedSecondary.length === 1) {
      const nextId = scopedSecondary[0]!._id;
      if (isCollege) {
        if (form.yearId !== nextId) setForm((current) => ({ ...current, yearId: nextId, subjectId: "" }));
      } else if (form.sectionId !== nextId) {
        setForm((current) => ({ ...current, sectionId: nextId, subjectId: "" }));
      }
    }
  }, [filteredSections, filteredYears, form.sectionId, form.yearId, isCollege, isTeacher, primaryId]);

  useEffect(() => {
    if (!isTeacher || !primaryId || filteredSubjects.length !== 1) return;
    if (form.subjectId !== filteredSubjects[0]!._id) {
      setForm((current) => ({ ...current, subjectId: filteredSubjects[0]!._id }));
    }
  }, [filteredSubjects, form.subjectId, isTeacher, primaryId]);

  const timetableQuery = useQuery({
    queryKey: ["timetable", form.classId, form.sectionId, form.batchId, form.yearId],
    queryFn: () =>
      unwrap<
        Array<{
          _id: string;
          dayOfWeek: number;
          periodNumber: number;
          subjectId?: { name: string };
          teacherId?: { user: { fullName: string } };
          startTime: string;
          endTime: string;
          room?: string;
        }>
      >(
        api.get(
          "/timetable",
          isCollege
            ? { params: { batchId: form.batchId, yearId: form.yearId } }
            : { params: { classId: form.classId, sectionId: form.sectionId } }
        )
      ),
    enabled: Boolean(primaryId && secondaryId)
  });

  const saveMutation = useMutation({
    mutationFn: (payload: TimetableSlotInput) => unwrap(api.post("/timetable", payload)),
    onSuccess: async () => {
      toast.success("Timetable slot saved");
      await queryClient.invalidateQueries({ queryKey: ["timetable"] });
    },
    onError: (error) => toast.error(parseErrorMessage(error))
  });

  const handleSubmit = (event: React.FormEvent) => {
    event.preventDefault();
    const payload = isTeacher ? { ...form, teacherId } : form;
    const parsed = timetableSlotSchema.safeParse(payload);
    if (!parsed.success) {
      toast.error(parsed.error.issues[0]?.message ?? "Validation failed");
      return;
    }
    saveMutation.mutate(parsed.data);
  };

  const renderPrimaryField = () => {
    if (isTeacher && hasSingleOption(primaryOptions)) {
      return (
        <FormField label={labels.primary}>
          <Input value={primaryOptions[0]!.name} readOnly disabled />
        </FormField>
      );
    }

    return (
      <FormField label={labels.primary}>
        <Select
          value={primaryId}
          onChange={(e) =>
            setForm((c) =>
              isCollege
                ? { ...c, batchId: e.target.value, yearId: "", subjectId: "" }
                : { ...c, classId: e.target.value, sectionId: "", subjectId: "" }
            )
          }
        >
          <option value="">Select {labels.primary.toLowerCase()}</option>
          {primaryOptions.map((item) => (
            <option key={item._id} value={item._id}>
              {item.name}
            </option>
          ))}
        </Select>
      </FormField>
    );
  };

  const renderSecondaryField = () => {
    const scopedSecondary = isCollege ? filteredYears : filteredSections;

    if (isTeacher && hasSingleOption(scopedSecondary)) {
      return (
        <FormField label={labels.secondary}>
          <Input value={scopedSecondary[0]!.name} readOnly disabled />
        </FormField>
      );
    }

    return (
      <FormField label={labels.secondary}>
        <Select
          value={secondaryId}
          onChange={(e) =>
            setForm((c) =>
              isCollege ? { ...c, yearId: e.target.value, subjectId: "" } : { ...c, sectionId: e.target.value, subjectId: "" }
            )
          }
          disabled={!primaryId}
        >
          <option value="">Select {labels.secondary.toLowerCase()}</option>
          {scopedSecondary.map((item) => (
            <option key={item._id} value={item._id}>
              {item.name}
            </option>
          ))}
        </Select>
      </FormField>
    );
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title="Timetable"
        description={`Create and view period schedules by ${labels.primary.toLowerCase()} and ${labels.secondary.toLowerCase()}.`}
      />

      <Card>
        <CardHeader>
          <CardTitle>Add Timetable Slot</CardTitle>
        </CardHeader>
        <CardContent>
          <form className="grid gap-4 md:grid-cols-2 xl:grid-cols-4" onSubmit={handleSubmit}>
            {renderPrimaryField()}
            {renderSecondaryField()}
            <FormField label="Subject">
              <Select
                value={form.subjectId}
                onChange={(e) => setForm((c) => ({ ...c, subjectId: e.target.value }))}
                disabled={!primaryId}
              >
                <option value="">Select subject</option>
                {filteredSubjects.map((item) => (
                  <option key={item._id} value={item._id}>
                    {item.name}
                  </option>
                ))}
              </Select>
            </FormField>
            {isAdmin ? (
              <FormField label="Teacher">
                <Select value={form.teacherId} onChange={(e) => setForm((c) => ({ ...c, teacherId: e.target.value }))}>
                  <option value="">Select teacher</option>
                  {(teachersQuery.data ?? []).map((teacher) => (
                    <option key={teacher._id} value={teacher._id}>
                      {teacher.user.fullName}
                    </option>
                  ))}
                </Select>
              </FormField>
            ) : null}
            <FormField label="Day">
              <Select value={form.dayOfWeek} onChange={(e) => setForm((c) => ({ ...c, dayOfWeek: Number(e.target.value) }))}>
                {DAYS_OF_WEEK.map((day, index) => (
                  <option key={day} value={index}>
                    {day}
                  </option>
                ))}
              </Select>
            </FormField>
            <FormField label="Period">
              <Input type="number" value={form.periodNumber} onChange={(e) => setForm((c) => ({ ...c, periodNumber: e.target.valueAsNumber }))} />
            </FormField>
            <FormField label="Start Time">
              <Input value={form.startTime} onChange={(e) => setForm((c) => ({ ...c, startTime: e.target.value }))} />
            </FormField>
            <FormField label="End Time">
              <Input value={form.endTime} onChange={(e) => setForm((c) => ({ ...c, endTime: e.target.value }))} />
            </FormField>
            <FormField label="Room">
              <Input value={form.room ?? ""} onChange={(e) => setForm((c) => ({ ...c, room: e.target.value }))} />
            </FormField>
            <FormField label="Academic Year (BS)">
              <Input value={form.academicYearBs} onChange={(e) => setForm((c) => ({ ...c, academicYearBs: e.target.value }))} />
            </FormField>
            <div className="md:col-span-2 xl:col-span-4 flex justify-end">
              <Button type="submit" disabled={saveMutation.isPending}>
                Save Slot
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Weekly Schedule</CardTitle>
        </CardHeader>
        <CardContent>
          {!primaryId || !secondaryId ? (
            <p className="text-sm text-slate-500">Select {labels.primary.toLowerCase()} and {labels.secondary.toLowerCase()} to view the timetable.</p>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHead>
                  <tr>
                    <Th>Day</Th>
                    <Th>Period</Th>
                    <Th>Subject</Th>
                    <Th>Teacher</Th>
                    <Th>Time</Th>
                    <Th>Room</Th>
                  </tr>
                </TableHead>
                <TableBody>
                  {(timetableQuery.data ?? []).map((slot) => (
                    <tr key={slot._id}>
                      <Td>{DAYS_OF_WEEK[slot.dayOfWeek]}</Td>
                      <Td>{slot.periodNumber}</Td>
                      <Td>{slot.subjectId?.name ?? "—"}</Td>
                      <Td>{slot.teacherId?.user.fullName ?? "—"}</Td>
                      <Td>
                        {slot.startTime} - {slot.endTime}
                      </Td>
                      <Td>{slot.room ?? "—"}</Td>
                    </tr>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
};