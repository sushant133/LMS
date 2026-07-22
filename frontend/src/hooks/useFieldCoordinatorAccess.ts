import { useQuery } from "@tanstack/react-query";
import { api, unwrap } from "lib/api";

export interface FieldCoordinatorAccessData {
  hasStaffProfile: boolean;
  hasCoordinatorAccess: boolean;
  isPrimary: boolean;
  isAssistant: boolean;
  activePostingCount: number;
  totalPostingCount: number;
  staffId?: string;
  fullName?: string;
}

/**
 * Whether the logged-in staff user is primary/assistant field coordinator
 * on any posting. Used to show Field Management without requiring the
 * "field-duty" module grant in the access matrix.
 */
export const useFieldCoordinatorAccess = (enabled = true) =>
  useQuery({
    queryKey: ["field-duty", "me", "access"],
    queryFn: () =>
      unwrap<FieldCoordinatorAccessData>(api.get("/field-duty/me/access")),
    enabled,
    staleTime: 60 * 1000,
    refetchOnWindowFocus: true,
  });
