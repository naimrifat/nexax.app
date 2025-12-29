// src/App.tsx
import React from 'react';
import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router-dom';
import Layout from './components/Layout';
import HomePage from './pages/HomePage';
import DashboardPage from './pages/DashboardPage';
import ResultsPage from './pages/ResultsPage';
import PricingPage from './pages/PricingPage';
import { ListingProvider } from './context/ListingContext';
import { AuthProvider } from './context/AuthContext';
import ListingStyleSettingsPage from './pages/ListingStyleSettingsPage';
import AuthPage from './pages/AuthPage';
import ProtectedRoute from './components/ProtectedRoute';
import DraftsPage from './pages/DraftsPage';
import './App.css';

function App() {
  return (
    <Router>
      <AuthProvider>
        <ListingProvider>
          <Layout>
            <Routes>
              <Route path="/" element={<HomePage />} />
              <Route path="/pricing" element={<PricingPage />} />
              <Route path="/login" element={<AuthPage />} />

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

              {/* Canonical results route (supports query params like ?mode=edit&listingId=...) */}
              <Route
                path="/results"
                element={
                  <ProtectedRoute>
                    <ResultsPage />
                  </ProtectedRoute>
                }
              />

              {/* Backward-compat: if anything still links to /results/:id, redirect to /results?mode=edit&listingId=:id */}
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

              {/* /create-listing is your entry flow; keep it pointing to HomePage if that's where upload/analyze starts */}
              <Route path="/create-listing" element={<HomePage />} />

              <Route path="*" element={<div style={{ padding: 24 }}>Page not found</div>} />
            </Routes>
          </Layout>
        </ListingProvider>
      </AuthProvider>
    </Router>
  );
}

/**
 * Redirect /results/:id -> /results?mode=edit&listingId=:id
 * Keeps old links working while the app standardizes on query params.
 */
function ResultsIdRedirect() {
  // Avoid importing useParams/useNavigate in App-level if you want; this is clean and contained.
  const pathname = window.location.pathname; // "/results/<id>"
  const parts = pathname.split('/').filter(Boolean);
  const id = parts.length >= 2 ? parts[1] : '';

  if (!id) return <Navigate to="/results" replace />;

  const to = `/results?mode=edit&listingId=${encodeURIComponent(id)}`;
  return <Navigate to={to} replace />;
}

export default App;
