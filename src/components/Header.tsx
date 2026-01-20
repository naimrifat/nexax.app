// src/components/Header.tsx
import React, { useState, useEffect, useRef } from "react";
import { Link, useLocation } from "react-router-dom";
import {
  Menu,
  X,
  LayoutDashboard,
  Home,
  LogOut,
  TrendingUp,
  Camera,
  Settings,
  User,
  CreditCard,
  ChevronDown,
} from "lucide-react";
import { useAuth } from "../context/AuthContext";
import { supabase } from "../../lib/supabaseClient";

const Header: React.FC = () => {
  const [isScrolled, setIsScrolled] = useState(false);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [profileOpen, setProfileOpen] = useState(false);

  const location = useLocation();

  // We only need user here for display.
  const { user } = useAuth();

  const profileRef = useRef<HTMLDivElement | null>(null);

  // Track scroll position to change header style
  useEffect(() => {
    const handleScroll = () => setIsScrolled(window.scrollY > 20);
    window.addEventListener("scroll", handleScroll);
    return () => window.removeEventListener("scroll", handleScroll);
  }, []);

  // Close mobile menu when changing routes
  useEffect(() => {
    setMobileMenuOpen(false);
    setProfileOpen(false);
  }, [location]);

  // Close profile menu when clicking outside
  useEffect(() => {
    const onDocClick = (e: MouseEvent) => {
      if (!profileRef.current) return;
      const target = e.target as Node;
      if (!profileRef.current.contains(target)) {
        setProfileOpen(false);
      }
    };
    document.addEventListener("mousedown", onDocClick);
    return () => document.removeEventListener("mousedown", onDocClick);
  }, []);

  const handleLogout = async () => {
    try {
      console.log("[Header] handleLogout started");

      // 1) Attempt normal local sign out, but do not wait long.
      const signOutAttempt = supabase.auth.signOut({ scope: "local" });
      const timeoutPromise = new Promise<"timeout">((resolve) => setTimeout(() => resolve("timeout"), 800));

      const result = await Promise.race([signOutAttempt.then(() => "ok" as const), timeoutPromise]);

      if (result === "ok") {
        console.log("[Header] Supabase signOut succeeded (local)");
      } else {
        console.warn("[Header] Supabase signOut timed out, applying manual logout fallback...");
      }

      // 2) Manual fallback: clear Supabase auth storage keys
      for (let i = localStorage.length - 1; i >= 0; i--) {
        const k = localStorage.key(i);
        if (!k) continue;
        if (k.startsWith("sb-") && k.endsWith("-auth-token")) {
          localStorage.removeItem(k);
        }
      }
      localStorage.removeItem("supabase.auth.token");

      // Clear legacy Snapline local auth keys (from old AuthContext implementation)
      localStorage.removeItem("snapline.auth.users");
      localStorage.removeItem("snapline.auth.currentUser");

      setMobileMenuOpen(false);
      setProfileOpen(false);

      // 3) Hard reload into /login (no SPA state survives)
      window.location.href = "/login";
    } catch (err: unknown) {
      console.error("[Header] Manual logout failed:", err);
      alert(err instanceof Error ? err.message : "Logout failed.");
      window.location.href = "/login";
    }
  };

  const showPricing = !user && location.pathname === "/";

  return (
    <header
      className={`sticky top-0 z-50 w-full transition-all duration-300 ${
        isScrolled ? "bg-white shadow-md py-3" : "bg-transparent py-5"
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
            <span className="text-xl font-bold text-gray-900">Nexax.app</span>
          </Link>

          {/* Desktop Navigation */}
          <nav className="hidden md:flex items-center space-x-6">
            <NavLink to="/" label="Home" icon={<Home className="w-4 h-4" />} active={location.pathname === "/"} />
            <NavLink
              to="/dashboard"
              label="Dashboard"
              icon={<LayoutDashboard className="w-4 h-4" />}
              active={location.pathname === "/dashboard"}
            />

            {showPricing && (
              <NavLink to="/pricing" label="Pricing" active={location.pathname === "/pricing"} />
            )}

            <div className="ml-4 flex items-center space-x-3">
              {user ? (
                <div className="relative" ref={profileRef}>
                  <button
                    type="button"
                    className="btn btn-outline flex items-center"
                    onClick={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      setProfileOpen((v) => !v);
                    }}
                  >
                    <span className="text-sm text-gray-800 mr-2">Hi, {user.email}</span>
                    <ChevronDown className="w-4 h-4" />
                  </button>

                  {profileOpen && (
                    <div className="absolute right-0 mt-2 w-64 bg-white border border-gray-200 rounded-lg shadow-lg overflow-hidden z-50">
                      <div className="px-4 py-3 bg-gray-50">
                        <div className="text-xs text-gray-500">Signed in as</div>
                        <div className="text-sm font-medium text-gray-900 truncate">{user.email}</div>
                      </div>

                      <div className="py-2">
                        <MenuItem to="/settings/account" icon={<User className="w-4 h-4" />} label="Settings: Account" />
                        <MenuItem
                          to="/settings/listing-style"
                          icon={<Settings className="w-4 h-4" />}
                          label="Settings: Listing Style"
                        />
                        <MenuItem
                          to="/settings/billing"
                          icon={<CreditCard className="w-4 h-4" />}
                          label="Settings: Billing"
                        />
                      </div>

                      <div className="border-t border-gray-200" />

                      <button
                        type="button"
                        className="w-full px-4 py-2 text-left text-sm text-gray-700 hover:bg-gray-50 flex items-center space-x-2"
                        onClick={(e) => {
                          e.preventDefault();
                          e.stopPropagation();
                          console.log("[Header] Logout clicked (profile menu)");
                          handleLogout();
                        }}
                      >
                        <LogOut className="w-4 h-4" />
                        <span>Log Out</span>
                      </button>
                    </div>
                  )}
                </div>
              ) : (
                <>
                  {/* No popup: route-based auth */}
                  <Link to="/login" className="btn btn-outline">
                    Log In
                  </Link>
                  <Link to="/signup" className="btn btn-primary">
                    Sign Up
                  </Link>
                </>
              )}
            </div>
          </nav>

          {/* Mobile Menu Button */}
          <button
            type="button"
            className="md:hidden p-2 rounded-md"
            onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
          >
            {mobileMenuOpen ? <X className="w-6 h-6 text-gray-900" /> : <Menu className="w-6 h-6 text-gray-900" />}
          </button>
        </div>
      </div>

      {/* Mobile Menu */}
      {mobileMenuOpen && (
        <div className="md:hidden bg-white absolute top-full left-0 w-full shadow-md animate-fade-in">
          <div className="container mx-auto px-4 py-4 flex flex-col space-y-4">
            <MobileNavLink to="/" label="Home" icon={<Home className="w-5 h-5" />} active={location.pathname === "/"} />
            <MobileNavLink
              to="/dashboard"
              label="Dashboard"
              icon={<LayoutDashboard className="w-5 h-5" />}
              active={location.pathname === "/dashboard"}
            />

            {/* Pricing only on homepage and only when logged out */}
            {showPricing && <MobileNavLink to="/pricing" label="Pricing" active={location.pathname === "/pricing"} />}

            {user && (
              <>
                <div className="pt-2">
                  <div className="text-xs uppercase tracking-wide text-gray-500 px-1 mb-2">Settings</div>
                  <MobileNavLink
                    to="/settings/account"
                    label="Account"
                    icon={<User className="w-5 h-5" />}
                    active={location.pathname === "/settings/account"}
                  />
                  <MobileNavLink
                    to="/settings/listing-style"
                    label="Listing Style"
                    icon={<Settings className="w-5 h-5" />}
                    active={location.pathname === "/settings/listing-style"}
                  />
                  <MobileNavLink
                    to="/settings/billing"
                    label="Billing"
                    icon={<CreditCard className="w-5 h-5" />}
                    active={location.pathname === "/settings/billing"}
                  />
                </div>
              </>
            )}

            <hr className="border-gray-200" />
            <div className="flex flex-col space-y-3 pt-2">
              {user ? (
                <>
                  <div className="rounded-lg bg-gray-50 px-3 py-2 text-sm text-gray-700">Signed in as {user.email}</div>
                  <button
                    type="button"
                    className="btn btn-outline w-full"
                    onClick={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      console.log("[Header] Logout button clicked (mobile)");
                      handleLogout();
                    }}
                  >
                    <LogOut className="w-4 h-4 mr-1" />
                    Log Out
                  </button>
                </>
              ) : (
                <>
                  {/* No popup: route-based auth */}
                  <Link to="/login" className="btn btn-outline w-full">
                    Log In
                  </Link>
                  <Link to="/signup" className="btn btn-primary w-full">
                    Sign Up
                  </Link>
                </>
              )}
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
      active ? "text-teal-700 bg-teal-50" : "text-gray-700 hover:text-teal-600 hover:bg-gray-50"
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
      active ? "text-teal-700 bg-teal-50" : "text-gray-700"
    }`}
  >
    {icon && icon}
    <span className="font-medium">{label}</span>
  </Link>
);

function MenuItem({
  to,
  icon,
  label,
}: {
  to: string;
  icon: React.ReactNode;
  label: string;
}) {
  return (
    <Link
      to={to}
      className="w-full px-4 py-2 text-sm text-gray-700 hover:bg-gray-50 flex items-center space-x-2"
    >
      {icon}
      <span>{label}</span>
    </Link>
  );
}

export default Header;
