import React from "react";
import { Navigate, Outlet, useLocation } from "react-router-dom";
import { useAuth } from "./context/AuthContext";

const ProtectedRoute: React.FC = () => {
  const location = useLocation();
  const { user, isLoading } = useAuth();

  // Only show the blocking loader if we *don't yet know* whether there is a user.
  // If a user already exists, never block navigation with a loader.
  if (isLoading && !user) {
    return (
      <div className="min-h-[50vh] flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin rounded-full h-10 w-10 border-b-2 border-teal-600 mx-auto mb-3" />
          <p className="text-gray-600">Loading...</p>
        </div>
      </div>
    );
  }

  // If loading is done (or user exists) but there's still no user, redirect.
  if (!user) {
    return <Navigate to="/auth" replace state={{ from: location }} />;
  }

  // User exists -> allow route content to render.
  return <Outlet />;
};

export default ProtectedRoute;
