import type { DashboardResponse, NotificationRecord } from "@phit-erp/shared";
import { queryClient } from "lib/queryClient";

/** One page of the Notifications page feed (useInfiniteQuery). */
export interface NotificationFeedPage {
  rows: NotificationRecord[];
  total: number;
}
/** Cached notification lists are either a plain array or the paged feed. */
type CachedNotifications =
  | NotificationRecord[]
  | { pages: NotificationFeedPage[]; pageParams: unknown[] }
  | undefined;
const cachedRows = (data: CachedNotifications): NotificationRecord[] =>
  !data ? [] : Array.isArray(data) ? data : data.pages.flatMap((page) => page.rows);

type NotificationChange =
  | { kind: "read"; id?: string }
  | { kind: "remove"; id?: string };

/** How many currently-unread notifications a change turns off the badge. */
const unreadAffected = (change: NotificationChange): number | "all" => {
  if (!change.id) {
    // Mark-all-read and clear-all both leave nothing unread.
    return "all";
  }
  const lists = queryClient.getQueriesData<CachedNotifications>({ queryKey: ["notifications"] });
  for (const [, list] of lists) {
    const match = cachedRows(list).find((item) => item._id === change.id);
    if (match) return match.read ? 0 : 1;
  }
  const dashboards = queryClient.getQueriesData<DashboardResponse>({ queryKey: ["dashboard"] });
  for (const [, dashboard] of dashboards) {
    const match = dashboard?.notifications?.find((item) => item._id === change.id);
    if (match) return match.read ? 0 : 1;
  }
  return 0;
};

const patchDashboardNotifications = (
  old: DashboardResponse | undefined,
  change: NotificationChange,
  delta: number | "all",
): DashboardResponse | undefined => {
  if (!old) {
    return old;
  }

  // The dashboard only lists unread notifications, so reading one also drops it there.
  const nextNotifications = change.id
    ? (old.notifications ?? []).filter((item) => item._id !== change.id)
    : [];

  const nextUnread =
    delta === "all" ? 0 : Math.max(0, (old.unreadNotificationCount ?? 0) - delta);

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

const applyNotificationChangeLocally = (change: NotificationChange): void => {
  const delta = unreadAffected(change);

  queryClient.setQueriesData<number>({ queryKey: ["notification-count"] }, (count) => {
    const current = typeof count === "number" ? count : 0;
    return delta === "all" ? 0 : Math.max(0, current - delta);
  });

  queryClient.setQueriesData<DashboardResponse>({ queryKey: ["dashboard"] }, (old) =>
    patchDashboardNotifications(old, change, delta),
  );

  const patchRows = (rows: NotificationRecord[]): NotificationRecord[] => {
    if (change.kind === "remove") {
      return change.id ? rows.filter((item) => item._id !== change.id) : [];
    }
    return rows.map((item) =>
      !change.id || item._id === change.id ? { ...item, read: true } : item,
    );
  };
  queryClient.setQueriesData<CachedNotifications>({ queryKey: ["notifications"] }, (old) => {
    if (!old) return old;
    if (Array.isArray(old)) return patchRows(old);
    const removed = change.kind === "remove" ? (change.id ? 1 : Infinity) : 0;
    return {
      ...old,
      pages: old.pages.map((page) => ({
        rows: patchRows(page.rows),
        total: Math.max(0, page.total - removed),
      })),
    };
  });

  // True totals shown on the Notifications page
  queryClient.setQueriesData<{ count: number; total: number }>(
    { queryKey: ["notification-totals"] },
    (old) => {
      if (!old) return old;
      const count = delta === "all" ? 0 : Math.max(0, old.count - delta);
      const total =
        change.kind === "remove" ? (change.id ? Math.max(0, old.total - 1) : 0) : old.total;
      return { count, total };
    },
  );
};

/**
 * Optimistic update when a notification is opened (seen). It stays in the inbox,
 * un-highlighted; only the unread badge drops. Omit the id for "mark all as read".
 */
export const applyNotificationReadLocally = (notificationId?: string): void =>
  applyNotificationChangeLocally({ kind: "read", id: notificationId });

/**
 * Optimistic update when a notification is cleared (deleted from the inbox).
 * Omit the id for "clear all".
 */
export const applyNotificationRemovedLocally = (notificationId?: string): void =>
  applyNotificationChangeLocally({ kind: "remove", id: notificationId });

export const invalidateNotificationQueries = async (): Promise<void> => {
  await Promise.all([
    queryClient.invalidateQueries({ queryKey: ["notifications"] }),
    queryClient.invalidateQueries({ queryKey: ["notification-count"] }),
    queryClient.invalidateQueries({ queryKey: ["notification-totals"] }),
    queryClient.invalidateQueries({ queryKey: ["dashboard"] }),
  ]);
};
