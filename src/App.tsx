import React from 'react';
import { BrowserRouter as Router, Routes, Route } from 'react-router-dom';
import Layout from './components/Layout';
import HomePage from './pages/HomePage';
import DashboardPage from './pages/DashboardPage';
import ResultsPage from './pages/ResultsPage'; // keep as default export
import PricingPage from './pages/PricingPage';
import { ListingProvider } from './context/ListingContext';
import './App.css';

function App() {
  return (
    <Router>
      <ListingProvider>
        <Layout>
          <Routes>
            <Route path="/" element={<HomePage />} />
            <Route path="/dashboard" element={<DashboardPage />} />
            {/* Make :id optional so one component handles /results and /results/:id */}
            <Route path="/results/:id?" element={<ResultsPage />} />
            <Route path="/pricing" element={<PricingPage />} />
            <Route path="/create-listing" element={<UploadPage />} />

            {/* Simple 404 fallback */}
            <Route path="*" element={<div style={{ padding: 24 }}>Page not found</div>} />
          </Routes>
        </Layout>
      </ListingProvider>
    </Router>
  );
}

export default App;
