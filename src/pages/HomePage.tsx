import React, { useState, useRef } from 'react';
import { Upload, Sparkles, X } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { AiData } from '../types';

// Helper to clean up the raw AI response to match our Interface
const normalizeAiResponse = (raw: any): AiData => {
  const categoryId = raw?.category?.id || raw?.category_id || raw?.ebay_category_id || '';
  
  const normalizedSpecifics = (raw?.item_specifics || []).map((s: any) => ({
    name: s?.name ?? s?.Name ?? '',
    value: s?.value ?? s?.Value ?? '',
    options: s?.options ?? s?.Values ?? [],
    required: !!s?.required,
    multi: !!s?.multi,
    selectionOnly: !!s?.selectionOnly,
    freeTextAllowed: s?.freeTextAllowed ?? true,
  }));

  return {
    title: raw?.title ?? '',
    description: raw?.description ?? '',
    category: { 
      id: categoryId, 
      name: raw?.category?.name || raw?.ebay_category_name, 
      path: raw?.category?.path || raw?.ebay_category_path
    },
    item_specifics: normalizedSpecifics,
    keywords: raw?.keywords ?? [],
    price_suggestion: raw?.price_suggestion,
    images: raw?.images || [], 
  };
};

export default function HomePage() {
  const navigate = useNavigate();
  const [photos, setPhotos] = useState<File[]>([]);
  const [previewUrls, setPreviewUrls] = useState<string[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [status, setStatus] = useState('');
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handlePhotoUpload = (files: FileList | null) => {
    if (!files) return;
    const newFiles = Array.from(files).filter((f) => f.type.startsWith('image/'));
    if (photos.length + newFiles.length > 12) return alert('Max 12 photos allowed');
    
    const newUrls = newFiles.map((f) => URL.createObjectURL(f));
    setPhotos(prev => [...prev, ...newFiles]);
    setPreviewUrls(prev => [...prev, ...newUrls]);
  };

  const handleRemovePhoto = (index: number) => {
    setPhotos(prev => prev.filter((_, i) => i !== index));
    setPreviewUrls(prev => prev.filter((_, i) => i !== index));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!photos.length) return setStatus('Please upload at least one image');
    
    setIsLoading(true);
    setStatus('Uploading images to Cloudinary...');

    try {
      // 1. Upload Images
      const uploadedUrls = await Promise.all(
        photos.map(async (file) => {
          const formData = new FormData();
          formData.append('file', file);
          formData.append('upload_preset', 'ebay_listings'); // Your preset
          const res = await fetch('https://api.cloudinary.com/v1_1/dvhiftzlp/image/upload', { method: 'POST', body: formData });
          const data = await res.json();
          if (!res.ok) throw new Error(data.error?.message);
          return data.secure_url;
        })
      );

      // 2. Analyze with AI
      setStatus('Analyzing photos with AI...');
      const res = await fetch('/api/analyze-listing', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ session_id: Date.now().toString(), images: uploadedUrls }),
      });
      
      if (!res.ok) throw new Error('Analysis failed');
      const result = await res.json();
      const rawData = result.data || result.analysis || result;

      // 3. Normalize & Save
      const listingData = normalizeAiResponse(rawData);
      listingData.images = uploadedUrls; 

      // Save to Session Storage (The "Bridge" to Page 2)
      sessionStorage.setItem('aiListingData', JSON.stringify(listingData));

      // 4. Navigate to the Results Page
      navigate('/results');

    } catch (err: any) {
      console.error(err);
      setStatus(`Error: ${err.message}`);
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-gray-50 py-12 px-4">
      <div className="max-w-3xl mx-auto text-center mb-10">
        <h1 className="text-4xl font-bold text-gray-900 mb-4">Listing Generator</h1>
        <p className="text-gray-600">Upload photos to generate a complete eBay listing.</p>
      </div>

      <div className="max-w-2xl mx-auto card p-8 bg-white shadow-sm rounded-xl">
        <div 
          onClick={() => fileInputRef.current?.click()}
          className="border-2 border-dashed border-gray-300 rounded-xl p-12 text-center cursor-pointer hover:bg-gray-50 hover:border-teal-400 transition-all"
        >
          <input 
            ref={fileInputRef} type="file" hidden multiple accept="image/*" 
            onChange={(e) => handlePhotoUpload(e.target.files)} 
          />
          <Upload className="w-12 h-12 mx-auto text-teal-500 mb-4" />
          <p className="text-lg font-medium text-gray-700">Click to upload or drag photos</p>
          <p className="text-sm text-gray-400 mt-2">{photos.length} / 12 photos selected</p>
        </div>

        {previewUrls.length > 0 && (
          <div className="grid grid-cols-5 gap-2 mt-6">
            {previewUrls.map((u, i) => (
              <div key={i} className="relative group aspect-square">
                <img src={u} className="w-full h-full object-cover rounded-md border" />
                <button 
                  onClick={(e) => { e.stopPropagation(); handleRemovePhoto(i); }}
                  className="absolute top-1 right-1 bg-red-500 text-white rounded-full p-1 opacity-0 group-hover:opacity-100 transition-opacity"
                >
                  <X className="w-3 h-3" />
                </button>
              </div>
            ))}
          </div>
        )}

        <button
          onClick={handleSubmit}
          disabled={isLoading || !photos.length}
          className="w-full mt-8 btn btn-primary py-3 text-lg flex items-center justify-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {isLoading ? (
            <span className="animate-pulse">{status}</span>
          ) : (
            <>
              <Sparkles className="w-5 h-5" /> Generate Listing
            </>
          )}
        </button>
        
        {status && !isLoading && <p className="mt-4 text-center text-red-500 bg-red-50 p-2 rounded">{status}</p>}
      </div>
    </div>
  );
}
