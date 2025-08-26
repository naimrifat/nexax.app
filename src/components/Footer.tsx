import React from 'react';
import { Link } from 'react-router-dom';
import { Facebook, Twitter, Instagram, Mail, ArrowRight, TrendingUp, Camera } from 'lucide-react';

const Footer: React.FC = () => {
  return (
    <footer className="bg-gray-50 border-t border-gray-200">
      <div className="container mx-auto px-4 py-12 md:py-16">
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-10">
          {/* Brand */}
          <div className="space-y-4">
            <div className="flex items-center space-x-2">
              <div className="w-10 h-10 bg-gradient-to-r from-teal-500 to-purple-600 rounded-lg flex items-center justify-center relative overflow-hidden">
                <div className="absolute inset-0 bg-gradient-to-br from-teal-400 to-purple-500 opacity-90"></div>
                <div className="relative flex items-center justify-center">
                  <Camera className="w-4 h-4 text-white absolute -translate-x-1" />
                  <TrendingUp className="w-4 h-4 text-white absolute translate-x-1 translate-y-0.5" />
                </div>
              </div>
              <span className="text-xl font-bold text-gray-900">SnapLine</span>
            </div>
            <p className="text-gray-600 text-sm">
              Effortlessly create professional product listings for all major marketplaces with AI-powered descriptions.
            </p>
            <div className="flex space-x-4 pt-2">
              <SocialIcon icon={<Facebook className="w-5 h-5" />} />
              <SocialIcon icon={<Twitter className="w-5 h-5" />} />
              <SocialIcon icon={<Instagram className="w-5 h-5" />} />
              <SocialIcon icon={<Mail className="w-5 h-5" />} />
            </div>
          </div>

          {/* Product */}
          <div>
            <h4 className="font-medium text-gray-900 mb-4">Product</h4>
            <ul className="space-y-3">
              <FooterLink label="Features" href="/features" />
              <FooterLink label="Pricing" href="/pricing" />
              <FooterLink label="Marketplace Templates" href="/templates" />
              <FooterLink label="Success Stories" href="/success-stories" />
            </ul>
          </div>

          {/* Resources */}
          <div>
            <h4 className="font-medium text-gray-900 mb-4">Resources</h4>
            <ul className="space-y-3">
              <FooterLink label="Help Center" href="/help" />
              <FooterLink label="API Documentation" href="/api-docs" />
              <FooterLink label="Blog" href="/blog" />
              <FooterLink label="Marketplace Guides" href="/guides" />
            </ul>
          </div>

          {/* Newsletter */}
          <div>
            <h4 className="font-medium text-gray-900 mb-4">Stay Updated</h4>
            <p className="text-sm text-gray-600 mb-3">
              Subscribe to our newsletter for tips, updates, and special offers.
            </p>
            <div className="flex">
              <input 
                type="email" 
                placeholder="Your email" 
                className="input rounded-r-none border-r-0 focus:z-10"
              />
              <button className="btn btn-primary rounded-l-none px-3">
                <ArrowRight className="w-5 h-5" />
              </button>
            </div>
          </div>
        </div>

        <div className="border-t border-gray-200 mt-10 pt-6 flex flex-col md:flex-row md:items-center md:justify-between text-sm text-gray-600">
          <div className="flex flex-col md:flex-row md:space-x-6 space-y-2 md:space-y-0 mb-4 md:mb-0">
            <span>© 2025 SnapLine. All rights reserved.</span>
            <Link to="/privacy" className="hover:text-teal-600 transition-colors">Privacy Policy</Link>
            <Link to="/terms" className="hover:text-teal-600 transition-colors">Terms of Service</Link>
          </div>
          <div>
            <span className="bg-gray-200 text-gray-700 px-3 py-1 rounded-full text-xs font-medium">
              Made with ❤️ for creators and sellers
            </span>
          </div>
        </div>
      </div>
    </footer>
  );
};

interface FooterLinkProps {
  label: string;
  href: string;
}

const FooterLink: React.FC<FooterLinkProps> = ({ label, href }) => (
  <li>
    <Link to={href} className="text-gray-600 hover:text-teal-600 transition-colors">
      {label}
    </Link>
  </li>
);

const SocialIcon: React.FC<{ icon: React.ReactNode }> = ({ icon }) => (
  <a href="#" className="w-8 h-8 bg-gray-200 rounded-full flex items-center justify-center text-gray-600 hover:bg-teal-100 hover:text-teal-600 transition-all">
    {icon}
  </a>
);

export default Footer;