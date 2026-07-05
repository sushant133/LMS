import type { AddressSelection, SchoolInput } from "@phit-erp/shared";
import { DEFAULT_ACADEMIC_YEAR_BS } from "@phit-erp/shared";

export const defaultSchoolAddress: AddressSelection = {
  province: "Bagmati Province",
  district: "Kathmandu",
  municipality: "Kathmandu Metropolitan City",
  ward: "1",
  streetAddress: "Putalisadak"
};

export const buildSchoolSettingsPayload = (school: Pick<SchoolInput, "name" | "nameNp" | "principalName" | "academicYearBs" | "email" | "phone" | "address">) => ({
  schoolName: school.name,
  schoolNameNp: school.nameNp,
  academicYearBs: school.academicYearBs,
  principalName: school.principalName,
  contactEmail: school.email,
  contactPhone: school.phone,
  address: school.address,
  holidays: []
});

export const buildDefaultSchoolPayload = () => ({
  name: "Public Himal Institute of Technology",
  nameNp: "पब्लिक हिमाल इन्स्टिच्युट अफ टेक्नोलोजी",
  code: "DEMO",
  email: "school@example.com",
  phone: "9800000000",
  principalName: "Principal Name",
  academicYearBs: DEFAULT_ACADEMIC_YEAR_BS,
  address: defaultSchoolAddress,
  isActive: true
});