import { LibraryPortal } from "features/library/LibraryPortal";
import { TeacherLabEquipment } from "features/laboratory/TeacherLabEquipment";
import { useAuth } from "features/auth/AuthProvider";

export const MyLibraryPage = () => {
  const { user } = useAuth();

  return (
    <div className="min-w-0 w-full space-y-8">
      <LibraryPortal />
      {user?.role === "TEACHER" ? <TeacherLabEquipment /> : null}
    </div>
  );
};