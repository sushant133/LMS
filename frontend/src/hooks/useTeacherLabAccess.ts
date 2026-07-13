import { useQuery } from "@tanstack/react-query";
import { api, unwrap } from "lib/api";

export interface TeacherLabAccessData {
  hasLaboratoryAccess: boolean;
  assignedLabIds: string[];
  laboratoryCount: number;
}

/**
 * Teachers only: whether admin assigned any laboratory to this login.
 * Used to hide Laboratory from the sidebar when none are assigned.
 */
export const useTeacherLabAccess = (enabled = true) =>
  useQuery({
    queryKey: ["teacher-lab-access"],
    queryFn: () =>
      unwrap<TeacherLabAccessData>(api.get("/teacher/lab-access")),
    enabled,
    staleTime: 60 * 1000,
    refetchOnWindowFocus: true,
  });
