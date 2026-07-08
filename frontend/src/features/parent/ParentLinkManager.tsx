import { useMemo, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import {
  PARENT_RELATIONSHIPS,
  createParentFromStudentSchema,
  parentChildLinkSchema,
  type CreateParentFromStudentInput,
  type ParentChildLinkInput,
  type ParentFromStudentRelationship,
  type StudentParentCandidatesResponse
} from "@phit-erp/shared";
import { toast } from "sonner";
import { PortalLoginFields, validatePortalPassword } from "components/shared/PortalLoginFields";
import { FormField } from "components/shared/FormField";
import { StudentNameLink } from "components/shared/StudentNameLink";
import { PageHeader } from "components/shared/PageHeader";
import { Badge } from "components/ui/badge";
import { Button } from "components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "components/ui/card";
import { Input } from "components/ui/input";
import { Select } from "components/ui/select";
import { Table, TableBody, Td, Th, TableHead } from "components/ui/table";
import { api, unwrap } from "lib/api";
import { queryClient } from "lib/queryClient";
import { parseErrorMessage } from "lib/utils";
import { useIsTenantAdmin } from "hooks/useNormalizedRole";

type ParentLinkRecord = {
  _id: string;
  parentUserId?: { _id: string; fullName: string; email: string; phone?: string; createdAt?: string };
  studentId?: { _id: string; admissionNumber?: string; user: { fullName: string } };
  relationship: string;
  status?: string;
  studentRegistrationNumber?: string;
  createdAt?: string;
};

type PendingRegistrationRecord = ParentLinkRecord;

const relationshipLabels: Record<ParentFromStudentRelationship, string> = {
  FATHER: "Father",
  MOTHER: "Mother",
  GUARDIAN: "Guardian"
};

export const ParentLinkManager = () => {
  const canManage = useIsTenantAdmin();
  const [selectedStudentId, setSelectedStudentId] = useState("");
  const [customLoginByRelationship, setCustomLoginByRelationship] = useState<Record<ParentFromStudentRelationship, string>>({
    FATHER: "",
    MOTHER: "",
    GUARDIAN: ""
  });
  const [passwordByRelationship, setPasswordByRelationship] = useState<Record<ParentFromStudentRelationship, string>>({
    FATHER: "",
    MOTHER: "",
    GUARDIAN: ""
  });
  const [confirmPasswordByRelationship, setConfirmPasswordByRelationship] = useState<
    Record<ParentFromStudentRelationship, string>
  >({
    FATHER: "",
    MOTHER: "",
    GUARDIAN: ""
  });
  const [manualForm, setManualForm] = useState<ParentChildLinkInput>({
    parentUserId: "",
    studentId: "",
    relationship: "GUARDIAN",
    isPrimary: true
  });

  const parentsQuery = useQuery({
    queryKey: ["parent-users"],
    queryFn: () => unwrap<Array<{ _id: string; fullName: string; email: string }>>(api.get("/parent/users"))
  });
  const studentsQuery = useQuery({
    queryKey: ["students"],
    queryFn: () => unwrap<Array<{ _id: string; user: { fullName: string }; admissionNumber: string }>>(api.get("/students"))
  });
  const candidatesQuery = useQuery({
    queryKey: ["parent-candidates", selectedStudentId],
    queryFn: () => unwrap<StudentParentCandidatesResponse>(api.get(`/parent/students/${selectedStudentId}/candidates`)),
    enabled: Boolean(selectedStudentId)
  });
  const linksQuery = useQuery({
    queryKey: ["parent-links"],
    queryFn: () => unwrap<ParentLinkRecord[]>(api.get("/parent/links"))
  });
  const pendingQuery = useQuery({
    queryKey: ["parent-registrations-pending"],
    queryFn: () => unwrap<PendingRegistrationRecord[]>(api.get("/parent/registrations/pending"))
  });

  const invalidateParentData = async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ["parent-links"] }),
      queryClient.invalidateQueries({ queryKey: ["parent-users"] }),
      queryClient.invalidateQueries({ queryKey: ["parent-candidates"] }),
      queryClient.invalidateQueries({ queryKey: ["parent-registrations-pending"] })
    ]);
  };

  const approveRegistration = useMutation({
    mutationFn: (id: string) => unwrap(api.post(`/parent/registrations/${id}/approve`)),
    onSuccess: async () => {
      toast.success("Parent registration approved");
      await invalidateParentData();
    },
    onError: (error) => toast.error(parseErrorMessage(error))
  });

  const rejectRegistration = useMutation({
    mutationFn: ({ id, reason }: { id: string; reason?: string }) =>
      unwrap(api.post(`/parent/registrations/${id}/reject`, { rejectionReason: reason })),
    onSuccess: async () => {
      toast.success("Parent registration rejected");
      await invalidateParentData();
    },
    onError: (error) => toast.error(parseErrorMessage(error))
  });

  const createFromStudent = useMutation({
    mutationFn: (payload: CreateParentFromStudentInput) =>
      unwrap<{ loginEmail: string; defaultPassword?: string; createdUser: boolean }>(
        api.post("/parent/profiles/from-student", payload)
      ),
    onSuccess: async (data) => {
      const description = data.createdUser && data.defaultPassword
        ? `Login ID: ${data.loginEmail} · Password: ${data.defaultPassword}`
        : `Linked to existing account: ${data.loginEmail}`;
      toast.success("Parent linked to student portal", { description });
      await invalidateParentData();
    },
    onError: (error) => toast.error(parseErrorMessage(error))
  });

  const createLink = useMutation({
    mutationFn: (payload: ParentChildLinkInput) => unwrap(api.post("/parent/links", payload)),
    onSuccess: async () => {
      toast.success("Parent linked to student");
      await invalidateParentData();
    },
    onError: (error) => toast.error(parseErrorMessage(error))
  });

  const deleteLink = useMutation({
    mutationFn: (id: string) => unwrap(api.delete(`/parent/links/${id}`)),
    onSuccess: async () => {
      toast.success("Parent link removed");
      await invalidateParentData();
    },
    onError: (error) => toast.error(parseErrorMessage(error))
  });

  const selectedStudent = useMemo(
    () => (studentsQuery.data ?? []).find((student) => student._id === selectedStudentId),
    [studentsQuery.data, selectedStudentId]
  );

  const handleCreateFromStudent = (relationship: ParentFromStudentRelationship) => {
    if (!selectedStudentId) {
      toast.error("Select a student first");
      return;
    }

    const password = passwordByRelationship[relationship];
    const confirmPassword = confirmPasswordByRelationship[relationship];
    const passwordError = validatePortalPassword(password, confirmPassword);
    if (passwordError) {
      toast.error(passwordError);
      return;
    }

    const candidate = candidatesQuery.data?.candidates.find((item) => item.relationship === relationship);
    const payload = {
      studentId: selectedStudentId,
      relationship,
      email: customLoginByRelationship[relationship].trim() || candidate?.suggestedLoginId || undefined,
      password: password.trim() || undefined,
      isPrimary: relationship === "GUARDIAN"
    };

    const parsed = createParentFromStudentSchema.safeParse(payload);
    if (!parsed.success) {
      toast.error("Invalid parent profile details");
      return;
    }

    createFromStudent.mutate(parsed.data);
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title="Parent–Student Links"
        description="Create parent portal accounts from student guardian details, or manually link an existing parent account."
      />

      <Card>
        <CardHeader>
          <CardTitle>Pending parent self-registrations</CardTitle>
          <p className="text-sm text-slate-500">
            Parents who registered from the login page using a student registration number. Approve to activate their
            portal account and link them to the student.
          </p>
        </CardHeader>
        <CardContent>
          {pendingQuery.isLoading ? (
            <p className="text-sm text-slate-500">Loading pending registrations…</p>
          ) : (pendingQuery.data ?? []).length === 0 ? (
            <p className="text-sm text-slate-500">No pending parent registrations.</p>
          ) : (
            <Table>
              <TableHead>
                <tr>
                  <Th>Parent</Th>
                  <Th>Student</Th>
                  <Th>Reg. No.</Th>
                  <Th>Relationship</Th>
                  <Th>Submitted</Th>
                  <Th>Actions</Th>
                </tr>
              </TableHead>
              <TableBody>
                {(pendingQuery.data ?? []).map((row) => (
                  <tr key={row._id}>
                    <Td>
                      <div>
                        <p className="font-medium">{row.parentUserId?.fullName ?? "—"}</p>
                        <p className="text-xs text-slate-500">{row.parentUserId?.email}</p>
                        {row.parentUserId?.phone ? (
                          <p className="text-xs text-slate-500">{row.parentUserId.phone}</p>
                        ) : null}
                      </div>
                    </Td>
                    <Td>
                      {row.studentId?._id && row.studentId.user?.fullName ? (
                        <StudentNameLink studentId={row.studentId._id} name={row.studentId.user.fullName} />
                      ) : (
                        "—"
                      )}
                    </Td>
                    <Td className="font-mono text-xs">
                      {row.studentRegistrationNumber ?? row.studentId?.admissionNumber ?? "—"}
                    </Td>
                    <Td>{row.relationship}</Td>
                    <Td>{row.createdAt ? new Date(row.createdAt).toLocaleString() : "—"}</Td>
                    <Td>
                      {canManage ? (
                        <div className="flex flex-wrap gap-2">
                          <Button
                            size="sm"
                            className="bg-brand-600 hover:bg-brand-700"
                            disabled={approveRegistration.isPending}
                            onClick={() => approveRegistration.mutate(row._id)}
                          >
                            Approve
                          </Button>
                          <Button
                            size="sm"
                            variant="outline"
                            disabled={rejectRegistration.isPending}
                            onClick={() => {
                              const reason = window.prompt("Rejection reason (optional):");
                              rejectRegistration.mutate({ id: row._id, reason: reason ?? undefined });
                            }}
                          >
                            Reject
                          </Button>
                        </div>
                      ) : (
                        "—"
                      )}
                    </Td>
                  </tr>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {canManage ? (
      <Card>
        <CardHeader>
          <CardTitle>Create parent from student details</CardTitle>
          <p className="text-sm text-slate-500">
            Select a student to use father, mother, or guardian information from their admission record. A portal account
            is created automatically and linked to the student.
          </p>
        </CardHeader>
        <CardContent className="space-y-4">
          <FormField label="Student">
            <Select
              value={selectedStudentId}
              onChange={(event) => {
                setSelectedStudentId(event.target.value);
                setCustomLoginByRelationship({ FATHER: "", MOTHER: "", GUARDIAN: "" });
                setPasswordByRelationship({ FATHER: "", MOTHER: "", GUARDIAN: "" });
                setConfirmPasswordByRelationship({ FATHER: "", MOTHER: "", GUARDIAN: "" });
              }}
            >
              <option value="">Select student</option>
              {(studentsQuery.data ?? []).map((student) => (
                <option key={student._id} value={student._id}>
                  {student.user.fullName} ({student.admissionNumber})
                </option>
              ))}
            </Select>
          </FormField>

          {!selectedStudentId ? (
            <p className="text-sm text-slate-500">Choose a student to preview parent profiles available from their record.</p>
          ) : candidatesQuery.isLoading ? (
            <p className="text-sm text-slate-500">Loading parent details…</p>
          ) : (
            <div className="grid gap-4">
              {(candidatesQuery.data?.candidates ?? []).map((candidate) => (
                <div key={candidate.relationship} className="rounded-2xl border border-slate-200 p-4">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <div className="flex items-center gap-2">
                        <p className="font-semibold text-slate-900">{relationshipLabels[candidate.relationship]}</p>
                        {candidate.isLinked ? (
                          <Badge>Linked</Badge>
                        ) : (
                          <Badge className="bg-slate-100 text-slate-600">Not linked</Badge>
                        )}
                      </div>
                      <p className="mt-1 text-sm text-slate-600">{candidate.fullName}</p>
                      <p className="text-sm text-slate-500">{candidate.phone || "No phone on student record"}</p>
                      <p className="mt-2 text-xs text-slate-500">
                        Suggested login ID: <span className="font-mono">{candidate.suggestedLoginId}</span>
                      </p>
                      {candidate.existingParentEmail ? (
                        <p className="text-xs text-slate-500">Existing parent account: {candidate.existingParentEmail}</p>
                      ) : null}
                    </div>
                    <Button
                      disabled={candidate.isLinked || createFromStudent.isPending}
                      onClick={() => handleCreateFromStudent(candidate.relationship)}
                    >
                      {candidate.isLinked ? "Already linked" : "Create & link parent"}
                    </Button>
                  </div>

                  {!candidate.isLinked ? (
                    <div className="mt-4 space-y-3">
                      <FormField label="Custom login ID (optional)">
                        <Input
                          value={customLoginByRelationship[candidate.relationship]}
                          placeholder={candidate.suggestedLoginId}
                          onChange={(event) =>
                            setCustomLoginByRelationship((current) => ({
                              ...current,
                              [candidate.relationship]: event.target.value
                            }))
                          }
                        />
                      </FormField>
                      <PortalLoginFields
                        email={customLoginByRelationship[candidate.relationship] || candidate.suggestedLoginId}
                        password={passwordByRelationship[candidate.relationship]}
                        confirmPassword={confirmPasswordByRelationship[candidate.relationship]}
                        onPasswordChange={(value) =>
                          setPasswordByRelationship((current) => ({ ...current, [candidate.relationship]: value }))
                        }
                        onConfirmPasswordChange={(value) =>
                          setConfirmPasswordByRelationship((current) => ({ ...current, [candidate.relationship]: value }))
                        }
                      />
                    </div>
                  ) : null}
                </div>
              ))}
            </div>
          )}

          {selectedStudent ? (
            <p className="text-xs text-slate-500">
              Parent portal for {selectedStudent.user.fullName} will show attendance, fees, homework, and notices after linking.
            </p>
          ) : null}
        </CardContent>
      </Card>
      ) : null}

      {canManage ? (
      <Card>
        <CardHeader><CardTitle>Manual link (existing parent account)</CardTitle></CardHeader>
        <CardContent className="grid gap-4 md:grid-cols-2">
          <FormField label="Parent">
            <Select value={manualForm.parentUserId} onChange={(event) => setManualForm((current) => ({ ...current, parentUserId: event.target.value }))}>
              <option value="">Select parent</option>
              {(parentsQuery.data ?? []).map((parent) => (
                <option key={parent._id} value={parent._id}>{parent.fullName} ({parent.email})</option>
              ))}
            </Select>
          </FormField>
          <FormField label="Student">
            <Select value={manualForm.studentId} onChange={(event) => setManualForm((current) => ({ ...current, studentId: event.target.value }))}>
              <option value="">Select student</option>
              {(studentsQuery.data ?? []).map((student) => (
                <option key={student._id} value={student._id}>{student.user.fullName}</option>
              ))}
            </Select>
          </FormField>
          <FormField label="Relationship">
            <Select
              value={manualForm.relationship}
              onChange={(event) =>
                setManualForm((current) => ({ ...current, relationship: event.target.value as ParentChildLinkInput["relationship"] }))
              }
            >
              {PARENT_RELATIONSHIPS.map((relationship) => <option key={relationship} value={relationship}>{relationship}</option>)}
            </Select>
          </FormField>
          <div className="flex items-end">
            <Button
              onClick={() => {
                const parsed = parentChildLinkSchema.safeParse(manualForm);
                if (!parsed.success) {
                  toast.error("Invalid link");
                  return;
                }
                createLink.mutate(parsed.data);
              }}
            >
              Create link
            </Button>
          </div>
        </CardContent>
      </Card>
      ) : null}

      <Card>
        <CardHeader><CardTitle>Existing links</CardTitle></CardHeader>
        <CardContent>
          <Table>
            <TableHead>
              <tr><Th>Parent</Th><Th>Student</Th><Th>Relationship</Th><Th>Status</Th><Th>Actions</Th></tr>
            </TableHead>
            <TableBody>
              {(linksQuery.data ?? []).length === 0 ? (
                <tr>
                  <Td colSpan={5}>No parent links yet.</Td>
                </tr>
              ) : (
                (linksQuery.data ?? []).map((link) => (
                  <tr key={link._id}>
                    <Td>
                      {link.parentUserId?.fullName ? (
                        <div>
                          <p className="font-medium">{link.parentUserId.fullName}</p>
                          <p className="text-xs text-slate-500">{link.parentUserId.email}</p>
                        </div>
                      ) : (
                        "—"
                      )}
                    </Td>
                    <Td>
                      {link.studentId?._id && link.studentId.user?.fullName ? (
                        <StudentNameLink studentId={link.studentId._id} name={link.studentId.user.fullName} />
                      ) : (
                        "—"
                      )}
                    </Td>
                    <Td>{link.relationship}</Td>
                    <Td>
                      {link.status === "PENDING" ? (
                        <Badge className="bg-amber-100 text-amber-800">Pending</Badge>
                      ) : link.status === "REJECTED" ? (
                        <Badge className="bg-red-100 text-red-700">Rejected</Badge>
                      ) : (
                        <Badge className="bg-brand-100 text-brand-800">Approved</Badge>
                      )}
                    </Td>
                    <Td>
                      <Button variant="outline" size="sm" onClick={() => deleteLink.mutate(link._id)}>
                        Remove
                      </Button>
                    </Td>
                  </tr>
                ))
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
};