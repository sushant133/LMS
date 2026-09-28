import { useMutation, useQuery } from "@tanstack/react-query";
import type { NotificationRecord } from "@phit-erp/shared";
import { Bell, CheckCheck, ChevronRight, Trash2 } from "lucide-react";
import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { PageContent } from "components/layout/PageContent";
import { PageHeader } from "components/shared/PageHeader";
import { Badge } from "components/ui/badge";
import { Button } from "components/ui/button";
import { Card, CardContent } from "components/ui/card";
import { Select } from "components/ui/select";
import { useAuth } from "features/auth/AuthProvider";
import { api, resolveMediaUrl, unwrap } from "lib/api";
import {
  applyNotificationReadLocally,
  applyNotificationRemovedLocally,
  invalidateNotificationQueries,
} from "lib/notificationQueries";
import {
  notificationImage,
  resolveNotificationTarget,
} from "lib/notificationTarget";
import { cn } from "lib/utils";
import { NotificationImageViewer } from "./NotificationImageViewer";

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
  const [typeFilter, setTypeFilter] = useState("");
  const [viewing, setViewing] = useState<{ url: string; title: string } | null>(
    null,
  );
  const navigate = useNavigate();
  const { user } = useAuth();

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
      if (typeFilter && item.type !== typeFilter) return false;
      return true;
    });
  }, [notifications, typeFilter]);

  const unreadCount = notifications.filter((item) => !item.read).length;
  const totalCount = notifications.length;

  const markRead = useMutation({
    mutationFn: (id: string) => unwrap(api.put(`/notifications/${id}/read`)),
    onMutate: (id) => {
      applyNotificationReadLocally(id);
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
    onError: () => {
      toast.error("Could not mark notifications as read");
    },
    onSettled: async () => {
      await invalidateNotificationQueries();
    },
  });

  const clearOne = useMutation({
    mutationFn: (id: string) => unwrap(api.delete(`/notifications/${id}`)),
    onMutate: (id) => {
      applyNotificationRemovedLocally(id);
    },
    onSuccess: () => {
      toast.success("Notification cleared");
    },
    onError: () => {
      toast.error("Could not clear notification");
    },
    onSettled: async () => {
      await invalidateNotificationQueries();
    },
  });

  const clearAll = useMutation({
    mutationFn: () => unwrap(api.delete("/notifications")),
    onMutate: () => {
      applyNotificationRemovedLocally();
    },
    onSuccess: () => {
      toast.success("All notifications cleared");
    },
    onError: () => {
      toast.error("Could not clear notifications");
    },
    onSettled: async () => {
      await invalidateNotificationQueries();
    },
  });

  const markSeen = (notification: NotificationRecord) => {
    if (!notification.read) {
      markRead.mutate(notification._id);
    }
  };

  const openImage = (notification: NotificationRecord) => {
    const image = notificationImage(notification.metadata);
    if (!image) return;
    markSeen(notification);
    setViewing({ url: image.full, title: notification.title });
  };

  const openNotification = (notification: NotificationRecord) => {
    markSeen(notification);
    const target = resolveNotificationTarget(notification, user);
    if (target) {
      navigate(target);
      return;
    }
    // Nothing to open — an image is the content itself.
    openImage(notification);
  };

  return (
    <PageContent className="space-y-6">
      <PageHeader
        title="Notifications"
        description="Tap a notification to open it. Seen notifications stay here until you clear them."
        action={
          totalCount > 0 ? (
            <div className="flex flex-wrap gap-2">
              {unreadCount > 0 ? (
                <Button
                  variant="secondary"
                  onClick={() => markAllRead.mutate()}
                  disabled={markAllRead.isPending}
                >
                  <CheckCheck className="mr-2 h-4 w-4" />
                  Mark all as read
                </Button>
              ) : null}
              <Button
                variant="secondary"
                onClick={() => clearAll.mutate()}
                disabled={clearAll.isPending}
              >
                <Trash2 className="mr-2 h-4 w-4" />
                Clear all ({totalCount})
              </Button>
            </div>
          ) : null
        }
      />

      <div className="flex flex-wrap items-center gap-3">
        {unreadCount > 0 ? (
          <Badge className="bg-brand-600 text-white">
            {unreadCount} unread
          </Badge>
        ) : null}
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
              <p>No notifications</p>
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
          filtered.map((notification) => {
            const unread = !notification.read;
            const image = notificationImage(notification.metadata);
            const target = resolveNotificationTarget(notification, user);
            return (
              <Card
                key={notification._id}
                role="button"
                tabIndex={0}
                aria-label={`${unread ? "Unread: " : ""}${notification.title}`}
                className={cn(
                  "min-w-0 cursor-pointer transition hover:border-brand-300",
                  unread
                    ? "border-brand-200 bg-brand-50/60"
                    : "border-slate-200 bg-white",
                )}
                onClick={() => openNotification(notification)}
                onKeyDown={(event) => {
                  if (event.target !== event.currentTarget) return;
                  if (event.key === "Enter" || event.key === " ") {
                    event.preventDefault();
                    openNotification(notification);
                  }
                }}
              >
                <CardContent className="flex flex-col gap-3 py-4 sm:flex-row sm:items-start sm:justify-between">
                  <div className="flex min-w-0 flex-1 gap-3">
                    <span
                      aria-hidden
                      className={cn(
                        "mt-1.5 h-2.5 w-2.5 shrink-0 rounded-full",
                        unread ? "bg-brand-600" : "bg-transparent",
                      )}
                    />
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <p
                          className={cn(
                            unread
                              ? "font-semibold text-slate-900"
                              : "font-medium text-slate-700",
                          )}
                        >
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
                        {unread ? (
                          <Badge className="bg-brand-600 text-white">New</Badge>
                        ) : null}
                      </div>
                      <p
                        className={cn(
                          "mt-1 text-sm",
                          unread ? "text-slate-700" : "text-slate-500",
                        )}
                      >
                        {notification.message}
                      </p>
                      {image ? (
                        <button
                          type="button"
                          className="mt-2 block overflow-hidden rounded-lg border border-slate-200 transition hover:border-brand-300 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500"
                          aria-label="View image"
                          onClick={(event) => {
                            event.stopPropagation();
                            openImage(notification);
                          }}
                        >
                          <img
                            src={resolveMediaUrl(image.thumb)}
                            alt=""
                            loading="lazy"
                            className="h-20 w-32 object-cover"
                          />
                        </button>
                      ) : null}
                      <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
                        {notification.createdAt ? (
                          <span
                            className={cn(
                              unread ? "font-medium text-brand-700" : "text-slate-400",
                            )}
                          >
                            {formatWhen(notification.createdAt)}
                          </span>
                        ) : null}
                        {target ? (
                          <span className="inline-flex items-center text-slate-500">
                            Open
                            <ChevronRight className="h-3.5 w-3.5" />
                          </span>
                        ) : null}
                      </div>
                    </div>
                  </div>
                  <Button
                    className="shrink-0 self-start"
                    size="sm"
                    variant="secondary"
                    onClick={(event) => {
                      event.stopPropagation();
                      clearOne.mutate(notification._id);
                    }}
                    disabled={clearOne.isPending && clearOne.variables === notification._id}
                  >
                    Clear
                  </Button>
                </CardContent>
              </Card>
            );
          })
        )}
      </div>

      {viewing ? (
        <NotificationImageViewer
          imageUrl={viewing.url}
          title={viewing.title}
          onClose={() => setViewing(null)}
        />
      ) : null}
    </PageContent>
  );
};
