import { useMemo, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { BookOpen, Filter, Plus } from "lucide-react";
import type {
  AssignmentInput,
  ClassroomFeedResponse,
  ClassroomPost,
} from "@phit-erp/shared";
import { ASSIGNMENT_TYPES } from "@phit-erp/shared";
import { toast } from "sonner";
import { useAuth } from "features/auth/AuthProvider";
import { PageContent } from "components/layout/PageContent";
import { EmptyState } from "components/shared/EmptyState";
import { LoadingState } from "components/shared/LoadingState";
import { Button } from "components/ui/button";
import { Input } from "components/ui/input";
import { Select } from "components/ui/select";
import { useTeacherScope } from "hooks/useTeacherScope";
import { api, unwrap } from "lib/api";
import { queryClient } from "lib/queryClient";
import { parseErrorMessage } from "lib/utils";
import { ClassroomPostCard } from "./ClassroomPostCard";
import { ComposePostModal } from "./ComposePostModal";
import { PostDetailPanel } from "./PostDetailPanel";
import { TYPE_LABELS } from "./homeworkUtils";

const STATUS_FILTER_OPTIONS = [
  { value: "", label: "All statuses" },
  { value: "UPCOMING", label: "Upcoming" },
  { value: "DUE_TODAY", label: "Due Today" },
  { value: "OVERDUE", label: "Overdue" },
  { value: "PENDING", label: "Not Submitted" },
  { value: "SUBMITTED", label: "Submitted" },
  { value: "GRADED", label: "Graded" },
];

export const HomeworkManager = () => {
  const { user } = useAuth();
  const isTeacher = user?.role === "TEACHER";
  const isStudent = user?.role === "STUDENT";
  const isParent = user?.role === "PARENT";
  const isPortalUser = isStudent || isParent;
  const canManage = isTeacher;
  const teacherScopeQuery = useTeacherScope(isTeacher);

  const [composeOpen, setComposeOpen] = useState(false);
  const [editingPost, setEditingPost] = useState<ClassroomPost | null>(null);
  const [selectedPostId, setSelectedPostId] = useState<string | null>(null);
  const [filters, setFilters] = useState({
    subjectId: "",
    topic: "",
    type: "",
    status: "",
    dateFrom: "",
    dateTo: "",
  });

  const subjectsQuery = useQuery({
    queryKey: ["subjects"],
    queryFn: () =>
      unwrap<Array<{ _id: string; name: string; code: string }>>(
        api.get("/academics/subjects"),
      ),
    enabled: isParent,
  });

  const studentSubjectsQuery = useQuery({
    queryKey: ["student-subjects"],
    queryFn: () =>
      unwrap<Array<{ _id: string; name: string; code: string }>>(
        api.get("/student/subjects"),
      ),
    enabled: isStudent,
  });

  const classes = isTeacher ? (teacherScopeQuery.data?.classes ?? []) : [];
  const sections = isTeacher ? (teacherScopeQuery.data?.sections ?? []) : [];
  const batches = isTeacher ? (teacherScopeQuery.data?.batches ?? []) : [];
  const years = isTeacher ? (teacherScopeQuery.data?.years ?? []) : [];
  const subjects = isTeacher
    ? (teacherScopeQuery.data?.subjects ?? [])
    : isStudent
      ? (studentSubjectsQuery.data ?? [])
      : (subjectsQuery.data ?? []);

  const feedQuery = useQuery({
    queryKey: ["homework-feed", filters],
    queryFn: () =>
      unwrap<ClassroomFeedResponse>(
        api.get("/homework/feed", {
          params: {
            subjectId: filters.subjectId || undefined,
            topic: filters.topic || undefined,
            type: filters.type || undefined,
            status: filters.status || undefined,
            dateFrom: filters.dateFrom || undefined,
            dateTo: filters.dateTo || undefined,
          },
        }),
      ),
  });

  const saveMutation = useMutation({
    mutationFn: async (payload: AssignmentInput) => {
      if (editingPost) {
        return unwrap(api.put(`/homework/${editingPost._id}`, payload));
      }
      return unwrap(api.post("/homework", payload));
    },
    onSuccess: async () => {
      toast.success(editingPost ? "Post updated" : "Post published");
      setComposeOpen(false);
      setEditingPost(null);
      await queryClient.invalidateQueries({ queryKey: ["homework-feed"] });
      if (selectedPostId) {
        await queryClient.invalidateQueries({
          queryKey: ["homework-detail", selectedPostId],
        });
      }
    },
    onError: (error) => toast.error(parseErrorMessage(error)),
  });

  const pinnedPosts = useMemo(
    () => (feedQuery.data?.posts ?? []).filter((post) => post.isPinned),
    [feedQuery.data?.posts],
  );
  const streamPosts = useMemo(
    () => (feedQuery.data?.posts ?? []).filter((post) => !post.isPinned),
    [feedQuery.data?.posts],
  );
  const topicSuggestions = feedQuery.data?.topics ?? [];

  const streamHero = (
    <div className="min-w-0 overflow-hidden rounded-3xl bg-gradient-to-r from-sky-600 to-blue-700 text-white shadow-lg">
      <div className="flex flex-col gap-4 p-5 sm:flex-row sm:items-center sm:justify-between sm:p-8">
        <div className="min-w-0 space-y-2">
          <div className="inline-flex items-center gap-2 rounded-full bg-white/15 px-3 py-1 text-xs font-medium">
            <BookOpen className="h-3.5 w-3.5 shrink-0" />
            Classroom Stream
          </div>
          <h1 className="text-xl font-bold sm:text-3xl">
            Assignments, CAS & Notes
          </h1>
          <p className="max-w-2xl text-sm text-sky-100 sm:text-base">
            {canManage
              ? "Share assignments, activities, and notes with your class."
              : "View assignments, CAS activities, and class notes from your teachers in one stream."}
          </p>
        </div>
        {canManage ? (
          <Button
            className="shrink-0 bg-white text-blue-700 hover:bg-sky-50"
            onClick={() => {
              setEditingPost(null);
              setComposeOpen(true);
            }}
          >
            <Plus className="mr-2 h-4 w-4" />
            Create
          </Button>
        ) : null}
      </div>
    </div>
  );

  const streamFilters = (
    <div className="min-w-0 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
      <div className="mb-3 flex items-center gap-2 text-sm font-medium text-slate-700">
        <Filter className="h-4 w-4 shrink-0" />
        Filter stream
      </div>
      <div className="grid min-w-0 grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
        <Select
          className="min-w-0"
          value={filters.subjectId}
          onChange={(event) =>
            setFilters((current) => ({
              ...current,
              subjectId: event.target.value,
            }))
          }
        >
          <option value="">All subjects</option>
          {subjects.map((subject) => (
            <option key={subject._id} value={subject._id}>
              {subject.name}
            </option>
          ))}
        </Select>
        <Select
          className="min-w-0"
          value={filters.type}
          onChange={(event) =>
            setFilters((current) => ({ ...current, type: event.target.value }))
          }
        >
          <option value="">All types</option>
          {ASSIGNMENT_TYPES.map((type) => (
            <option key={type} value={type}>
              {TYPE_LABELS[type]}
            </option>
          ))}
        </Select>
        <Select
          className="min-w-0"
          value={filters.status}
          onChange={(event) =>
            setFilters((current) => ({
              ...current,
              status: event.target.value,
            }))
          }
        >
          {STATUS_FILTER_OPTIONS.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </Select>
        <Input
          className="min-w-0 sm:col-span-2 xl:col-span-3"
          placeholder="Topic / unit"
          value={filters.topic}
          onChange={(event) =>
            setFilters((current) => ({ ...current, topic: event.target.value }))
          }
          list="stream-topic-suggestions"
        />
        {!isPortalUser ? (
          <div className="grid min-w-0 grid-cols-1 gap-2 sm:col-span-2 sm:grid-cols-2 xl:col-span-3">
            <Input
              placeholder="From (BS)"
              value={filters.dateFrom}
              onChange={(event) =>
                setFilters((current) => ({
                  ...current,
                  dateFrom: event.target.value,
                }))
              }
            />
            <Input
              placeholder="To (BS)"
              value={filters.dateTo}
              onChange={(event) =>
                setFilters((current) => ({
                  ...current,
                  dateTo: event.target.value,
                }))
              }
            />
          </div>
        ) : null}
      </div>
      <datalist id="stream-topic-suggestions">
        {topicSuggestions.map((topic) => (
          <option key={topic} value={topic} />
        ))}
      </datalist>
    </div>
  );

  if (feedQuery.isLoading) {
    return (
      <PageContent className="space-y-5">
        {streamHero}
        {streamFilters}
        <div className="flex min-h-[240px] items-center justify-center">
          <LoadingState />
        </div>
      </PageContent>
    );
  }

  if (feedQuery.isError) {
    return (
      <PageContent className="space-y-5">
        {streamHero}
        {streamFilters}
        <EmptyState
          title="Could not load classroom stream"
          description="Please refresh the page or try again in a moment."
        />
      </PageContent>
    );
  }

  return (
    <PageContent className="space-y-5">
      {streamHero}
      {streamFilters}

      {(feedQuery.data?.posts.length ?? 0) === 0 ? (
        <EmptyState
          title="No posts yet"
          description={
            canManage
              ? "Create your first assignment, CAS activity, or class note."
              : "Your teachers have not posted anything yet."
          }
        />
      ) : (
        <div className="space-y-6">
          {pinnedPosts.length > 0 ? (
            <section className="space-y-3">
              <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500">
                Pinned
              </h2>
              <div className="space-y-3">
                {pinnedPosts.map((post) => (
                  <ClassroomPostCard
                    key={post._id}
                    post={post}
                    onOpen={(item) => setSelectedPostId(item._id)}
                  />
                ))}
              </div>
            </section>
          ) : null}

          <section className="space-y-3">
            {pinnedPosts.length > 0 ? (
              <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500">
                Stream
              </h2>
            ) : null}
            <div className="space-y-3">
              {streamPosts.map((post) => (
                <ClassroomPostCard
                  key={post._id}
                  post={post}
                  onOpen={(item) => setSelectedPostId(item._id)}
                />
              ))}
            </div>
          </section>
        </div>
      )}

      <ComposePostModal
        open={composeOpen}
        editingPost={editingPost}
        classes={classes}
        sections={sections}
        batches={batches}
        years={years}
        subjects={subjects}
        topicSuggestions={topicSuggestions}
        scopedOnly={isTeacher}
        onClose={() => {
          setComposeOpen(false);
          setEditingPost(null);
        }}
        onSave={async (payload) => {
          await saveMutation.mutateAsync(payload);
        }}
        saving={saveMutation.isPending}
      />

      {selectedPostId ? (
        <PostDetailPanel
          postId={selectedPostId}
          canManage={canManage}
          studentId={feedQuery.data?.studentId}
          onClose={() => setSelectedPostId(null)}
          onEdit={(post) => {
            setEditingPost(post);
            setComposeOpen(true);
          }}
          onDeleted={async () => {
            setSelectedPostId(null);
            await queryClient.invalidateQueries({
              queryKey: ["homework-feed"],
            });
          }}
        />
      ) : null}
    </PageContent>
  );
};
