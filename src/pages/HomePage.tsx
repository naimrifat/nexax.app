import React, { useState, useRef } from 'react';
import { Link } from 'react-router-dom';
import { Upload, X, PlusCircle, Image, Sparkles, CheckCircle, ArrowRight, Camera, AlertCircle, ShoppingBag, Award, Smartphone, Edit, Tag } from 'lucide-react';
import MarketplaceLogo from '../components/MarketplaceLogo';
import imageCompression from 'browser-image-compression';
import CategorySelector from '../components/CategorySelector';

// Helper components that might be in your project
const StepCard: React.FC<any> = ({ number, title, description, icon }) => (<div></div>);
const FeatureCard: React.FC<any> = ({ title, description, icon }) => (<div></div>);
const TestimonialCard: React.FC<any> = ({ quote, author, role, platform }) => (<div></div>);

export default function HomePage() {
    const [photos, setPhotos] = useState<File[]>([]);
    const [photoPreviewUrls, setPhotoPreviewUrls] = useState<string[]>([]);
    const [isDragging, setIsDragging] = useState(false);
    const [status, setStatus] = useState('');
    const [results, setResults] = useState<any>(null); // Original AI result (raw)
    const [listingData, setListingData] = useState<any>(null); // Editable, normalized data for the form
    const [isLoading, setIsLoading] = useState(false);
    const [activeTab, setActiveTab] = useState<string>('eBay');
    const fileInputRef = useRef<HTMLInputElement>(null);
    const [showCategorySelector, setShowCategorySelector] = useState(false);
    const [ebaySpecifics, setEbaySpecifics] = useState<any[]>([]);
    const [loadingSpecifics, setLoadingSpecifics] = useState(false);

    // --- Helpers ---
    // Normalize AI response so category preselect works and item specifics are consistent
    const normalizeAiToListing = (raw: any) => {
        const categoryId = raw?.category?.id || raw?.category_id || raw?.ebay_category_id || '';
        const categoryPath = raw?.category?.path || raw?.category_path || raw?.categoryName || '';

        const specifics = Array.isArray(raw?.item_specifics)
            ? raw.item_specifics
            : (raw?.itemSpecifics || []);

        const normalizedSpecifics = specifics.map((s: any) => ({
            name: s?.name || s?.Name || '',
            value: s?.value || s?.Value || '',
            options: s?.options || s?.Values || [],
        }));

        return {
            title: raw?.title || '',
            description: raw?.description || '',
            category: { id: categoryId, path: categoryPath },
            item_specifics: normalizedSpecifics,
            keywords: raw?.keywords || [],
        };
    };

    const fetchEbaySpecifics = async (categoryId: string) => {
        setLoadingSpecifics(true);
        try {
            const response = await fetch('/api/ebay-categories', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    action: 'getCategorySpecifics',
                    categoryId: categoryId
                })
            });

            if (response.ok) {
                const data = await response.json();
                const mergedSpecifics = (data.aspects || []).map((aspect: any) => {
                    const existing = (listingData?.item_specifics || []).find((s: any) => (s.name || s.Name) === aspect.name);
                    return {
                        name: aspect.name,
                        value: existing?.value || existing?.Value || '',
                        required: aspect.required,
                        options: aspect.values || []
                    };
                });
                setEbaySpecifics(mergedSpecifics);
                // reflect options into the editable listing data so UI renders dropdowns
                setListingData((prev: any) => ({
                    ...(prev || {}),
                    item_specifics: mergedSpecifics
                }));
            }
        } catch (error) {
            console.error('Failed to fetch eBay specifics:', error);
        } finally {
            setLoadingSpecifics(false);
        }
    };

    // --- Form Handling Functions ---

    const handleCategoryChange = (newCategory: { path: string; id: string }) => {
        setListingData((prevData: any) => ({
            ...prevData,
            category: {
                path: newCategory.path,
                id: newCategory.id,
            },
        }));
        setShowCategorySelector(false); // Close the selector after selection
        if (newCategory.id) {
            fetchEbaySpecifics(newCategory.id);
        }
    };

    const handleInputChange = (field: string, value: any) => {
        setListingData((prevData: any) => ({
            ...prevData,
            [field]: value,
        }));
    };
    
    const handleItemSpecificsChange = (index: number, value: string) => {
        const newSpecifics = [...(listingData?.item_specifics || [])];
        newSpecifics[index].value = value;
        setListingData((prevData: any) => ({
            ...prevData,
            item_specifics: newSpecifics
        }));
    };


    // --- Photo Handling Functions ---
    const handlePhotoUpload = (files: FileList | null) => {
        if (!files) return;
        const newFiles = Array.from(files).filter(file => file.type.startsWith('image/'));
        if (photos.length + newFiles.length > 12) {
            alert("You can upload a maximum of 12 photos.");
            return;
        }
        const newUrls = newFiles.map(file => URL.createObjectURL(file));
        setPhotos(prev => [...prev, ...newFiles]);
        setPhotoPreviewUrls(prev => [...prev, ...newUrls]);
    };
    
    const handleFileInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        handlePhotoUpload(e.target.files);
    };

    const removePhoto = (indexToRemove: number) => {
        URL.revokeObjectURL(photoPreviewUrls[indexToRemove]);
        setPhotos(prev => prev.filter((_, index) => index !== indexToRemove));
        setPhotoPreviewUrls(prev => prev.filter((_, index) => index !== indexToRemove));
    };

    const triggerFileInput = () => fileInputRef.current?.click();
    const handleDragOver = (e: React.DragEvent) => { e.preventDefault(); setIsDragging(true); };
    const handleDragLeave = () => setIsDragging(false);
    const handleDrop = (e: React.DragEvent) => {
        e.preventDefault();
        setIsDragging(false);
        handlePhotoUpload(e.dataTransfer.files);
    };
    
    // --- Submission & API Logic ---
    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        if (photos.length === 0) {
            setStatus('Please upload at least one image.');
            return;
        }
        setIsLoading(true);
        setResults(null);
        setListingData(null);
        setStatus('Uploading images to Cloudinary...');

        try {
            const uploadedUrls = await Promise.all(photos.map(async (file) => {
                const formData = new FormData();
                formData.append('file', file);
                formData.append('upload_preset', 'ebay_listings');
                
                const res = await fetch('https://api.cloudinary.com/v1_1/dvhiftzlp/image/upload', {
                    method: 'POST',
                    body: formData,
                });
                
                const data = await res.json();
                if (!res.ok) throw new Error(data.error?.message || 'Image upload failed');
                return data.secure_url;
            }));

            setStatus('Images uploaded! Analyzing with AI...');
            
            const analysisResponse = await fetch('/api/analyze-listing', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    session_id: Date.now().toString(),
                    images: uploadedUrls
                })
            });

            if (!analysisResponse.ok) {
                const errorData = await analysisResponse.json();
                throw new Error(errorData.error || 'Failed to analyze images');
            }

            const analysisResult = await analysisResponse.json();
            const aiData = analysisResult.data;
            const normalized = normalizeAiToListing(aiData);

            setStatus('Listing generated successfully!');
            setResults(aiData); // keep original
            setListingData(normalized); // use normalized for UI
            if (normalized?.category?.id) {
                fetchEbaySpecifics(normalized.category.id);
            }

        } catch (error: any) {
            console.error('Error:', error);
            setStatus(`Error: ${error.message}`);
        } finally {
            setIsLoading(false);
        }
    };

    // --- Publish to eBay Logic ---
    const handlePublishToEbay = async () => {
        setStatus('Publishing to eBay...');
        try {
            const response = await fetch('/api/publish-listing', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ // Send the final, EDITED data
                    listing_data: listingData,
                    images: photoPreviewUrls 
                })
            });
            
            if (!response.ok) {
                throw new Error('Failed to start the publishing process.');
            }

            setStatus('Listing sent to eBay for publishing!');
            alert('Your listing has been sent to eBay! It may take a minute to appear.');

        } catch (error: any) {
            console.error('Error publishing listing:', error);
            setStatus(`Error: ${error.message}`);
            alert(`An error occurred: ${error.message}`);
        }
    };
    
    // --- JSX to Render the Page ---
    return (
        <div className="flex flex-col">
            {/* ... Other page sections ... */}
            <section className="py-16 md:py-24 bg-white">
                <div className="container mx-auto px-4">
                    <div className="max-w-6xl mx-auto">
                        <div className="text-center mb-12">
                            <h2 className="text-3xl md:text-4xl font-bold text-gray-900 mb-4">Try It Now - Free Demo</h2>
                            <p className="text-lg text-gray-600 max-w-2xl mx-auto">Upload up to 12 photos and see how our AI creates professional listings instantly</p>
                        </div>

                        {!listingData ? ( // Changed from !results to !listingData
                            <form onSubmit={handleSubmit} className="grid grid-cols-1 lg:grid-cols-2 gap-8">
                                {/* ... Upload form JSX is unchanged ... */}
                                <div className="card p-6">
                                <h3 className="text-xl font-semibold mb-4 flex items-center"><Image className="w-5 h-5 mr-2 text-teal-600" /> Upload Product Photos</h3>
                                <div
                                    className={`border-2 border-dashed rounded-lg p-6 text-center mb-4 transition-all cursor-pointer ${isDragging ? 'border-teal-500 bg-teal-50' : 'border-gray-300 hover:border-teal-400'}`}
                                    onDragOver={handleDragOver} onDragLeave={handleDragLeave} onDrop={handleDrop} onClick={triggerFileInput}
                                >
                                    <input type="file" ref={fileInputRef} className="hidden" accept="image/*" multiple onChange={handleFileInputChange} />
                                    <Upload className="w-12 h-12 mx-auto text-gray-400 mb-3" />
                                    <p className="text-gray-700 font-medium">Drag and drop your photos here</p>
                                    <p className="text-gray-500 text-sm">or click to browse</p>
                                </div>
                                {photoPreviewUrls.length > 0 && (
                                    <div className="grid grid-cols-4 gap-3 mb-4">
                                        {photoPreviewUrls.map((url, index) => (
                                            <div key={index} className="relative group aspect-square">
                                                <img src={url} alt={`Product ${index + 1}`} className="w-full h-full object-cover rounded-lg" />
                                                <button type="button" onClick={(e) => { e.stopPropagation(); removePhoto(index); }} className="absolute top-1 right-1 bg-red-500 text-white rounded-full p-0.5 opacity-0 group-hover:opacity-100">
                                                    <X className="w-3 h-3" />
                                                </button>
                                                {index === 0 && <span className="absolute bottom-1 left-1 bg-teal-500 text-white text-xs px-1.5 py-0.5 rounded">Main</span>}
                                            </div>
                                        ))}
                                    </div>
                                )}
                                <p className="text-sm text-gray-500 text-center">{photos.length}/12 photos uploaded</p>
                            </div>
                            <div className="card p-6 bg-gradient-to-br from-teal-500 to-teal-600 text-white">
                                <h3 className="text-xl font-semibold mb-4 flex items-center"><Sparkles className="w-5 h-5 mr-2" /> AI-Powered Generation</h3>
                                <div className="space-y-4 mb-6">
                                    <div className="flex items-center"><CheckCircle className="w-5 h-5 mr-3 text-teal-200" /><span className="text-sm">Smart title optimization</span></div>
                                    <div className="flex items-center"><CheckCircle className="w-5 h-5 mr-3 text-teal-200" /><span className="text-sm">SEO-optimized descriptions</span></div>
                                    <div className="flex items-center"><CheckCircle className="w-5 h-5 mr-3 text-teal-200" /><span className="text-sm">Auto-categorization</span></div>
                                    <div className="flex items-center"><CheckCircle className="w-5 h-5 mr-3 text-teal-200" /><span className="text-sm">Analyzes up to 12 photos</span></div>
                                </div>
                                <button type="submit" disabled={isLoading || photos.length === 0} className="btn bg-white text-teal-700 hover:bg-teal-50 w-full py-3 flex items-center justify-center">
                                    <Sparkles className="w-5 h-5 mr-2" />
                                    {isLoading ? 'Generating...' : 'Generate Listings'}
                                </button>
                                {status && <p className={`mt-4 text-center font-medium ${status.includes('Error') ? 'text-yellow-300' : 'text-teal-100'}`}>{status}</p>}
                            </div>
                            </form>
                        ) : (
                            <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
                                <div className="lg:col-span-1">
                                    <div className="card overflow-hidden">
                                        <img src={photoPreviewUrls[0]} alt="Main product" className="w-full h-auto object-cover"/>
                                    </div>
                                </div>
                                <div className="lg:col-span-2 space-y-6">
                                    <div className="flex items-center justify-between">
                                        <h2 className="text-2xl font-bold text-gray-900">Your Generated Listing</h2>
                                        <div className="flex items-center gap-3">
                                            <button
                                              onClick={handlePublishToEbay}
                                              disabled={!listingData?.category?.id || loadingSpecifics}
                                              className={`btn ${(!listingData?.category?.id || loadingSpecifics) ? 'opacity-50 cursor-not-allowed' : 'bg-teal-600 text-white hover:bg-teal-700'}`}
                                            >
                                              Publish to eBay
                                            </button>
                                            <button onClick={() => { setResults(null); setListingData(null); setPhotos([]); setPhotoPreviewUrls([]); setStatus(''); }} className="btn btn-outline">Create Another</button>
                                        </div>
                                    </div>
                                    
                                    {/* Editable form */}
                                    <div className="bg-white rounded-lg shadow p-6 space-y-4">
                                        <div>
                                            <label className="block text-sm font-semibold text-gray-600 mb-1">Title</label>
                                            <input 
                                                type="text" 
                                                className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-teal-500"
                                                value={listingData.title || ''}
                                                onChange={(e) => handleInputChange('title', e.target.value)}
                                                maxLength={80}
                                            />
                                            <p className="text-xs text-gray-500 mt-1">{listingData.title?.length || 0}/80 characters</p>
                                        </div>
                                        
                                        {/* Category (click to open selector) */}
                                        <div>
                                            <label className="block text-sm font-semibold text-gray-600 mb-1">Category</label>
                                            <div
                                                onClick={() => setShowCategorySelector(true)}
                                                className="mt-1 flex cursor-pointer items-center justify-between rounded-md border border-gray-300 bg-white px-3 py-2 text-left shadow-sm hover:bg-gray-50"
                                            >
                                                <span>
                                                    {listingData.category?.path || 'Click to select a category...'}
                                                </span>
                                                <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-gray-400"><path d="m9 18 6-6-6-6"/></svg>
                                            </div>
                                        </div>
                                        
                                        <div>
                                            <label className="block text-sm font-semibold text-gray-600 mb-1">Description</label>
                                            <textarea 
                                                className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-teal-500"
                                                rows={5}
                                                value={listingData.description || ''}
                                                onChange={(e) => handleInputChange('description', e.target.value)}
                                            />
                                        </div>
                                        
                                        {listingData.item_specifics && (
                                            <div>
                                                <label className="block text-sm font-semibold text-gray-600 mb-2">Item Specifics</label>
        {listingData.item_specifics.map((spec: any, index: number) => (
            <div key={index} className="grid grid-cols-2 gap-2 mb-2">
                <input 
                    type="text" 
                    className="px-3 py-2 border border-gray-300 rounded-md bg-gray-50"
                    value={spec.name}
                    readOnly
                />
                {spec.options && spec.options.length > 0 ? (
                    <select
                        className="px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-teal-500"
                        value={spec.value}
                        onChange={(e) => handleItemSpecificsChange(index, e.target.value)}
                    >
                        <option value="">Select...</option>
                        {spec.options.map((option: any) => (
                            <option key={option.value || option} value={option.value || option}>
                                {option.value || option}
                            </option>
                        ))}
                    </select>
                ) : (
                    <input 
                        type="text" 
                        className="px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-teal-500"
                        value={spec.value}
                        onChange={(e) => handleItemSpecificsChange(index, e.target.value)}
                    />
                )}
            </div>
        ))}
    </div>
)}
                                        
                                        {/* ... Keywords display (can remain as is) ... */}

                                    </div>

                                    {/* Category Selector Modal */}
                                    {showCategorySelector && (
                                        <CategorySelector
                                            initialCategoryPath={listingData?.category?.path || ''}
                                            initialCategoryId={listingData?.category?.id || ''}
                                            onCategorySelect={handleCategoryChange}
                                            onClose={() => setShowCategorySelector(false)}
                                        />
                                    )}
                                </div>
                            </div>
                        )}
                    </div>
                </div>
            </section>
        </div>
    );
};
import React, { useState, useRef } from 'react';
import { Link } from 'react-router-dom';
import { Upload, X, PlusCircle, Image, Sparkles, CheckCircle, ArrowRight, Camera, AlertCircle, ShoppingBag, Award, Smartphone, Edit, Tag } from 'lucide-react';
import MarketplaceLogo from '../components/MarketplaceLogo';
import imageCompression from 'browser-image-compression';
import CategorySelector from '../components/CategorySelector';

// Helper components that might be in your project
const StepCard: React.FC<any> = ({ number, title, description, icon }) => (<div></div>);
const FeatureCard: React.FC<any> = ({ title, description, icon }) => (<div></div>);
const TestimonialCard: React.FC<any> = ({ quote, author, role, platform }) => (<div></div>);

export default function HomePage() {
    const [photos, setPhotos] = useState<File[]>([]);
    const [photoPreviewUrls, setPhotoPreviewUrls] = useState<string[]>([]);
    const [isDragging, setIsDragging] = useState(false);
    const [status, setStatus] = useState('');
    const [results, setResults] = useState<any>(null); // Original AI result (raw)
    const [listingData, setListingData] = useState<any>(null); // Editable, normalized data for the form
    const [isLoading, setIsLoading] = useState(false);
    const [activeTab, setActiveTab] = useState<string>('eBay');
    const fileInputRef = useRef<HTMLInputElement>(null);
    const [showCategorySelector, setShowCategorySelector] = useState(false);
    const [ebaySpecifics, setEbaySpecifics] = useState<any[]>([]);
    const [loadingSpecifics, setLoadingSpecifics] = useState(false);

    // --- Helpers ---
    // Normalize AI response so category preselect works and item specifics are consistent
    const normalizeAiToListing = (raw: any) => {
        const categoryId = raw?.category?.id || raw?.category_id || raw?.ebay_category_id || '';
        const categoryPath = raw?.category?.path || raw?.category_path || raw?.categoryName || '';

        const specifics = Array.isArray(raw?.item_specifics)
            ? raw.item_specifics
            : (raw?.itemSpecifics || []);

        const normalizedSpecifics = specifics.map((s: any) => ({
            name: s?.name || s?.Name || '',
            value: s?.value || s?.Value || '',
            options: s?.options || s?.Values || [],
        }));

        return {
            title: raw?.title || '',
            description: raw?.description || '',
            category: { id: categoryId, path: categoryPath },
            item_specifics: normalizedSpecifics,
            keywords: raw?.keywords || [],
        };
    };

    const fetchEbaySpecifics = async (categoryId: string) => {
        setLoadingSpecifics(true);
        try {
            const response = await fetch('/api/ebay-categories', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    action: 'getCategorySpecifics',
                    categoryId: categoryId
                })
            });

            if (response.ok) {
                const data = await response.json();
                const mergedSpecifics = (data.aspects || []).map((aspect: any) => {
                    const existing = (listingData?.item_specifics || []).find((s: any) => (s.name || s.Name) === aspect.name);
                    return {
                        name: aspect.name,
                        value: existing?.value || existing?.Value || '',
                        required: aspect.required,
                        options: aspect.values || []
                    };
                });
                setEbaySpecifics(mergedSpecifics);
                // reflect options into the editable listing data so UI renders dropdowns
                setListingData((prev: any) => ({
                    ...(prev || {}),
                    item_specifics: mergedSpecifics
                }));
            }
        } catch (error) {
            console.error('Failed to fetch eBay specifics:', error);
        } finally {
            setLoadingSpecifics(false);
        }
    };

    // --- Form Handling Functions ---

    const handleCategoryChange = (newCategory: { path: string; id: string }) => {
        setListingData((prevData: any) => ({
            ...prevData,
            category: {
                path: newCategory.path,
                id: newCategory.id,
            },
        }));
        setShowCategorySelector(false); // Close the selector after selection
        if (newCategory.id) {
            fetchEbaySpecifics(newCategory.id);
        }
    };

    const handleInputChange = (field: string, value: any) => {
        setListingData((prevData: any) => ({
            ...prevData,
            [field]: value,
        }));
    };
    
    const handleItemSpecificsChange = (index: number, value: string) => {
        const newSpecifics = [...(listingData?.item_specifics || [])];
        newSpecifics[index].value = value;
        setListingData((prevData: any) => ({
            ...prevData,
            item_specifics: newSpecifics
        }));
    };


    // --- Photo Handling Functions ---
    const handlePhotoUpload = (files: FileList | null) => {
        if (!files) return;
        const newFiles = Array.from(files).filter(file => file.type.startsWith('image/'));
        if (photos.length + newFiles.length > 12) {
            alert("You can upload a maximum of 12 photos.");
            return;
        }
        const newUrls = newFiles.map(file => URL.createObjectURL(file));
        setPhotos(prev => [...prev, ...newFiles]);
        setPhotoPreviewUrls(prev => [...prev, ...newUrls]);
    };
    
    const handleFileInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        handlePhotoUpload(e.target.files);
    };

    const removePhoto = (indexToRemove: number) => {
        URL.revokeObjectURL(photoPreviewUrls[indexToRemove]);
        setPhotos(prev => prev.filter((_, index) => index !== indexToRemove));
        setPhotoPreviewUrls(prev => prev.filter((_, index) => index !== indexToRemove));
    };

    const triggerFileInput = () => fileInputRef.current?.click();
    const handleDragOver = (e: React.DragEvent) => { e.preventDefault(); setIsDragging(true); };
    const handleDragLeave = () => setIsDragging(false);
    const handleDrop = (e: React.DragEvent) => {
        e.preventDefault();
        setIsDragging(false);
        handlePhotoUpload(e.dataTransfer.files);
    };
    
    // --- Submission & API Logic ---
    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        if (photos.length === 0) {
            setStatus('Please upload at least one image.');
            return;
        }
        setIsLoading(true);
        setResults(null);
        setListingData(null);
        setStatus('Uploading images to Cloudinary...');

        try {
            const uploadedUrls = await Promise.all(photos.map(async (file) => {
                const formData = new FormData();
                formData.append('file', file);
                formData.append('upload_preset', 'ebay_listings');
                
                const res = await fetch('https://api.cloudinary.com/v1_1/dvhiftzlp/image/upload', {
                    method: 'POST',
                    body: formData,
                });
                
                const data = await res.json();
                if (!res.ok) throw new Error(data.error?.message || 'Image upload failed');
                return data.secure_url;
            }));

            setStatus('Images uploaded! Analyzing with AI...');
            
            const analysisResponse = await fetch('/api/analyze-listing', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    session_id: Date.now().toString(),
                    images: uploadedUrls
                })
            });

            if (!analysisResponse.ok) {
                const errorData = await analysisResponse.json();
                throw new Error(errorData.error || 'Failed to analyze images');
            }

            const analysisResult = await analysisResponse.json();
            const aiData = analysisResult.data;
            const normalized = normalizeAiToListing(aiData);

            setStatus('Listing generated successfully!');
            setResults(aiData); // keep original
            setListingData(normalized); // use normalized for UI
            if (normalized?.category?.id) {
                fetchEbaySpecifics(normalized.category.id);
            }

        } catch (error: any) {
            console.error('Error:', error);
            setStatus(`Error: ${error.message}`);
        } finally {
            setIsLoading(false);
        }
    };

    // --- Publish to eBay Logic ---
    const handlePublishToEbay = async () => {
        setStatus('Publishing to eBay...');
        try {
            const response = await fetch('/api/publish-listing', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ // Send the final, EDITED data
                    listing_data: listingData,
                    images: photoPreviewUrls 
                })
            });
            
            if (!response.ok) {
                throw new Error('Failed to start the publishing process.');
            }

            setStatus('Listing sent to eBay for publishing!');
            alert('Your listing has been sent to eBay! It may take a minute to appear.');

        } catch (error: any) {
            console.error('Error publishing listing:', error);
            setStatus(`Error: ${error.message}`);
            alert(`An error occurred: ${error.message}`);
        }
    };
    
    // --- JSX to Render the Page ---
    return (
        <div className="flex flex-col">
            {/* ... Other page sections ... */}
            <section className="py-16 md:py-24 bg-white">
                <div className="container mx-auto px-4">
                    <div className="max-w-6xl mx-auto">
                        <div className="text-center mb-12">
                            <h2 className="text-3xl md:text-4xl font-bold text-gray-900 mb-4">Try It Now - Free Demo</h2>
                            <p className="text-lg text-gray-600 max-w-2xl mx-auto">Upload up to 12 photos and see how our AI creates professional listings instantly</p>
                        </div>

                        {!listingData ? ( // Changed from !results to !listingData
                            <form onSubmit={handleSubmit} className="grid grid-cols-1 lg:grid-cols-2 gap-8">
                                {/* ... Upload form JSX is unchanged ... */}
                                <div className="card p-6">
                                <h3 className="text-xl font-semibold mb-4 flex items-center"><Image className="w-5 h-5 mr-2 text-teal-600" /> Upload Product Photos</h3>
                                <div
                                    className={`border-2 border-dashed rounded-lg p-6 text-center mb-4 transition-all cursor-pointer ${isDragging ? 'border-teal-500 bg-teal-50' : 'border-gray-300 hover:border-teal-400'}`}
                                    onDragOver={handleDragOver} onDragLeave={handleDragLeave} onDrop={handleDrop} onClick={triggerFileInput}
                                >
                                    <input type="file" ref={fileInputRef} className="hidden" accept="image/*" multiple onChange={handleFileInputChange} />
                                    <Upload className="w-12 h-12 mx-auto text-gray-400 mb-3" />
                                    <p className="text-gray-700 font-medium">Drag and drop your photos here</p>
                                    <p className="text-gray-500 text-sm">or click to browse</p>
                                </div>
                                {photoPreviewUrls.length > 0 && (
                                    <div className="grid grid-cols-4 gap-3 mb-4">
                                        {photoPreviewUrls.map((url, index) => (
                                            <div key={index} className="relative group aspect-square">
                                                <img src={url} alt={`Product ${index + 1}`} className="w-full h-full object-cover rounded-lg" />
                                                <button type="button" onClick={(e) => { e.stopPropagation(); removePhoto(index); }} className="absolute top-1 right-1 bg-red-500 text-white rounded-full p-0.5 opacity-0 group-hover:opacity-100">
                                                    <X className="w-3 h-3" />
                                                </button>
                                                {index === 0 && <span className="absolute bottom-1 left-1 bg-teal-500 text-white text-xs px-1.5 py-0.5 rounded">Main</span>}
                                            </div>
                                        ))}
                                    </div>
                                )}
                                <p className="text-sm text-gray-500 text-center">{photos.length}/12 photos uploaded</p>
                            </div>
                            <div className="card p-6 bg-gradient-to-br from-teal-500 to-teal-600 text-white">
                                <h3 className="text-xl font-semibold mb-4 flex items-center"><Sparkles className="w-5 h-5 mr-2" /> AI-Powered Generation</h3>
                                <div className="space-y-4 mb-6">
                                    <div className="flex items-center"><CheckCircle className="w-5 h-5 mr-3 text-teal-200" /><span className="text-sm">Smart title optimization</span></div>
                                    <div className="flex items-center"><CheckCircle className="w-5 h-5 mr-3 text-teal-200" /><span className="text-sm">SEO-optimized descriptions</span></div>
                                    <div className="flex items-center"><CheckCircle className="w-5 h-5 mr-3 text-teal-200" /><span className="text-sm">Auto-categorization</span></div>
                                    <div className="flex items-center"><CheckCircle className="w-5 h-5 mr-3 text-teal-200" /><span className="text-sm">Analyzes up to 12 photos</span></div>
                                </div>
                                <button type="submit" disabled={isLoading || photos.length === 0} className="btn bg-white text-teal-700 hover:bg-teal-50 w-full py-3 flex items-center justify-center">
                                    <Sparkles className="w-5 h-5 mr-2" />
                                    {isLoading ? 'Generating...' : 'Generate Listings'}
                                </button>
                                {status && <p className={`mt-4 text-center font-medium ${status.includes('Error') ? 'text-yellow-300' : 'text-teal-100'}`}>{status}</p>}
                            </div>
                            </form>
                        ) : (
                            <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
                                <div className="lg:col-span-1">
                                    <div className="card overflow-hidden">
                                        <img src={photoPreviewUrls[0]} alt="Main product" className="w-full h-auto object-cover"/>
                                    </div>
                                </div>
                                <div className="lg:col-span-2 space-y-6">
                                    <div className="flex items-center justify-between">
                                        <h2 className="text-2xl font-bold text-gray-900">Your Generated Listing</h2>
                                        <div className="flex items-center gap-3">
                                            <button
                                              onClick={handlePublishToEbay}
                                              disabled={!listingData?.category?.id || loadingSpecifics}
                                              className={`btn ${(!listingData?.category?.id || loadingSpecifics) ? 'opacity-50 cursor-not-allowed' : 'bg-teal-600 text-white hover:bg-teal-700'}`}
                                            >
                                              Publish to eBay
                                            </button>
                                            <button onClick={() => { setResults(null); setListingData(null); setPhotos([]); setPhotoPreviewUrls([]); setStatus(''); }} className="btn btn-outline">Create Another</button>
                                        </div>
                                    </div>
                                    
                                    {/* Editable form */}
                                    <div className="bg-white rounded-lg shadow p-6 space-y-4">
                                        <div>
                                            <label className="block text-sm font-semibold text-gray-600 mb-1">Title</label>
                                            <input 
                                                type="text" 
                                                className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-teal-500"
                                                value={listingData.title || ''}
                                                onChange={(e) => handleInputChange('title', e.target.value)}
                                                maxLength={80}
                                            />
                                            <p className="text-xs text-gray-500 mt-1">{listingData.title?.length || 0}/80 characters</p>
                                        </div>
                                        
                                        {/* Category (click to open selector) */}
                                        <div>
                                            <label className="block text-sm font-semibold text-gray-600 mb-1">Category</label>
                                            <div
                                                onClick={() => setShowCategorySelector(true)}
                                                className="mt-1 flex cursor-pointer items-center justify-between rounded-md border border-gray-300 bg-white px-3 py-2 text-left shadow-sm hover:bg-gray-50"
                                            >
                                                <span>
                                                    {listingData.category?.path || 'Click to select a category...'}
                                                </span>
                                                <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-gray-400"><path d="m9 18 6-6-6-6"/></svg>
                                            </div>
                                        </div>
                                        
                                        <div>
                                            <label className="block text-sm font-semibold text-gray-600 mb-1">Description</label>
                                            <textarea 
                                                className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-teal-500"
                                                rows={5}
                                                value={listingData.description || ''}
                                                onChange={(e) => handleInputChange('description', e.target.value)}
                                            />
                                        </div>
                                        
                                        {listingData.item_specifics && (
                                            <div>
                                                <label className="block text-sm font-semibold text-gray-600 mb-2">Item Specifics</label>
        {listingData.item_specifics.map((spec: any, index: number) => (
            <div key={index} className="grid grid-cols-2 gap-2 mb-2">
                <input 
                    type="text" 
                    className="px-3 py-2 border border-gray-300 rounded-md bg-gray-50"
                    value={spec.name}
                    readOnly
                />
                {spec.options && spec.options.length > 0 ? (
                    <select
                        className="px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-teal-500"
                        value={spec.value}
                        onChange={(e) => handleItemSpecificsChange(index, e.target.value)}
                    >
                        <option value="">Select...</option>
                        {spec.options.map((option: any) => (
                            <option key={option.value || option} value={option.value || option}>
                                {option.value || option}
                            </option>
                        ))}
                    </select>
                ) : (
                    <input 
                        type="text" 
                        className="px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-teal-500"
                        value={spec.value}
                        onChange={(e) => handleItemSpecificsChange(index, e.target.value)}
                    />
                )}
            </div>
        ))}
    </div>
)}
                                        
                                        {/* ... Keywords display (can remain as is) ... */}

                                    </div>

                                    {/* Category Selector Modal */}
                                    {showCategorySelector && (
                                        <CategorySelector
                                            initialCategoryPath={listingData?.category?.path || ''}
                                            initialCategoryId={listingData?.category?.id || ''}
                                            onCategorySelect={handleCategoryChange}
                                            onClose={() => setShowCategorySelector(false)}
                                        />
                                    )}
                                </div>
                            </div>
                        )}
                    </div>
                </div>
            </section>
        </div>
    );
};
