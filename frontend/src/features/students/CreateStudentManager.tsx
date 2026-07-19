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
import { Button } from "components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "components/ui/card";
import { LoadingState } from "components/shared/LoadingState";
import { useAuth } from "features/auth/AuthProvider";
import { useIsCollege } from "hooks/useInstitutionType";
import { useIsTenantAdmin } from "hooks/useNormalizedRole";
import { api, unwrap } from "lib/api";
import {
  toastCredentialCreateResult,
  toastCredentialUpdateResult,
  toastResendCredentials,
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
import {
  countPendingRequiredDocuments,
  type PendingStudentDocument,
} from "./studentDocumentUtils";

type StudentWriteResult =
  | {
      student: StudentRecord;
      loginEmail: string;
      defaultPassword?: string;
      credentialsEmail?: CredentialsEmailResult;
      credentialsChanged?: boolean;
    }
  | {
      student: StudentRecord;
      loginEmail?: string;
      defaultPassword?: string;
      credentialsEmail?: CredentialsEmailResult;
      credentialsChanged?: boolean;
    };

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
        ? unwrap<StudentWriteResult>(api.put(`/students/${editing._id}`, payload))
        : unwrap<StudentWriteResult>(api.post("/students", payload)),
    onSuccess: async (data) => {
      if (editing) {
        toastCredentialUpdateResult(data, {
          successTitle: "Student updated — credentials emailed",
          noCredentialChangeTitle: "Student updated successfully",
        });
      } else {
        toastCredentialCreateResult(data, {
          successTitle: "Student created successfully",
        });
      }
      const profileStudentId = data.student._id;
      setEditing(null);
      setPendingDocuments([]);
      await queryClient.invalidateQueries({ queryKey: ["students"] });
      await queryClient.invalidateQueries({
        queryKey: ["student-profile", profileStudentId],
      });
    },
    onError: (error) => toast.error(parseErrorMessage(error)),
  });

  const resendCredentialsMutation = useMutation({
    mutationFn: async (userId: string) => toastResendCredentials(userId),
  });

  const isLoading = isCollege
    ? batchesQuery.isLoading || yearsQuery.isLoading
    : classesQuery.isLoading || sectionsQuery.isLoading;

  if (!canManage) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>New Student Registration</CardTitle>
        </CardHeader>
        <CardContent className="text-sm text-slate-600">
          You do not have permission to create or edit students. Contact a college
          administrator if you need access.
        </CardContent>
      </Card>
    );
  }

  if (isLoading) {
    return <LoadingState />;
  }

  return (
    <Card>
      <CardHeader className="flex flex-row flex-wrap items-start justify-between gap-3">
        <div>
          <CardTitle>
            {editing ? "Edit Student" : "New Student Registration"}
          </CardTitle>
          {editing ? (
            <p className="mt-1 text-sm text-slate-600">
              Changing Login ID or password emails the student their new access
              details. You can also resend credentials without editing other
              fields.
            </p>
          ) : null}
        </div>
        {editing?.user?._id ? (
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={resendCredentialsMutation.isPending}
            onClick={() => {
              if (
                !window.confirm(
                  `Resend login credentials to ${editing.user.fullName} (${editing.user.email})?\n\nA new password will be generated and emailed to the student.`,
                )
              ) {
                return;
              }
              void resendCredentialsMutation.mutateAsync(editing.user._id);
            }}
          >
            {resendCredentialsMutation.isPending
              ? "Sending..."
              : "Resend credentials"}
          </Button>
        ) : null}
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
            const queuedDocs = pendingDocuments;
            const result = await studentMutation.mutateAsync(value);
            if (!wasEditing && queuedDocs.length > 0) {
              await uploadPendingDocuments(
                result.student._id,
                queuedDocs,
                user?._id ?? "",
                user?.fullName ?? "Admin",
              );
              setPendingDocuments([]);
              await queryClient.invalidateQueries({ queryKey: ["students"] });
              await queryClient.invalidateQueries({
                queryKey: ["student-profile", result.student._id],
              });
            }
            if (!wasEditing) {
              // Remaining required docs after any queued uploads stay PENDING
              const uploadedTypes = new Set(queuedDocs.map((d) => d.type));
              const docsAfterCreate = (result.student.documents ?? []).map(
                (doc) =>
                  uploadedTypes.has(doc.type)
                    ? { ...doc, status: "UPLOADED" as const, url: "uploaded" }
                    : doc,
              );
              const pendingCount =
                countPendingRequiredDocuments(docsAfterCreate);
              if (pendingCount > 0) {
                toast.message(
                  `${pendingCount} required document${pendingCount === 1 ? "" : "s"} marked as pending`,
                  {
                    description:
                      "You can upload them later from the student profile.",
                  },
                );
              }
            }
            navigate("/students/list", { replace: true });
          }}
        />
      </CardContent>
    </Card>
  );
};
