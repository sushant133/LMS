import { useEffect, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useLocation, useNavigate } from "react-router-dom";
import type {
  BatchRecord,
  ClassRecord,
  SectionRecord,
  StudentInput,
  StudentRecord,
  YearRecord,
} from "@phit-erp/shared";
import { toast } from "sonner";
import { Card, CardContent, CardHeader, CardTitle } from "components/ui/card";
import { LoadingState } from "components/shared/LoadingState";
import { useAuth } from "features/auth/AuthProvider";
import { useIsCollege } from "hooks/useInstitutionType";
import { useIsTenantAdmin } from "hooks/useNormalizedRole";
import { api, unwrap } from "lib/api";
import {
  toastCredentialCreateResult,
  type CredentialsEmailResult,
} from "lib/credentialsEmail";
import { queryClient } from "lib/queryClient";
import { parseErrorMessage } from "lib/utils";
import { StudentForm } from "./StudentForm";
import { uploadPendingDocuments } from "./StudentDocumentsSection";
import {
  mapStudentToInput,
  type StudentEditLocationState,
} from "./studentFormUtils";
import type { PendingStudentDocument } from "./studentDocumentUtils";

export const CreateStudentManager = () => {
  const { user } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const isCollege = useIsCollege();
  const canManage = useIsTenantAdmin();
  const editState =
    (location.state as StudentEditLocationState | null)?.student ?? null;

  const [editing, setEditing] = useState<StudentRecord | null>(editState);
  const [pendingDocuments, setPendingDocuments] = useState<
    PendingStudentDocument[]
  >([]);

  useEffect(() => {
    setEditing(editState);
    setPendingDocuments([]);
  }, [editState?._id, location.key]);

  const classesQuery = useQuery({
    queryKey: ["classes"],
    queryFn: () => unwrap<ClassRecord[]>(api.get("/academics/classes")),
    enabled: canManage && !isCollege,
  });
  const sectionsQuery = useQuery({
    queryKey: ["sections"],
    queryFn: () => unwrap<SectionRecord[]>(api.get("/academics/sections")),
    enabled: canManage && !isCollege,
  });
  const batchesQuery = useQuery({
    queryKey: ["batches"],
    queryFn: () => unwrap<BatchRecord[]>(api.get("/academics/batches")),
    enabled: canManage && isCollege,
  });
  const yearsQuery = useQuery({
    queryKey: ["years"],
    queryFn: () => unwrap<YearRecord[]>(api.get("/academics/years")),
    enabled: canManage && isCollege,
  });

  const studentMutation = useMutation({
    mutationFn: async (payload: StudentInput) =>
      editing
        ? unwrap<StudentRecord>(api.put(`/students/${editing._id}`, payload))
        : unwrap<{
            student: StudentRecord;
            loginEmail: string;
            defaultPassword: string;
            credentialsEmail?: CredentialsEmailResult;
          }>(api.post("/students", payload)),
    onSuccess: async (data) => {
      if ("loginEmail" in data) {
        toastCredentialCreateResult(data, {
          successTitle: "Student created successfully",
        });
      } else {
        toast.success("Student updated");
      }
      const profileStudentId =
        "loginEmail" in data ? data.student._id : data._id;
      setEditing(null);
      setPendingDocuments([]);
      await queryClient.invalidateQueries({ queryKey: ["students"] });
      await queryClient.invalidateQueries({
        queryKey: ["student-profile", profileStudentId],
      });
    },
    onError: (error) => toast.error(parseErrorMessage(error)),
  });

  const isLoading = isCollege
    ? batchesQuery.isLoading || yearsQuery.isLoading
    : classesQuery.isLoading || sectionsQuery.isLoading;

  if (!canManage) {
    return null;
  }

  if (isLoading) {
    return <LoadingState />;
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>
          {editing ? "Edit Student" : "New Student Registration"}
        </CardTitle>
      </CardHeader>
      <CardContent>
        <StudentForm
          key={editing?._id ?? "new-student"}
          studentId={editing?._id}
          isEditing={Boolean(editing)}
          canManageDocuments={canManage}
          initialValue={editing ? mapStudentToInput(editing) : undefined}
          classes={classesQuery.data ?? []}
          sections={sectionsQuery.data ?? []}
          batches={batchesQuery.data ?? []}
          years={yearsQuery.data ?? []}
          submitting={studentMutation.isPending}
          uploadedBy={user?._id}
          uploadedByName={user?.fullName}
          pendingDocuments={pendingDocuments}
          onPendingDocumentsChange={setPendingDocuments}
          onCancel={
            editing
              ? () => {
                  setEditing(null);
                  setPendingDocuments([]);
                  navigate("/students/list", { replace: true });
                }
              : undefined
          }
          onSubmit={async (value) => {
            const wasEditing = Boolean(editing);
            const result = await studentMutation.mutateAsync(value);
            if (
              !wasEditing &&
              pendingDocuments.length > 0 &&
              "student" in result
            ) {
              await uploadPendingDocuments(
                result.student._id,
                pendingDocuments,
                user?._id ?? "",
                user?.fullName ?? "Admin",
              );
              setPendingDocuments([]);
              await queryClient.invalidateQueries({ queryKey: ["students"] });
              await queryClient.invalidateQueries({
                queryKey: ["student-profile", result.student._id],
              });
            }
            navigate("/students/list", { replace: true });
          }}
        />
      </CardContent>
    </Card>
  );
};
