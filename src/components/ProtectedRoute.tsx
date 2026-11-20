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

  if (!user) return <Navigate to="/login" replace />;
  if (!roles.includes(user.role)) return <Navigate to="/" replace />;

  return children;
};

export default ProtectedRoute;
