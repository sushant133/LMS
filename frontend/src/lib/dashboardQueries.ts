import { queryClient } from "lib/queryClient";

export const invalidateDashboardQueries = async (): Promise<void> => {
  await Promise.all([
    queryClient.invalidateQueries({ queryKey: ["dashboard"] }),
    queryClient.invalidateQueries({ queryKey: ["dashboard-fee-dues"] })
  ]);
};