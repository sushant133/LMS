import { useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import type { CreateSchoolInput, SchoolInput, SchoolRecord } from "@nepal-school-erp/shared";
import { createSchoolSchema, schoolSchema } from "@nepal-school-erp/shared";
import { toast } from "sonner";
import { AddressFields } from "components/shared/AddressFields";
import { FormField } from "components/shared/FormField";
import { PageHeader } from "components/shared/PageHeader";
import { Button } from "components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "components/ui/card";
import { Input } from "components/ui/input";
import { Select } from "components/ui/select";
import { Table, TableBody, Td, Th, TableHead } from "components/ui/table";
import { api, unwrap } from "lib/api";
import { queryClient } from "lib/queryClient";
import { parseErrorMessage } from "lib/utils";

const schoolToForm = (school: SchoolRecord): SchoolInput => ({
  name: school.name,
  nameNp: school.nameNp,
  code: school.code,
  email: school.email,
  phone: school.phone,
  principalName: school.principalName,
  academicYearBs: school.academicYearBs,
  address: school.address,
  isActive: school.isActive
});

const defaultSchoolValue: CreateSchoolInput = {
  name: "",
  nameNp: "",
  code: "",
  email: "",
  phone: "",
  principalName: "",
  academicYearBs: "2083/2084",
  address: {
    province: "",
    district: "",
    municipality: "",
    ward: "",
    streetAddress: ""
  },
  isActive: true,
  adminFullName: "",
  adminEmail: "",
  adminPhone: ""
};

export const SchoolManager = () => {
  const [form, setForm] = useState<CreateSchoolInput>(defaultSchoolValue);
  const [editingSchoolId, setEditingSchoolId] = useState<string | null>(null);
  const schoolsQuery = useQuery({
    queryKey: ["schools"],
    queryFn: () => unwrap<SchoolRecord[]>(api.get("/schools"))
  });

  const createMutation = useMutation({
    mutationFn: async (payload: CreateSchoolInput) => unwrap(api.post("/schools", payload)),
    onSuccess: async () => {
      toast.success("School created successfully");
      setForm(defaultSchoolValue);
      await queryClient.invalidateQueries({ queryKey: ["schools"] });
      await queryClient.invalidateQueries({ queryKey: ["auth", "me"] });
    },
    onError: (error) => toast.error(parseErrorMessage(error))
  });

  const updateMutation = useMutation({
    mutationFn: async ({ schoolId, payload }: { schoolId: string; payload: SchoolInput }) => unwrap(api.put(`/schools/${schoolId}`, payload)),
    onSuccess: async () => {
      toast.success("School updated successfully");
      setEditingSchoolId(null);
      setForm(defaultSchoolValue);
      await queryClient.invalidateQueries({ queryKey: ["schools"] });
      await queryClient.invalidateQueries({ queryKey: ["auth", "me"] });
    },
    onError: (error) => toast.error(parseErrorMessage(error))
  });

  const deleteMutation = useMutation({
    mutationFn: async (schoolId: string) => unwrap(api.delete(`/schools/${schoolId}`)),
    onSuccess: async () => {
      toast.success("School and all associated data deleted");
      await queryClient.invalidateQueries({ queryKey: ["schools"] });
      await queryClient.invalidateQueries({ queryKey: ["auth", "me"] });
    },
    onError: (error) => toast.error(parseErrorMessage(error))
  });

  return (
    <div className="space-y-6">
      <PageHeader title="School Directory" description="Create, edit, and manage tenant schools. Each school gets isolated data and an initial school admin account." />

      <Card>
        <CardHeader>
          <CardTitle>{editingSchoolId ? "Edit School" : "Create School"}</CardTitle>
        </CardHeader>
        <CardContent>
          <form
            className="space-y-4"
            onSubmit={(event) => {
              event.preventDefault();

              if (editingSchoolId) {
                const parsed = schoolSchema.safeParse(form);
                if (!parsed.success) {
                  toast.error(parsed.error.issues[0]?.message ?? "Validation failed");
                  return;
                }
                void updateMutation.mutateAsync({ schoolId: editingSchoolId, payload: parsed.data });
                return;
              }

              const parsed = createSchoolSchema.safeParse(form);
              if (!parsed.success) {
                toast.error(parsed.error.issues[0]?.message ?? "Validation failed");
                return;
              }
              void createMutation.mutateAsync(parsed.data);
            }}
          >
            <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
              <FormField label="School Name (English)">
                <Input value={form.name} onChange={(event) => setForm((current) => ({ ...current, name: event.target.value }))} />
              </FormField>
              <FormField label="School Name (Nepali)">
                <Input value={form.nameNp} onChange={(event) => setForm((current) => ({ ...current, nameNp: event.target.value }))} />
              </FormField>
              <FormField label="Code">
                <Input value={form.code} onChange={(event) => setForm((current) => ({ ...current, code: event.target.value.toUpperCase() }))} />
              </FormField>
              <FormField label="Academic Year (BS)">
                <Input value={form.academicYearBs} onChange={(event) => setForm((current) => ({ ...current, academicYearBs: event.target.value }))} />
              </FormField>
              <FormField label="School Email">
                <Input value={form.email} onChange={(event) => setForm((current) => ({ ...current, email: event.target.value }))} />
              </FormField>
              <FormField label="School Phone">
                <Input value={form.phone} onChange={(event) => setForm((current) => ({ ...current, phone: event.target.value }))} />
              </FormField>
              <FormField label="Principal Name">
                <Input value={form.principalName} onChange={(event) => setForm((current) => ({ ...current, principalName: event.target.value }))} />
              </FormField>
              <FormField label="Status">
                <Select value={String(form.isActive)} onChange={(event) => setForm((current) => ({ ...current, isActive: event.target.value === "true" }))}>
                  <option value="true">Active</option>
                  <option value="false">Inactive</option>
                </Select>
              </FormField>
            </div>

            <AddressFields value={form.address} onChange={(address) => setForm((current) => ({ ...current, address }))} />

            {editingSchoolId ? null : (
              <div className="grid gap-4 md:grid-cols-3">
                <FormField label="School Admin Name">
                  <Input value={form.adminFullName} onChange={(event) => setForm((current) => ({ ...current, adminFullName: event.target.value }))} />
                </FormField>
                <FormField label="School Admin Email">
                  <Input value={form.adminEmail} onChange={(event) => setForm((current) => ({ ...current, adminEmail: event.target.value }))} />
                </FormField>
                <FormField label="School Admin Phone">
                  <Input value={form.adminPhone} onChange={(event) => setForm((current) => ({ ...current, adminPhone: event.target.value }))} />
                </FormField>
              </div>
            )}

            <div className="flex justify-end gap-2">
              {editingSchoolId ? (
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => {
                    setEditingSchoolId(null);
                    setForm(defaultSchoolValue);
                  }}
                >
                  Cancel
                </Button>
              ) : null}
              <Button disabled={createMutation.isPending || updateMutation.isPending} type="submit">
                {editingSchoolId
                  ? updateMutation.isPending
                    ? "Saving..."
                    : "Save Changes"
                  : createMutation.isPending
                    ? "Creating..."
                    : "Create School"}
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Schools</CardTitle>
        </CardHeader>
        <CardContent className="overflow-x-auto">
          <Table>
            <TableHead>
              <tr>
                <Th>Name</Th>
                <Th>Code</Th>
                <Th>Academic Year</Th>
                <Th>Principal</Th>
                <Th>Status</Th>
                <Th className="text-right">Actions</Th>
              </tr>
            </TableHead>
            <TableBody>
              {(schoolsQuery.data ?? []).map((school) => (
                <tr key={school._id}>
                  <Td>
                    <div className="font-medium text-slate-900">{school.name}</div>
                    <div className="text-xs text-slate-500">{school.email}</div>
                  </Td>
                  <Td>{school.code}</Td>
                  <Td>{school.academicYearBs}</Td>
                  <Td>{school.principalName}</Td>
                  <Td>{school.isActive ? "Active" : "Inactive"}</Td>
                  <Td className="text-right">
                    <div className="flex justify-end gap-2">
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={deleteMutation.isPending || updateMutation.isPending}
                        onClick={() => {
                          setEditingSchoolId(school._id);
                          setForm({ ...schoolToForm(school), adminFullName: "", adminEmail: "", adminPhone: "" });
                          window.scrollTo({ top: 0, behavior: "smooth" });
                        }}
                      >
                        Edit
                      </Button>
                      <Button
                        size="sm"
                        variant="destructive"
                        disabled={deleteMutation.isPending || updateMutation.isPending}
                        onClick={() => {
                          if (window.confirm(`Permanently delete "${school.name}" and ALL associated data (users, students, teachers, records, uploads)? This cannot be undone.`)) {
                            if (editingSchoolId === school._id) {
                              setEditingSchoolId(null);
                              setForm(defaultSchoolValue);
                            }
                            void deleteMutation.mutateAsync(school._id);
                          }
                        }}
                      >
                        Delete
                      </Button>
                    </div>
                  </Td>
                </tr>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
};
