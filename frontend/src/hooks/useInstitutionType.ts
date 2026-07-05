import type { InstitutionType } from "@phit-erp/shared";
import { useAuth } from "features/auth/AuthProvider";

export const useInstitutionType = (): InstitutionType => {
  const { user, availableSchools, activeSchoolId } = useAuth();
  const activeSchool =
    availableSchools.find((school) => school._id === activeSchoolId) ??
    user?.school ??
    availableSchools[0];

  return activeSchool?.institutionType ?? "SCHOOL";
};

export const useIsCollege = (): boolean => useInstitutionType() === "COLLEGE";