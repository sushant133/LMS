import { useQuery } from "@tanstack/react-query";
import { lazy, Suspense } from "react";
import { LoadingState } from "components/shared/LoadingState";
import { api, unwrap } from "lib/api";

const PassedOutStudentsPanel = lazy(() =>
  import("features/exams/PassedOutStudentsPanel").then((module) => ({
    default: module.PassedOutStudentsPanel,
  })),
);
const BackStudentsPanel = lazy(() =>
  import("features/exams/BackStudentsPanel").then((module) => ({
    default: module.BackStudentsPanel,
  })),
);

interface CtevtStudentListsPanelProps {
  view: "passed-out" | "back-students";
}

/**
 * CTEVT → Passed-Out Students / Back Students. Loads the batch and year lists
 * both panels filter by (previously supplied by the College ExamManager).
 */
export const CtevtStudentListsPanel = ({ view }: CtevtStudentListsPanelProps) => {
  const batchesQuery = useQuery({
    queryKey: ["batches"],
    queryFn: () =>
      unwrap<Array<{ _id: string; name: string }>>(api.get("/academics/batches")),
  });
  const yearsQuery = useQuery({
    queryKey: ["years"],
    queryFn: () =>
      unwrap<
        Array<{
          _id: string;
          name: string;
          batchId?: string | { _id?: string };
        }>
      >(api.get("/academics/years")),
  });

  const batches = (batchesQuery.data ?? []).map((batch) => ({
    _id: String(batch._id),
    name: String(batch.name ?? ""),
  }));
  const years = (yearsQuery.data ?? []).map((year) => {
    const rawBatchId = year.batchId;
    const batchId =
      rawBatchId == null
        ? undefined
        : typeof rawBatchId === "object"
          ? String(rawBatchId._id ?? "")
          : String(rawBatchId);
    return {
      _id: String(year._id),
      name: String(year.name ?? ""),
      batchId: batchId || undefined,
    };
  });

  return (
    <Suspense fallback={<LoadingState />}>
      {view === "passed-out" ? (
        <PassedOutStudentsPanel batches={batches} years={years} />
      ) : (
        <BackStudentsPanel batches={batches} years={years} />
      )}
    </Suspense>
  );
};
