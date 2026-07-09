import { useMutation, useQuery } from "@tanstack/react-query";
import type { NotificationRecord } from "@phit-erp/shared";
import { toast } from "sonner";
import { PageContent } from "components/layout/PageContent";
import { PageHeader } from "components/shared/PageHeader";
import { Badge } from "components/ui/badge";
import { Button } from "components/ui/button";
import { Card, CardContent } from "components/ui/card";
import { api, unwrap } from "lib/api";
import {
  applyNotificationReadLocally,
  invalidateNotificationQueries,
} from "lib/notificationQueries";
import { cn } from "lib/utils";

export const NotificationCenter = () => {
  const notificationsQuery = useQuery({
    queryKey: ["notifications"],
    queryFn: () => unwrap<NotificationRecord[]>(api.get("/notifications")),
  });

  const notifications = notificationsQuery.data ?? [];
  const unreadNotifications = notifications.filter((item) => !item.read);

  const markRead = useMutation({
    mutationFn: (id: string) => unwrap(api.put(`/notifications/${id}/read`)),
    onMutate: (id) => {
      applyNotificationReadLocally(id);
    },
    onError: async () => {
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
        description="In-app alerts and SMS delivery status for attendance, assignments, fees, and more."
        action={
          unreadNotifications.length > 0 ? (
            <Button
              variant="secondary"
              onClick={() => markAllRead.mutate()}
              disabled={markAllRead.isPending}
            >
              Mark all read
            </Button>
          ) : null
        }
      />
      <div className="space-y-3">
        {notificationsQuery.isLoading ? (
          <Card>
            <CardContent className="py-8 text-center text-sm text-slate-500">
              Loading notifications...
            </CardContent>
          </Card>
        ) : notifications.length === 0 ? (
          <Card>
            <CardContent className="py-8 text-center text-sm text-slate-500">
              No notifications yet.
            </CardContent>
          </Card>
        ) : unreadNotifications.length === 0 ? (
          <Card>
            <CardContent className="py-8 text-center text-sm text-slate-500">
              You&apos;re all caught up. No unread notifications.
            </CardContent>
          </Card>
        ) : (
          notifications.map((notification) => (
            <Card
              key={notification._id}
              className={cn("min-w-0", notification.read ? "opacity-70" : "")}
            >
              <CardContent className="flex flex-col gap-3 py-4 sm:flex-row sm:items-start sm:justify-between">
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="font-semibold text-slate-900">
                      {notification.title}
                    </p>
                    <Badge>{notification.type}</Badge>
                    <Badge>{notification.channel}</Badge>
                    {notification.smsStatus !== "SKIPPED" ? (
                      <Badge>{notification.smsStatus}</Badge>
                    ) : null}
                    {!notification.read ? (
                      <Badge className="bg-brand-600 text-white">New</Badge>
                    ) : null}
                  </div>
                  <p className="mt-1 text-sm text-slate-600">
                    {notification.message}
                  </p>
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
