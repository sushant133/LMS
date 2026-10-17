import { MutationCache, QueryClient } from "@tanstack/react-query";

export const queryClient: QueryClient = new QueryClient({
  // Any successful write marks every cached query stale, so the staleTime below
  // never shows outdated data after a save — even in another module whose keys
  // the mutation did not invalidate. Only on-screen queries refetch right away.
  mutationCache: new MutationCache({
    onSuccess: () => {
      void queryClient.invalidateQueries({
        refetchType: "none",
        // Session state is managed explicitly by AuthProvider
        predicate: (query) => query.queryKey[0] !== "auth"
      });
    }
  }),
  defaultOptions: {
    queries: {
      // Never hammer the API with retries on 401/403/404 (was flooding teacher consoles)
      retry: (failureCount, error) => {
        const status = (error as { response?: { status?: number } })?.response?.status;
        if (status === 401 || status === 403 || status === 404) return false;
        return failureCount < 1;
      },
      refetchOnWindowFocus: false,
      // With the default of 0, every page visit / tab switch / remount re-downloaded
      // the same lists (students, batches, settings…). Reuse them for 30s instead.
      staleTime: 30_000,
      // Keep each section's last data in memory for 30 min (default 5). Going back
      // to a section then shows it instantly and refreshes quietly in the background.
      gcTime: 30 * 60_000
    }
  }
});
