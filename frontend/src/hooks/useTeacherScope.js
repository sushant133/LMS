import { useQuery } from "@tanstack/react-query";
import { api, unwrap } from "lib/api";
export const useTeacherScope = (enabled = true) => useQuery({
    queryKey: ["teacher-scope"],
    queryFn: () => unwrap(api.get("/teacher/scope")),
    enabled,
    staleTime: 5 * 60 * 1000
});
