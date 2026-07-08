import { useEffect, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import {
  DEFAULT_DAILY_ATTENDANCE_CONFIG,
  hasInstitutionAccess,
  settingsSchema,
  type SchoolSettingsRecord,
  type SettingsInput
} from "@phit-erp/shared";
import { toast } from "sonner";
import { AddressFields } from "components/shared/AddressFields";
import { CollegeLogo } from "components/shared/CollegeLogo";
import { FormField } from "components/shared/FormField";
import { NepaliDateField } from "components/shared/NepaliDateField";
import { PageHeader } from "components/shared/PageHeader";
import { Button } from "components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "components/ui/card";
import { Input } from "components/ui/input";
import { api, unwrap } from "lib/api";
import { queryClient } from "lib/queryClient";
import { parseErrorMessage } from "lib/utils";
import { useAuth } from "features/auth/AuthProvider";
import { useReadOnlyAccess } from "hooks/useNormalizedRole";

const defaultSettingsValue: SettingsInput = {
  schoolName: "",
  schoolNameNp: "",
  academicYearBs: "2083/2084",
  principalName: "",
  contactEmail: "",
  contactPhone: "",
  address: {
    province: "",
    district: "",
    municipality: "",
    ward: "",
    streetAddress: ""
  },
  holidays: [],
  dailyAttendance: { ...DEFAULT_DAILY_ATTENDANCE_CONFIG },
  infrastructure: {
    classrooms: 0,
    usableClassrooms: 0,
    toiletsMale: 0,
    toiletsFemale: 0,
    toiletsDisabled: 0,
    drinkingWater: false,
    electricity: false,
    internet: false,
    libraryBooks: 0,
    hasScienceLab: false,
    hasComputerLab: false,
    hasPlayground: false,
    hasRamp: false,
    midDayMeal: false
  }
};

export const SettingsManager = () => {
  const { user, availableSchools } = useAuth();
  const { isReadOnly, readOnlyMessage } = useReadOnlyAccess();
  const [form, setForm] = useState<SettingsInput>(defaultSettingsValue);
  const settingsQuery = useQuery({
    queryKey: ["settings"],
    queryFn: () => unwrap<SchoolSettingsRecord>(api.get("/settings"))
  });

  useEffect(() => {
    if (!settingsQuery.data) {
      return;
    }

    setForm({
      schoolName: settingsQuery.data.schoolName,
      schoolNameNp: settingsQuery.data.schoolNameNp,
      academicYearBs: settingsQuery.data.academicYearBs,
      principalName: settingsQuery.data.principalName,
      contactEmail: settingsQuery.data.contactEmail,
      contactPhone: settingsQuery.data.contactPhone,
      address: settingsQuery.data.address,
      holidays: settingsQuery.data.holidays,
      dailyAttendance: settingsQuery.data.dailyAttendance ?? { ...DEFAULT_DAILY_ATTENDANCE_CONFIG },
      infrastructure: (settingsQuery.data as any).infrastructure || defaultSettingsValue.infrastructure
    });
  }, [settingsQuery.data]);

  const settingsMutation = useMutation({
    mutationFn: async (payload: SettingsInput) => unwrap<SchoolSettingsRecord>(api.put("/settings", payload)),
    onSuccess: async () => {
      toast.success("Settings updated");
      await queryClient.invalidateQueries({ queryKey: ["settings"] });
    },
    onError: (error) => toast.error(parseErrorMessage(error))
  });

  return (
    <div className="space-y-8">
      <PageHeader 
        title="Institution Settings" 
        description="Manage Public Himal Institute of Technology profile, contact details, holidays, and infrastructure data required for IEMIS reporting." 
      />
      {hasInstitutionAccess(user?.role ?? "") && availableSchools?.[0] && (
        <div className="-mt-4 text-sm text-brand-700">
          Updating details for <span className="font-medium">{availableSchools[0].name}</span>
        </div>
      )}

      <form
        onSubmit={(event) => {
          event.preventDefault();
          const parsed = settingsSchema.safeParse(form);
          if (!parsed.success) {
            toast.error(parsed.error.issues[0]?.message ?? "Validation failed");
            return;
          }
          void settingsMutation.mutateAsync(parsed.data);
        }}
      >
        {/* College Profile */}
        <Card className="mb-6">
          <CardHeader>
            <CardTitle>College Profile</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="mb-4 flex items-center gap-4 rounded-xl border border-brand-100 bg-brand-50/60 p-4">
              <CollegeLogo className="h-16 w-16" />
              <p className="text-sm text-slate-600">
                Official college logo used on marksheets, fee receipts, login screen, and application header.
              </p>
            </div>
            <div className="grid gap-4 md:grid-cols-2">
              <FormField label="College Name (English)">
                <Input value={form.schoolName} onChange={(event) => setForm((current) => ({ ...current, schoolName: event.target.value }))} />
              </FormField>
              <FormField label="College Name (Nepali)">
                <Input value={form.schoolNameNp} onChange={(event) => setForm((current) => ({ ...current, schoolNameNp: event.target.value }))} />
              </FormField>
              <FormField label="Academic Year (BS)">
                <Input value={form.academicYearBs} onChange={(event) => setForm((current) => ({ ...current, academicYearBs: event.target.value }))} />
              </FormField>
              <FormField label="Principal Name">
                <Input value={form.principalName} onChange={(event) => setForm((current) => ({ ...current, principalName: event.target.value }))} />
              </FormField>
            </div>
          </CardContent>
        </Card>

        {/* Contact Information */}
        <Card className="mb-6">
          <CardHeader>
            <CardTitle>Contact Information</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid gap-4 md:grid-cols-2">
              <FormField label="Contact Email">
                <Input type="email" value={form.contactEmail} onChange={(event) => setForm((current) => ({ ...current, contactEmail: event.target.value }))} />
              </FormField>
              <FormField label="Contact Phone">
                <Input value={form.contactPhone} onChange={(event) => setForm((current) => ({ ...current, contactPhone: event.target.value }))} />
              </FormField>
            </div>
            <AddressFields value={form.address} onChange={(address) => setForm((current) => ({ ...current, address }))} />
          </CardContent>
        </Card>

        {/* Infrastructure (IEMIS) */}
        <Card className="mb-6 border-brand-200">
          <CardHeader>
            <CardTitle>Infrastructure Details (IEMIS)</CardTitle>
            <p className="text-sm text-slate-600">This data is used for government IEMIS / Flash Report submissions.</p>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-1 gap-x-6 gap-y-4 md:grid-cols-2">
              <FormField label="Total Classrooms">
                <Input type="number" value={form.infrastructure.classrooms} onChange={(e) => setForm(c => ({ ...c, infrastructure: { ...c.infrastructure, classrooms: e.target.valueAsNumber } }))} />
              </FormField>
              <FormField label="Usable Classrooms">
                <Input type="number" value={form.infrastructure.usableClassrooms} onChange={(e) => setForm(c => ({ ...c, infrastructure: { ...c.infrastructure, usableClassrooms: e.target.valueAsNumber } }))} />
              </FormField>

              <div className="md:col-span-2 mt-2">
                <div className="text-sm font-medium text-slate-700 mb-2">Toilets</div>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                  <FormField label="Male Toilets">
                    <Input type="number" value={form.infrastructure.toiletsMale} onChange={(e) => setForm(c => ({ ...c, infrastructure: { ...c.infrastructure, toiletsMale: e.target.valueAsNumber } }))} />
                  </FormField>
                  <FormField label="Female Toilets">
                    <Input type="number" value={form.infrastructure.toiletsFemale} onChange={(e) => setForm(c => ({ ...c, infrastructure: { ...c.infrastructure, toiletsFemale: e.target.valueAsNumber } }))} />
                  </FormField>
                  <FormField label="Disabled Toilets">
                    <Input type="number" value={form.infrastructure.toiletsDisabled} onChange={(e) => setForm(c => ({ ...c, infrastructure: { ...c.infrastructure, toiletsDisabled: e.target.valueAsNumber } }))} />
                  </FormField>
                </div>
              </div>

              <div className="md:col-span-2 mt-2">
                <div className="text-sm font-medium text-slate-700 mb-2">Facilities</div>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                  {[
                    { key: "drinkingWater", label: "Drinking Water" },
                    { key: "electricity", label: "Electricity" },
                    { key: "internet", label: "Internet" },
                    { key: "hasScienceLab", label: "Science Lab" },
                    { key: "hasComputerLab", label: "Computer Lab" },
                    { key: "hasPlayground", label: "Playground" },
                    { key: "hasRamp", label: "Accessibility Ramp" },
                    { key: "midDayMeal", label: "Mid-day Meal" },
                  ].map(({ key, label }) => (
                    <label key={key} className="flex items-center gap-2 text-sm cursor-pointer">
                      <input
                        type="checkbox"
                        checked={form.infrastructure[key as keyof typeof form.infrastructure] as boolean}
                        onChange={(e) => setForm(c => ({
                          ...c,
                          infrastructure: { ...c.infrastructure, [key]: e.target.checked }
                        }))}
                        className="h-4 w-4 accent-brand-600"
                      />
                      {label}
                    </label>
                  ))}
                </div>
              </div>

              <div className="md:col-span-2">
                <FormField label="Library Books Count">
                  <Input type="number" value={form.infrastructure.libraryBooks} onChange={(e) => setForm(c => ({ ...c, infrastructure: { ...c.infrastructure, libraryBooks: e.target.valueAsNumber } }))} />
                </FormField>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card className="mb-6">
          <CardHeader>
            <CardTitle>Daily Attendance Settings</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-4 md:grid-cols-2">
            <FormField label="Attendance Start Time">
              <Input
                value={form.dailyAttendance?.startTime ?? DEFAULT_DAILY_ATTENDANCE_CONFIG.startTime}
                onChange={(event) =>
                  setForm((current) => ({
                    ...current,
                    dailyAttendance: {
                      ...(current.dailyAttendance ?? DEFAULT_DAILY_ATTENDANCE_CONFIG),
                      startTime: event.target.value
                    }
                  }))
                }
                placeholder="06:00"
              />
            </FormField>
            <FormField label="Attendance End Time">
              <Input
                value={form.dailyAttendance?.endTime ?? DEFAULT_DAILY_ATTENDANCE_CONFIG.endTime}
                onChange={(event) =>
                  setForm((current) => ({
                    ...current,
                    dailyAttendance: {
                      ...(current.dailyAttendance ?? DEFAULT_DAILY_ATTENDANCE_CONFIG),
                      endTime: event.target.value
                    }
                  }))
                }
                placeholder="12:00"
              />
            </FormField>
            <label className="flex items-center gap-2 text-sm text-slate-700">
              <input
                type="checkbox"
                checked={form.dailyAttendance?.closeBeforeFirstPeriodEnds ?? true}
                onChange={(event) =>
                  setForm((current) => ({
                    ...current,
                    dailyAttendance: {
                      ...(current.dailyAttendance ?? DEFAULT_DAILY_ATTENDANCE_CONFIG),
                      closeBeforeFirstPeriodEnds: event.target.checked
                    }
                  }))
                }
              />
              Close attendance when the first period ends
            </label>
            <label className="flex items-center gap-2 text-sm text-slate-700">
              <input
                type="checkbox"
                checked={form.dailyAttendance?.allowMedicalLeave ?? true}
                onChange={(event) =>
                  setForm((current) => ({
                    ...current,
                    dailyAttendance: {
                      ...(current.dailyAttendance ?? DEFAULT_DAILY_ATTENDANCE_CONFIG),
                      allowMedicalLeave: event.target.checked
                    }
                  }))
                }
              />
              Allow Medical Leave status
            </label>
          </CardContent>
        </Card>

        {/* Holiday Management */}
        <Card className="mb-6">
          <CardHeader>
            <div className="flex items-center justify-between">
              <CardTitle>Holiday Calendar</CardTitle>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() =>
                  setForm((current) => ({
                    ...current,
                    holidays: [...current.holidays, { title: "", dateBs: "" }]
                  }))
                }
              >
                + Add Holiday
              </Button>
            </div>
          </CardHeader>
          <CardContent>
            {form.holidays.length === 0 && (
              <p className="text-sm text-slate-500 py-2">No holidays added yet.</p>
            )}
            <div className="space-y-3">
              {form.holidays.map((holiday, index) => (
                <div key={index} className="flex flex-col md:flex-row gap-3 items-end rounded-xl border p-3">
                  <div className="flex-1">
                    <FormField label="Holiday Title">
                      <Input
                        value={holiday.title}
                        onChange={(event) =>
                          setForm((current) => ({
                            ...current,
                            holidays: current.holidays.map((item, i) => (i === index ? { ...item, title: event.target.value } : item))
                          }))
                        }
                      />
                    </FormField>
                  </div>
                  <div className="w-full md:w-48">
                    <FormField label="Date (BS)">
                      <NepaliDateField
                        value={holiday.dateBs}
                        onChange={(value) =>
                          setForm((current) => ({
                            ...current,
                            holidays: current.holidays.map((item, i) => (i === index ? { ...item, dateBs: value } : item))
                          }))
                        }
                      />
                    </FormField>
                  </div>
                  <Button
                    type="button"
                    variant="destructive"
                    size="sm"
                    onClick={() =>
                      setForm((current) => ({
                        ...current,
                        holidays: current.holidays.filter((_, i) => i !== index)
                      }))
                    }
                  >
                    Remove
                  </Button>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>

        <div className="flex justify-end pt-2">
          <Button type="submit" disabled={settingsMutation.isPending || isReadOnly} title={isReadOnly ? readOnlyMessage : undefined}>
            {settingsMutation.isPending ? "Saving..." : "Save All Settings"}
          </Button>
        </div>
      </form>
    </div>
  );
};
