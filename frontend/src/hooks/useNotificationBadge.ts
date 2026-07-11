import { useQuery } from "@tanstack/react-query";
import { useAuth } from "features/auth/AuthProvider";
import { api, unwrap } from "lib/api";

/**
 * Unread count for sidebar badge — always the current user's personal inbox.
 * Polls periodically and refetches on window focus so it stays synced with
 * Notification Center and Dashboard.
 */
export const useNotificationBadge = () => {
  const { user } = useAuth();

  const query = useQuery({
    queryKey: ["notification-count", user?._id],
    queryFn: async () => {
      const response = await unwrap<{ count: number }>(
        api.get("/notifications/unread-count"),
      );
      return response.count;
    },
    enabled: Boolean(user),
    staleTime: 20_000,
    refetchInterval: 60_000,
    refetchOnWindowFocus: true,
    placeholderData: 0,
  });

  return {
    unreadCount: query.data ?? 0,
    isLoading: query.isLoading,
    refetch: query.refetch,
  };
};
