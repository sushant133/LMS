import { jsx as _jsx } from "react/jsx-runtime";
import { createContext, useContext, useMemo, useState } from "react";
import { flushSync } from "react-dom";
import { useMutation, useQuery } from "@tanstack/react-query";
import { api, unwrap } from "lib/api";
import { queryClient } from "lib/queryClient";
const AuthContext = createContext(null);
const keepAuthMeQuery = (queryKey) => queryKey[0] === "auth" && queryKey[1] === "me";
export const AuthProvider = ({ children }) => {
    const [authEpoch, setAuthEpoch] = useState(0);
    const [loggingOut, setLoggingOut] = useState(false);
    const meQuery = useQuery({
        queryKey: ["auth", "me"],
        queryFn: async () => {
            try {
                return await unwrap(api.get("/auth/me"));
            }
            catch {
                return null;
            }
        },
        retry: false,
        staleTime: Number.POSITIVE_INFINITY,
        refetchOnMount: false,
        refetchOnReconnect: false,
        refetchOnWindowFocus: false
    });
    const loginMutation = useMutation({
        mutationFn: async (payload) => unwrap(api.post("/auth/login", payload)),
        onSuccess: async (data) => {
            queryClient.setQueryData(["auth", "me"], data);
            await queryClient.invalidateQueries({
                predicate: (query) => !keepAuthMeQuery(query.queryKey)
            });
        }
    });
    const registerMutation = useMutation({
        mutationFn: async (payload) => unwrap(api.post("/auth/register", payload)),
        onSuccess: async (data) => {
            queryClient.setQueryData(["auth", "me"], data);
            await queryClient.invalidateQueries({
                predicate: (query) => !keepAuthMeQuery(query.queryKey)
            });
        }
    });
    const switchSchoolMutation = useMutation({
        mutationFn: async (schoolId) => {
            await api.post("/auth/active-school", { schoolId });
        },
        onSuccess: async () => {
            await queryClient.invalidateQueries();
        }
    });
    const logoutMutation = useMutation({
        mutationFn: async () => {
            await api.post("/auth/logout");
        },
        onMutate: async () => {
            flushSync(() => {
                setLoggingOut(true);
                queryClient.setQueryData(["auth", "me"], null);
                setAuthEpoch((current) => current + 1);
            });
            await queryClient.cancelQueries({
                predicate: (query) => !keepAuthMeQuery(query.queryKey)
            });
        },
        onSettled: async () => {
            queryClient.setQueryData(["auth", "me"], null);
            queryClient.removeQueries({
                predicate: (query) => !keepAuthMeQuery(query.queryKey)
            });
            setLoggingOut(false);
        }
    });
    const isBootstrapping = meQuery.isPending && meQuery.data === undefined;
    const value = useMemo(() => ({
        user: meQuery.data?.user ?? null,
        availableSchools: meQuery.data?.availableSchools ?? [],
        activeSchoolId: meQuery.data?.activeSchoolId ?? null,
        loading: isBootstrapping || loginMutation.isPending || registerMutation.isPending,
        loggingOut,
        authEpoch,
        login: loginMutation.mutateAsync,
        register: registerMutation.mutateAsync,
        logout: logoutMutation.mutateAsync,
        setActiveSchool: switchSchoolMutation.mutateAsync
    }), [
        authEpoch,
        loggingOut,
        isBootstrapping,
        loginMutation.mutateAsync,
        logoutMutation.mutateAsync,
        meQuery.data?.activeSchoolId,
        meQuery.data?.availableSchools,
        meQuery.data?.user,
        loginMutation.isPending,
        registerMutation.isPending,
        registerMutation.mutateAsync,
        switchSchoolMutation.mutateAsync
    ]);
    return _jsx(AuthContext.Provider, { value: value, children: children });
};
export const useAuth = () => {
    const context = useContext(AuthContext);
    if (!context) {
        throw new Error("useAuth must be used within AuthProvider");
    }
    return context;
};
