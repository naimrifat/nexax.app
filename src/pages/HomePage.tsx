import React, { useState, useRef } from 'react';
import { Link } from 'react-router-dom';
import { ArrowRight, Upload, CheckCircle, ShoppingBag, Sparkles, Award, Smartphone, X, PlusCircle, Image, Edit, Copy, Download, ExternalLink, Tag, Camera, TrendingUp } from 'lucide-react';
import MarketplaceLogo from '../components/MarketplaceLogo';

const HomePage: React.FC = () => {
  const [photos, setPhotos] = useState<File[]>([]);
  const [photoPreviewUrls, setPhotoPreviewUrls] = useState<string[]>([]);
  const [isDragging, setIsDragging] = useState(false);
  const [isGenerating, setIsGenerating] = useState(false);
  const [showResults, setShowResults] = useState(false);
  const [activeTab, setActiveTab] = useState<string>('eBay');
  const [editMode, setEditMode] = useState<boolean>(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Generated listing data
  const [listingData, setListingData] = useState({
    title: 'Vintage 90s Tommy Hilfiger Denim Jacket Blue Red Logo Size L',
    description: 'Amazing vintage Tommy Hilfiger denim jacket from the 90s featuring the iconic flag logo. In excellent condition with minimal wear. This classic piece features button closure, front pockets, and adjustable button cuffs. Perfect addition to any vintage collection or everyday wardrobe.\n\nSize: Large (fits true to size)\nMaterial: 100% Cotton Denim\nCondition: Excellent vintage condition\nEra: 1990s\n\nMeasurements:\n- Chest: 22" (pit to pit)\n- Length: 26"\n- Sleeves: 24"',
    price: 89.99,
    condition: 'Pre-owned - Excellent',
    brand: 'Tommy Hilfiger',
    color: 'Blue',
    size: 'L',
    category: 'Men\'s Clothing > Jackets & Coats',
    tags: ['vintage', 'denim jacket', '90s', 'tommy hilfiger', 'streetwear']
  });

  const handlePhotoUpload = (files: FileList | null) => {
    if (!files) return;
    
    const newFiles: File[] = [];
    const newUrls: string[] = [];
    
    Array.from(files).forEach(file => {
      if (file.type.startsWith('image/') && photos.length + newFiles.length < 8) {
        newFiles.push(file);
        newUrls.push(URL.createObjectURL(file));
      }
    });

    setPhotos([...photos, ...newFiles]);
    setPhotoPreviewUrls([...photoPreviewUrls, ...newUrls]);
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(true);
  };

  const handleDragLeave = () => {
    setIsDragging(false);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    handlePhotoUpload(e.dataTransfer.files);
  };

  const handleFileInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    handlePhotoUpload(e.target.files);
  };

  const triggerFileInput = () => {
    if (fileInputRef.current) {
      fileInputRef.current.click();
    }
  };

  const removePhoto = (index: number) => {
    const newPhotos = [...photos];
    const newUrls = [...photoPreviewUrls];
    
    URL.revokeObjectURL(newUrls[index]);
    
    newPhotos.splice(index, 1);
    newUrls.splice(index, 1);
    
    setPhotos(newPhotos);
    setPhotoPreviewUrls(newUrls);
  };

  const handleGenerateListings = () => {
    if (photos.length === 0) {
      alert('Please upload at least one photo to continue.');
      return;
    }
    
    setIsGenerating(true);
    
    // Simulate AI processing
    setTimeout(() => {
      setIsGenerating(false);
      setShowResults(true);
    }, 3000);
  };

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) => {
    const { name, value } = e.target;
    setListingData({
      ...listingData,
      [name]: value
    });
  };

  const handleSaveEdits = () => {
    setEditMode(false);
  };

  const platformTemplates = [
    { id: 'eBay', color: 'bg-yellow-100', textColor: 'text-yellow-800' },
    { id: 'Poshmark', color: 'bg-red-100', textColor: 'text-red-800' },
    { id: 'Mercari', color: 'bg-blue-100', textColor: 'text-blue-800' }
  ];

  // Mock photo URLs
  const mockPhotoUrl = "https://images.pexels.com/photos/1598507/pexels-photo-1598507.jpeg?auto=compress&cs=tinysrgb&w=1260&h=750&dpr=2";

  return (
    <div className="flex flex-col">
      {/* Hero Section */}
      <section className="relative pt-16 pb-20 md:pt-24 md:pb-32 bg-gradient-to-br from-teal-50 to-purple-50 overflow-hidden">
        <div className="absolute inset-0 overflow-hidden">
          <div className="absolute left-1/2 top-0 transform -translate-x-1/2 w-[120%] h-[120%] bg-[radial-gradient(50%_50%_at_50%_50%,rgba(15,118,110,0.05)_0%,rgba(126,34,206,0.03)_50%,rgba(255,255,255,0)_100%)]"></div>
        </div>
        
        <div className="container mx-auto px-4 relative">
          <div className="max-w-4xl mx-auto text-center">
            <h1 className="text-4xl md:text-5xl lg:text-6xl font-bold text-gray-900 mb-6 leading-tight">
              Transform Product Photos into <span className="text-transparent bg-clip-text bg-gradient-to-r from-teal-600 to-purple-600">Perfect Listings</span>
            </h1>
            <p className="text-xl text-gray-700 mb-10 max-w-2xl mx-auto">
              Upload your product photos and let our AI create professional, optimized listings for eBay, Poshmark, Mercari, and more — in seconds.
            </p>
            
            {/* Marketplace Logos */}
            <div className="mb-12">
              <p className="text-sm text-gray-500 mb-6">Works with all major marketplaces</p>
              <div className="flex flex-wrap justify-center items-center gap-12 max-w-2xl mx-auto">
                <MarketplaceLogo name="eBay" className="h-8" />
                <MarketplaceLogo name="Poshmark" className="h-8" />
                <MarketplaceLogo name="Mercari" className="h-8" />
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Interactive Listing Creator */}
      <section className="py-16 md:py-24 bg-white">
        <div className="container mx-auto px-4">
          <div className="max-w-6xl mx-auto">
            <div className="text-center mb-12">
              <h2 className="text-3xl md:text-4xl font-bold text-gray-900 mb-4">Try It Now - Free Demo</h2>
              <p className="text-lg text-gray-600 max-w-2xl mx-auto">
                Upload up to 8 photos and see how our AI creates professional listings instantly
              </p>
            </div>

            {!showResults ? (
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
                {/* Photo Upload Section */}
                <div className="card p-6">
                  <h3 className="text-xl font-semibold mb-4 flex items-center">
                    <Image className="w-5 h-5 mr-2 text-teal-600" />
                    Upload Product Photos
                  </h3>
                  
                  {/* Drag & Drop Zone */}
                  <div 
                    className={`border-2 border-dashed rounded-lg p-6 text-center mb-4 transition-all ${
                      isDragging ? 'border-teal-500 bg-teal-50 upload-highlight' : 'border-gray-300 hover:border-teal-400'
                    }`}
                    onDragOver={handleDragOver}
                    onDragLeave={handleDragLeave}
                    onDrop={handleDrop}
                    onClick={triggerFileInput}
                  >
                    <input 
                      type="file" 
                      ref={fileInputRef}
                      className="hidden" 
                      accept="image/*" 
                      multiple 
                      onChange={handleFileInputChange}
                    />
                    <Upload className="w-12 h-12 mx-auto text-gray-400 mb-3" />
                    <p className="text-gray-700 font-medium">Drag and drop your photos here</p>
                    <p className="text-gray-500 text-sm mb-3">or click to browse</p>
                    <p className="text-xs text-gray-400">Up to 8 photos • JPEG, PNG, WebP (max 10MB each)</p>
                  </div>
                  
                  {/* Photo Preview Grid */}
                  {photoPreviewUrls.length > 0 && (
                    <div className="grid grid-cols-4 gap-3 mb-4">
                      {photoPreviewUrls.map((url, index) => (
                        <div key={index} className="relative group">
                          <div className="aspect-square rounded-lg overflow-hidden bg-gray-100">
                            <img 
                              src={url} 
                              alt={`Product ${index + 1}`} 
                              className="w-full h-full object-cover"
                            />
                          </div>
                          <button 
                            className="absolute top-1 right-1 bg-red-500 text-white rounded-full p-0.5 shadow-sm opacity-0 group-hover:opacity-100 transition-opacity"
                            onClick={(e) => {
                              e.stopPropagation();
                              removePhoto(index);
                            }}
                          >
                            <X className="w-3 h-3" />
                          </button>
                          {index === 0 && (
                            <span className="absolute bottom-1 left-1 bg-teal-500 text-white text-xs px-1.5 py-0.5 rounded">
                              Main
                            </span>
                          )}
                        </div>
                      ))}
                      
                      {/* Add More Button */}
                      {photos.length < 8 && (
                        <div 
                          className="aspect-square rounded-lg border-2 border-dashed border-gray-300 flex items-center justify-center cursor-pointer hover:border-teal-400 transition-colors"
                          onClick={triggerFileInput}
                        >
                          <div className="text-center">
                            <PlusCircle className="w-6 h-6 mx-auto text-gray-400 mb-1" />
                            <span className="text-xs text-gray-500">Add More</span>
                          </div>
                        </div>
                      )}
                    </div>
                  )}

                  <p className="text-sm text-gray-500 text-center">
                    {photos.length}/8 photos uploaded
                  </p>
                </div>

                {/* Generation Panel */}
                <div className="card p-6 bg-gradient-to-br from-teal-500 to-teal-600 text-white">
                  <h3 className="text-xl font-semibold mb-4 flex items-center">
                    <Sparkles className="w-5 h-5 mr-2" />
                    AI-Powered Generation
                  </h3>
                  
                  <div className="space-y-4 mb-6">
                    <div className="flex items-center">
                      <CheckCircle className="w-5 h-5 mr-3 text-teal-200" />
                      <span className="text-sm">Smart title optimization</span>
                    </div>
                    <div className="flex items-center">
                      <CheckCircle className="w-5 h-5 mr-3 text-teal-200" />
                      <span className="text-sm">SEO-optimized descriptions</span>
                    </div>
                    <div className="flex items-center">
                      <CheckCircle className="w-5 h-5 mr-3 text-teal-200" />
                      <span className="text-sm">Auto-categorization</span>
                    </div>
                    <div className="flex items-center">
                      <CheckCircle className="w-5 h-5 mr-3 text-teal-200" />
                      <span className="text-sm">Competitive pricing suggestions</span>
                    </div>
                    <div className="flex items-center">
                      <CheckCircle className="w-5 h-5 mr-3 text-teal-200" />
                      <span className="text-sm">Platform-specific formatting</span>
                    </div>
                  </div>

                  {isGenerating ? (
                    <div className="text-center">
                      <Sparkles className="w-8 h-8 mx-auto mb-3 animate-pulse" />
                      <p className="font-medium mb-2">Analyzing your photos...</p>
                      <div className="w-full bg-teal-400 rounded-full h-2 mb-4">
                        <div className="bg-white h-2 rounded-full animate-pulse" style={{ width: '75%' }}></div>
                      </div>
                      <p className="text-sm text-teal-100">This usually takes 10-15 seconds</p>
                    </div>
                  ) : (
                    <>
                      <button
                        className="btn bg-white text-teal-700 hover:bg-teal-50 w-full py-3 flex items-center justify-center mb-4"
                        onClick={handleGenerateListings}
                        disabled={photos.length === 0}
                      >
                        <Sparkles className="w-5 h-5 mr-2" />
                        Generate Listings
                      </button>
                      
                      <p className="text-sm text-teal-100 text-center">
                        {photos.length === 0 ? 'Upload photos to continue' : `${photos.length} photos ready for processing`}
                      </p>
                    </>
                  )}
                </div>
              </div>
            ) : (
              /* Results Section */
              <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
                {/* Photo Preview */}
                <div className="lg:col-span-1">
                  <div className="card overflow-hidden mb-6">
                    <div className="aspect-square bg-gray-100">
                      <img 
                        src={mockPhotoUrl} 
                        alt="Product" 
                        className="w-full h-full object-cover"
                      />
                    </div>
                    <div className="p-4">
                      <h4 className="font-semibold mb-2">Detected Details</h4>
                      <div className="space-y-1 text-sm">
                        <div className="flex justify-between">
                          <span className="text-gray-500">Brand:</span>
                          <span className="font-medium">{listingData.brand}</span>
                        </div>
                        <div className="flex justify-between">
                          <span className="text-gray-500">Size:</span>
                          <span className="font-medium">{listingData.size}</span>
                        </div>
                        <div className="flex justify-between">
                          <span className="text-gray-500">Color:</span>
                          <span className="font-medium">{listingData.color}</span>
                        </div>
                        <div className="flex justify-between">
                          <span className="text-gray-500">Condition:</span>
                          <span className="font-medium">{listingData.condition}</span>
                        </div>
                      </div>
                    </div>
                  </div>

                  <div className="card p-4">
                    <h4 className="font-semibold mb-3">Generated Tags</h4>
                    <div className="flex flex-wrap gap-2">
                      {listingData.tags.map((tag, index) => (
                        <span key={index} className="badge badge-primary flex items-center text-xs">
                          <Tag className="w-3 h-3 mr-1" />
                          {tag}
                        </span>
                      ))}
                    </div>
                  </div>
                </div>
                
                {/* Listing Preview */}
                <div className="lg:col-span-2">
                  <div className="card mb-6">
                    <div className="border-b border-gray-200">
                      <div className="flex overflow-x-auto">
                        {platformTemplates.map((platform) => (
                          <button
                            key={platform.id}
                            className={`px-6 py-4 font-medium text-sm whitespace-nowrap transition-colors flex items-center space-x-2 ${
                              activeTab === platform.id
                                ? `border-b-2 border-teal-500 text-teal-700`
                                : 'text-gray-500 hover:text-gray-700'
                            }`}
                            onClick={() => setActiveTab(platform.id)}
                          >
                            <MarketplaceLogo name={platform.id} className="h-4" />
                            <span>{platform.id}</span>
                          </button>
                        ))}
                      </div>
                    </div>
                    
                    <div className="p-6">
                      <div className="flex justify-between items-center mb-4">
                        <h3 className="text-xl font-bold flex items-center space-x-2">
                          <MarketplaceLogo name={activeTab} className="h-5" />
                          <span>Listing Preview</span>
                        </h3>
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
                              <CheckCircle className="w-4 h-4 mr-1.5" />
                              Save
                            </button>
                          )}
                        </div>
                      </div>
                      
                      {/* Title */}
                      <div className="mb-4">
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
                          <div className="p-3 bg-gray-50 rounded-md border">
                            <p className="font-semibold text-gray-900">{listingData.title}</p>
                          </div>
                        )}
                      </div>
                      
                      {/* Price */}
                      <div className="mb-4">
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
                          <div className="p-3 bg-gray-50 rounded-md border">
                            <span className="font-semibold text-gray-900">${listingData.price.toFixed(2)}</span>
                          </div>
                        )}
                      </div>
                      
                      {/* Description */}
                      <div className="mb-6">
                        <label className="block text-sm font-medium text-gray-700 mb-1">Description</label>
                        {editMode ? (
                          <textarea
                            name="description"
                            rows={6}
                            className="input"
                            value={listingData.description}
                            onChange={handleInputChange}
                          ></textarea>
                        ) : (
                          <div className="p-3 bg-gray-50 rounded-md border max-h-32 overflow-y-auto">
                            <p className="text-gray-900 whitespace-pre-line text-sm">{listingData.description}</p>
                          </div>
                        )}
                      </div>

                      {/* Sign Up CTA */}
                      <div className="bg-gradient-to-r from-teal-500 to-purple-600 rounded-lg p-6 text-white text-center">
                        <div className="flex items-center justify-center space-x-2 mb-2">
                          <h4 className="text-lg font-semibold">Ready to List on</h4>
                          <MarketplaceLogo name={activeTab} className="h-5" />
                          <span className="text-lg font-semibold">?</span>
                        </div>
                        <p className="text-teal-50 mb-4 text-sm">
                          Sign up now to publish this listing directly to {activeTab} and start selling!
                        </p>
                        <button className="btn bg-white text-teal-700 hover:bg-teal-50 px-6 py-2 font-medium">
                          Sign Up & Publish Listing
                        </button>
                        <p className="text-xs text-teal-100 mt-2">Free 14-day trial • No credit card required</p>
                      </div>
                    </div>
                  </div>

                  <div className="flex gap-4">
                    <button 
                      className="btn btn-outline flex-1"
                      onClick={() => {
                        setShowResults(false);
                        setPhotos([]);
                        setPhotoPreviewUrls([]);
                        setEditMode(false);
                      }}
                    >
                      Try Another Product
                    </button>
                    <Link to="/pricing" className="btn btn-primary flex-1">
                      View Pricing Plans
                    </Link>
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
      </section>

      {/* How It Works */}
      <section className="py-16 md:py-24 bg-gray-50">
        <div className="container mx-auto px-4">
          <div className="text-center mb-16">
            <h2 className="text-3xl md:text-4xl font-bold text-gray-900 mb-4">How SnapLine Works</h2>
            <p className="text-lg text-gray-600 max-w-2xl mx-auto">
              Create professional marketplace listings in just three simple steps
            </p>
          </div>
          
          <div className="grid grid-cols-1 md:grid-cols-3 gap-8 max-w-5xl mx-auto">
            <StepCard 
              number={1} 
              title="Upload Photos"
              description="Drag and drop your product photos. We recommend 3-5 images from different angles."
              icon={<Upload className="w-8 h-8" />}
            />
            <StepCard 
              number={2} 
              title="AI Works Magic"
              description="Our AI analyzes your photos to identify the product, category, condition, and key selling points."
              icon={<Sparkles className="w-8 h-8" />}
            />
            <StepCard 
              number={3} 
              title="Get Your Listings"
              description="Review, edit if needed, and export to your preferred marketplace in the correct format."
              icon={<ShoppingBag className="w-8 h-8" />}
            />
          </div>
        </div>
      </section>

      {/* Features */}
      <section className="py-16 md:py-24 bg-white">
        <div className="container mx-auto px-4">
          <div className="text-center mb-16">
            <h2 className="text-3xl md:text-4xl font-bold text-gray-900 mb-4">Powerful Features</h2>
            <p className="text-lg text-gray-600 max-w-2xl mx-auto">
              Everything you need to create and manage professional listings across all marketplaces
            </p>
          </div>
          
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-8">
            <FeatureCard 
              title="AI-Powered Descriptions"
              description="Generate compelling, SEO-optimized product descriptions automatically from your photos."
              icon={<Sparkles className="w-6 h-6 text-purple-600" />}
            />
            <FeatureCard 
              title="Multi-Platform Templates"
              description="Automatically format listings to meet the requirements of each marketplace."
              icon={<ShoppingBag className="w-6 h-6 text-teal-600" />}
            />
            <FeatureCard 
              title="Image Enhancement"
              description="Automatically remove backgrounds, adjust lighting, and optimize product images."
              icon={<Upload className="w-6 h-6 text-blue-600" />}
            />
            <FeatureCard 
              title="One-Click Export"
              description="Export listings directly to your connected marketplace accounts with a single click."
              icon={<ArrowRight className="w-6 h-6 text-green-600" />}
            />
            <FeatureCard 
              title="Mobile Friendly"
              description="Create listings on the go from your phone or tablet with our responsive design."
              icon={<Smartphone className="w-6 h-6 text-orange-600" />}
            />
            <FeatureCard 
              title="Bulk Processing"
              description="Upload multiple products at once and create listings in batch for maximum efficiency."
              icon={<CheckCircle className="w-6 h-6 text-red-600" />}
            />
          </div>
        </div>
      </section>

      {/* Testimonials */}
      <section className="py-16 md:py-24 bg-gray-50">
        <div className="container mx-auto px-4">
          <div className="text-center mb-16">
            <h2 className="text-3xl md:text-4xl font-bold text-gray-900 mb-4">Loved by Sellers</h2>
            <p className="text-lg text-gray-600 max-w-2xl mx-auto">
              See what sellers are saying about how SnapLine has transformed their business
            </p>
          </div>
          
          <div className="grid grid-cols-1 md:grid-cols-3 gap-8 max-w-5xl mx-auto">
            <TestimonialCard 
              quote="I used to spend hours creating listings. Now I just upload photos and get professional listings in minutes."
              author="Sarah K."
              role="Vintage Clothing Seller"
              platform="eBay & Poshmark"
            />
            <TestimonialCard 
              quote="The AI descriptions are incredible. They highlight features I wouldn't have thought to mention and really help my items sell faster."
              author="Marcus T."
              role="Sneaker Reseller"
              platform="eBay & Mercari"
            />
            <TestimonialCard 
              quote="As someone who sells on multiple platforms, the platform-specific formatting saves me so much time and frustration."
              author="Jessica M."
              role="Small Business Owner"
              platform="Poshmark & Mercari"
            />
          </div>
        </div>
      </section>

      {/* CTA Section */}
      <section className="py-16 bg-gradient-to-br from-teal-600 to-purple-700 text-white">
        <div className="container mx-auto px-4 text-center">
          <h2 className="text-3xl md:text-4xl font-bold mb-6">Ready to Transform Your Listings?</h2>
          <p className="text-xl mb-8 max-w-2xl mx-auto text-teal-50">
            Join thousands of sellers who are saving time and increasing sales with SnapLine.
          </p>
          <Link to="/pricing" className="btn bg-white text-teal-700 hover:bg-teal-50 px-8 py-3 text-lg font-medium">
            Get Started Free
          </Link>
          <p className="mt-4 text-sm text-teal-100">No credit card required. Try it free today.</p>
        </div>
      </section>
    </div>
  );
};

interface StepCardProps {
  number: number;
  title: string;
  description: string;
  icon: React.ReactNode;
}

const StepCard: React.FC<StepCardProps> = ({ number, title, description, icon }) => (
  <div className="card hover:shadow-md px-6 py-8 flex flex-col items-center text-center animate-slide-up">
    <div className="w-16 h-16 bg-teal-50 rounded-full flex items-center justify-center mb-5">
      {icon}
    </div>
    <div className="w-8 h-8 bg-teal-600 rounded-full flex items-center justify-center text-white font-bold mb-3">
      {number}
    </div>
    <h3 className="text-xl font-semibold text-gray-900 mb-2">{title}</h3>
    <p className="text-gray-600">{description}</p>
  </div>
);

interface FeatureCardProps {
  title: string;
  description: string;
  icon: React.ReactNode;
}

const FeatureCard: React.FC<FeatureCardProps> = ({ title, description, icon }) => (
  <div className="card hover:shadow-md p-6 animate-slide-up">
    <div className="mb-4">
      {icon}
    </div>
    <h3 className="text-lg font-semibold text-gray-900 mb-2">{title}</h3>
    <p className="text-gray-600 text-sm">{description}</p>
  </div>
);

interface TestimonialCardProps {
  quote: string;
  author: string;
  role: string;
  platform: string;
}

const TestimonialCard: React.FC<TestimonialCardProps> = ({ quote, author, role, platform }) => (
  <div className="card hover:shadow-md p-6 animate-slide-up">
    <div className="mb-4 text-yellow-500 flex">
      <Award className="w-5 h-5" />
      <Award className="w-5 h-5" />
      <Award className="w-5 h-5" />
      <Award className="w-5 h-5" />
      <Award className="w-5 h-5" />
    </div>
    <p className="text-gray-700 mb-4 italic">"{quote}"</p>
    <div>
      <p className="font-semibold text-gray-900">{author}</p>
      <p className="text-sm text-gray-500">{role}</p>
      <p className="text-xs text-teal-600 mt-1">{platform}</p>
    </div>
  </div>
);

export default HomePage;