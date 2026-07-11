import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import type {
  StudentDocument,
  StudentProfileData,
  StudentRecord,
} from "@phit-erp/shared";
import {
  Activity,
  BookOpen,
  Bus,
  ClipboardList,
  FileText,
  GraduationCap,
  LayoutDashboard,
  User,
  Wallet,
} from "lucide-react";
import { Link, useParams } from "react-router-dom";
import { EmptyState } from "components/shared/EmptyState";
import { LoadingState } from "components/shared/LoadingState";
import { PageHeader } from "components/shared/PageHeader";
import { Badge } from "components/ui/badge";
import { Button } from "components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "components/ui/card";
import { Table, TableBody, Td, Th, TableHead } from "components/ui/table";
import { useAuth } from "features/auth/AuthProvider";
import { useNormalizedRole } from "hooks/useNormalizedRole";
import { api, resolveApiUrl, unwrap } from "lib/api";
import {
  getStudentProfileBackLabel,
  getStudentProfileBackPath,
} from "lib/studentProfileNav";
import { queryClient } from "lib/queryClient";
import { cn, formatCurrencyNpr } from "lib/utils";
import { StudentDocumentsSection } from "./StudentDocumentsSection";
import {
  countPendingRequiredDocuments,
  getCategoryLabel,
  isPendingStudentDocument,
} from "./studentDocumentUtils";

type ProfileTab =
  | "overview"
  | "academic"
  | "fees"
  | "exams"
  | "attendance"
  | "library"
  | "transport"
  | "documents"
  | "activity";

const tabs: Array<{
  id: ProfileTab;
  label: string;
  icon: typeof LayoutDashboard;
}> = [
  { id: "overview", label: "Overview", icon: User },
  { id: "academic", label: "Academic", icon: GraduationCap },
  { id: "fees", label: "Fees & Accounting", icon: Wallet },
  { id: "exams", label: "Examination", icon: ClipboardList },
  { id: "attendance", label: "Attendance", icon: BookOpen },
  { id: "library", label: "Library", icon: BookOpen },
  { id: "transport", label: "Transport", icon: Bus },
  { id: "documents", label: "Documents", icon: FileText },
  { id: "activity", label: "Activity History", icon: Activity },
];

const formatAddress = (address: StudentRecord["address"]): string =>
  [
    address.streetAddress,
    `Ward ${address.ward}`,
    address.municipality,
    address.district,
    address.province,
  ]
    .filter(Boolean)
    .join(", ");

const InfoGrid = ({
  items,
}: {
  items: Array<{ label: string; value: string | number }>;
}) => (
  <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
    {items.map((item) => (
      <div
        key={item.label}
        className="rounded-xl border border-slate-100 bg-slate-50/80 px-3 py-2"
      >
        <div className="text-xs uppercase tracking-wide text-slate-500">
          {item.label}
        </div>
        <div className="mt-1 font-medium text-slate-900">
          {item.value || "—"}
        </div>
      </div>
    ))}
  </div>
);

export const StudentProfileView = () => {
  const { studentId = "" } = useParams();
  const { user } = useAuth();
  const role = useNormalizedRole();
  const [tab, setTab] = useState<ProfileTab>("overview");
  const [documents, setDocuments] = useState<StudentDocument[]>([]);

  const profileQuery = useQuery({
    queryKey: ["student-profile", studentId],
    queryFn: async () => {
      const data = await unwrap<StudentProfileData>(
        api.get(`/students/${studentId}/profile`),
      );
      setDocuments(data.student.documents ?? []);
      return data;
    },
    enabled: Boolean(studentId),
  });

  const profile = profileQuery.data;
  const student = profile?.student;
  const permissions = profile?.permissions;

  const pendingRequiredCount = useMemo(
    () => countPendingRequiredDocuments(documents),
    [documents],
  );

  const pendingDocumentNames = useMemo(
    () =>
      documents
        .filter((doc) => isPendingStudentDocument(doc))
        .map((doc) => doc.name || getCategoryLabel(doc.type)),
    [documents],
  );

  const visibleTabs = useMemo(() => {
    return tabs.filter((item) => {
      if (item.id === "fees" && !permissions?.canViewFinancial) return false;
      if (item.id === "activity" && !permissions?.canViewActivity) return false;
      if (item.id === "library" && permissions?.canViewLibrary === false)
        return false;
      if (item.id === "transport" && permissions?.canViewTransport === false)
        return false;
      if (item.id === "documents" && permissions?.canViewDocuments === false)
        return false;
      return true;
    });
  }, [permissions]);

  const isTeacherLimited = permissions?.canViewFullPersonal === false;

  if (profileQuery.isLoading) return <LoadingState />;
  if (!student || !profile) {
    return (
      <EmptyState
        title="Student not found"
        description="This student profile could not be loaded."
      />
    );
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title={isTeacherLimited ? "Student academic view" : "Student Profile"}
        description={
          isTeacherLimited
            ? `Academic details for ${student.user?.fullName ?? "student"} — your assigned subjects only`
            : `Complete profile for ${student.user?.fullName ?? "student"}`
        }
        action={
          <Button variant="outline" asChild>
            <Link to={getStudentProfileBackPath(role)}>
              {getStudentProfileBackLabel(role)}
            </Link>
          </Button>
        }
      />

      <Card className="overflow-hidden">
        <div className="flex flex-col items-center border-b border-slate-100 bg-gradient-to-r from-slate-50 to-white px-6 py-8 text-center">
          {student.photoUrl ? (
            <img
              src={student.photoUrl}
              alt={student.user.fullName}
              className="h-28 w-28 rounded-2xl object-cover shadow-sm"
            />
          ) : (
            <div className="flex h-28 w-28 items-center justify-center rounded-2xl bg-slate-200 text-3xl font-semibold text-slate-600">
              {student.user.fullName.slice(0, 1)}
            </div>
          )}
          <h2 className="mt-4 text-2xl font-bold text-slate-900">
            {student.user?.fullName ?? "Student"}
          </h2>
          <div className="mt-3 flex flex-wrap justify-center gap-2 text-sm text-slate-600">
            <Badge className="bg-white text-slate-700 ring-1 ring-slate-200">
              Reg: {student.admissionNumber}
            </Badge>
            <Badge className="bg-white text-slate-700 ring-1 ring-slate-200">
              Roll: {student.rollNumber}
            </Badge>
            <Badge className="bg-white text-slate-700 ring-1 ring-slate-200">
              {profile.primaryLabel}: {profile.primaryName}
            </Badge>
            <Badge className="bg-white text-slate-700 ring-1 ring-slate-200">
              {profile.secondaryLabel}: {profile.secondaryName}
            </Badge>
            {isTeacherLimited ? (
              <Badge className="bg-amber-100 text-amber-900 ring-1 ring-amber-200">
                Teacher view · assigned subjects only
              </Badge>
            ) : (
              <Badge className="bg-brand-100 text-brand-800 ring-1 ring-brand-200">
                Faculty: HA
              </Badge>
            )}
            {!isTeacherLimited && pendingRequiredCount > 0 ? (
              <Badge className="bg-amber-100 text-amber-900 ring-1 ring-amber-200">
                {pendingRequiredCount} document
                {pendingRequiredCount === 1 ? "" : "s"} pending
              </Badge>
            ) : null}
          </div>
        </div>

        <div className="flex flex-wrap gap-1 border-b border-slate-100 p-2">
          {visibleTabs.map((item) => {
            const Icon = item.icon;
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => setTab(item.id)}
                className={cn(
                  "inline-flex items-center gap-2 rounded-xl px-3 py-2 text-sm font-medium transition-colors",
                  tab === item.id
                    ? "bg-slate-900 text-white"
                    : "text-slate-600 hover:bg-slate-100",
                )}
              >
                <Icon className="h-4 w-4" />
                {item.label}
                {item.id === "documents" && pendingRequiredCount > 0 ? (
                  <span
                    className={cn(
                      "rounded-full px-1.5 py-0.5 text-xs font-semibold",
                      tab === item.id
                        ? "bg-amber-400 text-amber-950"
                        : "bg-amber-100 text-amber-900",
                    )}
                  >
                    {pendingRequiredCount}
                  </span>
                ) : null}
              </button>
            );
          })}
        </div>

        <CardContent className="p-6">
          {tab === "overview" ? (
            <div className="space-y-6">
              {isTeacherLimited ? (
                <div className="rounded-xl border border-sky-200 bg-sky-50 px-4 py-3 text-sm text-sky-950">
                  You can only view students in your assigned batch/year (or
                  class/section) and data related to your subjects (attendance
                  and exam marks). Personal contact details, fees, library,
                  transport, and documents are not available to teachers.
                </div>
              ) : null}
              <section>
                <h3 className="mb-3 text-lg font-semibold">
                  {isTeacherLimited ? "Student identity" : "Personal Information"}
                </h3>
                <InfoGrid
                  items={
                    isTeacherLimited
                      ? [
                          {
                            label: "Full Name",
                            value: student.user?.fullName ?? "—",
                          },
                          {
                            label: "Registration / Admission No.",
                            value: student.admissionNumber,
                          },
                          { label: "Roll Number", value: student.rollNumber },
                          {
                            label: profile.primaryLabel,
                            value: profile.primaryName,
                          },
                          {
                            label: profile.secondaryLabel,
                            value: profile.secondaryName,
                          },
                          { label: "Gender", value: student.gender },
                        ]
                      : [
                          {
                            label: "Full Name",
                            value: student.user?.fullName ?? "—",
                          },
                          {
                            label: "Registration / Admission No.",
                            value: student.admissionNumber,
                          },
                          { label: "Roll Number", value: student.rollNumber },
                          {
                            label: profile.primaryLabel,
                            value: profile.primaryName,
                          },
                          {
                            label: profile.secondaryLabel,
                            value: profile.secondaryName,
                          },
                          { label: "Faculty", value: "HA" },
                          {
                            label: "Mobile Number",
                            value: student.user?.phone ?? "—",
                          },
                          {
                            label: "Email",
                            value: student.user?.email ?? "—",
                          },
                          {
                            label: "Admission Date (BS)",
                            value: student.admissionDateBs ?? "—",
                          },
                          {
                            label: "Date of Birth (BS)",
                            value: student.dateOfBirthBs ?? "—",
                          },
                          { label: "Gender", value: student.gender },
                          {
                            label: "Blood Group",
                            value: student.bloodGroup ?? "—",
                          },
                          {
                            label: "Fees Due",
                            value: formatCurrencyNpr(student.feesDueNpr ?? 0),
                          },
                        ]
                  }
                />
              </section>
              {!isTeacherLimited ? (
                <>
                  <section>
                    <h3 className="mb-3 text-lg font-semibold">Address</h3>
                    <InfoGrid
                      items={[
                        {
                          label: "Permanent Address",
                          value: student.address
                            ? formatAddress(student.address)
                            : "—",
                        },
                      ]}
                    />
                  </section>
                  <section>
                    <h3 className="mb-3 text-lg font-semibold">
                      Parent / Guardian
                    </h3>
                    <InfoGrid
                      items={[
                        {
                          label: "Father",
                          value: `${student.fatherName ?? "—"}${
                            student.fatherPhone
                              ? ` (${student.fatherPhone})`
                              : ""
                          }`,
                        },
                        {
                          label: "Mother",
                          value: `${student.motherName ?? "—"}${
                            student.motherPhone
                              ? ` (${student.motherPhone})`
                              : ""
                          }`,
                        },
                        {
                          label: "Guardian",
                          value: `${student.guardianName ?? "—"} (${
                            student.guardianPhone ?? "—"
                          })`,
                        },
                      ]}
                    />
                  </section>
                </>
              ) : (
                <section>
                  <h3 className="mb-3 text-lg font-semibold">
                    Your subjects for this student
                  </h3>
                  {profile.subjects.length === 0 ? (
                    <p className="text-sm text-slate-500">
                      No subjects assigned to you for this student&apos;s
                      group.
                    </p>
                  ) : (
                    <div className="flex flex-wrap gap-2">
                      {profile.subjects.map((s) => (
                        <Badge
                          key={s._id}
                          className="bg-brand-50 text-brand-900 ring-1 ring-brand-200"
                        >
                          {s.name}
                          {s.code ? ` (${s.code})` : ""}
                        </Badge>
                      ))}
                    </div>
                  )}
                </section>
              )}
              {!isTeacherLimited && pendingRequiredCount > 0 ? (
                <section>
                  <h3 className="mb-3 text-lg font-semibold">
                    Pending Documents
                  </h3>
                  <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3">
                    <p className="text-sm text-amber-900">
                      {pendingRequiredCount} required document
                      {pendingRequiredCount === 1 ? "" : "s"} not yet
                      submitted. The student account is active — upload the
                      files from the Documents tab when available.
                    </p>
                    <ul className="mt-2 list-inside list-disc space-y-1 text-sm text-amber-900">
                      {pendingDocumentNames.map((name) => (
                        <li key={name}>{name}</li>
                      ))}
                    </ul>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      className="mt-3"
                      onClick={() => setTab("documents")}
                    >
                      Go to Documents
                    </Button>
                  </div>
                </section>
              ) : null}
            </div>
          ) : null}

          {tab === "academic" ? (
            <div className="space-y-6">
              <InfoGrid
                items={[
                  { label: profile.primaryLabel, value: profile.primaryName },
                  {
                    label: profile.secondaryLabel,
                    value: profile.secondaryName,
                  },
                  { label: "Faculty", value: "HA" },
                  {
                    label: "Registration / Admission No.",
                    value: student.admissionNumber,
                  },
                  {
                    label: "Subjects Enrolled",
                    value: profile.subjects.length,
                  },
                  {
                    label: "Attendance %",
                    value: `${profile.attendance.yearlyPercentage}%`,
                  },
                ]}
              />
              <section>
                <h3 className="mb-3 font-semibold">Subjects</h3>
                <div className="flex flex-wrap gap-2">
                  {profile.subjects.map((subject) => (
                    <Badge
                      key={subject._id}
                      className="bg-slate-100 text-slate-700"
                    >
                      {subject.name}
                      {subject.code ? ` (${subject.code})` : ""}
                    </Badge>
                  ))}
                </div>
              </section>
              <section>
                <h3 className="mb-3 font-semibold">Latest Results</h3>
                {profile.results.length === 0 ? (
                  <p className="text-sm text-slate-500">
                    No exam results recorded yet.
                  </p>
                ) : (
                  <Table>
                    <TableHead>
                      <tr>
                        <Th>Exam</Th>
                        <Th>GPA</Th>
                        <Th>Grade</Th>
                        <Th>Percentage</Th>
                        <Th>Status</Th>
                      </tr>
                    </TableHead>
                    <TableBody>
                      {profile.results.slice(0, 5).map((result) => (
                        <tr key={String(result._id)}>
                          <Td>
                            {(result.exam as { name?: string } | null)?.name ??
                              "Exam"}
                          </Td>
                          <Td>{String(result.gpa)}</Td>
                          <Td>{String(result.grade)}</Td>
                          <Td>{String(result.percentage)}%</Td>
                          <Td>
                            <Badge
                              className={
                                result.passFailStatus === "PASS"
                                  ? "bg-brand-100 text-brand-700"
                                  : "bg-red-100 text-red-700"
                              }
                            >
                              {String(result.passFailStatus)}
                            </Badge>
                          </Td>
                        </tr>
                      ))}
                    </TableBody>
                  </Table>
                )}
              </section>
            </div>
          ) : null}

          {tab === "fees" && profile.financial ? (
            <div className="space-y-6">
              <InfoGrid
                items={[
                  {
                    label: "Outstanding Due",
                    value: formatCurrencyNpr(
                      profile.financial.outstandingDueNpr as number,
                    ),
                  },
                  {
                    label: "Total Paid",
                    value: formatCurrencyNpr(
                      profile.financial.totalPaidNpr as number,
                    ),
                  },
                  {
                    label: "Total Discount",
                    value: formatCurrencyNpr(
                      profile.financial.totalDiscountNpr as number,
                    ),
                  },
                  {
                    label: "Scholarship",
                    value: formatCurrencyNpr(
                      profile.financial.totalScholarshipNpr as number,
                    ),
                  },
                ]}
              />
              <section>
                <h3 className="mb-3 font-semibold">Payment History</h3>
                <Table>
                  <TableHead>
                    <tr>
                      <Th>Date (BS)</Th>
                      <Th>Amount</Th>
                      <Th>Discount</Th>
                      <Th>Scholarship</Th>
                      <Th>Method</Th>
                    </tr>
                  </TableHead>
                  <TableBody>
                    {(
                      (profile.financial.collections as Array<
                        Record<string, unknown>
                      >) ?? []
                    ).map((item) => (
                      <tr key={String(item._id)}>
                        <Td>{String(item.paidDateBs)}</Td>
                        <Td>{formatCurrencyNpr(Number(item.amountPaidNpr))}</Td>
                        <Td>
                          {formatCurrencyNpr(Number(item.discountNpr ?? 0))}
                        </Td>
                        <Td>
                          {formatCurrencyNpr(Number(item.scholarshipNpr ?? 0))}
                        </Td>
                        <Td>{String(item.paymentMethod ?? "—")}</Td>
                      </tr>
                    ))}
                  </TableBody>
                </Table>
              </section>
            </div>
          ) : null}

          {tab === "exams" ? (
            <div className="space-y-4">
              {profile.results.length === 0 ? (
                <EmptyState
                  title="No exam results"
                  description="Results will appear here after they are published."
                />
              ) : (
                profile.results.map((result) => (
                  <Card key={String(result._id)}>
                    <CardHeader className="flex flex-row items-center justify-between">
                      <CardTitle className="text-base">
                        {(result.exam as { name?: string } | null)?.name ??
                          "Exam"}{" "}
                        — {String(result.percentage)}%
                      </CardTitle>
                      <div className="flex gap-2">
                        <Badge>{String(result.grade)}</Badge>
                        <Badge
                          className={
                            result.passFailStatus === "PASS"
                              ? "bg-brand-100 text-brand-700"
                              : "bg-red-100 text-red-700"
                          }
                        >
                          {String(result.passFailStatus)}
                        </Badge>
                        {result.publishedAtBs ? (
                          <Button variant="outline" size="sm" asChild>
                            <a
                              href={resolveApiUrl(
                                `/exams/results/${String(result.examId)}/${studentId}/marksheet/pdf`,
                              )}
                              target="_blank"
                              rel="noreferrer"
                            >
                              Download Marksheet
                            </a>
                          </Button>
                        ) : null}
                      </div>
                    </CardHeader>
                    <CardContent>
                      <Table>
                        <TableHead>
                          <tr>
                            <Th>Subject</Th>
                            <Th>Theory</Th>
                            <Th>Practical</Th>
                            <Th>Internal</Th>
                            <Th>Obtained</Th>
                            <Th>Grade</Th>
                          </tr>
                        </TableHead>
                        <TableBody>
                          {(
                            (result.marks as Array<Record<string, unknown>>) ??
                            []
                          ).map((mark, index) => (
                            <tr key={`${String(result._id)}-${index}`}>
                              <Td>{String(mark.subjectName)}</Td>
                              <Td>{String(mark.theoryMarks ?? 0)}</Td>
                              <Td>{String(mark.practicalMarks ?? 0)}</Td>
                              <Td>{String(mark.internalMarks ?? 0)}</Td>
                              <Td>{String(mark.obtainedMarks)}</Td>
                              <Td>{String(mark.grade ?? "—")}</Td>
                            </tr>
                          ))}
                        </TableBody>
                      </Table>
                    </CardContent>
                  </Card>
                ))
              )}
            </div>
          ) : null}

          {tab === "attendance" ? (
            <div className="space-y-6">
              <InfoGrid
                items={[
                  {
                    label: "Yearly Attendance",
                    value: `${profile.attendance.yearlyPercentage}%`,
                  },
                  {
                    label: "Present Days",
                    value: profile.attendance.totalPresent,
                  },
                  {
                    label: "Absent Days",
                    value: profile.attendance.totalAbsent,
                  },
                  {
                    label: "Total Recorded",
                    value: profile.attendance.totalDays,
                  },
                ]}
              />
              <section>
                <h3 className="mb-3 font-semibold">Monthly Summary</h3>
                <Table>
                  <TableHead>
                    <tr>
                      <Th>Month</Th>
                      <Th>Present</Th>
                      <Th>Absent</Th>
                      <Th>Percentage</Th>
                    </tr>
                  </TableHead>
                  <TableBody>
                    {profile.attendance.monthlySummary.map((row) => (
                      <tr key={row.month}>
                        <Td>{row.month}</Td>
                        <Td>{row.present}</Td>
                        <Td>{row.absent}</Td>
                        <Td>{row.percentage}%</Td>
                      </tr>
                    ))}
                  </TableBody>
                </Table>
              </section>
              <section>
                <h3 className="mb-3 font-semibold">Recent Attendance</h3>
                <Table>
                  <TableHead>
                    <tr>
                      <Th>Date (BS)</Th>
                      <Th>Subject</Th>
                      <Th>Status</Th>
                    </tr>
                  </TableHead>
                  <TableBody>
                    {profile.attendance.records.map((row, index) => (
                      <tr key={`${row.dateBs}-${index}`}>
                        <Td>{row.dateBs}</Td>
                        <Td>{row.subjectName ?? "—"}</Td>
                        <Td>
                          <Badge
                            className={
                              row.status === "PRESENT"
                                ? "bg-brand-100 text-brand-700"
                                : "bg-red-100 text-red-700"
                            }
                          >
                            {row.status}
                          </Badge>
                        </Td>
                      </tr>
                    ))}
                  </TableBody>
                </Table>
              </section>
            </div>
          ) : null}

          {tab === "library" ? (
            <div className="space-y-4">
              <InfoGrid
                items={[
                  {
                    label: "Pending Books",
                    value: profile.library.pendingCount,
                  },
                  {
                    label: "Total Fines",
                    value: formatCurrencyNpr(profile.library.fineTotal),
                  },
                ]}
              />
              <Table>
                <TableHead>
                  <tr>
                    <Th>Book</Th>
                    <Th>Issued</Th>
                    <Th>Due</Th>
                    <Th>Returned</Th>
                    <Th>Status</Th>
                    <Th>Fine</Th>
                  </tr>
                </TableHead>
                <TableBody>
                  {profile.library.issues.map((issue) => (
                    <tr key={String(issue._id)}>
                      <Td>{String(issue.bookTitle)}</Td>
                      <Td>{String(issue.issuedDateBs)}</Td>
                      <Td>{String(issue.dueDateBs)}</Td>
                      <Td>{String(issue.returnedDateBs ?? "—")}</Td>
                      <Td>{String(issue.status)}</Td>
                      <Td>{formatCurrencyNpr(Number(issue.fineNpr ?? 0))}</Td>
                    </tr>
                  ))}
                </TableBody>
              </Table>
            </div>
          ) : null}

          {tab === "transport" ? (
            profile.transport ? (
              <InfoGrid
                items={[
                  {
                    label: "Route",
                    value: String(profile.transport.routeName),
                  },
                  {
                    label: "Vehicle",
                    value: String(profile.transport.vehicle),
                  },
                  { label: "Driver", value: String(profile.transport.driver) },
                  {
                    label: "Driver Phone",
                    value: String(profile.transport.driverPhone),
                  },
                  {
                    label: "Pickup Stop",
                    value: String(profile.transport.pickupStop),
                  },
                  {
                    label: "Drop Stop",
                    value: String(profile.transport.dropStop),
                  },
                  {
                    label: "Monthly Fee",
                    value: formatCurrencyNpr(
                      Number(profile.transport.transportFeeNpr ?? 0),
                    ),
                  },
                ]}
              />
            ) : (
              <EmptyState
                title="No transport assignment"
                description="This student is not assigned to a transport route."
              />
            )
          ) : null}

          {tab === "documents" ? (
            <StudentDocumentsSection
              studentId={studentId}
              documents={documents}
              onChange={(nextDocuments) => {
                setDocuments(nextDocuments);
                void queryClient.invalidateQueries({
                  queryKey: ["student-profile", studentId],
                });
                void queryClient.invalidateQueries({ queryKey: ["students"] });
              }}
              canManage={Boolean(permissions?.canManageDocuments)}
              uploadedBy={user?._id}
              uploadedByName={user?.fullName}
              showPendingSummary
            />
          ) : null}

          {tab === "activity" && permissions?.canViewActivity ? (
            <Table>
              <TableHead>
                <tr>
                  <Th>Date & Time</Th>
                  <Th>Action</Th>
                  <Th>Performed By</Th>
                  <Th>Role</Th>
                </tr>
              </TableHead>
              <TableBody>
                {profile.activityLog.map((entry) => (
                  <tr key={entry._id}>
                    <Td>{new Date(entry.createdAt).toLocaleString()}</Td>
                    <Td>{entry.action}</Td>
                    <Td>{entry.actorName ?? "—"}</Td>
                    <Td>{entry.actorRole}</Td>
                  </tr>
                ))}
              </TableBody>
            </Table>
          ) : null}
        </CardContent>
      </Card>
    </div>
  );
};
