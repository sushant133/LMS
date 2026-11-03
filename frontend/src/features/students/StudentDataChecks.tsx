import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "components/ui/card";
import { Table, TableBody, Td, Th, TableHead } from "components/ui/table";
import { LoadingState } from "components/shared/LoadingState";
import { StudentNameLink } from "components/shared/StudentNameLink";
import { api, unwrap } from "lib/api";

interface DataCheckRow {
  studentId: string;
  admissionNumber?: string;
  rollNumber?: number;
  fullName: string;
  batchName: string;
  yearName: string;
  academicStatus: string;
  reason: string;
}

interface DataChecksResponse {
  passedOutInThirdYear: DataCheckRow[];
  activeInEndedBatch: DataCheckRow[];
}

const CheckTable = ({
  title,
  description,
  rows,
}: {
  title: string;
  description: string;
  rows: DataCheckRow[];
}) => (
  <Card>
    <CardHeader>
      <CardTitle className="text-base">
        {title}{" "}
        <span className={rows.length ? "text-amber-700" : "text-emerald-700"}>
          ({rows.length})
        </span>
      </CardTitle>
      <p className="text-sm text-slate-500">{description}</p>
    </CardHeader>
    <CardContent>
      {rows.length === 0 ? (
        <p className="text-sm text-emerald-700">No records to check.</p>
      ) : (
        <div className="overflow-x-auto">
          <Table>
            <TableHead>
              <tr>
                <Th>Adm. No.</Th>
                <Th>Student</Th>
                <Th>Batch</Th>
                <Th>Year</Th>
                <Th>Status</Th>
                <Th>Issue</Th>
              </tr>
            </TableHead>
            <TableBody>
              {rows.map((row) => (
                <tr key={row.studentId}>
                  <Td>{row.admissionNumber || "—"}</Td>
                  <Td>
                    <StudentNameLink studentId={row.studentId} name={row.fullName || "Student"} />
                  </Td>
                  <Td>{row.batchName || "—"}</Td>
                  <Td>{row.yearName || "—"}</Td>
                  <Td>{row.academicStatus.replace(/_/g, " ")}</Td>
                  <Td className="text-slate-600">{row.reason}</Td>
                </tr>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </CardContent>
  </Card>
);

/** Read-only list of student records whose status and placement disagree. */
export const StudentDataChecks = () => {
  const query = useQuery({
    queryKey: ["students", "data-checks"],
    queryFn: () => unwrap<DataChecksResponse>(api.get("/students/data-checks")),
  });

  if (query.isLoading) return <LoadingState />;
  if (query.isError || !query.data) {
    return <p className="text-sm text-rose-700">Could not load the data checks.</p>;
  }

  return (
    <div className="space-y-6">
      <p className="text-sm text-slate-500">
        Read-only. Nothing is changed here — open a student to correct the record.
      </p>
      <CheckTable
        title="Passed Out but still in 3rd Year"
        description="Students marked Passed Out whose year is still 3rd Year."
        rows={query.data.passedOutInThirdYear}
      />
      <CheckTable
        title="Active students in an ended batch"
        description='Active students whose batch is marked ended (inactive), or who are placed at year "Ended".'
        rows={query.data.activeInEndedBatch}
      />
    </div>
  );
};
