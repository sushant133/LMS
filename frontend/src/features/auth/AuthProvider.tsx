import type { PropsWithChildren } from "react";
import { createContext, useContext, useMemo, useState } from "react";
import { flushSync } from "react-dom";
import { useMutation, useQuery } from "@tanstack/react-query";
import type {
  AuthResponse,
  LoginInput,
  RegisterInput,
  SchoolRecord,
  UserProfile,
} from "@phit-erp/shared";
import { api, unwrap } from "lib/api";
import { queryClient } from "lib/queryClient";

interface AuthContextValue {
  user: UserProfile | null;
  availableSchools: SchoolRecord[];
  activeSchoolId: string | null;
  loading: boolean;
  loggingOut: boolean;
  authEpoch: number;
  login: (payload: LoginInput) => Promise<AuthResponse>;
  register: (payload: RegisterInput) => Promise<AuthResponse>;
  logout: () => Promise<void>;
  setActiveSchool: (schoolId: string) => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

interface MeResponse extends AuthResponse {}

const keepAuthMeQuery = (queryKey: readonly unknown[]) =>
  queryKey[0] === "auth" && queryKey[1] === "me";

export const AuthProvider = ({ children }: PropsWithChildren) => {
  const [authEpoch, setAuthEpoch] = useState(0);
  const [loggingOut, setLoggingOut] = useState(false);

  const meQuery = useQuery<MeResponse | null>({
    queryKey: ["auth", "me"],
    queryFn: async () => {
      try {
        return await unwrap<MeResponse>(api.get("/auth/me"));
      } catch {
        return null;
      }
    },
    retry: false,
    staleTime: Number.POSITIVE_INFINITY,
    refetchOnMount: false,
    refetchOnReconnect: false,
    refetchOnWindowFocus: false,
  });

  const loginMutation = useMutation({
    mutationFn: async (payload: LoginInput) =>
      unwrap<AuthResponse>(api.post("/auth/login", payload)),
  });

  const registerMutation = useMutation({
    mutationFn: async (payload: RegisterInput) =>
      unwrap<AuthResponse>(api.post("/auth/register", payload)),
  });

  const switchSchoolMutation = useMutation({
    mutationFn: async (schoolId: string) => {
      await api.post("/auth/active-school", { schoolId });
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries();
    },
  });

  const logoutMutation = useMutation({
    mutationFn: async () => {
      try {
        await api.post("/auth/logout");
      } catch {
        // Ignore — still clear client session below.
      }
    },
    onMutate: async () => {
      flushSync(() => {
        setLoggingOut(true);
        queryClient.setQueryData<MeResponse | null>(["auth", "me"], null);
        setAuthEpoch((current) => current + 1);
      });
      await queryClient.cancelQueries({
        predicate: (query) => !keepAuthMeQuery(query.queryKey),
      });
    },
    onSettled: async () => {
      // Keep auth/me as null — do not removeQueries (avoids accidental refetch).
      queryClient.setQueryData<MeResponse | null>(["auth", "me"], null);
      queryClient.removeQueries({
        predicate: (query) => !keepAuthMeQuery(query.queryKey),
      });
      flushSync(() => {
        setLoggingOut(false);
      });
    },
  });

  const isBootstrapping = meQuery.isPending && meQuery.data === undefined;

  const value = useMemo<AuthContextValue>(
    () => ({
      user: meQuery.data?.user ?? null,
      availableSchools: meQuery.data?.availableSchools ?? [],
      activeSchoolId: meQuery.data?.activeSchoolId ?? null,
      // Do not treat login/register pending as global "loading" — that unmounted the login form.
      loading: isBootstrapping,
      loggingOut,
      authEpoch,
      login: async (payload: LoginInput) => {
        const data = await loginMutation.mutateAsync(payload);
        // flushSync so ProtectedRoute sees `user` before navigate() runs
        // (otherwise it can bounce back to /login thinking the session is empty).
        flushSync(() => {
          queryClient.setQueryData<MeResponse>(["auth", "me"], data);
        });
        void queryClient.invalidateQueries({
          predicate: (query) => !keepAuthMeQuery(query.queryKey),
        });
        return data;
      },
      register: async (payload: RegisterInput) => {
        const data = await registerMutation.mutateAsync(payload);
        flushSync(() => {
          queryClient.setQueryData<MeResponse>(["auth", "me"], data);
        });
        void queryClient.invalidateQueries({
          predicate: (query) => !keepAuthMeQuery(query.queryKey),
        });
        return data;
      },
      logout: logoutMutation.mutateAsync,
      setActiveSchool: switchSchoolMutation.mutateAsync,
    }),
    [
      authEpoch,
      loggingOut,
      isBootstrapping,
      loginMutation.mutateAsync,
      logoutMutation.mutateAsync,
      meQuery.data?.activeSchoolId,
      meQuery.data?.availableSchools,
      meQuery.data?.user,
      registerMutation.mutateAsync,
      switchSchoolMutation.mutateAsync,
    ],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
};

export const useAuth = (): AuthContextValue => {
  const context = useContext(AuthContext);

  if (!context) {
    throw new Error("useAuth must be used within AuthProvider");
  }

  return context;
};
