import { Navigate } from "react-router-dom";

/**
 * Teachers live under College Staff → Teachers tab.
 * Teacher APIs and TeachersManager remain unchanged; this only deep-links the UI.
 */
export const TeachersPage = () => <Navigate to="/college-staff?tab=teachers" replace />;
