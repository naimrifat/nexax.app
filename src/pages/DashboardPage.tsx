import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import { PlusCircle, Search, Filter, ArrowUp, ArrowDown, MoreHorizontal, Eye, Edit, Trash, ExternalLink, Download, Copy } from 'lucide-react';

const DashboardPage: React.FC = () => {
  const [activeFilter, setActiveFilter] = useState<string>('all');
  const [sortDirection, setSortDirection] = useState<'asc' | 'desc'>('desc');
  const [searchQuery, setSearchQuery] = useState<string>('');

  // Mock data - in a real app, this would come from an API
  const listingItems = [
    {
      id: '1',
      title: 'Vintage Tommy Hilfiger Denim Jacket',
      image: 'https://images.pexels.com/photos/1598507/pexels-photo-1598507.jpeg?auto=compress&cs=tinysrgb&w=1260&h=750&dpr=2',
      platforms: ['eBay', 'Poshmark'],
      date: '2023-09-15',
      price: 89.99,
      status: 'active',
      views: 243,
      likes: 18,
    },
    {
      id: '2',
      title: 'Nike Air Jordan 1 Retro High OG',
      image: 'https://images.pexels.com/photos/1598505/pexels-photo-1598505.jpeg?auto=compress&cs=tinysrgb&w=1260&h=750&dpr=2',
      platforms: ['eBay', 'Mercari'],
      date: '2023-09-10',
      price: 189.99,
      status: 'active',
      views: 521,
      likes: 47,
    },
    {
      id: '3',
      title: 'Vintage Levi\'s 501 Jeans',
      image: 'https://images.pexels.com/photos/9580121/pexels-photo-9580121.jpeg?auto=compress&cs=tinysrgb&w=1260&h=750&dpr=2',
      platforms: ['Poshmark', 'Mercari'],
      date: '2023-09-05',
      price: 65.00,
      status: 'draft',
      views: 0,
      likes: 0,
    },
    {
      id: '4',
      title: 'Apple iPhone 13 Pro - 256GB',
      image: 'https://images.pexels.com/photos/5749517/pexels-photo-5749517.jpeg?auto=compress&cs=tinysrgb&w=1260&h=750&dpr=2',
      platforms: ['eBay', 'Mercari'],
      date: '2023-09-01',
      price: 849.99,
      status: 'sold',
      views: 982,
      likes: 32,
    },
    {
      id: '5',
      title: 'Sony WH-1000XM4 Wireless Headphones',
      image: 'https://images.pexels.com/photos/3394666/pexels-photo-3394666.jpeg?auto=compress&cs=tinysrgb&w=1260&h=750&dpr=2',
      platforms: ['eBay', 'Mercari'],
      date: '2023-08-28',
      price: 249.99,
      status: 'active',
      views: 312,
      likes: 15,
    }
  ];

  // Filter and sort listings
  const filteredListings = listingItems
    .filter(item => {
      if (activeFilter === 'all') return true;
      return item.status === activeFilter;
    })
    .filter(item => {
      if (!searchQuery) return true;
      return item.title.toLowerCase().includes(searchQuery.toLowerCase());
    })
    .sort((a, b) => {
      const dateA = new Date(a.date).getTime();
      const dateB = new Date(b.date).getTime();
      return sortDirection === 'asc' ? dateA - dateB : dateB - dateA;
    });

  const toggleSortDirection = () => {
    setSortDirection(sortDirection === 'asc' ? 'desc' : 'asc');
  };

  return (
    <div className="container mx-auto px-4 py-8 md:py-12">
      <div className="max-w-6xl mx-auto">
        <div className="flex flex-col md:flex-row md:items-center md:justify-between mb-8">
          <h1 className="text-3xl font-bold text-gray-900 mb-4 md:mb-0">Your Listings</h1>
          <Link to="/upload" className="btn btn-primary flex items-center justify-center">
            <PlusCircle className="w-5 h-5 mr-2" />
            Create New Listing
          </Link>
        </div>

        {/* Filters and Search */}
        <div className="bg-white rounded-lg shadow-sm border border-gray-100 p-4 mb-6">
          <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
            <div className="flex flex-wrap gap-2">
              <FilterButton 
                label="All" 
                isActive={activeFilter === 'all'} 
                onClick={() => setActiveFilter('all')} 
                count={listingItems.length}
              />
              <FilterButton 
                label="Active" 
                isActive={activeFilter === 'active'} 
                onClick={() => setActiveFilter('active')} 
                count={listingItems.filter(item => item.status === 'active').length}
              />
              <FilterButton 
                label="Drafts" 
                isActive={activeFilter === 'draft'} 
                onClick={() => setActiveFilter('draft')} 
                count={listingItems.filter(item => item.status === 'draft').length}
              />
              <FilterButton 
                label="Sold" 
                isActive={activeFilter === 'sold'} 
                onClick={() => setActiveFilter('sold')} 
                count={listingItems.filter(item => item.status === 'sold').length}
              />
            </div>
            
            <div className="flex gap-2">
              <div className="relative flex-grow">
                <div className="absolute inset-y-0 left-3 flex items-center pointer-events-none">
                  <Search className="w-4 h-4 text-gray-400" />
                </div>
                <input
                  type="text"
                  placeholder="Search listings..."
                  className="input pl-10"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                />
              </div>
              
              <button className="btn btn-outline flex items-center">
                <Filter className="w-4 h-4 mr-1.5" />
                Filter
              </button>
              
              <button 
                className="btn btn-outline flex items-center"
                onClick={toggleSortDirection}
              >
                {sortDirection === 'asc' ? (
                  <ArrowUp className="w-4 h-4 mr-1.5" />
                ) : (
                  <ArrowDown className="w-4 h-4 mr-1.5" />
                )}
                Date
              </button>
            </div>
          </div>
        </div>

        {/* Listings */}
        <div className="space-y-4">
          {filteredListings.length === 0 ? (
            <div className="bg-white rounded-lg shadow-sm border border-gray-100 p-8 text-center">
              <h3 className="text-lg font-semibold text-gray-700 mb-2">No listings found</h3>
              <p className="text-gray-500 mb-4">
                {searchQuery ? 'Try a different search term' : 'Create your first listing to get started'}
              </p>
              <Link to="/upload" className="btn btn-primary inline-flex items-center">
                <PlusCircle className="w-4 h-4 mr-2" />
                Create New Listing
              </Link>
            </div>
          ) : (
            filteredListings.map((listing) => (
              <ListingCard key={listing.id} listing={listing} />
            ))
          )}
        </div>

        {/* Pagination */}
        {filteredListings.length > 0 && (
          <div className="flex justify-center mt-8">
            <nav className="flex items-center space-x-1">
              <button className="btn btn-outline py-1.5 px-3">Previous</button>
              <button className="h-9 w-9 rounded-md bg-teal-50 text-teal-700 font-medium flex items-center justify-center">1</button>
              <button className="h-9 w-9 rounded-md text-gray-700 hover:bg-gray-50 flex items-center justify-center">2</button>
              <button className="h-9 w-9 rounded-md text-gray-700 hover:bg-gray-50 flex items-center justify-center">3</button>
              <button className="btn btn-outline py-1.5 px-3">Next</button>
            </nav>
          </div>
        )}
      </div>
    </div>
  );
};

interface FilterButtonProps {
  label: string;
  isActive: boolean;
  onClick: () => void;
  count: number;
}

const FilterButton: React.FC<FilterButtonProps> = ({ label, isActive, onClick, count }) => (
  <button 
    className={`px-4 py-2 rounded-md text-sm font-medium flex items-center ${
      isActive 
        ? 'bg-teal-50 text-teal-700' 
        : 'bg-white text-gray-700 hover:bg-gray-50'
    }`}
    onClick={onClick}
  >
    {label}
    <span className={`ml-1.5 px-1.5 py-0.5 rounded-full text-xs ${
      isActive ? 'bg-teal-100 text-teal-800' : 'bg-gray-100 text-gray-700'
    }`}>
      {count}
    </span>
  </button>
);

interface ListingCardProps {
  listing: {
    id: string;
    title: string;
    image: string;
    platforms: string[];
    date: string;
    price: number;
    status: string;
    views: number;
    likes: number;
  };
}

const ListingCard: React.FC<ListingCardProps> = ({ listing }) => {
  const [isMenuOpen, setIsMenuOpen] = useState(false);

  const formatDate = (dateString: string) => {
    const date = new Date(dateString);
    return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  };

  const getStatusBadge = (status: string) => {
    switch (status) {
      case 'active':
        return <span className="badge badge-success">Active</span>;
      case 'draft':
        return <span className="badge bg-gray-100 text-gray-800">Draft</span>;
      case 'sold':
        return <span className="badge bg-purple-100 text-purple-800">Sold</span>;
      default:
        return null;
    }
  };

  return (
    <div className="bg-white rounded-lg shadow-sm border border-gray-100 overflow-hidden transition-all hover:shadow-md">
      <div className="flex flex-col sm:flex-row">
        {/* Image */}
        <div className="sm:w-48 h-48 sm:h-auto">
          <img 
            src={listing.image} 
            alt={listing.title} 
            className="w-full h-full object-cover"
          />
        </div>
        
        {/* Content */}
        <div className="flex-1 p-4 flex flex-col sm:flex-row">
          {/* Main Info */}
          <div className="flex-1">
            <div className="flex justify-between">
              <h3 className="text-lg font-semibold text-gray-900 mb-1 line-clamp-2">
                {listing.title}
              </h3>
              <div className="relative">
                <button 
                  className="p-1 rounded-md hover:bg-gray-100 transition-colors"
                  onClick={() => setIsMenuOpen(!isMenuOpen)}
                >
                  <MoreHorizontal className="w-5 h-5 text-gray-500" />
                </button>
                
                {/* Dropdown Menu */}
                {isMenuOpen && (
                  <div className="absolute right-0 mt-1 w-48 bg-white rounded-md shadow-lg border border-gray-100 z-10">
                    <div className="py-1">
                      <ActionButton icon={<Eye className="w-4 h-4" />} label="View" />
                      <ActionButton icon={<Edit className="w-4 h-4" />} label="Edit" />
                      <ActionButton icon={<Copy className="w-4 h-4" />} label="Duplicate" />
                      <ActionButton icon={<Download className="w-4 h-4" />} label="Download" />
                      <ActionButton icon={<ExternalLink className="w-4 h-4" />} label="Open in Marketplace" />
                      <div className="border-t border-gray-100 my-1"></div>
                      <ActionButton icon={<Trash className="w-4 h-4 text-red-500" />} label="Delete" labelClass="text-red-500" />
                    </div>
                  </div>
                )}
              </div>
            </div>
            
            {/* Price and Date */}
            <div className="flex items-center mb-3">
              <span className="font-medium text-gray-900">${listing.price.toFixed(2)}</span>
              <span className="mx-2 text-gray-300">•</span>
              <span className="text-sm text-gray-500">Created {formatDate(listing.date)}</span>
            </div>
            
            {/* Platforms */}
            <div className="flex flex-wrap gap-1.5 mb-3">
              {listing.platforms.map((platform) => (
                <span key={platform} className="text-xs px-2 py-1 bg-gray-100 text-gray-700 rounded-full">
                  {platform}
                </span>
              ))}
            </div>
            
            {/* Status Badge */}
            {getStatusBadge(listing.status)}
          </div>
          
          {/* Stats and Actions */}
          <div className="flex sm:flex-col justify-between sm:justify-center sm:items-end sm:ml-6 mt-4 sm:mt-0 pt-4 sm:pt-0 border-t sm:border-t-0 border-gray-100">
            {/* Stats */}
            {listing.status !== 'draft' && (
              <div className="flex sm:flex-col sm:items-end gap-3 sm:gap-1 mb-4">
                <div className="text-sm">
                  <span className="text-gray-500">Views:</span> <span className="font-medium text-gray-900">{listing.views}</span>
                </div>
                <div className="text-sm">
                  <span className="text-gray-500">Likes:</span> <span className="font-medium text-gray-900">{listing.likes}</span>
                </div>
              </div>
            )}
            
            {/* Actions */}
            <div className="flex sm:flex-col gap-2">
              <Link to={`/results/${listing.id}`} className="btn btn-outline py-1.5 text-sm px-3 flex items-center justify-center">
                <Eye className="w-4 h-4 mr-1.5" />
                View
              </Link>
              <Link to={`/upload?edit=${listing.id}`} className="btn btn-primary py-1.5 text-sm px-3 flex items-center justify-center">
                <Edit className="w-4 h-4 mr-1.5" />
                Edit
              </Link>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

interface ActionButtonProps {
  icon: React.ReactNode;
  label: string;
  labelClass?: string;
}

const ActionButton: React.FC<ActionButtonProps> = ({ icon, label, labelClass = "" }) => (
  <button className="w-full text-left px-4 py-2 text-sm text-gray-700 hover:bg-gray-50 flex items-center">
    <span className="mr-3 text-gray-500">{icon}</span>
    <span className={labelClass}>{label}</span>
  </button>
);

export default DashboardPage;