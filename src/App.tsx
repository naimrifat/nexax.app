// src/App.tsx
import React from "react";
import { BrowserRouter as Router, Routes, Route, Navigate } from "react-router-dom";
import Layout from "./components/Layout";
import HomePage from "./pages/HomePage";
import DashboardPage from "./pages/DashboardPage";
import ResultsPage from "./pages/ResultsPage";
import PricingPage from "./pages/PricingPage";
import { ListingProvider } from "./context/ListingContext";
import { AuthProvider, useAuth } from "./context/AuthContext";
import ListingStyleSettingsPage from "./pages/ListingStyleSettingsPage";
import AuthPage from "./pages/AuthPage";
import ProtectedRoute from "./components/ProtectedRoute";
import DraftsPage from "./pages/DraftsPage";
import "./App.css";

function App() {
  return (
    <Router>
      <AuthProvider>
        <AppContent />
      </AuthProvider>
    </Router>
  );
}

function AppContent() {
  const { isLoading } = useAuth();
  
  // Show nothing while auth is bootstrapping
  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-teal-600 mx-auto mb-4" />
          <p className="text-gray-600">Loading...</p>
        </div>
      </div>
    );
  }

  return (
    <ListingProvider>
      <Layout>
        <Routes>
          <Route path="/" element={<HomePage />} />
          <Route path="/pricing" element={<PricingPage />} />

          {/* Route-based auth (no popup) */}
          <Route path="/login" element={<AuthPage initialMode="login" />} />
          <Route path="/signup" element={<AuthPage initialMode="signup" />} />
          <Route path="/reset" element={<AuthPage initialMode="reset" />} />

          <Route
            path="/dashboard"
            element={
              <ProtectedRoute>
                <DashboardPage />
              </ProtectedRoute>
            }
          />

          <Route
            path="/drafts"
            element={
              <ProtectedRoute>
                <DraftsPage />
              </ProtectedRoute>
            }
          />

          <Route
            path="/results"
            element={
              <ProtectedRoute>
                <ResultsPage />
              </ProtectedRoute>
            }
          />

          <Route
            path="/results/:id"
            element={
              <ProtectedRoute>
                <ResultsIdRedirect />
              </ProtectedRoute>
            }
          />

          <Route
            path="/settings/listing-style"
            element={
              <ProtectedRoute>
                <ListingStyleSettingsPage />
              </ProtectedRoute>
            }
          />

          <Route path="/create-listing" element={<HomePage />} />

          <Route path="*" element={<div style={{ padding: 24 }}>Page not found</div>} />
        </Routes>
      </Layout>
    </ListingProvider>
  );
}

function ResultsIdRedirect() {
  const pathname = window.location.pathname;
  const parts = pathname.split("/").filter(Boolean);
  const id = parts.length >= 2 ? parts[1] : "";

  if (!id) return <Navigate to="/results" replace />;

  const to = `/results?mode=edit&listingId=${encodeURIComponent(id)}`;
  return <Navigate to={to} replace />;
}

export default App;
