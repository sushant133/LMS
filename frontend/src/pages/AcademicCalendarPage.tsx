import { PageContent } from "components/layout/PageContent";
import { ReadOnlyBanner } from "components/shared/ReadOnlyBanner";
import { useAuth } from "features/auth/AuthProvider";
import { AcademicCalendarHub } from "features/academic-calendar/AcademicCalendarHub";

export const AcademicCalendarPage = () => {
  const { user } = useAuth();

  return (
    <PageContent>
      {user?.role === "COLLEGE_VIEWER" ? <ReadOnlyBanner /> : null}
      <AcademicCalendarHub />
    </PageContent>
  );
};