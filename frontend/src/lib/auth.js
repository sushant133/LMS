export const getSchoolDisplayName = (availableSchools, user) => availableSchools[0]?.name ?? user?.school?.name ?? "Your School";
export const roleLabelMap = {
    SUPER_ADMIN: "Super Admin",
    SCHOOL_ADMIN: "School Admin",
    TEACHER: "Teacher",
    STUDENT: "Student",
    PARENT: "Parent",
    LIBRARY_STAFF: "Library Staff",
    LABORATORY_STAFF: "Laboratory Staff",
    ACCOUNTANT: "Accountant"
};
export const roleRedirectMap = {
    SUPER_ADMIN: "/dashboard/super_admin",
    SCHOOL_ADMIN: "/dashboard/school_admin",
    TEACHER: "/dashboard/teacher",
    STUDENT: "/my-subjects",
    PARENT: "/dashboard/parent",
    LIBRARY_STAFF: "/library",
    LABORATORY_STAFF: "/laboratory",
    ACCOUNTANT: "/accounting"
};
