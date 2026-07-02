import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { LibraryPortal } from "features/library/LibraryPortal";
import { TeacherLabEquipment } from "features/laboratory/TeacherLabEquipment";
import { useAuth } from "features/auth/AuthProvider";
export const MyLibraryPage = () => {
    const { user } = useAuth();
    return (_jsxs("div", { className: "min-w-0 w-full space-y-8", children: [_jsx(LibraryPortal, {}), user?.role === "TEACHER" ? _jsx(TeacherLabEquipment, {}) : null] }));
};
