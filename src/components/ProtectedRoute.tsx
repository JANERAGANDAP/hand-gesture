import type { ReactElement } from "react";
import { Navigate } from "react-router-dom";
import { useAuth, type Role } from "../contexts/AuthContext";

interface ProtectedRouteProps {
  roles: Role[];
  children: ReactElement;
}

const ProtectedRoute = ({ roles, children }: ProtectedRouteProps) => {
  const { user, loading } = useAuth();

  if (loading) return null;

  if (!user || !roles.includes(user.role)) {
    return <Navigate to="/login" replace />;
  }

  return children;
};

export default ProtectedRoute;
