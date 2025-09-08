import React from 'react';
import { BrowserRouter as Router, Routes, Route } from 'react-router-dom';
import Layout from './components/Layout';
import HomePage from './pages/HomePage';
import DashboardPage from './pages/DashboardPage';
import ResultsPage from './pages/ResultsPage'; // <-- This was the missing line
import PricingPage from './pages/PricingPage';
import { ListingProvider } from './context/ListingContext';
import './App.css';

// 1. IMPORT THE NEW UPLOAD PAGE
import UploadPage from './pages/UploadPage';

function App() {
  return (
    <Router>
      <ListingProvider>
        <Layout>
          <Routes>
            <Route path="/" element={<HomePage />} />
            <Route path="/dashboard" element={<DashboardPage />} />
            <Route path="/results/:id" element={<ResultsPage />} />
            <Route path="/pricing" element={<PricingPage />} />
            
            {/* 2. ADD THE ROUTES FOR THE NEW PAGES */}
            <Route path="/create-listing" element={<UploadPage />} />
            <Route path="/results" element={<ResultsPage />} />

          </Routes>
        </Layout>
      </ListingProvider>
    </Router>
  );
}

export default App;
