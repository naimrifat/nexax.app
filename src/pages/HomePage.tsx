import React, { useState, useRef } from 'react';
import { Link } from 'react-router-dom';
import { Upload, X, PlusCircle, Image, Sparkles, CheckCircle, ArrowRight, Camera, AlertCircle, ShoppingBag, Award, Smartphone, Edit, Tag } from 'lucide-react';
import MarketplaceLogo from '../components/MarketplaceLogo';
import imageCompression from 'browser-image-compression';

// Helper components that might be in your project
const StepCard: React.FC<any> = ({ number, title, description, icon }) => (<div></div>);
const FeatureCard: React.FC<any> = ({ title, description, icon }) => (<div></div>);
const TestimonialCard: React.FC<any> = ({ quote, author, role, platform }) => (<div></div>);

export default function HomePage() {
    const [photos, setPhotos] = useState<File[]>([]);
    const [photoPreviewUrls, setPhotoPreviewUrls] = useState<string[]>([]);
    const [isDragging, setIsDragging] = useState(false);
    const [status, setStatus] = useState('');
    const [results, setResults] = useState<any>(null);
    const [isLoading, setIsLoading] = useState(false);
    const [activeTab, setActiveTab] = useState<string>('eBay');
    const fileInputRef = useRef<HTMLInputElement>(null);

    // --- Photo Handling Functions ---
    const handlePhotoUpload = (files: FileList | null) => {
        if (!files) return;
        const newFiles = Array.from(files).filter(file => file.type.startsWith('image/'));
        // Updated to allow up to 12 photos
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
    
    // --- Updated Submission Logic ---
    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        if (photos.length === 0) {
            setStatus('Please upload at least one image.');
            return;
        }
        setIsLoading(true);
        setResults(null);
        setStatus('Uploading images to Cloudinary...');

        try {
            // Step 1: Upload all photos to Cloudinary
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
            console.log('Uploaded URLs:', uploadedUrls);

            // Step 2: Call your Vercel API endpoint for OpenAI analysis
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
            
            // Parse the JSON response from OpenAI
            const listingData = typeof analysisResult.data === 'string' 
                ? JSON.parse(analysisResult.data) 
                : analysisResult.data;

            setStatus('Listing generated successfully!');
            setResults(listingData);

            // Log for debugging
            console.log('Analysis complete:', listingData);

        } catch (error: any) {
            console.error('Error:', error);
            setStatus(`Error: ${error.message}`);
        } finally {
            setIsLoading(false);
        }
    };
    
    // --- JSX to Render the Page ---
    return (
        <div className="flex flex-col">
            {/* ... Your other page sections (Hero, How It Works, etc.) ... */}
            <section className="py-16 md:py-24 bg-white">
                <div className="container mx-auto px-4">
                    <div className="max-w-6xl mx-auto">
                        <div className="text-center mb-12">
                            <h2 className="text-3xl md:text-4xl font-bold text-gray-900 mb-4">Try It Now - Free Demo</h2>
                            <p className="text-lg text-gray-600 max-w-2xl mx-auto">Upload up to 12 photos and see how our AI creates professional listings instantly</p>
                        </div>

                        {!results ? (
                            <form onSubmit={handleSubmit} className="grid grid-cols-1 lg:grid-cols-2 gap-8">
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
                                        <button onClick={() => { setResults(null); setPhotos([]); setPhotoPreviewUrls([]); setStatus(''); }} className="btn btn-outline">Create Another</button>
                                    </div>
                                    
                                    {/* Display the generated listing data */}
                                    <div className="bg-white rounded-lg shadow p-6 space-y-4">
                                        <div>
                                            <h3 className="text-sm font-semibold text-gray-600 mb-1">Title</h3>
                                            <p className="text-lg font-medium text-gray-900">{results.title}</p>
                                        </div>
                                        
                                        <div>
                                            <h3 className="text-sm font-semibold text-gray-600 mb-1">Category</h3>
                                            <p className="text-gray-700">{results.category}</p>
                                        </div>
                                        
                                        <div>
                                            <h3 className="text-sm font-semibold text-gray-600 mb-1">Description</h3>
                                            <p className="text-gray-700 whitespace-pre-line">{results.description}</p>
                                        </div>
                                        
                                        {results.item_specifics && (
                                            <div>
                                                <h3 className="text-sm font-semibold text-gray-600 mb-2">Item Specifics</h3>
                                                <div className="grid grid-cols-2 gap-2">
                                                    {results.item_specifics.map((spec: any, index: number) => (
                                                        <div key={index} className="flex">
                                                            <span className="font-medium text-gray-600">{spec.name}:</span>
                                                            <span className="ml-2 text-gray-900">{spec.value}</span>
                                                        </div>
                                                    ))}
                                                </div>
                                            </div>
                                        )}
                                        
                                        {results.keywords && (
                                            <div>
                                                <h3 className="text-sm font-semibold text-gray-600 mb-2">Keywords</h3>
                                                <div className="flex flex-wrap gap-2">
                                                    {results.keywords.map((keyword: string, index: number) => (
                                                        <span key={index} className="px-2 py-1 bg-teal-100 text-teal-700 rounded text-sm">
                                                            {keyword}
                                                        </span>
                                                    ))}
                                                </div>
                                            </div>
                                        )}
                                    </div>
                                </div>
                            </div>
                        )}
                    </div>
                </div>
            </section>
        </div>
    );
};
