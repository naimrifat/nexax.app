import React, { useState, useEffect } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { Menu, X, ChevronDown, Upload, LayoutDashboard, Home, LogOut, TrendingUp, Camera } from 'lucide-react';

const Header: React.FC = () => {
  const [isScrolled, setIsScrolled] = useState(false);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const location = useLocation();

  // Track scroll position to change header style
  useEffect(() => {
    const handleScroll = () => {
      setIsScrolled(window.scrollY > 20);
    };
    
    window.addEventListener('scroll', handleScroll);
    return () => window.removeEventListener('scroll', handleScroll);
  }, []);

  // Close mobile menu when changing routes
  useEffect(() => {
    setMobileMenuOpen(false);
  }, [location]);

  return (
    <header 
      className={`sticky top-0 z-50 w-full transition-all duration-300 ${
        isScrolled ? 'bg-white shadow-md py-3' : 'bg-transparent py-5'
      }`}
    >
      <div className="container mx-auto px-4 md:px-6">
        <div className="flex items-center justify-between">
          {/* Logo */}
          <Link to="/" className="flex items-center space-x-2">
            <div className="w-10 h-10 bg-gradient-to-r from-teal-500 to-purple-600 rounded-lg flex items-center justify-center relative overflow-hidden">
              <div className="absolute inset-0 bg-gradient-to-br from-teal-400 to-purple-500 opacity-90"></div>
              <div className="relative flex items-center justify-center">
                <Camera className="w-4 h-4 text-white absolute -translate-x-1" />
                <TrendingUp className="w-4 h-4 text-white absolute translate-x-1 translate-y-0.5" />
              </div>
            </div>
            <span className="text-xl font-bold text-gray-900">SnapLine</span>
          </Link>

          {/* Desktop Navigation */}
          <nav className="hidden md:flex items-center space-x-6">
            <NavLink to="/" label="Home" icon={<Home className="w-4 h-4" />} active={location.pathname === '/'} />
            <NavLink to="/create-listing" label="Create Listing" icon={<Upload className="w-4 h-4" />} active={location.pathname === '/create-listing'} /> {/* <-- ADD THIS LINE */}
            <NavLink to="/dashboard" label="Dashboard" icon={<LayoutDashboard className="w-4 h-4" />} active={location.pathname === '/dashboard'} />
            <NavLink to="/pricing" label="Pricing" active={location.pathname === '/pricing'} />
            
            <div className="ml-4 flex items-center space-x-3">
              <button className="btn btn-outline">Log In</button>
              <button className="btn btn-primary">Sign Up</button>
            </div>
          </nav>

          {/* Mobile Menu Button */}
          <button 
            className="md:hidden p-2 rounded-md"
            onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
          >
            {mobileMenuOpen ? (
              <X className="w-6 h-6 text-gray-900" />
            ) : (
              <Menu className="w-6 h-6 text-gray-900" />
            )}
          </button>
        </div>
      </div>

      {/* Mobile Menu */}
      {mobileMenuOpen && (
        <div className="md:hidden bg-white absolute top-full left-0 w-full shadow-md animate-fade-in">
          <div className="container mx-auto px-4 py-4 flex flex-col space-y-4">
            <MobileNavLink to="/" label="Home" icon={<Home className="w-5 h-5" />} active={location.pathname === '/'} />
            <MobileNavLink to="/create-listing" label="Create Listing" icon={<Upload className="w-5 h-5" />} active={location.pathname === '/create-listing'} /> {/* <-- ADD THIS LINE */}
            <MobileNavLink to="/dashboard" label="Dashboard" icon={<LayoutDashboard className="w-5 h-5" />} active={location.pathname === '/dashboard'} />
            <MobileNavLink to="/pricing" label="Pricing" active={location.pathname === '/pricing'} />
            <hr className="border-gray-200" />
            <div className="flex flex-col space-y-3 pt-2">
              <button className="btn btn-outline w-full">Log In</button>
              <button className="btn btn-primary w-full">Sign Up</button>
            </div>
          </div>
        </div>
      )}
    </header>
  );
};

interface NavLinkProps {
  to: string;
  label: string;
  icon?: React.ReactNode;
  active: boolean;
}

const NavLink: React.FC<NavLinkProps> = ({ to, label, icon, active }) => (
  <Link 
    to={to} 
    className={`flex items-center space-x-1.5 px-3 py-2 rounded-md transition-all duration-200 ${
      active ? 'text-teal-700 bg-teal-50' : 'text-gray-700 hover:text-teal-600 hover:bg-gray-50'
    }`}
  >
    {icon && icon}
    <span>{label}</span>
  </Link>
);

const MobileNavLink: React.FC<NavLinkProps> = ({ to, label, icon, active }) => (
  <Link
    to={to}
    className={`flex items-center space-x-3 px-3 py-3 rounded-md ${
      active ? 'text-teal-700 bg-teal-50' : 'text-gray-700'
    }`}
  >
    {icon && icon}
    <span className="font-medium">{label}</span>
  </Link>
);

export default Header;
