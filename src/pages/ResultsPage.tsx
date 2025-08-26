import React, { useState, useEffect } from 'react';
import { useParams, Link } from 'react-router-dom';
import { Copy, Download, Check, Edit, Image, Sparkles, ArrowLeft, ArrowRight, ExternalLink, Tag } from 'lucide-react';
import { useListing } from '../context/ListingContext';

const ResultsPage: React.FC = () => {
  const { id } = useParams<{ id: string }>();
  const { photos } = useListing();
  const [activeTab, setActiveTab] = useState<string>('eBay');
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [isCopied, setIsCopied] = useState<boolean>(false);
  const [currentImageIndex, setCurrentImageIndex] = useState<number>(0);
  const [editMode, setEditMode] = useState<boolean>(false);
  
  // Mock listing data - in a real app, this would come from the backend
  const [listingData, setListingData] = useState({
    title: 'Vintage 90s Tommy Hilfiger Denim Jacket Blue Red Logo Size L',
    description: 'Amazing vintage Tommy Hilfiger denim jacket from the 90s featuring the iconic flag logo. In excellent condition with minimal wear. This classic piece features button closure, front pockets, and adjustable button cuffs. Perfect addition to any vintage collection or everyday wardrobe.\n\nSize: Large (fits true to size)\nMaterial: 100% Cotton Denim\nCondition: Excellent vintage condition\nEra: 1990s\n\nMeasurements:\n- Chest: 22" (pit to pit)\n- Length: 26"\n- Sleeves: 24"',
    price: 89.99,
    condition: 'Pre-owned - Excellent',
    brand: 'Tommy Hilfiger',
    color: 'Blue',
    size: 'L',
    tags: ['vintage', 'denim jacket', '90s', 'tommy hilfiger', 'streetwear']
  });

  // Simulate loading
  useEffect(() => {
    const timer = setTimeout(() => {
      setIsLoading(false);
    }, 2000);
    
    return () => clearTimeout(timer);
  }, []);

  const handleCopyListing = () => {
    // In a real app, this would copy the formatted listing to clipboard
    setIsCopied(true);
    setTimeout(() => setIsCopied(false), 2000);
  };

  const handleDownload = () => {
    // In a real app, this would download the listing in the appropriate format
    alert('Listing downloaded successfully!');
  };

  const handleNextImage = () => {
    if (photos && currentImageIndex < photos.length - 1) {
      setCurrentImageIndex(currentImageIndex + 1);
    }
  };

  const handlePrevImage = () => {
    if (currentImageIndex > 0) {
      setCurrentImageIndex(currentImageIndex - 1);
    }
  };

  const handleSaveEdits = () => {
    setEditMode(false);
    // In a real app, save the edits to the listing
  };

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    const { name, value } = e.target;
    setListingData({
      ...listingData,
      [name]: value
    });
  };

  const platformTemplates = [
    { id: 'eBay', color: 'bg-yellow-100', textColor: 'text-yellow-800' },
    { id: 'Poshmark', color: 'bg-red-100', textColor: 'text-red-800' },
    { id: 'Mercari', color: 'bg-blue-100', textColor: 'text-blue-800' }
  ];

  // Mock photo URL - in a real app, we would use the actual uploaded photos
  const mockPhotoUrl = "https://images.pexels.com/photos/1598507/pexels-photo-1598507.jpeg?auto=compress&cs=tinysrgb&w=1260&h=750&dpr=2";
  const mockPhotoUrl2 = "https://images.pexels.com/photos/1598505/pexels-photo-1598505.jpeg?auto=compress&cs=tinysrgb&w=1260&h=750&dpr=2";

  return (
    <div className="container mx-auto px-4 py-8 md:py-12">
      <div className="max-w-6xl mx-auto">
        <div className="flex items-center mb-8">
          <Link to="/upload" className="flex items-center text-gray-600 hover:text-teal-600 transition-colors">
            <ArrowLeft className="w-5 h-5 mr-2" />
            Back to Upload
          </Link>
          <h1 className="text-3xl font-bold text-gray-900 ml-4">Your Generated Listings</h1>
        </div>

        {isLoading ? (
          <div className="card p-8 text-center">
            <div className="flex flex-col items-center">
              <Sparkles className="w-12 h-12 text-teal-600 mb-4 animate-pulse" />
              <h2 className="text-2xl font-semibold mb-3">Generating Your Listings</h2>
              <p className="text-gray-600 mb-6">Our AI is analyzing your photos and creating professional listings...</p>
              <div className="w-full max-w-md h-2 bg-gray-200 rounded-full overflow-hidden">
                <div className="h-full bg-teal-500 animate-pulse" style={{ width: '75%' }}></div>
              </div>
            </div>
          </div>
        ) : (
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
            {/* Left Column - Photo Preview */}
            <div className="lg:col-span-1">
              <div className="card overflow-hidden">
                <div className="relative aspect-square bg-gray-100">
                  <img 
                    src={currentImageIndex % 2 === 0 ? mockPhotoUrl : mockPhotoUrl2} 
                    alt="Product" 
                    className="w-full h-full object-cover"
                  />
                  
                  {/* Image Navigation */}
                  {photos && photos.length > 1 && (
                    <div className="absolute bottom-4 left-0 right-0 flex justify-center space-x-2">
                      <button 
                        className="p-2 bg-black bg-opacity-50 rounded-full text-white hover:bg-opacity-70 transition-all disabled:opacity-30"
                        onClick={handlePrevImage}
                        disabled={currentImageIndex === 0}
                      >
                        <ArrowLeft className="w-4 h-4" />
                      </button>
                      <div className="bg-black bg-opacity-50 text-white text-sm rounded-full px-3 py-1">
                        {currentImageIndex + 1} / {photos.length}
                      </div>
                      <button 
                        className="p-2 bg-black bg-opacity-50 rounded-full text-white hover:bg-opacity-70 transition-all disabled:opacity-30"
                        onClick={handleNextImage}
                        disabled={!photos || currentImageIndex === photos.length - 1}
                      >
                        <ArrowRight className="w-4 h-4" />
                      </button>
                    </div>
                  )}
                </div>
                
                <div className="p-4">
                  <div className="flex justify-between items-center mb-3">
                    <h3 className="font-semibold">Product Photos</h3>
                    <Link to="/upload" className="text-sm text-teal-600 hover:text-teal-700 transition-colors">
                      Edit Photos
                    </Link>
                  </div>
                  
                  <div className="grid grid-cols-5 gap-2">
                    <PhotoThumb 
                      url={mockPhotoUrl} 
                      isActive={currentImageIndex === 0} 
                      onClick={() => setCurrentImageIndex(0)} 
                    />
                    <PhotoThumb 
                      url={mockPhotoUrl2} 
                      isActive={currentImageIndex === 1} 
                      onClick={() => setCurrentImageIndex(1)} 
                    />
                    {/* Add more thumbnails here as needed */}
                  </div>
                </div>
              </div>
              
              <div className="card p-4 mt-6">
                <h3 className="font-semibold mb-3">Product Details</h3>
                <div className="space-y-2">
                  <DetailItem label="Brand" value={listingData.brand} />
                  <DetailItem label="Size" value={listingData.size} />
                  <DetailItem label="Color" value={listingData.color} />
                  <DetailItem label="Condition" value={listingData.condition} />
                  <DetailItem label="Price" value={`$${listingData.price}`} />
                </div>
              </div>
              
              <div className="card p-4 mt-6">
                <div className="flex justify-between items-center mb-3">
                  <h3 className="font-semibold">Tags</h3>
                  <button className="text-sm text-teal-600 hover:text-teal-700 transition-colors">
                    Edit Tags
                  </button>
                </div>
                <div className="flex flex-wrap gap-2">
                  {listingData.tags.map((tag, index) => (
                    <span key={index} className="badge badge-primary flex items-center">
                      <Tag className="w-3 h-3 mr-1" />
                      {tag}
                    </span>
                  ))}
                </div>
              </div>
            </div>
            
            {/* Right Column - Listing Preview */}
            <div className="lg:col-span-2">
              <div className="card mb-6">
                <div className="border-b border-gray-200">
                  <div className="flex overflow-x-auto hide-scrollbar">
                    {platformTemplates.map((platform) => (
                      <button
                        key={platform.id}
                        className={`px-6 py-4 font-medium text-sm whitespace-nowrap transition-colors ${
                          activeTab === platform.id
                            ? `border-b-2 border-teal-500 text-teal-700`
                            : 'text-gray-500 hover:text-gray-700'
                        }`}
                        onClick={() => setActiveTab(platform.id)}
                      >
                        {platform.id}
                      </button>
                    ))}
                  </div>
                </div>
                
                <div className="p-6">
                  <div className="flex justify-between items-center mb-4">
                    <h2 className="text-xl font-bold">{activeTab} Listing</h2>
                    <div className="flex space-x-2">
                      {!editMode ? (
                        <button 
                          className="btn btn-outline py-1.5 flex items-center text-sm"
                          onClick={() => setEditMode(true)}
                        >
                          <Edit className="w-4 h-4 mr-1.5" />
                          Edit
                        </button>
                      ) : (
                        <button 
                          className="btn btn-primary py-1.5 flex items-center text-sm"
                          onClick={handleSaveEdits}
                        >
                          <Check className="w-4 h-4 mr-1.5" />
                          Save
                        </button>
                      )}
                      <button 
                        className="btn btn-outline py-1.5 flex items-center text-sm"
                        onClick={handleCopyListing}
                      >
                        {isCopied ? (
                          <>
                            <Check className="w-4 h-4 mr-1.5" />
                            Copied
                          </>
                        ) : (
                          <>
                            <Copy className="w-4 h-4 mr-1.5" />
                            Copy
                          </>
                        )}
                      </button>
                      <button 
                        className="btn btn-outline py-1.5 flex items-center text-sm"
                        onClick={handleDownload}
                      >
                        <Download className="w-4 h-4 mr-1.5" />
                        Download
                      </button>
                    </div>
                  </div>
                  
                  {/* Title */}
                  <div className="mb-6">
                    <label className="block text-sm font-medium text-gray-700 mb-1">Title</label>
                    {editMode ? (
                      <input
                        type="text"
                        name="title"
                        className="input"
                        value={listingData.title}
                        onChange={handleInputChange}
                      />
                    ) : (
                      <div className="p-3 bg-gray-50 rounded-md border border-gray-200">
                        <h3 className="font-semibold text-gray-900">{listingData.title}</h3>
                      </div>
                    )}
                  </div>
                  
                  {/* Description */}
                  <div className="mb-6">
                    <label className="block text-sm font-medium text-gray-700 mb-1">Description</label>
                    {editMode ? (
                      <textarea
                        name="description"
                        rows={10}
                        className="input"
                        value={listingData.description}
                        onChange={handleInputChange}
                      ></textarea>
                    ) : (
                      <div className="p-3 bg-gray-50 rounded-md border border-gray-200 whitespace-pre-line">
                        {listingData.description}
                      </div>
                    )}
                  </div>
                  
                  {/* Price */}
                  <div className="mb-6">
                    <label className="block text-sm font-medium text-gray-700 mb-1">Price</label>
                    {editMode ? (
                      <div className="relative">
                        <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                          <span className="text-gray-500">$</span>
                        </div>
                        <input
                          type="number"
                          name="price"
                          className="input pl-7"
                          value={listingData.price}
                          onChange={handleInputChange}
                          step="0.01"
                        />
                      </div>
                    ) : (
                      <div className="p-3 bg-gray-50 rounded-md border border-gray-200">
                        <span className="font-semibold text-gray-900">${listingData.price.toFixed(2)}</span>
                      </div>
                    )}
                  </div>
                  
                  {/* Platform-specific optimizations */}
                  <div className="bg-teal-50 border border-teal-100 rounded-md p-4 mb-6">
                    <h4 className="font-medium text-teal-800 mb-2 flex items-center">
                      <Sparkles className="w-4 h-4 mr-2" />
                      {activeTab} Optimizations
                    </h4>
                    <ul className="space-y-2 text-sm text-teal-700">
                      <li className="flex items-start">
                        <Check className="w-4 h-4 mr-2 mt-0.5 text-teal-600" />
                        Title optimized with high-performing keywords for {activeTab}
                      </li>
                      <li className="flex items-start">
                        <Check className="w-4 h-4 mr-2 mt-0.5 text-teal-600" />
                        Description formatted specifically for {activeTab}'s algorithm
                      </li>
                      <li className="flex items-start">
                        <Check className="w-4 h-4 mr-2 mt-0.5 text-teal-600" />
                        Competitive pricing based on similar items on {activeTab}
                      </li>
                      <li className="flex items-start">
                        <Check className="w-4 h-4 mr-2 mt-0.5 text-teal-600" />
                        Category and attributes set for maximum visibility
                      </li>
                    </ul>
                  </div>
                  
                  {/* Export Section */}
                  <div className="border-t border-gray-200 pt-6 mt-6">
                    <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between">
                      <div className="mb-4 sm:mb-0">
                        <h4 className="font-medium text-gray-900 mb-1">Ready to list on {activeTab}?</h4>
                        <p className="text-sm text-gray-500">Export this listing directly to your {activeTab} account</p>
                      </div>
                      <button className="btn btn-primary flex items-center justify-center">
                        <ExternalLink className="w-4 h-4 mr-2" />
                        Export to {activeTab}
                      </button>
                    </div>
                  </div>
                </div>
              </div>
              
              <div className="flex flex-col sm:flex-row gap-4">
                <Link 
                  to="/upload" 
                  className="btn btn-outline flex-1 flex items-center justify-center"
                >
                  <ArrowLeft className="w-4 h-4 mr-2" />
                  Create Another Listing
                </Link>
                <Link 
                  to="/dashboard" 
                  className="btn btn-primary flex-1 flex items-center justify-center"
                >
                  View All Listings
                  <ArrowRight className="w-4 h-4 ml-2" />
                </Link>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

interface PhotoThumbProps {
  url: string;
  isActive: boolean;
  onClick: () => void;
}

const PhotoThumb: React.FC<PhotoThumbProps> = ({ url, isActive, onClick }) => (
  <div 
    className={`aspect-square rounded-md overflow-hidden cursor-pointer ${
      isActive ? 'ring-2 ring-teal-500' : 'hover:opacity-80'
    }`}
    onClick={onClick}
  >
    <img 
      src={url} 
      alt="Product thumbnail" 
      className="w-full h-full object-cover"
    />
  </div>
);

interface DetailItemProps {
  label: string;
  value: string;
}

const DetailItem: React.FC<DetailItemProps> = ({ label, value }) => (
  <div className="flex justify-between">
    <span className="text-gray-500 text-sm">{label}:</span>
    <span className="text-gray-900 text-sm font-medium">{value}</span>
  </div>
);

export default ResultsPage;