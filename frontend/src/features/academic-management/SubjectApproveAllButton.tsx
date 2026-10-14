import { useMutation, useQueryClient } from "@tanstack/react-query";
import type { AcademicManagementFilters } from "@phit-erp/shared";
import { toast } from "sonner";
import { Button } from "components/ui/button";
import { useCanApproveRecords } from "hooks/useModuleAccess";
import { api, unwrap } from "lib/api";
import { parseErrorMessage } from "lib/utils";
import { academicListApiParams } from "./academicManagementUtils";

type RecordType = "SESSION_PLAN" | "LESSON_PLAN" | "LOG_BOOK";

const TYPE_LABEL: Record<RecordType, string> = {
  SESSION_PLAN: "session plans",
  LESSON_PLAN: "lesson plans",
  LOG_BOOK: "log book entries",
};

/**
 * "Approve all verified" for the ONE subject opened in the panel (e.g. Physics) and
 * only this panel's record type. Never approves other subjects.
 */
export const SubjectApproveAllButton = ({
  type,
  subjectIds,
  subjectName,
  filters,
  isCollege,
  isAdminView,
}: {
  type: RecordType;
  subjectIds: string[];
  subjectName: string;
  filters: AcademicManagementFilters;
  isCollege?: boolean;
  isAdminView?: boolean;
}) => {
  const canApprove = useCanApproveRecords();
  const queryClient = useQueryClient();
  const label = TYPE_LABEL[type];

  const mutation = useMutation({
    mutationFn: () => {
      const params = academicListApiParams(filters, { isCollege, adminScope: true });
      delete params.subjectId;
      return unwrap<{ sessionPlans: number; lessonPlans: number; logBooks: number }>(
        api.post(
          "/academic-management/approvals/approve-all",
          { academicYearBs: filters.academicYearBs, subjectIds, types: [type] },
          { params },
        ),
      );
    },
    onSuccess: (result) => {
      const total = result.sessionPlans + result.lessonPlans + result.logBooks;
      toast.success(
        total > 0
          ? `${total} verified ${label} approved for ${subjectName}`
          : `No verified ${label} waiting for approval in ${subjectName}`,
      );
      void queryClient.invalidateQueries({ queryKey: ["academic-management"] });
    },
    onError: (error) => toast.error(parseErrorMessage(error)),
  });

  if (!isAdminView || !canApprove || subjectIds.length === 0) return null;

  return (
    <div className="pt-2">
      <Button
        size="sm"
        variant="outline"
        disabled={mutation.isPending}
        onClick={() => {
          if (
            window.confirm(
              `Approve all verified ${label} for ${subjectName} only? Other subjects are not affected.`,
            )
          ) {
            mutation.mutate();
          }
        }}
      >
        {mutation.isPending
          ? `Approving ${subjectName}…`
          : `Approve all verified — ${subjectName}`}
      </Button>
    </div>
  );
};
