import React, { useState, useRef } from 'react';
import { Upload, X, PlusCircle, Image, Sparkles, CheckCircle, ArrowRight, Camera, AlertCircle } from 'lucide-react';

// This is the main component for your upload page
export default function UploadPage() {
    // --- State Management ---
    const [photos, setPhotos] = useState<File[]>([]);
    const [photoPreviewUrls, setPhotoPreviewUrls] = useState<string[]>([]);
    const [isDragging, setIsDragging] = useState(false);
    const [status, setStatus] = useState('');
    const [results, setResults] = useState<any>(null);
    const [isLoading, setIsLoading] = useState(false);
    const fileInputRef = useRef<HTMLInputElement>(null);

    // --- YOUR CREDENTIALS ---
    const imgbbApiKey = '7b6ad3d170c93f1a32cf2cef62bfebf5'; // <-- PASTE YOUR KEY HERE
    const makeWebhookUrl = 'https://hook.us2.make.com/e1e7hqg3p3oh28x8nxx25urjjn92qu06'; // <-- PASTE YOUR URL HERE

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

    const removePhoto = (indexToRemove: number) => {
        URL.revokeObjectURL(photoPreviewUrls[indexToRemove]);
        setPhotos(prev => prev.filter((_, index) => index !== indexToRemove));
        setPhotoPreviewUrls(prev => prev.filter((_, index) => index !== indexToRemove));
    };

    const triggerFileInput = () => fileInputRef.current?.click();

    // --- Drag and Drop Handlers ---
    const handleDragOver = (e: React.DragEvent) => { e.preventDefault(); setIsDragging(true); };
    const handleDragLeave = () => setIsDragging(false);
    const handleDrop = (e: React.DragEvent) => {
        e.preventDefault();
        setIsDragging(false);
        handlePhotoUpload(e.dataTransfer.files);
    };
    
    // --- Main Submission Logic ---
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
            // Step 1: Upload the FIRST image to ImgBB
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

            // Step 2: Send the single image URL to Make.com
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

            // Step 3: Display results
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
        <div className="container mx-auto px-4 py-8 md:py-12">
            <div className="max-w-4xl mx-auto">
                <div className="text-center mb-8">
                    <h1 className="text-3xl md:text-4xl font-bold text-gray-900 mb-4">
                        Create Professional Listings
                    </h1>
                    <p className="text-lg text-gray-600 max-w-2xl mx-auto">
                        Upload your product photos and let our AI create optimized listings for all major marketplaces
                    </p>
                </div>

                {!results ? (
                    <form onSubmit={handleSubmit} className="space-y-6">
                        <div 
                            className={`border-2 border-dashed rounded-lg p-8 text-center transition-all cursor-pointer ${isDragging ? 'border-teal-500 bg-teal-50' : 'border-gray-300 hover:border-teal-400'}`}
                            onDragOver={handleDragOver} onDragLeave={handleDragLeave} onDrop={handleDrop} onClick={triggerFileInput}
                        >
                            <input type="file" ref={fileInputRef} className="hidden" accept="image/*" multiple onChange={(e) => handlePhotoUpload(e.target.files)} />
                            <Upload className="w-12 h-12 mx-auto text-gray-400 mb-4" />
                            <h3 className="text-lg font-medium text-gray-700">Drag & drop or click to upload</h3>
                            <p className="text-sm text-gray-500 mt-1">Up to 8 photos supported ({photos.length}/8)</p>
                        </div>
                        
                        {photoPreviewUrls.length > 0 && (
                            <div className="grid grid-cols-4 sm:grid-cols-8 gap-4">
                                {photoPreviewUrls.map((url, index) => (
                                    <div key={index} className="relative group aspect-square">
                                        <img src={url} alt={`Preview ${index}`} className="w-full h-full object-cover rounded-lg border" />
                                        <button type="button" onClick={() => removePhoto(index)} className="absolute top-1 right-1 bg-red-500 text-white rounded-full p-1 opacity-0 group-hover:opacity-100 transition-opacity">
                                            <X className="w-3 h-3" />
                                        </button>
                                        {index === 0 && <span className="absolute bottom-1 left-1 bg-teal-500 text-white text-xs px-2 py-1 rounded">Main</span>}
                                    </div>
                                ))}
                            </div>
                        )}

                        <div className="text-center">
                            <button type="submit" disabled={isLoading || photos.length === 0} className="w-full sm:w-auto flex items-center justify-center gap-2 btn bg-teal-600 text-white hover:bg-teal-700 px-8 py-3 text-lg font-medium disabled:opacity-50 disabled:cursor-not-allowed">
                                <Sparkles className="w-5 h-5" />
                                {isLoading ? 'Generating...' : 'Generate Listings'}
                            </button>
                            {status && <p className={`mt-4 font-medium ${status.includes('Error') ? 'text-red-600' : 'text-gray-600'}`}>{status}</p>}
                        </div>
                    </form>
                ) : (
                    <div className="space-y-6">
                         <div className="flex items-center justify-between">
                            <h2 className="text-2xl font-bold text-gray-900">Your Generated Listing</h2>
                            <button onClick={() => { setResults(null); setPhotos([]); setPhotoPreviewUrls([]); setStatus(''); }} className="btn btn-outline">
                                Start Another
                            </button>
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
                )}
            </div>
        </div>
    );
}
