import { useQuery } from "@tanstack/react-query";
import { useAuth } from "features/auth/AuthProvider";
import { api, unwrap } from "lib/api";

export const useNotificationBadge = () => {
  const { user } = useAuth();

  const query = useQuery({
    queryKey: ["notification-count"],
    queryFn: async () => {
      const response = await unwrap<{ count: number }>(api.get("/notifications/unread-count"));
      return response.count;
    },
    enabled: Boolean(user),
    staleTime: 30_000,
    placeholderData: 0
  });

  return {
    unreadCount: query.data ?? 0,
    isLoading: query.isLoading
  };
};