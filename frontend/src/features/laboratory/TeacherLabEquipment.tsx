import { useQuery } from "@tanstack/react-query";
import type { LaboratoryIssueRecord } from "@phit-erp/shared";
import { PageHeader } from "components/shared/PageHeader";
import { Badge } from "components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "components/ui/card";
import { Table, TableBody, Td, Th, TableHead } from "components/ui/table";
import { api, unwrap } from "lib/api";

const issueStatusStyles: Record<string, string> = {
  ISSUED: "bg-sky-100 text-sky-800",
  RETURNED: "bg-emerald-100 text-emerald-800",
  OVERDUE: "bg-rose-100 text-rose-800"
};

export const TeacherLabEquipment = () => {
  const issuesQuery = useQuery({
    queryKey: ["laboratory-my-equipment"],
    queryFn: () => unwrap<LaboratoryIssueRecord[]>(api.get("/laboratory/my-equipment"))
  });

  const issues = issuesQuery.data ?? [];

  if (issues.length === 0) {
    return (
      <div className="space-y-6">
        <PageHeader title="Laboratory Equipment" description="Equipment issued to you by the laboratory." />
        <Card>
          <CardContent className="py-10 text-center text-sm text-slate-500">
            No laboratory equipment has been issued to you.
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <PageHeader title="Laboratory Equipment" description="Equipment issued to you by the laboratory." />
      <Card>
        <CardHeader>
          <CardTitle>Issued equipment</CardTitle>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHead>
              <tr>
                <Th>Item</Th>
                <Th>Quantity</Th>
                <Th>Issued</Th>
                <Th>Due</Th>
                <Th>Returned</Th>
                <Th>Status</Th>
              </tr>
            </TableHead>
            <TableBody>
              {issues.map((issue) => (
                <tr key={issue._id}>
                  <Td className="font-medium">{issue.equipmentName ?? "—"}</Td>
                  <Td>{issue.quantity}</Td>
                  <Td>{issue.issuedDateBs}</Td>
                  <Td>{issue.dueDateBs}</Td>
                  <Td>{issue.returnedDateBs ?? "—"}</Td>
                  <Td>
                    <Badge className={issueStatusStyles[issue.status] ?? ""}>{issue.status}</Badge>
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