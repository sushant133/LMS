import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import type {
  CollegeStaffProfileData,
  CollegeStaffRecord,
  HrDocument,
} from "@phit-erp/shared";
import { COLLEGE_STAFF_CATEGORY_LABELS } from "@phit-erp/shared";
import { FileText, LayoutDashboard, User } from "lucide-react";
import { Link, useParams } from "react-router-dom";
import { EmptyState } from "components/shared/EmptyState";
import { LoadingState } from "components/shared/LoadingState";
import { PageHeader } from "components/shared/PageHeader";
import { Badge } from "components/ui/badge";
import { Button } from "components/ui/button";
import { Card, CardContent } from "components/ui/card";
import { HrDocumentsSection } from "features/hr-documents/HrDocumentsSection";
import { api, unwrap } from "lib/api";
import { queryClient } from "lib/queryClient";
import { cn, formatCurrencyNpr } from "lib/utils";
import { staffPhotoSrc } from "./staffUtils";

type ProfileTab = "overview" | "documents";

const tabs: Array<{
  id: ProfileTab;
  label: string;
  icon: typeof LayoutDashboard;
}> = [
  { id: "overview", label: "Overview", icon: User },
  { id: "documents", label: "Documents", icon: FileText },
];

const formatAddress = (address: CollegeStaffRecord["address"]): string =>
  [
    address?.streetAddress,
    address?.ward ? `Ward ${address.ward}` : "",
    address?.municipality,
    address?.district,
    address?.province,
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

export const StaffProfileView = () => {
  const { staffId = "" } = useParams();
  const [tab, setTab] = useState<ProfileTab>("overview");
  const [documents, setDocuments] = useState<HrDocument[]>([]);

  const profileQuery = useQuery({
    queryKey: ["staff-profile", staffId],
    queryFn: async () => {
      const data = await unwrap<CollegeStaffProfileData>(
        api.get(`/college-staff/${staffId}/profile`),
      );
      setDocuments(data.staff.documents ?? []);
      return data;
    },
    enabled: Boolean(staffId),
  });

  const profile = profileQuery.data;
  const staff = profile?.staff;
  const permissions = profile?.permissions;

  const documentCount = useMemo(
    () => documents.filter((doc) => doc.url && doc.status !== "PENDING").length,
    [documents],
  );

  const roleLabel = staff
    ? staff.category === "OTHER" && staff.customRoleLabel
      ? staff.customRoleLabel
      : COLLEGE_STAFF_CATEGORY_LABELS[staff.category] ?? staff.category
    : "";

  if (profileQuery.isLoading) return <LoadingState />;
  if (!staff || !profile) {
    return (
      <EmptyState
        title="Staff not found"
        description="This staff profile could not be loaded."
      />
    );
  }

  const photo = staffPhotoSrc(staff.photoUrl);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Staff Profile"
        description={`Complete profile for ${staff.fullName}`}
        action={
          <Button variant="outline" asChild>
            <Link to="/college-staff">Back to College Staff</Link>
          </Button>
        }
      />

      <Card className="overflow-hidden">
        <div className="flex flex-col items-center border-b border-slate-100 bg-gradient-to-r from-slate-50 to-white px-6 py-8 text-center">
          {photo ? (
            <img
              src={photo}
              alt={staff.fullName}
              className="h-28 w-28 rounded-2xl object-cover shadow-sm"
            />
          ) : (
            <div className="flex h-28 w-28 items-center justify-center rounded-2xl bg-slate-200 text-3xl font-semibold text-slate-600">
              {(staff.fullName || "S").slice(0, 1)}
            </div>
          )}
          <h2 className="mt-4 text-2xl font-bold text-slate-900">
            {staff.fullName}
          </h2>
          <div className="mt-3 flex flex-wrap justify-center gap-2 text-sm text-slate-600">
            <Badge className="bg-brand-100 text-brand-900 ring-1 ring-brand-200">
              {staff.designation}
            </Badge>
            <Badge className="bg-white text-slate-700 ring-1 ring-slate-200">
              ID: {staff.staffId}
            </Badge>
            <Badge className="bg-white text-slate-700 ring-1 ring-slate-200">
              {roleLabel}
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
                    { label: "Full Name", value: staff.fullName },
                    { label: "Employee ID", value: staff.staffId },
                    { label: "Designation", value: staff.designation },
                    { label: "Staff role", value: roleLabel },
                    {
                      label: "Login ID",
                      value: staff.user?.email ?? staff.email ?? "—",
                    },
                    { label: "Phone", value: staff.phone },
                    { label: "Gender", value: staff.gender },
                    {
                      label: "Date of birth (BS)",
                      value: staff.dateOfBirthBs ?? "—",
                    },
                    { label: "Department", value: staff.department ?? "—" },
                    { label: "Joined date (BS)", value: staff.joinedDateBs },
                    {
                      label: "Qualification",
                      value: staff.qualification ?? "—",
                    },
                    {
                      label: "Experience",
                      value: `${staff.experienceYears ?? 0} years`,
                    },
                    {
                      label: "Employment type",
                      value: staff.employmentType,
                    },
                    {
                      label: "Basic salary",
                      value: formatCurrencyNpr(staff.basicSalaryNpr),
                    },
                    { label: "Employment status", value: staff.status },
                    {
                      label: "Login status",
                      value: staff.user?.isActive ? "Active" : "Inactive",
                    },
                    {
                      label: "Emergency contact",
                      value:
                        [staff.emergencyContactName, staff.emergencyContactPhone]
                          .filter(Boolean)
                          .join(" · ") || "—",
                    },
                    { label: "Address", value: formatAddress(staff.address) },
                    { label: "Remarks", value: staff.remarks ?? "—" },
                  ]}
                />
              </section>

              {permissions?.canViewDocuments ? (
                <section>
                  <h3 className="mb-3 text-lg font-semibold">Documents</h3>
                  <p className="mb-3 text-sm text-slate-500">
                    Upload or view CV, degree, certificates, and other staff
                    documents.
                  </p>
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => setTab("documents")}
                  >
                    <FileText className="mr-2 h-4 w-4" />
                    Manage documents
                  </Button>
                </section>
              ) : null}
            </div>
          ) : null}

          {tab === "documents" && permissions?.canViewDocuments ? (
            <HrDocumentsSection
              entityKind="staff"
              entityId={staff._id}
              documents={documents}
              onChange={setDocuments}
              canManage={Boolean(permissions.canManageDocuments)}
              onAfterMutation={async () => {
                await queryClient.invalidateQueries({
                  queryKey: ["staff-profile", staffId],
                });
                await queryClient.invalidateQueries({
                  queryKey: ["college-staff"],
                });
              }}
            />
          ) : null}
        </CardContent>
      </Card>
    </div>
  );
};
