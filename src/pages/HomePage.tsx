import React, { useState, useRef } from 'react';
import { Link } from 'react-router-dom';
import { Upload, X, PlusCircle, Image, Sparkles, CheckCircle, ArrowRight, Camera, AlertCircle, ShoppingBag, Award, Smartphone, Edit, Tag } from 'lucide-react';
import MarketplaceLogo from '../components/MarketplaceLogo';
import imageCompression from 'browser-image-compression'; // Import the new library

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

    // Helper function to convert a file to a Base64 text string
    const toBase64 = (file: File): Promise<string> => new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.readAsDataURL(file);
        reader.onload = () => {
            const base64String = (reader.result as string).split(',')[1];
            resolve(base64String);
        };
        reader.onerror = error => reject(error);
    });

    // --- Photo Handling Functions ---
    const handlePhotoUpload = (files: FileList | null) => {
        if (!files) return;
        const newFiles = Array.from(files).filter(file => file.type.startsWith('image/'));
        if (photos.length + newFiles.length > 8) {
            alert("You can upload a maximum of 8 photos.");
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
    
    // --- The Final Submission Logic ---
    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        if (photos.length === 0) {
            setStatus('Please upload at least one image.');
            return;
        }
        setIsLoading(true);
        setResults(null);
        setStatus('Starting process...');

        try {
            setStatus('Step 1 of 3: Compressing image...');
            const mainPhoto = photos[0];

            // --- THIS IS THE CRITICAL FIX ---
            // Compress the image before doing anything else
            const options = {
                maxSizeMB: 1,           // Set max size to 1MB
                maxWidthOrHeight: 1920, // Resize to a web-friendly resolution
                useWebWorker: true,
            };
            const compressedFile = await imageCompression(mainPhoto, options);
            
            setStatus('Step 2 of 3: Preparing image data...');
            const base64Image = await toBase64(compressedFile);

            setStatus('Step 3 of 3: Sending to AI engine...');
            const payload = { image_base64: base64Image };
            
            // Call our own secure serverless function
            const response = await fetch('/api/generate', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload),
            });

            if (!response.ok) {
                const errorData = await response.json();
                throw new Error(errorData.message || 'The AI engine returned an error.');
            }

            const resultData = await response.json();
            setResults(resultData);
            setStatus('Success! Your listing is ready.');

        } catch (error: any) {
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
                            <p className="text-lg text-gray-600 max-w-2xl mx-auto">Upload up to 8 photos and see how our AI creates professional listings instantly</p>
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
                                    <p className="text-sm text-gray-500 text-center">{photos.length}/8 photos uploaded</p>
                                </div>
                                <div className="card p-6 bg-gradient-to-br from-teal-500 to-teal-600 text-white">
                                    <h3 className="text-xl font-semibold mb-4 flex items-center"><Sparkles className="w-5 h-5 mr-2" /> AI-Powered Generation</h3>
                                    <div className="space-y-4 mb-6">
                                        <div className="flex items-center"><CheckCircle className="w-5 h-5 mr-3 text-teal-200" /><span className="text-sm">Smart title optimization</span></div>
                                        <div className="flex items-center"><CheckCircle className="w-5 h-5 mr-3 text-teal-200" /><span className="text-sm">SEO-optimized descriptions</span></div>
                                        <div className="flex items-center"><CheckCircle className="w-5 h-5 mr-3 text-teal-200" /><span className="text-sm">Auto-categorization</span></div>
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
                                    {results.titles && (
                                        <div>
                                            <h3 className="text-lg font-semibold mb-2">Titles</h3>
                                            <pre className="bg-gray-50 p-4 rounded-lg whitespace-pre-wrap text-sm">{JSON.stringify(results.titles, null, 2)}</pre>
                                        </div>
                                    )}
                                    {results.specifics && (
                                        <div>
                                            <h3 className="text-lg font-semibold mb-2">Item Specifics</h3>
                                            <pre className="bg-gray-50 p-4 rounded-lg whitespace-pre-wrap text-sm">{JSON.stringify(results.specifics, null, 2)}</pre>
                                        </div>
                                    )}
                                    {results.description && (
                                        <div>
                                            <h3 className="text-lg font-semibold mb-2">Description</h3>
                                            <div className="bg-gray-50 p-4 rounded-lg whitespace-pre-wrap text-sm leading-relaxed">{results.description}</div>
                                        </div>
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

