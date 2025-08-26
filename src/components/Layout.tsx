import React from 'react';
import Header from './Header';
import Footer from './Footer';
import { useLocation } from 'react-router-dom';

interface LayoutProps {
  children: React.ReactNode;
}

const Layout: React.FC<LayoutProps> = ({ children }) => {
  const location = useLocation();
  
  // Add page-specific classes based on route
  const getPageClass = () => {
    const path = location.pathname;
    if (path === '/') return 'home-page';
    if (path === '/upload') return 'upload-page';
    if (path.includes('/results')) return 'results-page';
    if (path === '/dashboard') return 'dashboard-page';
    return '';
  };

  return (
    <div className={`app-container ${getPageClass()}`}>
      <Header />
      <main className="flex-grow">
        <div className="page-transition animate-fade-in">
          {children}
        </div>
      </main>
      <Footer />
    </div>
  );
};

export default Layout;