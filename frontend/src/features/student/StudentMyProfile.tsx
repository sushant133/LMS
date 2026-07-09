import { useQuery } from "@tanstack/react-query";
import { Mail, MapPin, Phone, User } from "lucide-react";
import { EmptyState } from "components/shared/EmptyState";
import { LoadingState } from "components/shared/LoadingState";
import { PageHeader } from "components/shared/PageHeader";
import { Badge } from "components/ui/badge";
import { Card, CardContent } from "components/ui/card";
import { api, unwrap } from "lib/api";

export interface StudentSelfProfile {
  studentId: string;
  fullName: string;
  email: string;
  phone: string;
  address: string;
  admissionNumber: string;
  rollNumber: number;
  batch: string;
  year: string;
  batchLabel: string;
  yearLabel: string;
  faculty: string;
  photoUrl?: string;
  gender?: string;
  academicStatus?: string;
}

const ProfileField = ({
  label,
  value,
}: {
  label: string;
  value: string | number;
}) => (
  <div className="rounded-xl border border-slate-100 bg-slate-50/80 px-4 py-3">
    <div className="text-xs font-medium uppercase tracking-wide text-slate-500">
      {label}
    </div>
    <div className="mt-1 text-base font-semibold text-slate-900">
      {value || "—"}
    </div>
  </div>
);

export const StudentMyProfile = () => {
  const profileQuery = useQuery({
    queryKey: ["student-my-profile"],
    queryFn: () => unwrap<StudentSelfProfile>(api.get("/student/profile")),
  });

  if (profileQuery.isLoading) {
    return <LoadingState />;
  }

  const profile = profileQuery.data;
  if (!profile) {
    return (
      <EmptyState
        title="Profile not found"
        description="Your student profile could not be loaded. Please contact the LMS Administrator."
      />
    );
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="My Profile"
        description="View your personal and academic details registered in PHIT LMS."
      />

      <Card className="overflow-hidden">
        <div className="flex flex-col items-center border-b border-slate-100 bg-gradient-to-r from-brand-50 to-white px-6 py-8 text-center sm:flex-row sm:items-center sm:gap-6 sm:text-left">
          {profile.photoUrl ? (
            <img
              src={profile.photoUrl}
              alt={profile.fullName}
              className="h-24 w-24 rounded-2xl object-cover shadow-sm ring-2 ring-white"
            />
          ) : (
            <div className="flex h-24 w-24 items-center justify-center rounded-2xl bg-brand-100 text-3xl font-bold text-brand-800 shadow-sm">
              {profile.fullName.slice(0, 1).toUpperCase()}
            </div>
          )}
          <div className="mt-4 sm:mt-0">
            <h2 className="text-2xl font-bold text-slate-900">
              {profile.fullName}
            </h2>
            <div className="mt-2 flex flex-wrap justify-center gap-2 sm:justify-start">
              <Badge className="bg-white text-slate-700 ring-1 ring-slate-200">
                Reg / Admission: {profile.admissionNumber}
              </Badge>
              <Badge className="bg-white text-slate-700 ring-1 ring-slate-200">
                {profile.batchLabel}: {profile.batch}
              </Badge>
              <Badge className="bg-brand-100 text-brand-800 ring-1 ring-brand-200">
                Faculty: {profile.faculty}
              </Badge>
            </div>
          </div>
        </div>

        <CardContent className="space-y-6 p-6">
          <section>
            <h3 className="mb-3 flex items-center gap-2 text-lg font-semibold text-slate-900">
              <User className="h-5 w-5 text-brand-700" />
              Personal Information
            </h3>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              <ProfileField label="Full Name" value={profile.fullName} />
              <ProfileField
                label="Registration / Admission No."
                value={profile.admissionNumber}
              />
              <ProfileField label="Roll Number" value={profile.rollNumber} />
              <ProfileField label="Mobile Number" value={profile.phone} />
              <ProfileField label="Email" value={profile.email} />
              <ProfileField label="Faculty" value={profile.faculty} />
            </div>
          </section>

          <section>
            <h3 className="mb-3 flex items-center gap-2 text-lg font-semibold text-slate-900">
              <MapPin className="h-5 w-5 text-brand-700" />
              Academic Details
            </h3>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              <ProfileField label={profile.batchLabel} value={profile.batch} />
              <ProfileField label={profile.yearLabel} value={profile.year} />
              <ProfileField label="Faculty" value={profile.faculty} />
            </div>
          </section>

          <section>
            <h3 className="mb-3 flex items-center gap-2 text-lg font-semibold text-slate-900">
              <MapPin className="h-5 w-5 text-brand-700" />
              Address
            </h3>
            <div className="rounded-xl border border-slate-100 bg-slate-50/80 px-4 py-3">
              <div className="text-base font-medium text-slate-900">
                {profile.address}
              </div>
            </div>
          </section>

          <section>
            <h3 className="mb-3 flex items-center gap-2 text-lg font-semibold text-slate-900">
              <Phone className="h-5 w-5 text-brand-700" />
              Contact
            </h3>
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="flex items-center gap-3 rounded-xl border border-slate-100 bg-slate-50/80 px-4 py-3">
                <Phone className="h-4 w-4 shrink-0 text-slate-500" />
                <div>
                  <div className="text-xs uppercase tracking-wide text-slate-500">
                    Mobile Number
                  </div>
                  <div className="font-semibold text-slate-900">
                    {profile.phone || "—"}
                  </div>
                </div>
              </div>
              <div className="flex items-center gap-3 rounded-xl border border-slate-100 bg-slate-50/80 px-4 py-3">
                <Mail className="h-4 w-4 shrink-0 text-slate-500" />
                <div>
                  <div className="text-xs uppercase tracking-wide text-slate-500">
                    Email
                  </div>
                  <div className="font-semibold text-slate-900 break-all">
                    {profile.email || "—"}
                  </div>
                </div>
              </div>
            </div>
          </section>
        </CardContent>
      </Card>
    </div>
  );
};
