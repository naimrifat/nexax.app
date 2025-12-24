import React from 'react';
import { BrowserRouter as Router, Routes, Route } from 'react-router-dom';
import Layout from './components/Layout';
import HomePage from './pages/HomePage';
import DashboardPage from './pages/DashboardPage';
import ResultsPage from './pages/ResultsPage'; // keep as default export
import PricingPage from './pages/PricingPage';
import { ListingProvider } from './context/ListingContext';
import { AuthProvider } from './context/AuthContext';
import ListingStyleSettingsPage from './pages/ListingStyleSettingsPage';
import AuthPage from './pages/AuthPage';
import ProtectedRoute from './components/ProtectedRoute';
import './App.css';
import DraftsPage from './pages/DraftsPage';

function App() {
  return (
    <Router>
      <AuthProvider>
        <ListingProvider>
          <Layout>
            <Routes>
              <Route path="/" element={<HomePage />} />
              <Route path="/drafts" element={<DraftsPage />} />
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

              {/* Make :id optional so one component handles /results and /results/:id */}
              <Route
                path="/results/:id?"
                element={
                  <ProtectedRoute>
                    <ResultsPage />
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

              {/* Removed UploadPage import, use HomePage instead */}
              <Route path="/create-listing" element={<HomePage />} />

              {/* Simple 404 fallback */}
              <Route path="*" element={<div style={{ padding: 24 }}>Page not found</div>} />
            </Routes>
          </Layout>
        </ListingProvider>
      </AuthProvider>
    </Router>
  );
}

export default App;
