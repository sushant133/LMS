import { Suspense, lazy, type ReactNode } from "react";
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
    return <PageLoadingState />;
  }

  return <Navigate to={user ? roleRedirectMap[user.role] : "/login"} replace />;
};

const LazyRoute = ({ children }: { children: ReactNode }) => (
  <Suspense fallback={<PageLoadingState />}>{children}</Suspense>
);

const LoginRoute = () => {
  const { authEpoch } = useAuth();
  const location = useLocation();

  return <LoginPage key={`login-page-${authEpoch}-${location.key}`} />;
};

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<RootRedirect />} />
      <Route path="/login" element={<LoginRoute />} />
      <Route path="/register" element={<LazyRoute><RegisterPage /></LazyRoute>} />

        <Route element={<ProtectedRoute />}>
          <Route element={<AppLayout />}>
            {/* Shared portal layout: dashboard + all student/parent pages render in the same AppLayout shell */}
            <Route element={<ProtectedRoute roles={["SUPER_ADMIN", "SCHOOL_ADMIN", "TEACHER", "STUDENT", "PARENT"]} />}>
              <Route path="/dashboard/:role" element={<DashboardPage />} />
              <Route path="/homework-view" element={<HomeworkPage />} />
              <Route path="/exams" element={<ExamsPage />} />
              <Route path="/notifications" element={<NotificationsPage />} />
              <Route path="/notices" element={<NoticesPage />} />
            </Route>

            <Route element={<ProtectedRoute roles={["STUDENT"]} />}>
              <Route path="/my-subjects" element={<StudentSubjectsPage />} />
              <Route path="/my-fees" element={<StudentFeesPage />} />
            </Route>

            <Route element={<ProtectedRoute roles={["STUDENT", "TEACHER"]} />}>
              <Route path="/my-library" element={<MyLibraryPage />} />
            </Route>

            <Route element={<ProtectedRoute roles={["SUPER_ADMIN", "SCHOOL_ADMIN", "TEACHER"]} />}>
              <Route path="/students" element={<StudentsPage />} />
            </Route>

            <Route element={<ProtectedRoute roles={["TEACHER"]} />}>
              <Route path="/attendance" element={<AttendancePage />} />
            </Route>

            <Route element={<ProtectedRoute roles={["SUPER_ADMIN", "SCHOOL_ADMIN"]} />}>
              <Route path="/attendance-view" element={<AttendancePage />} />
            </Route>

            <Route element={<ProtectedRoute roles={["SUPER_ADMIN", "SCHOOL_ADMIN", "LIBRARY_STAFF"]} />}>
              <Route path="/library" element={<LibraryPage />} />
            </Route>

            <Route element={<ProtectedRoute roles={["SUPER_ADMIN", "SCHOOL_ADMIN", "LABORATORY_STAFF"]} />}>
              <Route path="/laboratory" element={<LaboratoryPage />} />
            </Route>

            <Route element={<ProtectedRoute roles={["SUPER_ADMIN", "SCHOOL_ADMIN", "ACCOUNTANT"]} />}>
              <Route path="/accounting" element={<AccountingPage />} />
            </Route>

            <Route element={<ProtectedRoute roles={["SUPER_ADMIN", "SCHOOL_ADMIN"]} />}>
              <Route path="/teachers" element={<TeachersPage />} />
              <Route path="/academics" element={<AcademicsPage />} />
              <Route path="/fees" element={<FeesPage />} />
              <Route path="/settings" element={<SettingsPage />} />
              <Route path="/reports" element={<ReportsPage />} />
              <Route path="/parent-links" element={<ParentLinksPage />} />
              <Route path="/transport" element={<TransportPage />} />
              <Route path="/hr" element={<HrPage />} />
            </Route>



            <Route element={<ProtectedRoute roles={["SUPER_ADMIN", "SCHOOL_ADMIN", "TEACHER"]} />}>
              <Route path="/timetable" element={<TimetablePage />} />
            </Route>

            <Route element={<ProtectedRoute roles={["TEACHER"]} />}>
              <Route path="/homework" element={<HomeworkPage />} />
            </Route>



            <Route element={<ProtectedRoute roles={["SUPER_ADMIN", "SCHOOL_ADMIN"]} />}>
              <Route path="/exams-view" element={<ExamsPage />} />
            </Route>



            <Route element={<ProtectedRoute roles={["PARENT"]} />}>
              <Route path="/parent-portal" element={<ParentPortalPage />} />
            </Route>

            <Route element={<ProtectedRoute roles={["SUPER_ADMIN"]} />}>
              <Route path="/schools" element={<SchoolsPage />} />
            </Route>
          </Route>
        </Route>

      <Route path="*" element={<LazyRoute><NotFoundPage /></LazyRoute>} />
    </Routes>
  );
}
