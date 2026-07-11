import { useMutation, useQuery } from "@tanstack/react-query";
import type { NotificationRecord } from "@phit-erp/shared";
import { Bell, CheckCheck } from "lucide-react";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import { PageContent } from "components/layout/PageContent";
import { PageHeader } from "components/shared/PageHeader";
import { Badge } from "components/ui/badge";
import { Button } from "components/ui/button";
import { Card, CardContent } from "components/ui/card";
import { Select } from "components/ui/select";
import { api, unwrap } from "lib/api";
import {
  applyNotificationReadLocally,
  invalidateNotificationQueries,
} from "lib/notificationQueries";
import { cn } from "lib/utils";

const TYPE_FILTERS: Array<{ value: string; label: string }> = [
  { value: "", label: "All types" },
  { value: "ACADEMIC_MANAGEMENT", label: "Academic Management" },
  { value: "ACADEMIC_CALENDAR", label: "Academic Calendar" },
  { value: "ATTENDANCE", label: "Attendance" },
  { value: "HOMEWORK", label: "Homework" },
  { value: "FEE", label: "Fees" },
  { value: "EXAM", label: "Exams" },
  { value: "NOTICE", label: "Notices" },
  { value: "LIBRARY", label: "Library" },
  { value: "LABORATORY", label: "Laboratory" },
  { value: "COMPLAINT", label: "Complaints" },
  { value: "GENERAL", label: "General" },
];

const formatWhen = (value?: string): string => {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  });
};

const typeBadgeClass = (type: string): string => {
  switch (type) {
    case "FEE":
    case "COMPLAINT":
      return "bg-rose-100 text-rose-800";
    case "ACADEMIC_MANAGEMENT":
    case "EXAM":
      return "bg-violet-100 text-violet-800";
    case "LIBRARY":
    case "LABORATORY":
      return "bg-sky-100 text-sky-800";
    case "ATTENDANCE":
    case "HOMEWORK":
      return "bg-amber-100 text-amber-900";
    default:
      return "bg-slate-100 text-slate-700";
  }
};

export const NotificationCenter = () => {
  const [statusFilter, setStatusFilter] = useState<"all" | "unread" | "read">(
    "all",
  );
  const [typeFilter, setTypeFilter] = useState("");

  const notificationsQuery = useQuery({
    queryKey: ["notifications"],
    queryFn: () =>
      unwrap<NotificationRecord[]>(
        api.get("/notifications", { params: { limit: 100 } }),
      ),
    staleTime: 15_000,
    refetchOnWindowFocus: true,
  });

  const notifications = notificationsQuery.data ?? [];

  const filtered = useMemo(() => {
    return notifications.filter((item) => {
      if (statusFilter === "unread" && item.read) return false;
      if (statusFilter === "read" && !item.read) return false;
      if (typeFilter && item.type !== typeFilter) return false;
      return true;
    });
  }, [notifications, statusFilter, typeFilter]);

  const unreadCount = notifications.filter((item) => !item.read).length;

  const markRead = useMutation({
    mutationFn: (id: string) => unwrap(api.put(`/notifications/${id}/read`)),
    onMutate: (id) => {
      applyNotificationReadLocally(id);
    },
    onError: async () => {
      toast.error("Could not mark notification as read");
      await invalidateNotificationQueries();
    },
    onSettled: async () => {
      await invalidateNotificationQueries();
    },
  });

  const markAllRead = useMutation({
    mutationFn: () => unwrap(api.put("/notifications/read-all")),
    onMutate: () => {
      applyNotificationReadLocally();
    },
    onSuccess: () => {
      toast.success("All notifications marked read");
    },
    onError: async () => {
      toast.error("Could not mark all as read");
      await invalidateNotificationQueries();
    },
    onSettled: async () => {
      await invalidateNotificationQueries();
    },
  });

  return (
    <PageContent className="space-y-6">
      <PageHeader
        title="Notifications"
        description="Your personal inbox for academic, fee, library, exam, and system alerts. Badge count stays in sync with this list."
        action={
          unreadCount > 0 ? (
            <Button
              variant="secondary"
              onClick={() => markAllRead.mutate()}
              disabled={markAllRead.isPending}
            >
              <CheckCheck className="mr-2 h-4 w-4" />
              Mark all read ({unreadCount})
            </Button>
          ) : null
        }
      />

      <div className="flex flex-wrap items-center gap-3">
        <div className="flex flex-wrap gap-2">
          {(
            [
              { id: "all", label: "All" },
              { id: "unread", label: `Unread (${unreadCount})` },
              { id: "read", label: "Read" },
            ] as const
          ).map((tab) => (
            <Button
              key={tab.id}
              size="sm"
              variant={statusFilter === tab.id ? "default" : "outline"}
              onClick={() => setStatusFilter(tab.id)}
            >
              {tab.label}
            </Button>
          ))}
        </div>
        <Select
          className="w-full max-w-xs sm:ml-auto"
          value={typeFilter}
          onChange={(event) => setTypeFilter(event.target.value)}
        >
          {TYPE_FILTERS.map((opt) => (
            <option key={opt.value || "all"} value={opt.value}>
              {opt.label}
            </option>
          ))}
        </Select>
      </div>

      <div className="space-y-3">
        {notificationsQuery.isLoading ? (
          <Card>
            <CardContent className="py-8 text-center text-sm text-slate-500">
              Loading notifications...
            </CardContent>
          </Card>
        ) : notifications.length === 0 ? (
          <Card>
            <CardContent className="flex flex-col items-center gap-2 py-10 text-center text-sm text-slate-500">
              <Bell className="h-8 w-8 text-slate-300" />
              <p>No notifications yet.</p>
              <p className="text-xs">
                Alerts for plans, fees, library, and exams will appear here.
              </p>
            </CardContent>
          </Card>
        ) : filtered.length === 0 ? (
          <Card>
            <CardContent className="py-8 text-center text-sm text-slate-500">
              No notifications match the current filters.
            </CardContent>
          </Card>
        ) : (
          filtered.map((notification) => (
            <Card
              key={notification._id}
              className={cn(
                "min-w-0 transition",
                notification.read
                  ? "border-slate-200 opacity-80"
                  : "border-brand-200 bg-brand-50/30",
              )}
            >
              <CardContent className="flex flex-col gap-3 py-4 sm:flex-row sm:items-start sm:justify-between">
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="font-semibold text-slate-900">
                      {notification.title}
                    </p>
                    <Badge className={typeBadgeClass(notification.type)}>
                      {notification.type.replace(/_/g, " ")}
                    </Badge>
                    {notification.channel !== "IN_APP" ? (
                      <Badge className="bg-slate-100 text-slate-700">
                        {notification.channel}
                      </Badge>
                    ) : null}
                    {notification.smsStatus &&
                    notification.smsStatus !== "SKIPPED" ? (
                      <Badge className="bg-slate-100 text-slate-700">
                        SMS {notification.smsStatus}
                      </Badge>
                    ) : null}
                    {!notification.read ? (
                      <Badge className="bg-brand-600 text-white">New</Badge>
                    ) : (
                      <Badge className="bg-slate-100 text-slate-600">Read</Badge>
                    )}
                  </div>
                  <p className="mt-1 text-sm text-slate-600">
                    {notification.message}
                  </p>
                  {notification.createdAt ? (
                    <p className="mt-2 text-xs text-slate-400">
                      {formatWhen(notification.createdAt)}
                    </p>
                  ) : null}
                </div>
                {!notification.read ? (
                  <Button
                    className="shrink-0 self-start"
                    size="sm"
                    variant="secondary"
                    onClick={() => markRead.mutate(notification._id)}
                    disabled={markRead.isPending}
                  >
                    Mark read
                  </Button>
                ) : null}
              </CardContent>
            </Card>
          ))
        )}
      </div>
    </PageContent>
  );
};
