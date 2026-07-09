import { FormField } from "components/shared/FormField";
import { NepaliDateField } from "components/shared/NepaliDateField";
import { Input } from "components/ui/input";
import { Select } from "components/ui/select";
import type {
  AttendanceExportPeriod,
  AttendancePeriodSelection,
} from "lib/attendancePeriodUtils";

interface AttendancePeriodFilterProps {
  value: AttendancePeriodSelection;
  onChange: (value: AttendancePeriodSelection) => void;
}

const periodLabels: Record<AttendanceExportPeriod, string> = {
  weekly: "Weekly",
  monthly: "Monthly",
  yearly: "Yearly",
  custom: "Custom range",
};

export const AttendancePeriodFilter = ({
  value,
  onChange,
}: AttendancePeriodFilterProps) => {
  const update = (patch: Partial<AttendancePeriodSelection>) =>
    onChange({ ...value, ...patch });

  return (
    <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
      <FormField label="Period">
        <Select
          value={value.period}
          onChange={(event) =>
            update({ period: event.target.value as AttendanceExportPeriod })
          }
        >
          {Object.entries(periodLabels).map(([key, label]) => (
            <option key={key} value={key}>
              {label}
            </option>
          ))}
        </Select>
      </FormField>

      {value.period === "weekly" ? (
        <FormField label="Week containing (BS)">
          <NepaliDateField
            value={value.weekReferenceBs}
            onChange={(next) => update({ weekReferenceBs: next })}
            placeholder="Select a date in the week"
          />
        </FormField>
      ) : null}

      {value.period === "monthly" ? (
        <FormField label="Month (BS)">
          <Input
            value={value.monthBs}
            onChange={(event) => update({ monthBs: event.target.value })}
            placeholder="YYYY-MM"
          />
        </FormField>
      ) : null}

      {value.period === "yearly" ? (
        <FormField label="Year (BS)">
          <Input
            value={value.yearBs}
            onChange={(event) => update({ yearBs: event.target.value })}
            placeholder="YYYY"
          />
        </FormField>
      ) : null}

      {value.period === "custom" ? (
        <>
          <FormField label="From (BS)">
            <NepaliDateField
              value={value.fromDateBs}
              onChange={(next) => update({ fromDateBs: next })}
            />
          </FormField>
          <FormField label="To (BS)">
            <NepaliDateField
              value={value.toDateBs}
              onChange={(next) => update({ toDateBs: next })}
            />
          </FormField>
        </>
      ) : null}
    </div>
  );
};
