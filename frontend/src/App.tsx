import { Suspense, type ReactNode, useLayoutEffect, useState } from "react";
import { Navigate, Route, Routes, useLocation } from "react-router-dom";
import { AppLayout } from "components/layout/AppLayout";
import { AuthLayout } from "components/layout/AuthLayout";
import { ErrorBoundary } from "components/shared/ErrorBoundary";
import { OfflineLoginOnly } from "components/shared/OfflineLoginOnly";
import { PageLoadingState } from "components/shared/LoadingState";
import { useAuth } from "features/auth/AuthProvider";
import { ProtectedRoute } from "features/auth/ProtectedRoute";
import { getRoleRedirectPath } from "lib/auth";
import { lazyWithRetry as lazy } from "lib/lazyWithRetry";
import { isNativeApp } from "lib/platform";
import { LoginPage } from "pages/LoginPage";
import { AppUpdatePrompt } from "components/AppUpdatePrompt";
import { NativeAppBridge } from "components/NativeAppBridge";
import { NepaliCharPad } from "components/shared/NepaliCharPad";
import SplashScreen from "components/SplashScreen";

const RegisterPage = lazy(() => import("pages/RegisterPage").then((module) => ({ default: module.RegisterPage })));
const PrivacyPolicyPage = lazy(() =>
  import("pages/PrivacyPolicyPage").then((module) => ({ default: module.PrivacyPolicyPage })),
);
const DashboardPage = lazy(() => import("pages/DashboardPage").then((module) => ({ default: module.DashboardPage })));
const StudentsLayout = lazy(() => import("pages/StudentsPage"));
const StudentsIndexRedirect = lazy(() =>
  import("pages/StudentsPage").then((module) => ({
    default: module.StudentsIndexRedirect,
  })),
);
const CreateStudentPage = lazy(() =>
  import("pages/CreateStudentPage").then((module) => ({ default: module.CreateStudentPage })),
);
const StudentListPage = lazy(() =>
  import("pages/StudentListPage").then((module) => ({ default: module.StudentListPage })),
);
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
const FieldManagementPage = lazy(() =>
  import("pages/FieldManagementPage").then((module) => ({ default: module.FieldManagementPage }))
);
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
const FinancePage = lazy(() => import("pages/FinancePage").then((module) => ({ default: module.FinancePage })));
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
const TeacherProfilePage = lazy(() =>
  import("pages/TeacherProfilePage").then((module) => ({ default: module.TeacherProfilePage })),
);
const StaffProfilePage = lazy(() =>
  import("pages/StaffProfilePage").then((module) => ({ default: module.StaffProfilePage })),
);

/**
 * Where a cold start lands.
 *
 * Web keeps the old rule — entry always opens the login page, so a leftover cookie on a
 * shared computer never signs someone in silently.
 *
 * The native app cannot use that rule. Back at the home screen calls App.exitApp(), which
 * finishes the activity, so every reopen is a cold start on "/" — and the user was shown a
 * login page for a session they were still in. The phone is personal and the session cookie
 * is the source of truth, so here we resume it and only fall through to /login when there
 * is genuinely no session. (Logout is unaffected: it clears the session and lands on
 * /login directly, never through here.)
 */
const RootRedirect = () => {
  const { user, loading, loggingOut } = useAuth();

  if (!isNativeApp()) {
    return <Navigate to="/login" replace />;
  }

  // Deciding before /auth/me answers would flash the login page at a signed-in user.
  if (loading) {
    return <PageLoadingState />;
  }

  const home = loggingOut ? null : getRoleRedirectPath(user?.role);
  return <Navigate to={home ?? "/login"} replace />;
};

const LazyRoute = ({ children }: { children: ReactNode }) => {
  const location = useLocation();
  return (
    <ErrorBoundary resetKey={location.pathname}>
      <Suspense fallback={<PageLoadingState />}>{children}</Suspense>
    </ErrorBoundary>
  );
};

/** Mobile/PWA restores last scroll; always land at the top of a new route. */
const ScrollToTop = () => {
  const { pathname } = useLocation();
  useLayoutEffect(() => {
    window.scrollTo(0, 0);
    document.documentElement.scrollTop = 0;
    document.body.scrollTop = 0;
  }, [pathname]);
  return null;
};

export default function App() {
  /**
   * Web: show the React splash for 1.5s.
   * Native app: skip it — the Capacitor launch screen (3s, capacitor.config.ts)
   * already covers startup, so showing both would stack to 4.5s.
   */
  const [showSplash, setShowSplash] = useState(() => !isNativeApp());

  if (showSplash) {
    return <SplashScreen onFinish={() => setShowSplash(false)} />;
  }
  return (
    <OfflineLoginOnly>
    {/* Android back button + notification-tap routing (no-op on web) */}
    <NativeAppBridge />
    <AppUpdatePrompt />
    {/* Insert palette for Nepali fields (ऋ, ं, ः are unreachable on the layouts) */}
    <NepaliCharPad />
    <ScrollToTop />
    <Routes>
      <Route path="/" element={<RootRedirect />} />

      <Route element={<AuthLayout />}>
        <Route path="/login" element={<LoginPage />} />
        <Route path="/register" element={<LazyRoute><RegisterPage /></LazyRoute>} />
        <Route path="/privacy" element={<LazyRoute><PrivacyPolicyPage /></LazyRoute>} />
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
              <Route path="/notices" element={<NoticesPage />} />
            </Route>

            {/* Exams / homework-view: not for COLLEGE_STAFF (API rejects; no sidebar) */}
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
                  ]}
                />
              }
            >
              <Route path="/homework-view" element={<HomeworkPage />} />
              <Route path="/exams" element={<ExamsPage />} />
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

            {/* Students: tabs (Create | List) stay on layout; content swaps in the outlet */}
            <Route element={<ProtectedRoute roles={["SUPER_ADMIN", "COLLEGE_ADMIN", "COLLEGE_VIEWER", "TEACHER"]} />}>
              <Route
                path="/students"
                element={
                  <LazyRoute>
                    <StudentsLayout />
                  </LazyRoute>
                }
              >
                <Route
                  index
                  element={
                    <LazyRoute>
                      <StudentsIndexRedirect />
                    </LazyRoute>
                  }
                />
                <Route
                  path="list"
                  element={
                    <LazyRoute>
                      <StudentListPage />
                    </LazyRoute>
                  }
                />
                <Route
                  path="create"
                  element={
                    <LazyRoute>
                      <CreateStudentPage />
                    </LazyRoute>
                  }
                />
              </Route>
              <Route
                path="/my-students"
                element={
                  <LazyRoute>
                    <StudentsLayout />
                  </LazyRoute>
                }
              >
                <Route
                  index
                  element={
                    <LazyRoute>
                      <StudentsIndexRedirect />
                    </LazyRoute>
                  }
                />
                <Route
                  path="list"
                  element={
                    <LazyRoute>
                      <StudentListPage />
                    </LazyRoute>
                  }
                />
              </Route>
            </Route>

            <Route
              element={
                <ProtectedRoute roles={["SUPER_ADMIN", "COLLEGE_ADMIN", "COLLEGE_VIEWER", "TEACHER", "STUDENT", "PARENT", "ACCOUNTANT"]} />
              }
            >
              <Route path="/students/:studentId/profile" element={<LazyRoute><StudentProfilePage /></LazyRoute>} />
            </Route>

            {/* Teachers: My Attendance. Parents: children daily + subject attendance. Staff with module access also allowed. */}
            <Route
              element={
                <ProtectedRoute
                  roles={[
                    "TEACHER",
                    "PARENT",
                    "SUPER_ADMIN",
                    "COLLEGE_ADMIN",
                    "COLLEGE_VIEWER",
                    "COLLEGE_STAFF",
                    "LIBRARY_STAFF",
                    "LABORATORY_STAFF",
                    "ACCOUNTANT",
                    "PRINCIPAL",
                    "CASHIER",
                    "AUDITOR",
                  ]}
                />
              }
            >
              <Route path="/attendance" element={<AttendancePage />} />
            </Route>

            {/* Attendance Management hub — admins + anyone granted teacher/staff/attendance modules */}
            <Route
              element={
                <ProtectedRoute
                  roles={[
                    "SUPER_ADMIN",
                    "COLLEGE_ADMIN",
                    "COLLEGE_VIEWER",
                    "TEACHER",
                    "COLLEGE_STAFF",
                    "LIBRARY_STAFF",
                    "LABORATORY_STAFF",
                    "ACCOUNTANT",
                    "PRINCIPAL",
                    "CASHIER",
                    "AUDITOR",
                  ]}
                />
              }
            >
              <Route path="/attendance-view" element={<AttendancePage />} />
            </Route>

            {/* Legacy URL → Attendance Management (Register tab) */}
            <Route
              path="/attendance-register"
              element={<Navigate to="/attendance-view?tab=register" replace />}
            />

            {/* Field Management: admins + field coordinators (staff) + students (read-only) — not teachers */}
            <Route
              element={
                <ProtectedRoute
                  roles={[
                    "SUPER_ADMIN",
                    "COLLEGE_ADMIN",
                    "COLLEGE_VIEWER",
                    "COLLEGE_STAFF",
                    "STUDENT",
                  ]}
                />
              }
            >
              <Route
                path="/field-management"
                element={
                  <LazyRoute>
                    <FieldManagementPage />
                  </LazyRoute>
                }
              />
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
              <Route path="/laboratory-view" element={<LaboratoryPage />} />
            </Route>

            <Route element={<ProtectedRoute roles={["SUPER_ADMIN", "COLLEGE_ADMIN", "COLLEGE_VIEWER", "ACCOUNTANT", "CASHIER", "AUDITOR", "PRINCIPAL"]} />}>
              <Route path="/accounting" element={<AccountingPage />} />
            </Route>

            {/* Finance Management: Admin + College Admin + staff with personalFinanceAccess grant */}
            <Route
              element={
                <ProtectedRoute
                  roles={[
                    "SUPER_ADMIN",
                    "COLLEGE_ADMIN",
                    "COLLEGE_VIEWER",
                    "COLLEGE_STAFF",
                    "TEACHER",
                    "LIBRARY_STAFF",
                    "LABORATORY_STAFF",
                    "ACCOUNTANT",
                    "CASHIER",
                    "AUDITOR",
                    "PRINCIPAL",
                  ]}
                  allowPersonalFinanceAccess
                />
              }
            >
              <Route
                path="/finance"
                element={
                  <LazyRoute>
                    <FinancePage />
                  </LazyRoute>
                }
              />
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
              <Route
                path="/college-staff/:staffId/profile"
                element={
                  <LazyRoute>
                    <StaffProfilePage />
                  </LazyRoute>
                }
              />
              <Route path="/teachers" element={<TeachersPage />} />
              <Route
                path="/teachers/:teacherId/profile"
                element={
                  <LazyRoute>
                    <TeacherProfilePage />
                  </LazyRoute>
                }
              />
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



            <Route
              element={
                <ProtectedRoute
                  roles={[
                    "SUPER_ADMIN",
                    "COLLEGE_ADMIN",
                    "COLLEGE_VIEWER",
                    "TEACHER",
                    "STUDENT",
                    "PRINCIPAL",
                  ]}
                />
              }
            >
              <Route path="/timetable" element={<TimetablePage />} />
              <Route path="/timetable-view" element={<TimetablePage />} />
            </Route>

            <Route element={<ProtectedRoute roles={["SUPER_ADMIN", "COLLEGE_ADMIN", "COLLEGE_VIEWER", "TEACHER", "COLLEGE_STAFF", "PRINCIPAL"]} />}>
              <Route path="/academic-management" element={<LazyRoute><AcademicManagementPage /></LazyRoute>} />
              <Route path="/academic-management-view" element={<LazyRoute><AcademicManagementPage /></LazyRoute>} />
            </Route>

            <Route element={<ProtectedRoute roles={["TEACHER"]} />}>
              <Route path="/homework" element={<HomeworkPage />} />
            </Route>



            {/* Admin Examination Management; staff unlock via Module Access (College / CTEVT). */}
            <Route
              element={
                <ProtectedRoute
                  roles={[
                    "SUPER_ADMIN",
                    "COLLEGE_ADMIN",
                    "COLLEGE_VIEWER",
                    "COLLEGE_STAFF",
                    "PRINCIPAL",
                    "TEACHER",
                    "ACCOUNTANT",
                    "CASHIER",
                    "AUDITOR",
                  ]}
                />
              }
            >
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
    </OfflineLoginOnly>
  );
}
