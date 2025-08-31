import React, { useState, useRef } from 'react';
import { Link } from 'react-router-dom';
import { Upload, X, PlusCircle, Image, Sparkles, CheckCircle, ArrowRight, Camera, AlertCircle, ShoppingBag, Award, Smartphone, Edit, Tag } from 'lucide-react';
import MarketplaceLogo from '../components/MarketplaceLogo'; // Assuming you have this component

export default function HomePage() {
    // --- Real State Management ---
    const [photos, setPhotos] = useState<File[]>([]);
    const [photoPreviewUrls, setPhotoPreviewUrls] = useState<string[]>([]);
    const [isDragging, setIsDragging] = useState(false);
    const [status, setStatus] = useState('');
    const [results, setResults] = useState<any>(null); // This will hold the REAL AI data
    const [isLoading, setIsLoading] = useState(false);
    const [activeTab, setActiveTab] = useState<string>('eBay');
    const fileInputRef = useRef<HTMLInputElement>(null);

    // --- YOUR CREDENTIALS ---
    const imgbbApiKey = 'YOUR_IMGBB_API_KEY'; // <-- PASTE YOUR KEY HERE
    const makeWebhookUrl = 'YOUR_MAKE_COM_WEBHOOK_URL'; // <-- PASTE YOUR URL HERE

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
    
    // --- The REAL Submission Logic ---
    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        if (photos.length === 0) {
            setStatus('Please upload at least one image.');
            return;
        }
        setIsLoading(true);
        setResults(null);
        setStatus('Starting process...');
        console.log('--- Starting Generation ---');
        try {
            setStatus('Step 1 of 2: Uploading your main image...');
            const mainPhoto = photos[0];
            const formData = new FormData();
            formData.append('image', mainPhoto);
            console.log('Uploading main image to ImgBB...');
            const imgResponse = await fetch(`https://api.imgbb.com/1/upload?key=${imgbbApiKey}`, {
                method: 'POST',
                body: formData,
            });
            if (!imgResponse.ok) throw new Error('Image upload failed. Please check the image file.');
            const imgData = await imgResponse.json();
            if (!imgData.success) throw new Error(imgData.error?.message || 'Unknown error uploading image.');
            const imageUrl = imgData.data.url;
            console.log('Image uploaded successfully:', imageUrl);
            setStatus('Step 2 of 2: Analyzing image with AI...');
            const payload = { image_url: imageUrl };
            console.log('Sending payload to Make.com:', payload);
            const makeResponse = await fetch(makeWebhookUrl, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload),
            });
            if (!makeResponse.ok) {
                const errorData = await makeResponse.json();
                throw new Error(errorData.message || 'The AI engine returned an error.');
            }
            const resultData = await makeResponse.json();
            console.log('Received results from Make.com:', resultData);
            setResults(resultData);
            setStatus('Success! Your listing is ready.');
        } catch (error: any) {
            console.error('An error occurred:', error);
            setStatus(`Error: ${error.message}`);
        } finally {
            setIsLoading(false);
        }
    };
    
    // --- JSX to Render the Page ---
    return (
        <div className="flex flex-col">
            {/* Hero Section */}
            <section className="relative pt-16 pb-20 md:pt-24 md:pb-32 bg-gradient-to-br from-teal-50 to-purple-50 overflow-hidden">
                <div className="container mx-auto px-4 relative">
                    <div className="max-w-4xl mx-auto text-center">
                        <h1 className="text-4xl md:text-5xl lg:text-6xl font-bold text-gray-900 mb-6 leading-tight">
                            Transform Product Photos into <span className="text-transparent bg-clip-text bg-gradient-to-r from-teal-600 to-purple-600">Perfect Listings</span>
                        </h1>
                        <p className="text-xl text-gray-700 mb-10 max-w-2xl mx-auto">
                            Upload your product photos and let our AI create professional, optimized listings for eBay, Poshmark, Mercari, and more — in seconds.
                        </p>
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

                        {!results ? (
                            <form onSubmit={handleSubmit} className="grid grid-cols-1 lg:grid-cols-2 gap-8">
                                {/* Photo Upload Section */}
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

                                {/* Generation Panel */}
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
                            /* --- REAL Results Section --- */
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
            
            {/* Other page sections */}
            <section className="py-16 md:py-24 bg-gray-50">
                <div className="container mx-auto px-4">
                    <div className="text-center mb-16">
                        <h2 className="text-3xl md:text-4xl font-bold text-gray-900 mb-4">How It Works</h2>
                    </div>
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-8 max-w-5xl mx-auto">
                        <StepCard number={1} title="Upload Photos" description="Drag and drop your product photos." icon={<Upload className="w-8 h-8" />} />
                        <StepCard number={2} title="AI Works Magic" description="Our AI analyzes your photos to identify the product, category, and key selling points." icon={<Sparkles className="w-8 h-8" />} />
                        <StepCard number={3} title="Get Your Listings" description="Review, edit, and export to your preferred marketplace." icon={<ShoppingBag className="w-8 h-8" />} />
                    </div>
                </div>
            </section>
        </div>
    );
};

// --- Helper Components ---
interface StepCardProps { number: number; title: string; description: string; icon: React.ReactNode; }
const StepCard: React.FC<StepCardProps> = ({ number, title, description, icon }) => (
    <div className="card hover:shadow-md px-6 py-8 flex flex-col items-center text-center">
        <div className="w-16 h-16 bg-teal-50 rounded-full flex items-center justify-center mb-5">{icon}</div>
        <div className="w-8 h-8 bg-teal-600 rounded-full flex items-center justify-center text-white font-bold mb-3">{number}</div>
        <h3 className="text-xl font-semibold text-gray-900 mb-2">{title}</h3>
        <p className="text-gray-600">{description}</p>
    </div>
);
