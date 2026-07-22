import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import type {
  HrDocument,
  TeacherProfileData,
  TeacherRecord,
} from "@phit-erp/shared";
import { DEFAULT_TEACHER_DESIGNATION } from "@phit-erp/shared";
import {
  FileText,
  GraduationCap,
  LayoutDashboard,
  User,
} from "lucide-react";
import { Link, useParams } from "react-router-dom";
import { EmptyState } from "components/shared/EmptyState";
import { LoadingState } from "components/shared/LoadingState";
import { PageHeader } from "components/shared/PageHeader";
import { Badge } from "components/ui/badge";
import { Button } from "components/ui/button";
import { Card, CardContent } from "components/ui/card";
import { HrDocumentsSection } from "features/hr-documents/HrDocumentsSection";
import { api, resolveMediaUrl, unwrap } from "lib/api";
import { queryClient } from "lib/queryClient";
import { cn, formatCurrencyNpr } from "lib/utils";

type ProfileTab = "overview" | "documents" | "assignments";

const tabs: Array<{
  id: ProfileTab;
  label: string;
  icon: typeof LayoutDashboard;
}> = [
  { id: "overview", label: "Overview", icon: User },
  { id: "documents", label: "Documents", icon: FileText },
  { id: "assignments", label: "Teaching load", icon: GraduationCap },
];

const formatAddress = (address: TeacherRecord["address"]): string =>
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

export const TeacherProfileView = () => {
  const { teacherId = "" } = useParams();
  const [tab, setTab] = useState<ProfileTab>("overview");
  const [documents, setDocuments] = useState<HrDocument[]>([]);

  const profileQuery = useQuery({
    queryKey: ["teacher-profile", teacherId],
    queryFn: async () => {
      const data = await unwrap<TeacherProfileData>(
        api.get(`/teachers/${teacherId}/profile`),
      );
      setDocuments(data.teacher.documents ?? []);
      return data;
    },
    enabled: Boolean(teacherId),
  });

  const profile = profileQuery.data;
  const teacher = profile?.teacher;
  const permissions = profile?.permissions;
  const designation =
    teacher?.user?.designation?.trim() || DEFAULT_TEACHER_DESIGNATION;

  const documentCount = useMemo(
    () => documents.filter((doc) => doc.url && doc.status !== "PENDING").length,
    [documents],
  );

  if (profileQuery.isLoading) return <LoadingState />;
  if (!teacher || !profile) {
    return (
      <EmptyState
        title="Teacher not found"
        description="This teacher profile could not be loaded."
      />
    );
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Teacher Profile"
        description={`Complete profile for ${teacher.user?.fullName ?? "teacher"}`}
        action={
          <Button variant="outline" asChild>
            <Link to="/college-staff?tab=teachers">Back to Teachers</Link>
          </Button>
        }
      />

      <Card className="overflow-hidden">
        <div className="flex flex-col items-center border-b border-slate-100 bg-gradient-to-r from-slate-50 to-white px-6 py-8 text-center">
          {resolveMediaUrl(teacher.photoUrl) ? (
            <img
              src={resolveMediaUrl(teacher.photoUrl)}
              alt={teacher.user?.fullName ?? "Teacher"}
              className="h-28 w-28 rounded-2xl object-cover shadow-sm"
            />
          ) : (
            <div className="flex h-28 w-28 items-center justify-center rounded-2xl bg-slate-200 text-3xl font-semibold text-slate-600">
              {(teacher.user?.fullName ?? "T").slice(0, 1)}
            </div>
          )}
          <h2 className="mt-4 text-2xl font-bold text-slate-900">
            {teacher.user?.fullName ?? "Teacher"}
          </h2>
          <div className="mt-3 flex flex-wrap justify-center gap-2 text-sm text-slate-600">
            <Badge className="bg-brand-100 text-brand-900 ring-1 ring-brand-200">
              {designation}
            </Badge>
            <Badge className="bg-white text-slate-700 ring-1 ring-slate-200">
              Code: {teacher.teacherCode}
            </Badge>
            <Badge className="bg-white text-slate-700 ring-1 ring-slate-200">
              {documentCount} document{documentCount === 1 ? "" : "s"}
            </Badge>
          </div>
        </div>

        <div className="flex flex-wrap gap-1 border-b border-slate-100 p-2">
          {tabs.map((item) => {
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
              </button>
            );
          })}
        </div>

        <CardContent className="p-6">
          {tab === "overview" ? (
            <div className="space-y-6">
              <section>
                <h3 className="mb-3 text-lg font-semibold">Personal information</h3>
                <InfoGrid
                  items={[
                    {
                      label: "Full Name",
                      value: teacher.user?.fullName ?? "—",
                    },
                    { label: "Designation", value: designation },
                    { label: "Teacher Code", value: teacher.teacherCode },
                    {
                      label: "Login ID",
                      value: teacher.user?.email ?? "—",
                    },
                    { label: "Phone", value: teacher.user?.phone ?? "—" },
                    { label: "Qualification", value: teacher.qualification },
                    { label: "Joined date (BS)", value: teacher.joinedDateBs },
                    {
                      label: "Basic salary",
                      value: formatCurrencyNpr(teacher.basicSalaryNpr),
                    },
                    {
                      label: "Account status",
                      value:
                        teacher.status === "INACTIVE" ||
                        teacher.user?.isActive === false
                          ? "Inactive"
                          : "Active",
                    },
                    { label: "Address", value: formatAddress(teacher.address) },
                  ]}
                />
              </section>

              {permissions?.canViewDocuments ? (
                <section>
                  <h3 className="mb-3 text-lg font-semibold">Documents preview</h3>
                  <p className="mb-3 text-sm text-slate-500">
                    Open the Documents tab to upload or view CV, degree, and
                    certificates.
                  </p>
                  <Button type="button" variant="outline" onClick={() => setTab("documents")}>
                    <FileText className="mr-2 h-4 w-4" />
                    Manage documents
                  </Button>
                </section>
              ) : null}
            </div>
          ) : null}

          {tab === "documents" && permissions?.canViewDocuments ? (
            <HrDocumentsSection
              entityKind="teacher"
              entityId={teacher._id}
              documents={documents}
              onChange={setDocuments}
              canManage={Boolean(permissions.canManageDocuments)}
              onAfterMutation={async () => {
                await queryClient.invalidateQueries({
                  queryKey: ["teacher-profile", teacherId],
                });
                await queryClient.invalidateQueries({ queryKey: ["teachers"] });
              }}
            />
          ) : null}

          {tab === "assignments" ? (
            <div className="space-y-4">
              <InfoGrid
                items={[
                  {
                    label: "Subjects linked (legacy)",
                    value: teacher.subjects?.length ?? 0,
                  },
                  {
                    label: "Batches",
                    value: teacher.assignedBatchIds?.length ?? 0,
                  },
                  {
                    label: "Years",
                    value: teacher.assignedYearIds?.length ?? 0,
                  },
                  {
                    label: "Classes",
                    value: teacher.assignedClassIds?.length ?? 0,
                  },
                  {
                    label: "Sections",
                    value: teacher.assignedSectionIds?.length ?? 0,
                  },
                  {
                    label: "Migration status",
                    value: teacher.assignmentMigrationStatus ?? "PENDING",
                  },
                ]}
              />
              <Button asChild>
                <Link
                  to={`/academics/subject-assignments?teacherId=${teacher._id}`}
                >
                  Open Subject Assignment
                </Link>
              </Button>
            </div>
          ) : null}
        </CardContent>
      </Card>
    </div>
  );
};
