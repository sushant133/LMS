import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { DAYS_OF_WEEK, timetableSlotSchema, type TimetableSlotInput } from "@nepal-school-erp/shared";
import { toast } from "sonner";
import { useAuth } from "features/auth/AuthProvider";
import { FormField } from "components/shared/FormField";
import { PageHeader } from "components/shared/PageHeader";
import { Button } from "components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "components/ui/card";
import { Input } from "components/ui/input";
import { Select } from "components/ui/select";
import { Table, TableBody, Td, Th, TableHead } from "components/ui/table";
import { useTeacherScope } from "hooks/useTeacherScope";
import { api, unwrap } from "lib/api";
import { queryClient } from "lib/queryClient";
import {
  filterSectionsByClass,
  filterSubjectsByClass,
  hasSingleOption,
  type ScopeOption
} from "lib/teacherScopeUtils";
import { parseErrorMessage } from "lib/utils";

const defaultSlot: TimetableSlotInput = {
  classId: "",
  sectionId: "",
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
  const isAdmin = user?.role === "SCHOOL_ADMIN" || user?.role === "SUPER_ADMIN";
  const teacherScopeQuery = useTeacherScope(isTeacher);

  const [form, setForm] = useState<TimetableSlotInput>(defaultSlot);

  const classesQuery = useQuery({
    queryKey: ["classes"],
    queryFn: () => unwrap<ScopeOption[]>(api.get("/academics/classes")),
    enabled: isAdmin
  });
  const sectionsQuery = useQuery({
    queryKey: ["sections", form.classId],
    queryFn: () =>
      unwrap<ScopeOption[]>(api.get("/academics/sections", { params: { classId: form.classId } })),
    enabled: isAdmin && Boolean(form.classId)
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

  const classes = isTeacher ? (teacherScopeQuery.data?.classes ?? []) : (classesQuery.data ?? []);
  const sections = isTeacher ? (teacherScopeQuery.data?.sections ?? []) : (sectionsQuery.data ?? []);
  const subjects = isTeacher ? (teacherScopeQuery.data?.subjects ?? []) : (subjectsQuery.data ?? []);
  const teacherId = isTeacher ? teacherScopeQuery.data?.scope.teacherId ?? "" : form.teacherId;

  const filteredSections = useMemo(() => filterSectionsByClass(sections, form.classId), [form.classId, sections]);
  const filteredSubjects = useMemo(() => filterSubjectsByClass(subjects, form.classId), [form.classId, subjects]);

  useEffect(() => {
    if (!isTeacher || !teacherScopeQuery.data) {
      return;
    }

    setForm((current) => ({
      ...current,
      teacherId: teacherScopeQuery.data!.scope.teacherId
    }));
  }, [isTeacher, teacherScopeQuery.data]);

  useEffect(() => {
    if (!isTeacher) {
      return;
    }

    if (hasSingleOption(classes) && form.classId !== classes[0]!._id) {
      setForm((current) => ({ ...current, classId: classes[0]!._id, sectionId: "", subjectId: "" }));
    }
  }, [classes, form.classId, isTeacher]);

  useEffect(() => {
    if (!isTeacher || !form.classId) {
      return;
    }

    if (hasSingleOption(filteredSections) && form.sectionId !== filteredSections[0]!._id) {
      setForm((current) => ({ ...current, sectionId: filteredSections[0]!._id, subjectId: "" }));
    }
  }, [filteredSections, form.classId, form.sectionId, isTeacher]);

  useEffect(() => {
    if (!isTeacher || !form.classId) {
      return;
    }

    if (hasSingleOption(filteredSubjects) && form.subjectId !== filteredSubjects[0]!._id) {
      setForm((current) => ({ ...current, subjectId: filteredSubjects[0]!._id }));
    }
  }, [filteredSubjects, form.classId, form.subjectId, isTeacher]);

  const timetableQuery = useQuery({
    queryKey: ["timetable", form.classId, form.sectionId],
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
      >(api.get("/timetable", { params: { classId: form.classId, sectionId: form.sectionId } })),
    enabled: Boolean(form.classId && form.sectionId)
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

  const renderClassField = () => {
    if (isTeacher && hasSingleOption(classes)) {
      return (
        <FormField label="Class">
          <Input value={classes[0]!.name} readOnly disabled />
        </FormField>
      );
    }

    return (
      <FormField label="Class">
        <Select
          value={form.classId}
          onChange={(e) => setForm((c) => ({ ...c, classId: e.target.value, sectionId: "", subjectId: "" }))}
        >
          <option value="">Select class</option>
          {classes.map((item) => (
            <option key={item._id} value={item._id}>
              {item.name}
            </option>
          ))}
        </Select>
      </FormField>
    );
  };

  const renderSectionField = () => {
    if (isTeacher && hasSingleOption(filteredSections)) {
      return (
        <FormField label="Section">
          <Input value={filteredSections[0]!.name} readOnly disabled />
        </FormField>
      );
    }

    return (
      <FormField label="Section">
        <Select
          value={form.sectionId}
          onChange={(e) => setForm((c) => ({ ...c, sectionId: e.target.value, subjectId: "" }))}
          disabled={!form.classId}
        >
          <option value="">Select section</option>
          {filteredSections.map((item) => (
            <option key={item._id} value={item._id}>
              {item.name}
            </option>
          ))}
        </Select>
      </FormField>
    );
  };

  const renderSubjectField = () => {
    if (isTeacher && hasSingleOption(filteredSubjects)) {
      return (
        <FormField label="Subject">
          <Input
            value={
              filteredSubjects[0]!.code
                ? `${filteredSubjects[0]!.name} (${filteredSubjects[0]!.code})`
                : filteredSubjects[0]!.name
            }
            readOnly
            disabled
          />
        </FormField>
      );
    }

    return (
      <FormField label="Subject">
        <Select
          value={form.subjectId}
          onChange={(e) => setForm((c) => ({ ...c, subjectId: e.target.value }))}
          disabled={!form.classId}
        >
          <option value="">Select subject</option>
          {filteredSubjects.map((item) => (
            <option key={item._id} value={item._id}>
              {item.name}
              {item.code ? ` (${item.code})` : ""}
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
        description={
          isTeacher
            ? "Add timetable slots for your assigned classes, sections, and subjects."
            : "Build class-section schedules by day and period."
        }
      />

      <Card>
        <CardHeader>
          <CardTitle>Add slot</CardTitle>
        </CardHeader>
        <CardContent>
          <form className="grid gap-4 md:grid-cols-3" onSubmit={handleSubmit}>
            {renderClassField()}
            {renderSectionField()}
            <FormField label="Day">
              <Select
                value={String(form.dayOfWeek)}
                onChange={(e) =>
                  setForm((c) => ({ ...c, dayOfWeek: Number(e.target.value) as TimetableSlotInput["dayOfWeek"] }))
                }
              >
                {DAYS_OF_WEEK.map((day, index) => (
                  <option key={day} value={index}>
                    {day}
                  </option>
                ))}
              </Select>
            </FormField>
            <FormField label="Period">
              <Input
                type="number"
                min={1}
                value={form.periodNumber}
                onChange={(e) => setForm((c) => ({ ...c, periodNumber: Number(e.target.value) }))}
              />
            </FormField>
            {renderSubjectField()}
            {isAdmin ? (
              <FormField label="Teacher">
                <Select value={form.teacherId} onChange={(e) => setForm((c) => ({ ...c, teacherId: e.target.value }))}>
                  <option value="">Select teacher</option>
                  {(teachersQuery.data ?? []).map((t) => (
                    <option key={t._id} value={t._id}>
                      {t.user.fullName}
                    </option>
                  ))}
                </Select>
              </FormField>
            ) : null}
            <FormField label="Start">
              <Input value={form.startTime} onChange={(e) => setForm((c) => ({ ...c, startTime: e.target.value }))} />
            </FormField>
            <FormField label="End">
              <Input value={form.endTime} onChange={(e) => setForm((c) => ({ ...c, endTime: e.target.value }))} />
            </FormField>
            <FormField label="Room">
              <Input value={form.room} onChange={(e) => setForm((c) => ({ ...c, room: e.target.value }))} />
            </FormField>
            <div className="md:col-span-3">
              <Button type="submit" disabled={isTeacher && teacherScopeQuery.isLoading}>
                Save slot
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Schedule</CardTitle>
        </CardHeader>
        <CardContent>
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
                  <Td>{slot.teacherId?.user?.fullName ?? "—"}</Td>
                  <Td>
                    {slot.startTime} – {slot.endTime}
                  </Td>
                  <Td>{slot.room ?? "—"}</Td>
                </tr>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
};