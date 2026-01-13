// src/components/ProtectedRoute.tsx
import { Navigate, useLocation } from "react-router-dom";
import { useAuth } from "../context/AuthContext";

type ProtectedRouteProps = {
  children: React.ReactNode;
};

const ProtectedRoute: React.FC<ProtectedRouteProps> = ({ children }) => {
  const location = useLocation();
  const { user, tenancyStatus, tenancyError, isTenancyLoading, isLoading, retryTenancy } = useAuth();

  console.log('[ProtectedRoute] Render:', { hasUser: !!user, path: location.pathname, tenancyStatus, isTenancyLoading, isLoading });

  // Not authenticated -> redirect to login
  if (!user) {
    return <Navigate to="/login" replace state={{ from: location }} />;
  }

  if (tenancyError) {
    return (
      <div style={{ padding: 24, maxWidth: 520, margin: "60px auto" }}>
        <div style={{ border: "1px solid #fecaca", background: "#fef2f2", color: "#991b1b", borderRadius: 8, padding: 16 }}>
          <div style={{ fontWeight: 700, marginBottom: 8 }}>Workspace load failed</div>
          <div style={{ marginBottom: 12 }}>{tenancyError}</div>
          <div style={{ display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
            <button
              type="button"
              onClick={() => void retryTenancy()}
              style={{ padding: "10px 14px", background: "#991b1b", color: "white", border: "none", borderRadius: 6, cursor: "pointer" }}
            >
              Retry
            </button>
            <button
              type="button"
              onClick={() => window.location.reload()}
              style={{ padding: "10px 14px", background: "#f3f4f6", color: "#111", border: "1px solid #ddd", borderRadius: 6, cursor: "pointer" }}
            >
              Reload
            </button>
          </div>
        </div>
      </div>
    );
  }

  if (isLoading || isTenancyLoading || tenancyStatus === "resolving") {
    return (
      <div style={{ padding: 24, textAlign: "center" }}>
        <div style={{ fontSize: 16, fontWeight: 600 }}>Loading workspace…</div>
      </div>
    );
  }

  return <>{children}</>;
};

export default ProtectedRoute;

