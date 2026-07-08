import type { DashboardResponse, NotificationRecord } from "@phit-erp/shared";
import { queryClient } from "lib/queryClient";

const patchDashboardNotifications = (
  old: DashboardResponse | undefined,
  notificationId?: string
): DashboardResponse | undefined => {
  if (!old) {
    return old;
  }

  const nextUnread = notificationId ? Math.max(0, old.unreadNotificationCount - 1) : 0;
  const nextNotifications = notificationId ? old.notifications.filter((item) => item._id !== notificationId) : [];

  return {
    ...old,
    unreadNotificationCount: nextUnread,
    notifications: nextNotifications,
    stats: old.stats.map((stat) =>
      stat.label === "Unread Alerts" ? { ...stat, value: nextUnread } : stat
    ),
    highlights: old.highlights
      .filter((highlight) => nextUnread > 0 || highlight.label !== "Unread notifications")
      .map((highlight) =>
        highlight.label === "Unread notifications"
          ? {
              ...highlight,
              value: `${nextUnread} new alert${nextUnread === 1 ? "" : "s"}`
            }
          : highlight
      )
  };
};

export const applyNotificationReadLocally = (notificationId?: string): void => {
  queryClient.setQueryData<number>(["notification-count"], (count) => {
    const current = typeof count === "number" ? count : 0;
    return notificationId ? Math.max(0, current - 1) : 0;
  });

  queryClient.setQueriesData<DashboardResponse>({ queryKey: ["dashboard"] }, (old) =>
    patchDashboardNotifications(old, notificationId)
  );

  queryClient.setQueryData<NotificationRecord[]>(["notifications"], (old) => {
    if (!old) {
      return old;
    }
    if (notificationId) {
      return old.map((item) => (item._id === notificationId ? { ...item, read: true } : item));
    }
    return old.map((item) => ({ ...item, read: true }));
  });
};

export const invalidateNotificationQueries = async (): Promise<void> => {
  await Promise.all([
    queryClient.invalidateQueries({ queryKey: ["notifications"] }),
    queryClient.invalidateQueries({ queryKey: ["notification-count"] }),
    queryClient.invalidateQueries({ queryKey: ["dashboard"] })
  ]);
};