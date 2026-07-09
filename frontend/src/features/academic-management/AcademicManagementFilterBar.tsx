import type { AcademicManagementFilters } from "@phit-erp/shared";
import { FileDown, Printer, RotateCcw, Search } from "lucide-react";
import { Button } from "components/ui/button";
import { Input } from "components/ui/input";
import { Select } from "components/ui/select";
import { getAcademicLabels } from "lib/academicStructureUtils";
import { useIsCollege } from "hooks/useInstitutionType";
import { NEPALI_MONTHS } from "./academicManagementUtils";

interface Option {
  _id: string;
  name: string;
}

interface TeacherOption {
  _id: string;
  user?: { fullName: string };
}

interface AcademicManagementFilterBarProps {
  filters: AcademicManagementFilters;
  onChange: (filters: AcademicManagementFilters) => void;
  onSearch: () => void;
  onReset: () => void;
  onExportExcel: () => void;
  onExportPdf: () => void;
  onPrint: () => void;
  activeTab:
    "dashboard" | "session-plan" | "lesson-plan" | "log-book" | "reports";
  classes: Option[];
  sections: Option[];
  batches: Option[];
  years: Option[];
  subjects: Option[];
  teachers: TeacherOption[];
  academicYearBs: string;
  showTeacherFilter: boolean;
}

export const AcademicManagementFilterBar = ({
  filters,
  onChange,
  onSearch,
  onReset,
  onExportExcel,
  onExportPdf,
  onPrint,
  activeTab,
  classes,
  sections,
  batches,
  years,
  subjects,
  teachers,
  academicYearBs,
  showTeacherFilter,
}: AcademicManagementFilterBarProps) => {
  const isCollege = useIsCollege();
  const labels = getAcademicLabels(isCollege ? "COLLEGE" : "SCHOOL");

  const update = (patch: Partial<AcademicManagementFilters>) =>
    onChange({ ...filters, ...patch });

  return (
    <div className="rounded-3xl border border-white/70 bg-white/90 p-4 shadow-sm">
      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
        <label className="space-y-1 text-sm">
          <span className="font-medium text-slate-700">Academic Year</span>
          <Input
            value={filters.academicYearBs || academicYearBs}
            onChange={(event) => update({ academicYearBs: event.target.value })}
            placeholder="2082/083"
          />
        </label>
        <label className="space-y-1 text-sm">
          <span className="font-medium text-slate-700">Session</span>
          <Input
            value={filters.session}
            onChange={(event) => update({ session: event.target.value })}
            placeholder="2082/083"
          />
        </label>
        <label className="space-y-1 text-sm">
          <span className="font-medium text-slate-700">Faculty / Program</span>
          <Input
            value={filters.faculty}
            onChange={(event) => update({ faculty: event.target.value })}
          />
        </label>
        {isCollege ? (
          <>
            <label className="space-y-1 text-sm">
              <span className="font-medium text-slate-700">
                {labels.primary}
              </span>
              <Select
                value={filters.batchId ?? ""}
                onChange={(event) =>
                  update({ batchId: event.target.value, yearId: "" })
                }
              >
                <option value="">All</option>
                {batches.map((batch) => (
                  <option key={batch._id} value={batch._id}>
                    {batch.name}
                  </option>
                ))}
              </Select>
            </label>
            <label className="space-y-1 text-sm">
              <span className="font-medium text-slate-700">
                {labels.secondary}
              </span>
              <Select
                value={filters.yearId ?? ""}
                onChange={(event) => update({ yearId: event.target.value })}
              >
                <option value="">All</option>
                {years
                  .filter(
                    (year) =>
                      !filters.batchId ||
                      (year as Option & { batchId?: string }).batchId ===
                        filters.batchId,
                  )
                  .map((year) => (
                    <option key={year._id} value={year._id}>
                      {year.name}
                    </option>
                  ))}
              </Select>
            </label>
            <label className="space-y-1 text-sm">
              <span className="font-medium text-slate-700">Semester</span>
              <Input
                value={filters.semesterBs}
                onChange={(event) => update({ semesterBs: event.target.value })}
                placeholder="1st"
              />
            </label>
          </>
        ) : (
          <>
            <label className="space-y-1 text-sm">
              <span className="font-medium text-slate-700">
                {labels.primary}
              </span>
              <Select
                value={filters.classId ?? ""}
                onChange={(event) =>
                  update({ classId: event.target.value, sectionId: "" })
                }
              >
                <option value="">All</option>
                {classes.map((schoolClass) => (
                  <option key={schoolClass._id} value={schoolClass._id}>
                    {schoolClass.name}
                  </option>
                ))}
              </Select>
            </label>
            <label className="space-y-1 text-sm">
              <span className="font-medium text-slate-700">
                {labels.secondary}
              </span>
              <Select
                value={filters.sectionId ?? ""}
                onChange={(event) => update({ sectionId: event.target.value })}
              >
                <option value="">All</option>
                {sections
                  .filter(
                    (section) =>
                      !filters.classId ||
                      (section as Option & { classId?: string }).classId ===
                        filters.classId,
                  )
                  .map((section) => (
                    <option key={section._id} value={section._id}>
                      {section.name}
                    </option>
                  ))}
              </Select>
            </label>
          </>
        )}
        <label className="space-y-1 text-sm">
          <span className="font-medium text-slate-700">Subject</span>
          <Select
            value={filters.subjectId ?? ""}
            onChange={(event) => update({ subjectId: event.target.value })}
          >
            <option value="">All</option>
            {subjects.map((subject) => (
              <option key={subject._id} value={subject._id}>
                {subject.name}
              </option>
            ))}
          </Select>
        </label>
        {showTeacherFilter ? (
          <label className="space-y-1 text-sm">
            <span className="font-medium text-slate-700">Teacher</span>
            <Select
              value={filters.teacherId ?? ""}
              onChange={(event) => update({ teacherId: event.target.value })}
            >
              <option value="">All</option>
              {teachers.map((teacher) => (
                <option key={teacher._id} value={teacher._id}>
                  {teacher.user?.fullName ?? teacher._id}
                </option>
              ))}
            </Select>
          </label>
        ) : null}
        {activeTab !== "session-plan" ? (
          <label className="space-y-1 text-sm">
            <span className="font-medium text-slate-700">Month</span>
            <Select
              value={filters.month ?? ""}
              onChange={(event) => update({ month: event.target.value })}
            >
              <option value="">All</option>
              {NEPALI_MONTHS.map((month) => (
                <option key={month} value={month}>
                  {month}
                </option>
              ))}
            </Select>
          </label>
        ) : null}
        {activeTab === "log-book" ? (
          <>
            <label className="space-y-1 text-sm">
              <span className="font-medium text-slate-700">Date From</span>
              <Input
                value={filters.dateFrom}
                onChange={(event) => update({ dateFrom: event.target.value })}
                placeholder="2082-01-01"
              />
            </label>
            <label className="space-y-1 text-sm">
              <span className="font-medium text-slate-700">Date To</span>
              <Input
                value={filters.dateTo}
                onChange={(event) => update({ dateTo: event.target.value })}
                placeholder="2082-01-31"
              />
            </label>
          </>
        ) : null}
        <label className="space-y-1 text-sm">
          <span className="font-medium text-slate-700">Status</span>
          <Select
            value={filters.status ?? ""}
            onChange={(event) =>
              update({
                status: (event.target.value ||
                  undefined) as AcademicManagementFilters["status"],
              })
            }
          >
            <option value="">All</option>
            {activeTab === "log-book" ? (
              <>
                <option value="PENDING">Pending</option>
                <option value="REVIEWED">Reviewed</option>
                <option value="APPROVED">Approved</option>
                <option value="NEEDS_IMPROVEMENT">Needs Improvement</option>
              </>
            ) : (
              <>
                <option value="DRAFT">Draft</option>
                <option value="SUBMITTED">Submitted</option>
                <option value="PENDING_APPROVAL">Pending Approval</option>
                <option value="APPROVED">Approved</option>
                <option value="REJECTED">Rejected</option>
              </>
            )}
          </Select>
        </label>
        <label className="space-y-1 text-sm md:col-span-2">
          <span className="font-medium text-slate-700">Keyword</span>
          <Input
            value={filters.keyword}
            onChange={(event) => update({ keyword: event.target.value })}
            placeholder="Search topic, unit, status..."
          />
        </label>
      </div>

      <div className="mt-4 flex flex-wrap gap-2">
        <Button onClick={onSearch}>
          <Search className="mr-2 h-4 w-4" />
          Search
        </Button>
        <Button variant="outline" onClick={onReset}>
          <RotateCcw className="mr-2 h-4 w-4" />
          Reset Filters
        </Button>
        <Button variant="outline" onClick={onExportPdf}>
          <FileDown className="mr-2 h-4 w-4" />
          Export PDF
        </Button>
        <Button variant="outline" onClick={onExportExcel}>
          <FileDown className="mr-2 h-4 w-4" />
          Export Excel
        </Button>
        <Button variant="outline" onClick={onPrint}>
          <Printer className="mr-2 h-4 w-4" />
          Print
        </Button>
      </div>
    </div>
  );
};
