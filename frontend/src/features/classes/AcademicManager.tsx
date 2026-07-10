import { useState } from "react";
import { Link } from "react-router-dom";
import { useIsCollege } from "hooks/useInstitutionType";
import { CollegeAcademicManager } from "./CollegeAcademicManager";
import { useMutation, useQuery } from "@tanstack/react-query";
import {
  CLASS_LEVELS,
  academicSubjectSchema,
  classSchema,
  sectionSchema,
  type AcademicSubjectInput,
  type ClassInput,
  type ClassRecord,
  type SectionInput,
  type SectionRecord,
  type SubjectRecord,
  type TeacherRecord,
} from "@phit-erp/shared";
import { toast } from "sonner";
import { EmptyState } from "components/shared/EmptyState";
import { FormField } from "components/shared/FormField";
import { PageHeader } from "components/shared/PageHeader";
import { Button } from "components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "components/ui/card";
import { Input } from "components/ui/input";
import { NumberInput } from "components/ui/number-input";
import { Select } from "components/ui/select";
import { Table, TableBody, Td, Th, TableHead } from "components/ui/table";
import { api, unwrap } from "lib/api";
import { queryClient } from "lib/queryClient";
import { parseErrorMessage } from "lib/utils";

const defaultClassValue: ClassInput = {
  name: "",
  level: "ECD",
  academicYearBs: "2083/2084",
  coordinatorId: "",
  isActive: true,
};

const defaultSectionValue: SectionInput = {
  name: "",
  classId: "",
  room: "",
  capacity: 40,
  classTeacherId: "",
};

const defaultSubjectValue: AcademicSubjectInput = {
  name: "",
  code: "",
  classIds: [],
  yearIds: [],
};

const SchoolAcademicManager = () => {
  const [classForm, setClassForm] = useState<ClassInput>(defaultClassValue);
  const [sectionForm, setSectionForm] =
    useState<SectionInput>(defaultSectionValue);
  const [subjectForm, setSubjectForm] =
    useState<AcademicSubjectInput>(defaultSubjectValue);
  const [editingClassId, setEditingClassId] = useState<string | null>(null);
  const [editingSectionId, setEditingSectionId] = useState<string | null>(null);
  const [editingSubjectId, setEditingSubjectId] = useState<string | null>(null);

  const classesQuery = useQuery({
    queryKey: ["classes"],
    queryFn: () => unwrap<ClassRecord[]>(api.get("/academics/classes")),
  });
  const sectionsQuery = useQuery({
    queryKey: ["sections"],
    queryFn: () => unwrap<SectionRecord[]>(api.get("/academics/sections")),
  });
  const subjectsQuery = useQuery({
    queryKey: ["subjects"],
    queryFn: () => unwrap<SubjectRecord[]>(api.get("/academics/subjects")),
  });
  const teachersQuery = useQuery({
    queryKey: ["teachers"],
    queryFn: () => unwrap<TeacherRecord[]>(api.get("/teachers")),
  });

  const refreshAcademicQueries = async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ["classes"] }),
      queryClient.invalidateQueries({ queryKey: ["sections"] }),
      queryClient.invalidateQueries({ queryKey: ["subjects"] }),
    ]);
  };

  const classMutation = useMutation({
    mutationFn: async (payload: ClassInput) =>
      editingClassId
        ? unwrap<ClassRecord>(
            api.put(`/academics/classes/${editingClassId}`, payload),
          )
        : unwrap<ClassRecord>(api.post("/academics/classes", payload)),
    onSuccess: async () => {
      toast.success(editingClassId ? "Class updated" : "Class created");
      setClassForm(defaultClassValue);
      setEditingClassId(null);
      await refreshAcademicQueries();
    },
    onError: (error) => toast.error(parseErrorMessage(error)),
  });

  const sectionMutation = useMutation({
    mutationFn: async (payload: SectionInput) =>
      editingSectionId
        ? unwrap<SectionRecord>(
            api.put(`/academics/sections/${editingSectionId}`, payload),
          )
        : unwrap<SectionRecord>(api.post("/academics/sections", payload)),
    onSuccess: async () => {
      toast.success(editingSectionId ? "Section updated" : "Section created");
      setSectionForm(defaultSectionValue);
      setEditingSectionId(null);
      await refreshAcademicQueries();
    },
    onError: (error) => toast.error(parseErrorMessage(error)),
  });

  const subjectMutation = useMutation({
    mutationFn: async (payload: AcademicSubjectInput) =>
      editingSubjectId
        ? unwrap<SubjectRecord>(
            api.put(`/academics/subjects/${editingSubjectId}`, payload),
          )
        : unwrap<SubjectRecord>(api.post("/academics/subjects", payload)),
    onSuccess: async () => {
      toast.success(editingSubjectId ? "Subject updated" : "Subject created");
      setSubjectForm(defaultSubjectValue);
      setEditingSubjectId(null);
      await refreshAcademicQueries();
    },
    onError: (error) => toast.error(parseErrorMessage(error)),
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

  const classes = classesQuery.data ?? [];
  const sections = sectionsQuery.data ?? [];
  const subjects = subjectsQuery.data ?? [];
  const teachers = teachersQuery.data ?? [];

  return (
    <div className="space-y-6">
      <PageHeader
        title="Academic Setup"
        description="Configure classes, sections, and subjects for BS academic years starting from Baisakh."
      />

      <Card>
        <CardContent className="flex flex-wrap items-center justify-between gap-3 py-4">
          <div>
            <p className="font-medium text-slate-900">Subject Assignment</p>
            <p className="text-sm text-slate-600">
              Assign teachers to subjects for class/section with FULL, UNIT, or PERCENTAGE coverage.
            </p>
          </div>
          <Link
            to="/academics/subject-assignments"
            className="inline-flex h-9 items-center rounded-md bg-[var(--brand-primary,#0c2d6b)] px-4 text-sm font-medium text-white hover:opacity-90"
          >
            Open Subject Assignment
          </Link>
        </CardContent>
      </Card>

      <div className="grid gap-6 xl:grid-cols-3">
        <Card>
          <CardHeader>
            <CardTitle>Classes</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <form
              className="space-y-3"
              onSubmit={(event) => {
                event.preventDefault();
                const parsed = classSchema.safeParse(classForm);
                if (!parsed.success) {
                  toast.error(
                    parsed.error.issues[0]?.message ?? "Validation failed",
                  );
                  return;
                }
                void classMutation.mutateAsync(parsed.data);
              }}
            >
              <FormField label="Class Name">
                <Input
                  value={classForm.name}
                  onChange={(event) =>
                    setClassForm((current) => ({
                      ...current,
                      name: event.target.value,
                    }))
                  }
                />
              </FormField>
              <FormField label="Level">
                <Select
                  value={classForm.level}
                  onChange={(event) =>
                    setClassForm((current) => ({
                      ...current,
                      level: event.target.value as ClassInput["level"],
                    }))
                  }
                >
                  {CLASS_LEVELS.map((level) => (
                    <option key={level} value={level}>
                      {level}
                    </option>
                  ))}
                </Select>
              </FormField>
              <FormField label="Academic Year (BS)">
                <Input
                  value={classForm.academicYearBs}
                  onChange={(event) =>
                    setClassForm((current) => ({
                      ...current,
                      academicYearBs: event.target.value,
                    }))
                  }
                />
              </FormField>
              <FormField label="Coordinator">
                <Select
                  value={classForm.coordinatorId ?? ""}
                  onChange={(event) =>
                    setClassForm((current) => ({
                      ...current,
                      coordinatorId: event.target.value,
                    }))
                  }
                >
                  <option value="">Select teacher</option>
                  {teachers.map((teacher) => (
                    <option key={teacher._id} value={teacher._id}>
                      {teacher.user.fullName}
                    </option>
                  ))}
                </Select>
              </FormField>
              <Button className="w-full" type="submit">
                {editingClassId ? "Update Class" : "Create Class"}
              </Button>
            </form>

            {classes.length === 0 ? (
              <EmptyState
                title="No classes"
                description="Create ECD through Class 12 records for the active academic year."
              />
            ) : (
              <div className="space-y-3">
                {classes.map((item) => (
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
                      </div>
                      <div className="flex gap-2">
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => {
                            setEditingClassId(item._id);
                            setClassForm({
                              name: item.name,
                              level: item.level as ClassInput["level"],
                              academicYearBs: item.academicYearBs,
                              coordinatorId: item.coordinatorId ?? "",
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
                              `/academics/classes/${item._id}`,
                              "classes",
                            )
                          }
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
            <CardTitle>Sections</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <form
              className="space-y-3"
              onSubmit={(event) => {
                event.preventDefault();
                const parsed = sectionSchema.safeParse(sectionForm);
                if (!parsed.success) {
                  toast.error(
                    parsed.error.issues[0]?.message ?? "Validation failed",
                  );
                  return;
                }
                void sectionMutation.mutateAsync(parsed.data);
              }}
            >
              <FormField label="Section Name">
                <Input
                  value={sectionForm.name}
                  onChange={(event) =>
                    setSectionForm((current) => ({
                      ...current,
                      name: event.target.value,
                    }))
                  }
                />
              </FormField>
              <FormField label="Class">
                <Select
                  value={sectionForm.classId}
                  onChange={(event) =>
                    setSectionForm((current) => ({
                      ...current,
                      classId: event.target.value,
                    }))
                  }
                >
                  <option value="">Select class</option>
                  {classes.map((item) => (
                    <option key={item._id} value={item._id}>
                      {item.name}
                    </option>
                  ))}
                </Select>
              </FormField>
              <FormField label="Room">
                <Input
                  value={sectionForm.room ?? ""}
                  onChange={(event) =>
                    setSectionForm((current) => ({
                      ...current,
                      room: event.target.value,
                    }))
                  }
                />
              </FormField>
              <FormField label="Capacity">
                <NumberInput
                  value={sectionForm.capacity}
                  onChange={(event) =>
                    setSectionForm((current) => ({
                      ...current,
                      capacity: event.target.valueAsNumber,
                    }))
                  }
                />
              </FormField>
              <FormField label="Class Teacher">
                <Select
                  value={sectionForm.classTeacherId ?? ""}
                  onChange={(event) =>
                    setSectionForm((current) => ({
                      ...current,
                      classTeacherId: event.target.value,
                    }))
                  }
                >
                  <option value="">Select teacher</option>
                  {teachers.map((teacher) => (
                    <option key={teacher._id} value={teacher._id}>
                      {teacher.user.fullName}
                    </option>
                  ))}
                </Select>
              </FormField>
              <Button className="w-full" type="submit">
                {editingSectionId ? "Update Section" : "Create Section"}
              </Button>
            </form>

            <div className="space-y-3">
              {sections.map((section) => (
                <div
                  key={section._id}
                  className="rounded-2xl border border-slate-200 p-4"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <h3 className="font-semibold text-slate-900">
                        {section.name}
                      </h3>
                      <p className="text-sm text-slate-500">
                        {classes.find((item) => item._id === section.classId)
                          ?.name ?? section.classId}{" "}
                        / {section.room || "No room"}
                      </p>
                    </div>
                    <div className="flex gap-2">
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => {
                          setEditingSectionId(section._id);
                          setSectionForm({
                            name: section.name,
                            classId: section.classId,
                            room: section.room ?? "",
                            capacity: section.capacity,
                            classTeacherId: section.classTeacherId ?? "",
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
                            `/academics/sections/${section._id}`,
                            "sections",
                          )
                        }
                      >
                        Delete
                      </Button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
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
                  toast.error(
                    parsed.error.issues[0]?.message ?? "Validation failed",
                  );
                  return;
                }
                void subjectMutation.mutateAsync(parsed.data);
              }}
            >
              <FormField label="Subject Name">
                <Input
                  value={subjectForm.name}
                  onChange={(event) =>
                    setSubjectForm((current) => ({
                      ...current,
                      name: event.target.value,
                    }))
                  }
                />
              </FormField>
              <FormField label="Code">
                <Input
                  value={subjectForm.code}
                  onChange={(event) =>
                    setSubjectForm((current) => ({
                      ...current,
                      code: event.target.value,
                    }))
                  }
                />
              </FormField>
              <FormField label="Class">
                <Select
                  multiple
                  className="h-28"
                  value={subjectForm.classIds}
                  onChange={(event) => {
                    const selected = Array.from(
                      event.target.selectedOptions,
                    ).map((option) => option.value);
                    setSubjectForm((current) => ({
                      ...current,
                      classIds: selected,
                    }));
                  }}
                >
                  {classes.map((item) => (
                    <option key={item._id} value={item._id}>
                      {item.name}
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
                    <Th>Class</Th>
                    <Th />
                  </tr>
                </TableHead>
                <TableBody>
                  {subjects.map((subject) => (
                    <tr key={subject._id}>
                      <Td>
                        <div className="font-medium">{subject.name}</div>
                        <div className="text-xs text-slate-500">
                          {subject.code}
                        </div>
                      </Td>
                      <Td>
                        {subject.classIds
                          .map(
                            (classId) =>
                              classes.find((item) => item._id === classId)
                                ?.name ?? classId,
                          )
                          .join(", ")}
                      </Td>
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
                                classIds: subject.classIds,
                                yearIds: subject.yearIds ?? [],
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
                                `/academics/subjects/${subject._id}`,
                                "subjects",
                              )
                            }
                          >
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

export const AcademicManager = () => {
  const isCollege = useIsCollege();
  return isCollege ? <CollegeAcademicManager /> : <SchoolAcademicManager />;
};
