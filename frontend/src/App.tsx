import { Suspense, lazy, type ReactNode } from "react";
import { Navigate, Route, Routes } from "react-router-dom";
import { AppLayout } from "components/layout/AppLayout";
import { AuthLayout } from "components/layout/AuthLayout";
import { PageLoadingState } from "components/shared/LoadingState";
import { ProtectedRoute } from "features/auth/ProtectedRoute";
import { LoginPage } from "pages/LoginPage";
const RegisterPage = lazy(() => import("pages/RegisterPage").then((module) => ({ default: module.RegisterPage })));
const DashboardPage = lazy(() => import("pages/DashboardPage").then((module) => ({ default: module.DashboardPage })));
const StudentsLayout = lazy(() => import("pages/StudentsPage"));
const CreateStudentPage = lazy(() => import("pages/CreateStudentPage").then((module) => ({ default: module.CreateStudentPage })));
const StudentListPage = lazy(() => import("pages/StudentListPage").then((module) => ({ default: module.StudentListPage })));
const TeachersPage = lazy(() => import("pages/TeachersPage").then((module) => ({ default: module.TeachersPage })));
const CollegeStaffPage = lazy(() => import("pages/CollegeStaffPage").then((module) => ({ default: module.CollegeStaffPage })));
const AcademicsPage = lazy(() => import("pages/AcademicsPage").then((module) => ({ default: module.AcademicsPage })));
const SubjectAssignmentsPage = lazy(() =>
  import("pages/SubjectAssignmentsPage").then((module) => ({ default: module.SubjectAssignmentsPage }))
);
const AcademicManagementPage = lazy(() =>
  import("pages/AcademicManagementPage").then((module) => ({ default: module.AcademicManagementPage }))
);
const AcademicCalendarPage = lazy(() =>
  import("pages/AcademicCalendarPage").then((module) => ({ default: module.AcademicCalendarPage }))
);
const AttendancePage = lazy(() => import("pages/AttendancePage").then((module) => ({ default: module.AttendancePage })));
const ExamsPage = lazy(() => import("pages/ExamsPage").then((module) => ({ default: module.ExamsPage })));
const NoticesPage = lazy(() => import("pages/NoticesPage").then((module) => ({ default: module.NoticesPage })));
const ComplaintsPage = lazy(() => import("pages/ComplaintsPage").then((module) => ({ default: module.ComplaintsPage })));
const SettingsPage = lazy(() => import("pages/SettingsPage").then((module) => ({ default: module.SettingsPage })));

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
const AdminManagementPage = lazy(() => import("pages/AdminManagementPage").then((module) => ({ default: module.AdminManagementPage })));
const CollegeAdministratorManagementPage = lazy(() =>
  import("pages/CollegeAdministratorManagementPage").then((module) => ({ default: module.CollegeAdministratorManagementPage }))
);
const StudentFeesPage = lazy(() => import("pages/StudentFeesPage").then((module) => ({ default: module.StudentFeesPage })));
const StudentSubjectsPage = lazy(() => import("pages/StudentSubjectsPage").then((module) => ({ default: module.StudentSubjectsPage })));
const StudentMyProfilePage = lazy(() =>
  import("pages/StudentMyProfilePage").then((module) => ({ default: module.StudentMyProfilePage }))
);
const StudentProfilePage = lazy(() => import("pages/StudentProfilePage").then((module) => ({ default: module.StudentProfilePage })));

/** App entry always opens the login page — no silent auto-login from a leftover cookie. */
const RootRedirect = () => {
  return <Navigate to="/login" replace />;
};

const LazyRoute = ({ children }: { children: ReactNode }) => (
  <Suspense fallback={<PageLoadingState />}>{children}</Suspense>
);

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<RootRedirect />} />

      <Route element={<AuthLayout />}>
        <Route path="/login" element={<LoginPage />} />
        <Route path="/register" element={<LazyRoute><RegisterPage /></LazyRoute>} />
      </Route>

        <Route element={<ProtectedRoute />}>
          <Route element={<AppLayout />}>
            {/* Dashboards for every portal role, including module staff created via College Staff */}
            <Route
              element={
                <ProtectedRoute
                  roles={[
                    "SUPER_ADMIN",
                    "COLLEGE_ADMIN",
                    "COLLEGE_VIEWER",
                    "TEACHER",
                    "STUDENT",
                    "PARENT",
                    "COLLEGE_STAFF",
                    "LIBRARY_STAFF",
                    "LABORATORY_STAFF",
                    "ACCOUNTANT",
                    "CASHIER",
                    "AUDITOR",
                    "PRINCIPAL"
                  ]}
                />
              }
            >
              <Route path="/dashboard/school_admin" element={<Navigate to="/dashboard/college_admin" replace />} />
              <Route path="/dashboard/:role" element={<DashboardPage />} />
              <Route path="/notifications" element={<NotificationsPage />} />
            </Route>

            <Route
              element={
                <ProtectedRoute
                  roles={[
                    "SUPER_ADMIN",
                    "COLLEGE_ADMIN",
                    "COLLEGE_VIEWER",
                    "TEACHER",
                    "STUDENT",
                    "PARENT",
                    "COLLEGE_STAFF"
                  ]}
                />
              }
            >
              <Route path="/homework-view" element={<HomeworkPage />} />
              <Route path="/exams" element={<ExamsPage />} />
              <Route path="/notices" element={<NoticesPage />} />
            </Route>

            <Route
              element={
                <ProtectedRoute
                  roles={[
                    "SUPER_ADMIN",
                    "COLLEGE_ADMIN",
                    "COLLEGE_VIEWER",
                    "TEACHER",
                    "STUDENT",
                    "PARENT",
                    "COLLEGE_STAFF",
                    "LIBRARY_STAFF",
                    "LABORATORY_STAFF",
                    "ACCOUNTANT",
                    "CASHIER",
                    "AUDITOR",
                    "PRINCIPAL"
                  ]}
                />
              }
            >
              <Route path="/academic-calendar" element={<LazyRoute><AcademicCalendarPage /></LazyRoute>} />
            </Route>

            <Route element={<ProtectedRoute roles={["STUDENT"]} />}>
              <Route path="/my-profile" element={<LazyRoute><StudentMyProfilePage /></LazyRoute>} />
              <Route path="/my-subjects" element={<StudentSubjectsPage />} />
              <Route path="/my-fees" element={<StudentFeesPage />} />
            </Route>

            <Route element={<ProtectedRoute roles={["STUDENT", "TEACHER"]} />}>
              <Route path="/my-library" element={<MyLibraryPage />} />
            </Route>

            <Route element={<ProtectedRoute roles={["SUPER_ADMIN", "COLLEGE_ADMIN", "COLLEGE_VIEWER", "TEACHER"]} />}>
              <Route path="/students" element={<LazyRoute><StudentsLayout /></LazyRoute>}>
                <Route index element={<Navigate to="list" replace />} />
                <Route path="list" element={<LazyRoute><StudentListPage /></LazyRoute>} />
                <Route path="create" element={<LazyRoute><CreateStudentPage /></LazyRoute>} />
              </Route>
            </Route>

            <Route
              element={
                <ProtectedRoute roles={["SUPER_ADMIN", "COLLEGE_ADMIN", "COLLEGE_VIEWER", "TEACHER", "STUDENT", "PARENT", "ACCOUNTANT"]} />
              }
            >
              <Route path="/students/:studentId/profile" element={<LazyRoute><StudentProfilePage /></LazyRoute>} />
            </Route>

            <Route element={<ProtectedRoute roles={["TEACHER"]} />}>
              <Route path="/attendance" element={<AttendancePage />} />
            </Route>

            <Route element={<ProtectedRoute roles={["SUPER_ADMIN", "COLLEGE_ADMIN", "COLLEGE_VIEWER"]} />}>
              <Route path="/attendance-view" element={<AttendancePage />} />
            </Route>

            <Route element={<ProtectedRoute roles={["SUPER_ADMIN", "COLLEGE_ADMIN", "COLLEGE_VIEWER", "LIBRARY_STAFF"]} />}>
              <Route path="/library" element={<LibraryPage />} />
            </Route>

            {/* Lab staff + teachers assigned as laboratory in-charge */}
            <Route
              element={
                <ProtectedRoute
                  roles={["SUPER_ADMIN", "COLLEGE_ADMIN", "COLLEGE_VIEWER", "LABORATORY_STAFF", "TEACHER"]}
                />
              }
            >
              <Route path="/laboratory" element={<LaboratoryPage />} />
            </Route>

            <Route element={<ProtectedRoute roles={["SUPER_ADMIN", "COLLEGE_ADMIN", "COLLEGE_VIEWER", "ACCOUNTANT", "CASHIER", "AUDITOR", "PRINCIPAL"]} />}>
              <Route path="/accounting" element={<AccountingPage />} />
            </Route>

            <Route
              element={
                <ProtectedRoute
                  roles={[
                    "SUPER_ADMIN",
                    "COLLEGE_ADMIN",
                    "COLLEGE_VIEWER",
                    "TEACHER",
                    "STUDENT",
                    "COLLEGE_STAFF",
                    "LIBRARY_STAFF",
                    "LABORATORY_STAFF",
                    "ACCOUNTANT",
                    "CASHIER",
                    "AUDITOR",
                    "PRINCIPAL"
                  ]}
                />
              }
            >
              <Route path="/complains" element={<LazyRoute><ComplaintsPage /></LazyRoute>} />
            </Route>

            <Route element={<ProtectedRoute roles={["SUPER_ADMIN", "COLLEGE_ADMIN", "COLLEGE_VIEWER"]} />}>
              <Route path="/college-staff" element={<CollegeStaffPage />} />
              <Route path="/teachers" element={<TeachersPage />} />
              <Route path="/academics" element={<AcademicsPage />} />
              <Route
                path="/academics/subject-assignments"
                element={
                  <LazyRoute>
                    <SubjectAssignmentsPage />
                  </LazyRoute>
                }
              />
              <Route path="/fees" element={<Navigate to="/accounting" replace />} />
              <Route path="/settings" element={<SettingsPage />} />
              <Route path="/reports" element={<ReportsPage />} />
              <Route path="/parent-links" element={<ParentLinksPage />} />
              <Route path="/hr" element={<HrPage />} />
            </Route>

            {/* Transport: admins manage; drivers/transport staff (COLLEGE_STAFF) can open routes view */}
            <Route
              element={
                <ProtectedRoute
                  roles={["SUPER_ADMIN", "COLLEGE_ADMIN", "COLLEGE_VIEWER", "COLLEGE_STAFF"]}
                />
              }
            >
              <Route path="/transport" element={<TransportPage />} />
            </Route>



            <Route element={<ProtectedRoute roles={["SUPER_ADMIN", "COLLEGE_ADMIN", "COLLEGE_VIEWER", "TEACHER"]} />}>
              <Route path="/timetable" element={<TimetablePage />} />
              <Route path="/academic-management" element={<LazyRoute><AcademicManagementPage /></LazyRoute>} />
            </Route>

            <Route element={<ProtectedRoute roles={["TEACHER"]} />}>
              <Route path="/homework" element={<HomeworkPage />} />
            </Route>



            <Route element={<ProtectedRoute roles={["SUPER_ADMIN", "COLLEGE_ADMIN", "COLLEGE_VIEWER"]} />}>
              <Route path="/exams-view" element={<ExamsPage />} />
            </Route>



            <Route element={<ProtectedRoute roles={["PARENT"]} />}>
              <Route path="/parent-portal" element={<ParentPortalPage />} />
            </Route>

            <Route element={<ProtectedRoute roles={["SUPER_ADMIN"]} />}>
              <Route path="/admin-management" element={<LazyRoute><AdminManagementPage /></LazyRoute>} />
            </Route>

            <Route element={<ProtectedRoute roles={["SUPER_ADMIN", "COLLEGE_ADMIN"]} />}>
              <Route path="/college-administrators" element={<LazyRoute><CollegeAdministratorManagementPage /></LazyRoute>} />
            </Route>

            <Route path="/colleges" element={<Navigate to="/dashboard/super_admin" replace />} />
            <Route path="/schools" element={<Navigate to="/dashboard/super_admin" replace />} />
          </Route>
        </Route>

      <Route path="*" element={<LazyRoute><NotFoundPage /></LazyRoute>} />
    </Routes>
  );
}
