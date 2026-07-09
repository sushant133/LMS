import { useMemo, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import {
  canManageInstitution,
  hasInstitutionAccess,
  COMPLAINANT_ROLES,
  COMPLAINT_CATEGORIES,
  COMPLAINT_CATEGORY_LABELS,
  COMPLAINT_STATUSES,
  COMPLAINT_STATUS_LABELS,
  createComplaintSchema,
  normalizeUserRole,
  USER_ROLE_LABELS,
  type ComplaintRecord,
  type ComplaintStatus,
  type CreateComplaintInput,
} from "@phit-erp/shared";
import { MessageSquareWarning, Send, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { AttachmentViewer } from "components/shared/AttachmentViewer";
import { EmptyState } from "components/shared/EmptyState";
import { FormField } from "components/shared/FormField";
import { PageContent } from "components/layout/PageContent";
import { PageHeader } from "components/shared/PageHeader";
import { Badge } from "components/ui/badge";
import { Button } from "components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "components/ui/card";
import { Input } from "components/ui/input";
import { Select } from "components/ui/select";
import { Textarea } from "components/ui/textarea";
import { useAuth } from "features/auth/AuthProvider";
import { ComplaintAttachmentUpload } from "features/complaints/ComplaintAttachmentUpload";
import { api, unwrap } from "lib/api";
import { queryClient } from "lib/queryClient";
import { cn, parseErrorMessage } from "lib/utils";

const defaultForm: CreateComplaintInput = {
  subject: "",
  category: "OTHER",
  content: "",
  attachments: [],
};

const statusBadgeClass: Record<ComplaintStatus, string> = {
  SUBMITTED: "bg-amber-100 text-amber-800",
  UNDER_REVIEW: "bg-blue-100 text-blue-800",
  RESOLVED: "bg-emerald-100 text-emerald-800",
  CLOSED: "bg-slate-200 text-slate-700",
};

const formatDate = (value?: string) => {
  if (!value) return "—";
  return new Date(value).toLocaleString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
};

export const ComplaintsManager = () => {
  const { user } = useAuth();
  const role = normalizeUserRole(user?.role ?? "");
  const canWriteAdmin = canManageInstitution(role);
  const canViewAll = hasInstitutionAccess(role);
  const canSubmit = COMPLAINANT_ROLES.includes(role);

  const [form, setForm] = useState<CreateComplaintInput>(defaultForm);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [statusDraft, setStatusDraft] = useState<{
    status: ComplaintStatus;
    adminResponse: string;
  }>({
    status: "UNDER_REVIEW",
    adminResponse: "",
  });

  const complaintsQuery = useQuery({
    queryKey: ["complaints"],
    queryFn: () => unwrap<ComplaintRecord[]>(api.get("/complaints")),
  });

  const complaints = complaintsQuery.data ?? [];

  const openCount = useMemo(
    () =>
      complaints.filter(
        (item) => item.status === "SUBMITTED" || item.status === "UNDER_REVIEW",
      ).length,
    [complaints],
  );

  const createComplaint = useMutation({
    mutationFn: (payload: CreateComplaintInput) =>
      unwrap(api.post("/complaints", payload)),
    onSuccess: () => {
      toast.success(
        "Complaint submitted. Only you and the college administration can view it.",
      );
      setForm(defaultForm);
      void queryClient.invalidateQueries({ queryKey: ["complaints"] });
    },
    onError: (error) => toast.error(parseErrorMessage(error)),
  });

  const updateStatus = useMutation({
    mutationFn: ({
      id,
      status,
      adminResponse,
    }: {
      id: string;
      status: ComplaintStatus;
      adminResponse: string;
    }) =>
      unwrap(api.patch(`/complaints/${id}/status`, { status, adminResponse })),
    onSuccess: () => {
      toast.success("Complaint status updated");
      setExpandedId(null);
      void queryClient.invalidateQueries({ queryKey: ["complaints"] });
    },
    onError: (error) => toast.error(parseErrorMessage(error)),
  });

  const deleteComplaint = useMutation({
    mutationFn: (id: string) => unwrap(api.delete(`/complaints/${id}`)),
    onSuccess: () => {
      toast.success("Complaint deleted");
      setExpandedId(null);
      void queryClient.invalidateQueries({ queryKey: ["complaints"] });
    },
    onError: (error) => toast.error(parseErrorMessage(error)),
  });

  const handleSubmit = () => {
    const parsed = createComplaintSchema.safeParse(form);
    if (!parsed.success) {
      toast.error(parsed.error.issues[0]?.message ?? "Please check the form");
      return;
    }
    createComplaint.mutate(parsed.data);
  };

  const startAdminReview = (complaint: ComplaintRecord) => {
    setExpandedId(complaint._id);
    setStatusDraft({
      status:
        complaint.status === "SUBMITTED" ? "UNDER_REVIEW" : complaint.status,
      adminResponse: complaint.adminResponse ?? "",
    });
  };

  return (
    <PageContent className="space-y-6">
      <PageHeader
        title="Complains"
        description={
          canViewAll
            ? "Review complaints submitted by students, teachers, and staff. Only the complainant and administrators can see each complaint."
            : "Submit a private complaint to college administration. Only you and the administrators can view your submissions."
        }
        action={
          canViewAll && openCount > 0 ? (
            <Badge className="bg-amber-500 text-white">{openCount} open</Badge>
          ) : null
        }
      />

      {canSubmit ? (
        <Card className="border-brand-100 shadow-sm">
          <CardHeader className="border-b border-slate-100 pb-4">
            <CardTitle className="flex items-center gap-2 text-lg">
              <MessageSquareWarning className="h-5 w-5 text-brand-600" />
              Submit a Complaint
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4 pt-6">
            <div className="grid gap-4 md:grid-cols-2">
              <FormField label="Subject">
                <Input
                  placeholder="Brief summary of your complaint"
                  value={form.subject}
                  onChange={(event) =>
                    setForm((current) => ({
                      ...current,
                      subject: event.target.value,
                    }))
                  }
                />
              </FormField>
              <FormField label="Category">
                <Select
                  value={form.category}
                  onChange={(event) =>
                    setForm((current) => ({
                      ...current,
                      category: event.target
                        .value as CreateComplaintInput["category"],
                    }))
                  }
                >
                  {COMPLAINT_CATEGORIES.map((category) => (
                    <option key={category} value={category}>
                      {COMPLAINT_CATEGORY_LABELS[category]}
                    </option>
                  ))}
                </Select>
              </FormField>
            </div>

            <FormField label="Details">
              <Textarea
                rows={5}
                placeholder="Describe your complaint in detail. Include dates, names, or specific incidents if relevant."
                value={form.content}
                onChange={(event) =>
                  setForm((current) => ({
                    ...current,
                    content: event.target.value,
                  }))
                }
              />
            </FormField>

            <FormField label="Supporting files">
              <ComplaintAttachmentUpload
                attachments={form.attachments}
                onChange={(attachments) =>
                  setForm((current) => ({ ...current, attachments }))
                }
                disabled={createComplaint.isPending}
              />
            </FormField>

            <div className="flex justify-end border-t border-slate-100 pt-4">
              <Button
                onClick={handleSubmit}
                disabled={createComplaint.isPending}
              >
                <Send className="mr-2 h-4 w-4" />
                {createComplaint.isPending
                  ? "Submitting..."
                  : "Submit Complaint"}
              </Button>
            </div>
          </CardContent>
        </Card>
      ) : null}

      <div className="space-y-3">
        <h3 className="text-sm font-semibold uppercase tracking-wide text-slate-500">
          {canViewAll ? "All Complaints" : "My Complaints"}
        </h3>

        {complaintsQuery.isLoading ? (
          <Card>
            <CardContent className="py-10 text-center text-sm text-slate-500">
              Loading complaints...
            </CardContent>
          </Card>
        ) : complaints.length === 0 ? (
          <EmptyState
            title="No complaints yet"
            description={
              canSubmit
                ? "Use the form above to submit your first complaint to the college administration."
                : "No complaints have been submitted yet."
            }
          />
        ) : (
          complaints.map((complaint) => {
            const isExpanded = expandedId === complaint._id;

            return (
              <Card key={complaint._id} className="overflow-hidden">
                <CardContent className="space-y-4 py-5">
                  <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                    <div className="min-w-0 flex-1 space-y-2">
                      <div className="flex flex-wrap items-center gap-2">
                        <h4 className="font-semibold text-slate-900">
                          {complaint.subject}
                        </h4>
                        <Badge
                          className={cn(
                            "text-xs",
                            statusBadgeClass[complaint.status],
                          )}
                        >
                          {COMPLAINT_STATUS_LABELS[complaint.status]}
                        </Badge>
                        <Badge className="bg-slate-100 text-slate-700">
                          {COMPLAINT_CATEGORY_LABELS[complaint.category]}
                        </Badge>
                      </div>
                      <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-slate-500">
                        <span>Submitted {formatDate(complaint.createdAt)}</span>
                        {canViewAll && complaint.submitterName ? (
                          <span>By {complaint.submitterName}</span>
                        ) : null}
                        {canViewAll ? (
                          <span>
                            {USER_ROLE_LABELS[complaint.submitterRole]}
                          </span>
                        ) : null}
                      </div>
                    </div>

                    {canViewAll ? (
                      <div className="flex shrink-0 flex-wrap gap-2">
                        {canWriteAdmin ? (
                          <>
                            <Button
                              size="sm"
                              variant="secondary"
                              onClick={() =>
                                isExpanded
                                  ? setExpandedId(null)
                                  : startAdminReview(complaint)
                              }
                            >
                              {isExpanded ? "Close" : "Manage"}
                            </Button>
                            <Button
                              size="sm"
                              variant="destructive"
                              disabled={deleteComplaint.isPending}
                              onClick={() => {
                                const confirmed = window.confirm(
                                  `Delete complaint "${complaint.subject}"? This cannot be undone.`,
                                );
                                if (confirmed) {
                                  deleteComplaint.mutate(complaint._id);
                                }
                              }}
                            >
                              <Trash2 className="mr-1 h-3.5 w-3.5" />
                              Delete
                            </Button>
                          </>
                        ) : (
                          <Button
                            size="sm"
                            variant="secondary"
                            onClick={() =>
                              isExpanded
                                ? setExpandedId(null)
                                : setExpandedId(complaint._id)
                            }
                          >
                            {isExpanded ? "Close" : "View"}
                          </Button>
                        )}
                      </div>
                    ) : null}
                  </div>

                  <p className="whitespace-pre-wrap text-sm leading-relaxed text-slate-700">
                    {complaint.content}
                  </p>

                  {complaint.attachments.length > 0 ? (
                    <AttachmentViewer
                      attachments={complaint.attachments}
                      title="Attached evidence"
                    />
                  ) : null}

                  {complaint.adminResponse ? (
                    <div className="rounded-xl border border-emerald-100 bg-emerald-50/60 p-4">
                      <p className="text-xs font-semibold uppercase tracking-wide text-emerald-700">
                        Administration response
                      </p>
                      <p className="mt-1 whitespace-pre-wrap text-sm text-emerald-900">
                        {complaint.adminResponse}
                      </p>
                      {complaint.resolvedByName ? (
                        <p className="mt-2 text-xs text-emerald-700">
                          Updated by {complaint.resolvedByName}
                          {complaint.resolvedAt
                            ? ` · ${formatDate(complaint.resolvedAt)}`
                            : ""}
                        </p>
                      ) : null}
                    </div>
                  ) : null}

                  {canWriteAdmin && isExpanded ? (
                    <div className="space-y-3 rounded-xl border border-slate-200 bg-slate-50 p-4">
                      <div className="grid gap-3 md:grid-cols-2">
                        <FormField label="Status">
                          <Select
                            value={statusDraft.status}
                            onChange={(event) =>
                              setStatusDraft((current) => ({
                                ...current,
                                status: event.target.value as ComplaintStatus,
                              }))
                            }
                          >
                            {COMPLAINT_STATUSES.map((status) => (
                              <option key={status} value={status}>
                                {COMPLAINT_STATUS_LABELS[status]}
                              </option>
                            ))}
                          </Select>
                        </FormField>
                      </div>
                      <FormField label="Response to complainant">
                        <Textarea
                          rows={3}
                          placeholder="Optional message visible to the person who submitted this complaint"
                          value={statusDraft.adminResponse}
                          onChange={(event) =>
                            setStatusDraft((current) => ({
                              ...current,
                              adminResponse: event.target.value,
                            }))
                          }
                        />
                      </FormField>
                      <div className="flex justify-end">
                        <Button
                          onClick={() =>
                            updateStatus.mutate({
                              id: complaint._id,
                              status: statusDraft.status,
                              adminResponse: statusDraft.adminResponse,
                            })
                          }
                          disabled={updateStatus.isPending}
                        >
                          {updateStatus.isPending
                            ? "Saving..."
                            : "Update status"}
                        </Button>
                      </div>
                    </div>
                  ) : null}
                </CardContent>
              </Card>
            );
          })
        )}
      </div>
    </PageContent>
  );
};
