import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { Suspense, lazy } from "react";
import { Navigate, Route, Routes, useLocation } from "react-router-dom";
import { AppLayout } from "components/layout/AppLayout";
import { PageLoadingState } from "components/shared/LoadingState";
import { ProtectedRoute } from "features/auth/ProtectedRoute";
import { useAuth } from "features/auth/AuthProvider";
import { roleRedirectMap } from "lib/auth";
import { LoginPage } from "pages/LoginPage";
const RegisterPage = lazy(() => import("pages/RegisterPage").then((module) => ({ default: module.RegisterPage })));
const DashboardPage = lazy(() => import("pages/DashboardPage").then((module) => ({ default: module.DashboardPage })));
const StudentsPage = lazy(() => import("pages/StudentsPage").then((module) => ({ default: module.StudentsPage })));
const TeachersPage = lazy(() => import("pages/TeachersPage").then((module) => ({ default: module.TeachersPage })));
const AcademicsPage = lazy(() => import("pages/AcademicsPage").then((module) => ({ default: module.AcademicsPage })));
const AttendancePage = lazy(() => import("pages/AttendancePage").then((module) => ({ default: module.AttendancePage })));
const ExamsPage = lazy(() => import("pages/ExamsPage").then((module) => ({ default: module.ExamsPage })));
const FeesPage = lazy(() => import("pages/FeesPage").then((module) => ({ default: module.FeesPage })));
const NoticesPage = lazy(() => import("pages/NoticesPage").then((module) => ({ default: module.NoticesPage })));
const SettingsPage = lazy(() => import("pages/SettingsPage").then((module) => ({ default: module.SettingsPage })));
const SchoolsPage = lazy(() => import("pages/SchoolsPage").then((module) => ({ default: module.SchoolsPage })));
const NotFoundPage = lazy(() => import("pages/NotFoundPage").then((module) => ({ default: module.NotFoundPage })));
const ReportsPage = lazy(() => import("pages/ReportsPage").then((module) => ({ default: module.ReportsPage })));
const TimetablePage = lazy(() => import("pages/TimetablePage").then((module) => ({ default: module.TimetablePage })));
const HomeworkPage = lazy(() => import("pages/HomeworkPage").then((module) => ({ default: module.HomeworkPage })));
const ParentPortalPage = lazy(() => import("pages/ParentPortalPage").then((module) => ({ default: module.ParentPortalPage })));
const ParentLinksPage = lazy(() => import("pages/ParentLinksPage").then((module) => ({ default: module.ParentLinksPage })));
const NotificationsPage = lazy(() => import("pages/NotificationsPage").then((module) => ({ default: module.NotificationsPage })));
const LibraryPage = lazy(() => import("pages/LibraryPage").then((module) => ({ default: module.LibraryPage })));
const LaboratoryPage = lazy(() => import("pages/LaboratoryPage").then((module) => ({ default: module.LaboratoryPage })));
const MyLibraryPage = lazy(() => import("pages/MyLibraryPage").then((module) => ({ default: module.MyLibraryPage })));
const TransportPage = lazy(() => import("pages/TransportPage").then((module) => ({ default: module.TransportPage })));
const HrPage = lazy(() => import("pages/HrPage").then((module) => ({ default: module.HrPage })));
const AccountingPage = lazy(() => import("pages/AccountingPage").then((module) => ({ default: module.AccountingPage })));
const StudentFeesPage = lazy(() => import("pages/StudentFeesPage").then((module) => ({ default: module.StudentFeesPage })));
const StudentSubjectsPage = lazy(() => import("pages/StudentSubjectsPage").then((module) => ({ default: module.StudentSubjectsPage })));
const RootRedirect = () => {
    const { user, loading } = useAuth();
    if (loading) {
        return _jsx(PageLoadingState, {});
    }
    return _jsx(Navigate, { to: user ? roleRedirectMap[user.role] : "/login", replace: true });
};
const LazyRoute = ({ children }) => (_jsx(Suspense, { fallback: _jsx(PageLoadingState, {}), children: children }));
const LoginRoute = () => {
    const { authEpoch } = useAuth();
    const location = useLocation();
    return _jsx(LoginPage, {}, `login-page-${authEpoch}-${location.key}`);
};
export default function App() {
    return (_jsxs(Routes, { children: [_jsx(Route, { path: "/", element: _jsx(RootRedirect, {}) }), _jsx(Route, { path: "/login", element: _jsx(LoginRoute, {}) }), _jsx(Route, { path: "/register", element: _jsx(LazyRoute, { children: _jsx(RegisterPage, {}) }) }), _jsx(Route, { element: _jsx(ProtectedRoute, {}), children: _jsxs(Route, { element: _jsx(AppLayout, {}), children: [_jsxs(Route, { element: _jsx(ProtectedRoute, { roles: ["SUPER_ADMIN", "SCHOOL_ADMIN", "TEACHER", "STUDENT", "PARENT"] }), children: [_jsx(Route, { path: "/dashboard/:role", element: _jsx(DashboardPage, {}) }), _jsx(Route, { path: "/homework-view", element: _jsx(HomeworkPage, {}) }), _jsx(Route, { path: "/exams", element: _jsx(ExamsPage, {}) }), _jsx(Route, { path: "/notifications", element: _jsx(NotificationsPage, {}) }), _jsx(Route, { path: "/notices", element: _jsx(NoticesPage, {}) })] }), _jsxs(Route, { element: _jsx(ProtectedRoute, { roles: ["STUDENT"] }), children: [_jsx(Route, { path: "/my-subjects", element: _jsx(StudentSubjectsPage, {}) }), _jsx(Route, { path: "/my-fees", element: _jsx(StudentFeesPage, {}) })] }), _jsx(Route, { element: _jsx(ProtectedRoute, { roles: ["STUDENT", "TEACHER"] }), children: _jsx(Route, { path: "/my-library", element: _jsx(MyLibraryPage, {}) }) }), _jsx(Route, { element: _jsx(ProtectedRoute, { roles: ["SUPER_ADMIN", "SCHOOL_ADMIN", "TEACHER"] }), children: _jsx(Route, { path: "/students", element: _jsx(StudentsPage, {}) }) }), _jsx(Route, { element: _jsx(ProtectedRoute, { roles: ["TEACHER"] }), children: _jsx(Route, { path: "/attendance", element: _jsx(AttendancePage, {}) }) }), _jsx(Route, { element: _jsx(ProtectedRoute, { roles: ["SUPER_ADMIN", "SCHOOL_ADMIN"] }), children: _jsx(Route, { path: "/attendance-view", element: _jsx(AttendancePage, {}) }) }), _jsx(Route, { element: _jsx(ProtectedRoute, { roles: ["SUPER_ADMIN", "SCHOOL_ADMIN", "LIBRARY_STAFF"] }), children: _jsx(Route, { path: "/library", element: _jsx(LibraryPage, {}) }) }), _jsx(Route, { element: _jsx(ProtectedRoute, { roles: ["SUPER_ADMIN", "SCHOOL_ADMIN", "LABORATORY_STAFF"] }), children: _jsx(Route, { path: "/laboratory", element: _jsx(LaboratoryPage, {}) }) }), _jsx(Route, { element: _jsx(ProtectedRoute, { roles: ["SUPER_ADMIN", "SCHOOL_ADMIN", "ACCOUNTANT"] }), children: _jsx(Route, { path: "/accounting", element: _jsx(AccountingPage, {}) }) }), _jsxs(Route, { element: _jsx(ProtectedRoute, { roles: ["SUPER_ADMIN", "SCHOOL_ADMIN"] }), children: [_jsx(Route, { path: "/teachers", element: _jsx(TeachersPage, {}) }), _jsx(Route, { path: "/academics", element: _jsx(AcademicsPage, {}) }), _jsx(Route, { path: "/fees", element: _jsx(FeesPage, {}) }), _jsx(Route, { path: "/settings", element: _jsx(SettingsPage, {}) }), _jsx(Route, { path: "/reports", element: _jsx(ReportsPage, {}) }), _jsx(Route, { path: "/parent-links", element: _jsx(ParentLinksPage, {}) }), _jsx(Route, { path: "/transport", element: _jsx(TransportPage, {}) }), _jsx(Route, { path: "/hr", element: _jsx(HrPage, {}) })] }), _jsx(Route, { element: _jsx(ProtectedRoute, { roles: ["SUPER_ADMIN", "SCHOOL_ADMIN", "TEACHER"] }), children: _jsx(Route, { path: "/timetable", element: _jsx(TimetablePage, {}) }) }), _jsx(Route, { element: _jsx(ProtectedRoute, { roles: ["TEACHER"] }), children: _jsx(Route, { path: "/homework", element: _jsx(HomeworkPage, {}) }) }), _jsx(Route, { element: _jsx(ProtectedRoute, { roles: ["SUPER_ADMIN", "SCHOOL_ADMIN"] }), children: _jsx(Route, { path: "/exams-view", element: _jsx(ExamsPage, {}) }) }), _jsx(Route, { element: _jsx(ProtectedRoute, { roles: ["PARENT"] }), children: _jsx(Route, { path: "/parent-portal", element: _jsx(ParentPortalPage, {}) }) }), _jsx(Route, { element: _jsx(ProtectedRoute, { roles: ["SUPER_ADMIN"] }), children: _jsx(Route, { path: "/schools", element: _jsx(SchoolsPage, {}) }) })] }) }), _jsx(Route, { path: "*", element: _jsx(LazyRoute, { children: _jsx(NotFoundPage, {}) }) })] }));
}
