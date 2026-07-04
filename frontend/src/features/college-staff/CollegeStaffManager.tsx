import { useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import {
  COLLEGE_STAFF_CATEGORY_LABELS,
  EMPLOYMENT_TYPES,
  collegeStaffSchema,
  type CollegeStaffCategory,
  type CollegeStaffInput,
  type CollegeStaffRecord
} from "@nepal-school-erp/shared";
import { Upload } from "lucide-react";
import { toast } from "sonner";
import { AddressFields } from "components/shared/AddressFields";
import { EmptyState } from "components/shared/EmptyState";
import { FormField } from "components/shared/FormField";
import { NepaliDateField } from "components/shared/NepaliDateField";
import { Badge } from "components/ui/badge";
import { Button } from "components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "components/ui/card";
import { Input } from "components/ui/input";
import { Select } from "components/ui/select";
import { Table, TableBody, Td, Th, TableHead } from "components/ui/table";
import { api, resolveApiUrl, unwrap } from "lib/api";
import { queryClient } from "lib/queryClient";
import { formatCurrencyNpr, parseErrorMessage } from "lib/utils";

const emptyAddress = { province: "", district: "", municipality: "", ward: "", streetAddress: "" };

const createDefaultStaff = (category: CollegeStaffCategory): CollegeStaffInput => ({
  fullName: "",
  email: "",
  phone: "",
  enableLogin: false,
  staffId: "",
  photoUrl: "",
  gender: "Male",
  dateOfBirthBs: "",
  address: emptyAddress,
  joinedDateBs: "",
  designation: COLLEGE_STAFF_CATEGORY_LABELS[category].replace(/s$/, ""),
  category,
  employmentType: "FULL_TIME",
  basicSalaryNpr: 0,
  status: "ACTIVE"
});

interface CollegeStaffManagerProps {
  category: CollegeStaffCategory;
  title: string;
}

export const CollegeStaffManager = ({ category, title }: CollegeStaffManagerProps) => {
  const [form, setForm] = useState<CollegeStaffInput>(() => createDefaultStaff(category));
  const [password, setPassword] = useState("");
  const [editing, setEditing] = useState<CollegeStaffRecord | null>(null);
  const [isUploading, setIsUploading] = useState(false);

  const staffQuery = useQuery({
    queryKey: ["college-staff", category],
    queryFn: () => unwrap<CollegeStaffRecord[]>(api.get("/college-staff", { params: { category } }))
  });

  const saveMutation = useMutation({
    mutationFn: async (payload: CollegeStaffInput) => {
      const body = { ...payload, password: password.trim() || undefined };
      if (editing) {
        return unwrap<CollegeStaffRecord>(api.put(`/college-staff/${editing._id}`, body));
      }
      return unwrap<{ staff: CollegeStaffRecord; loginEmail?: string; defaultPassword?: string }>(
        api.post("/college-staff", body)
      );
    },
    onSuccess: async (data) => {
      if (editing) {
        toast.success("Staff member updated");
      } else if (data && typeof data === "object" && "loginEmail" in data && data.loginEmail) {
        toast.success("Staff created with portal login", {
          description: `Login ID: ${data.loginEmail} · Password: ${data.defaultPassword}`
        });
      } else {
        toast.success("Staff member created");
      }
      setForm(createDefaultStaff(category));
      setPassword("");
      setEditing(null);
      await queryClient.invalidateQueries({ queryKey: ["college-staff"] });
      await queryClient.invalidateQueries({ queryKey: ["accounting-salary-employees"] });
    },
    onError: (error) => toast.error(parseErrorMessage(error))
  });

  const deactivateMutation = useMutation({
    mutationFn: (id: string) => api.delete(`/college-staff/${id}`),
    onSuccess: async () => {
      toast.success("Staff member deactivated");
      await queryClient.invalidateQueries({ queryKey: ["college-staff"] });
      await queryClient.invalidateQueries({ queryKey: ["accounting-salary-employees"] });
    },
    onError: (error) => toast.error(parseErrorMessage(error))
  });

  const handlePhotoUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    setIsUploading(true);
    const formData = new FormData();
    formData.append("photo", file);

    try {
      const response = await fetch(resolveApiUrl("/uploads/staff/photo"), {
        method: "POST",
        body: formData,
        credentials: "include"
      });
      if (!response.ok) {
        const body = await response.json().catch(() => ({}));
        throw new Error(body.message ?? "Upload failed");
      }
      const body = await response.json();
      setForm((current) => ({ ...current, photoUrl: body.data?.url ?? "" }));
      toast.success("Photo uploaded");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Upload failed");
    } finally {
      setIsUploading(false);
      event.target.value = "";
    }
  };

  const loadStaff = (staff: CollegeStaffRecord) => {
    setEditing(staff);
    setForm({
      fullName: staff.fullName,
      email: staff.email ?? staff.user?.email ?? "",
      phone: staff.phone,
      enableLogin: staff.enableLogin,
      staffId: staff.staffId,
      photoUrl: staff.photoUrl ?? "",
      gender: staff.gender,
      dateOfBirthBs: staff.dateOfBirthBs ?? "",
      address: staff.address,
      joinedDateBs: staff.joinedDateBs,
      designation: staff.designation,
      category: staff.category,
      employmentType: staff.employmentType,
      basicSalaryNpr: staff.basicSalaryNpr,
      status: staff.status
    });
  };

  if (staffQuery.isLoading) {
    return <EmptyState title={`Loading ${title.toLowerCase()}`} description="Please wait." />;
  }

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>{editing ? `Edit ${title}` : `Create ${title}`}</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-3 md:grid-cols-2">
          <FormField label="Staff ID">
            <Input value={form.staffId} onChange={(event) => setForm((current) => ({ ...current, staffId: event.target.value }))} />
          </FormField>
          <FormField label="Full Name">
            <Input value={form.fullName} onChange={(event) => setForm((current) => ({ ...current, fullName: event.target.value }))} />
          </FormField>
          <FormField label="Designation">
            <Input value={form.designation} onChange={(event) => setForm((current) => ({ ...current, designation: event.target.value }))} />
          </FormField>
          <FormField label="Gender">
            <Select value={form.gender} onChange={(event) => setForm((current) => ({ ...current, gender: event.target.value }))}>
              <option value="Male">Male</option>
              <option value="Female">Female</option>
              <option value="Other">Other</option>
            </Select>
          </FormField>
          <FormField label="Date of Birth (BS)">
            <NepaliDateField value={form.dateOfBirthBs ?? ""} onChange={(value) => setForm((current) => ({ ...current, dateOfBirthBs: value }))} />
          </FormField>
          <FormField label="Joining Date (BS)">
            <NepaliDateField value={form.joinedDateBs} onChange={(value) => setForm((current) => ({ ...current, joinedDateBs: value }))} />
          </FormField>
          <FormField label="Contact Number">
            <Input value={form.phone} onChange={(event) => setForm((current) => ({ ...current, phone: event.target.value }))} />
          </FormField>
          <FormField label="Email">
            <Input value={form.email ?? ""} onChange={(event) => setForm((current) => ({ ...current, email: event.target.value }))} />
          </FormField>
          <FormField label="Employment Type">
            <Select
              value={form.employmentType}
              onChange={(event) => setForm((current) => ({ ...current, employmentType: event.target.value as CollegeStaffInput["employmentType"] }))}
            >
              {EMPLOYMENT_TYPES.map((type) => (
                <option key={type} value={type}>
                  {type.replace(/_/g, " ")}
                </option>
              ))}
            </Select>
          </FormField>
          <FormField label="Basic Salary (NPR)">
            <Input type="number" value={form.basicSalaryNpr} onChange={(event) => setForm((current) => ({ ...current, basicSalaryNpr: event.target.valueAsNumber }))} />
          </FormField>
          <FormField label="Status">
            <Select value={form.status} onChange={(event) => setForm((current) => ({ ...current, status: event.target.value as CollegeStaffInput["status"] }))}>
              <option value="ACTIVE">Active</option>
              <option value="INACTIVE">Inactive</option>
            </Select>
          </FormField>
          <FormField label="Photo">
            <div className="space-y-2">
              <label className="inline-flex cursor-pointer items-center gap-2 rounded-xl border border-slate-300 px-3 py-2 text-sm">
                <Upload className="h-4 w-4" />
                {isUploading ? "Uploading..." : "Upload photo"}
                <input type="file" accept="image/jpeg,image/png,image/webp" className="hidden" disabled={isUploading} onChange={handlePhotoUpload} />
              </label>
              {form.photoUrl ? <img src={form.photoUrl} alt="Staff preview" className="h-20 w-20 rounded-lg object-cover" /> : null}
            </div>
          </FormField>
          <div className="md:col-span-2">
            <AddressFields value={form.address} onChange={(address) => setForm((current) => ({ ...current, address }))} />
          </div>
          <label className="flex items-center gap-2 rounded-xl border border-slate-200 px-3 py-2 text-sm md:col-span-2">
            <input
              type="checkbox"
              checked={form.enableLogin}
              onChange={(event) => setForm((current) => ({ ...current, enableLogin: event.target.checked }))}
            />
            Enable portal login credentials
          </label>
          {form.enableLogin ? (
            <FormField label="Portal Password">
              <Input type="password" value={password} placeholder="Leave blank for default password" onChange={(event) => setPassword(event.target.value)} />
            </FormField>
          ) : null}
          <div className="flex gap-2 md:col-span-2">
            {editing ? (
              <Button
                variant="outline"
                onClick={() => {
                  setEditing(null);
                  setForm(createDefaultStaff(category));
                  setPassword("");
                }}
              >
                Cancel
              </Button>
            ) : null}
            <Button
              onClick={() => {
                const parsed = collegeStaffSchema.safeParse({ ...form, password: password.trim() || undefined });
                if (!parsed.success) {
                  toast.error(parsed.error.issues[0]?.message ?? "Invalid staff details");
                  return;
                }
                void saveMutation.mutateAsync(parsed.data);
              }}
            >
              {editing ? "Update Staff" : "Create Staff"}
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{title}</CardTitle>
        </CardHeader>
        <CardContent>
          {(staffQuery.data ?? []).length === 0 ? (
            <EmptyState title={`No ${title.toLowerCase()} yet`} description={`Add ${title.toLowerCase()} records for salary, attendance, and reporting.`} />
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHead>
                  <tr>
                    <Th>Photo</Th>
                    <Th>Staff ID</Th>
                    <Th>Name</Th>
                    <Th>Designation</Th>
                    <Th>Contact</Th>
                    <Th>Salary</Th>
                    <Th>Status</Th>
                    <Th />
                  </tr>
                </TableHead>
                <TableBody>
                  {(staffQuery.data ?? []).map((staff) => (
                    <tr key={staff._id}>
                      <Td>
                        {staff.photoUrl ? (
                          <img src={staff.photoUrl} alt={staff.fullName} className="h-10 w-10 rounded-full object-cover" />
                        ) : (
                          <div className="flex h-10 w-10 items-center justify-center rounded-full bg-slate-100 text-xs text-slate-500">
                            {staff.fullName.slice(0, 1)}
                          </div>
                        )}
                      </Td>
                      <Td>{staff.staffId}</Td>
                      <Td>
                        <div className="font-medium">{staff.fullName}</div>
                        {staff.enableLogin ? <div className="text-xs text-slate-500">{staff.user?.email ?? staff.email}</div> : null}
                      </Td>
                      <Td>{staff.designation}</Td>
                      <Td>{staff.phone}</Td>
                      <Td>{formatCurrencyNpr(staff.basicSalaryNpr)}</Td>
                      <Td>
                        <Badge>{staff.status}</Badge>
                      </Td>
                      <Td className="text-right">
                        <div className="flex justify-end gap-2">
                          <Button size="sm" variant="outline" onClick={() => loadStaff(staff)}>
                            Edit
                          </Button>
                          <Button size="sm" variant="destructive" onClick={() => void deactivateMutation.mutateAsync(staff._id)}>
                            Deactivate
                          </Button>
                        </div>
                      </Td>
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