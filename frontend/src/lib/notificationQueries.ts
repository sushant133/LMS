import type { DashboardResponse, NotificationRecord } from "@phit-erp/shared";
import { queryClient } from "lib/queryClient";

const patchDashboardNotifications = (
  old: DashboardResponse | undefined,
  notificationId?: string,
): DashboardResponse | undefined => {
  if (!old) {
    return old;
  }

  const nextUnread = notificationId
    ? Math.max(0, (old.unreadNotificationCount ?? 0) - 1)
    : 0;

  const nextNotifications = notificationId
    ? (old.notifications ?? []).map((item) =>
        item._id === notificationId ? { ...item, read: true } : item,
      )
    : (old.notifications ?? []).map((item) => ({ ...item, read: true }));

  // Dashboard panel usually only shows unread — keep unread-first list in sync
  const visibleNotifications = nextNotifications.filter((n) => !n.read).slice(0, 5);

  return {
    ...old,
    unreadNotificationCount: nextUnread,
    notifications: visibleNotifications,
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

/** Optimistic local updates so badge, list, and dashboard stay aligned immediately. */
export const applyNotificationReadLocally = (notificationId?: string): void => {
  // All notification-count query variants (with/without user id)
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
        return old.map((item) =>
          item._id === notificationId ? { ...item, read: true } : item,
        );
      }
      return old.map((item) => ({ ...item, read: true }));
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
