import type { DashboardResponse, NotificationRecord } from "@phit-erp/shared";
import { queryClient } from "lib/queryClient";

const patchDashboardNotifications = (
  old: DashboardResponse | undefined,
  notificationId?: string,
): DashboardResponse | undefined => {
  if (!old) {
    return old;
  }

  // Cleared notifications are removed entirely (no read history)
  const nextNotifications = notificationId
    ? (old.notifications ?? []).filter((item) => item._id !== notificationId)
    : [];

  const nextUnread = notificationId
    ? Math.max(0, (old.unreadNotificationCount ?? 0) - 1)
    : 0;

  return {
    ...old,
    unreadNotificationCount: nextUnread,
    notifications: nextNotifications.filter((n) => !n.read).slice(0, 5),
    stats: (old.stats ?? []).map((stat) =>
      stat.label === "Unread Alerts" ? { ...stat, value: nextUnread } : stat,
    ),
    highlights: (old.highlights ?? [])
      .filter(
        (highlight) =>
          nextUnread > 0 || highlight.label !== "Unread notifications",
      )
      .map((highlight) =>
        highlight.label === "Unread notifications"
          ? {
              ...highlight,
              value: `${nextUnread} new alert${nextUnread === 1 ? "" : "s"}`,
            }
          : highlight,
      ),
  };
};

/**
 * Optimistic local updates when a notification is read/cleared.
 * Removes the item from lists and updates the badge count.
 */
export const applyNotificationReadLocally = (notificationId?: string): void => {
  queryClient.setQueriesData<number>({ queryKey: ["notification-count"] }, (count) => {
    const current = typeof count === "number" ? count : 0;
    return notificationId ? Math.max(0, current - 1) : 0;
  });

  queryClient.setQueriesData<DashboardResponse>({ queryKey: ["dashboard"] }, (old) =>
    patchDashboardNotifications(old, notificationId),
  );

  queryClient.setQueriesData<NotificationRecord[]>(
    { queryKey: ["notifications"] },
    (old) => {
      if (!old) return old;
      if (notificationId) {
        return old.filter((item) => item._id !== notificationId);
      }
      return [];
    },
  );
};

export const invalidateNotificationQueries = async (): Promise<void> => {
  await Promise.all([
    queryClient.invalidateQueries({ queryKey: ["notifications"] }),
    queryClient.invalidateQueries({ queryKey: ["notification-count"] }),
    queryClient.invalidateQueries({ queryKey: ["dashboard"] }),
  ]);
};
