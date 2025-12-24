import React from 'react';
import { BrowserRouter as Router, Routes, Route } from 'react-router-dom';
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

              {/* Optional id is fine; query params like ?mode=edit still work */}
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

              <Route path="/create-listing" element={<HomePage />} />

              <Route path="*" element={<div style={{ padding: 24 }}>Page not found</div>} />
            </Routes>
          </Layout>
        </ListingProvider>
      </AuthProvider>
    </Router>
  );
}

export default App;
