import { useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { PARENT_RELATIONSHIPS, parentChildLinkSchema, type ParentChildLinkInput } from "@nepal-school-erp/shared";
import { toast } from "sonner";
import { FormField } from "components/shared/FormField";
import { PageHeader } from "components/shared/PageHeader";
import { Button } from "components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "components/ui/card";
import { Select } from "components/ui/select";
import { Table, TableBody, Td, Th, TableHead } from "components/ui/table";
import { api, unwrap } from "lib/api";
import { queryClient } from "lib/queryClient";
import { parseErrorMessage } from "lib/utils";

export const ParentLinkManager = () => {
  const [form, setForm] = useState<ParentChildLinkInput>({ parentUserId: "", studentId: "", relationship: "GUARDIAN", isPrimary: true });

  const parentsQuery = useQuery({
    queryKey: ["parent-users"],
    queryFn: () => unwrap<Array<{ _id: string; fullName: string; email: string }>>(api.get("/parent/users"))
  });
  const studentsQuery = useQuery({
    queryKey: ["students"],
    queryFn: () => unwrap<Array<{ _id: string; user: { fullName: string } }>>(api.get("/students"))
  });
  const linksQuery = useQuery({
    queryKey: ["parent-links"],
    queryFn: () =>
      unwrap<Array<{ _id: string; parentUserId: string; studentId?: { user: { fullName: string } }; relationship: string }>>(
        api.get("/parent/links")
      )
  });

  const createLink = useMutation({
    mutationFn: (payload: ParentChildLinkInput) => unwrap(api.post("/parent/links", payload)),
    onSuccess: async () => {
      toast.success("Parent linked to student");
      await queryClient.invalidateQueries({ queryKey: ["parent-links"] });
    },
    onError: (e) => toast.error(parseErrorMessage(e))
  });

  return (
    <div className="space-y-6">
      <PageHeader title="Parent–Student Links" description="Connect parent accounts to students for the parent portal." />
      <Card>
        <CardHeader><CardTitle>Link parent to student</CardTitle></CardHeader>
        <CardContent className="grid gap-4 md:grid-cols-2">
          <FormField label="Parent">
            <Select value={form.parentUserId} onChange={(e) => setForm((c) => ({ ...c, parentUserId: e.target.value }))}>
              <option value="">Select parent</option>
              {(parentsQuery.data ?? []).map((p: { _id: string; fullName: string; email: string }) => (
                <option key={p._id} value={p._id}>{p.fullName} ({p.email})</option>
              ))}
            </Select>
          </FormField>
          <FormField label="Student">
            <Select value={form.studentId} onChange={(e) => setForm((c) => ({ ...c, studentId: e.target.value }))}>
              <option value="">Select student</option>
              {(studentsQuery.data ?? []).map((s: { _id: string; user: { fullName: string } }) => (
                <option key={s._id} value={s._id}>{s.user.fullName}</option>
              ))}
            </Select>
          </FormField>
          <FormField label="Relationship">
            <Select value={form.relationship} onChange={(e) => setForm((c) => ({ ...c, relationship: e.target.value as ParentChildLinkInput["relationship"] }))}>
              {PARENT_RELATIONSHIPS.map((r) => <option key={r} value={r}>{r}</option>)}
            </Select>
          </FormField>
          <div className="flex items-end">
            <Button onClick={() => { const p = parentChildLinkSchema.safeParse(form); if (!p.success) return toast.error("Invalid link"); createLink.mutate(p.data); }}>Create link</Button>
          </div>
        </CardContent>
      </Card>
      <Card>
        <CardHeader><CardTitle>Existing links</CardTitle></CardHeader>
        <CardContent>
          <Table>
            <TableHead><tr><Th>Parent</Th><Th>Student</Th><Th>Relationship</Th></tr></TableHead>
            <TableBody>
              {(linksQuery.data ?? []).map((link: { _id: string; parentUserId: string; studentId?: { user: { fullName: string } }; relationship: string }) => (
                <tr key={link._id}><Td>{link.parentUserId}</Td><Td>{link.studentId?.user?.fullName ?? "—"}</Td><Td>{link.relationship}</Td></tr>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
};