import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useListingData } from '../hooks/useListingData';
import { useCategorySpecifics } from '../hooks/useCategorySpecifics';
import { SpecificsEditor } from '../components/SpecificsEditor';
import { ItemSpecific, AiData } from '../types';
import clsx from 'clsx';

export default function ResultsPage() {
  const navigate = useNavigate();
  
  // 1. Fetch Data (From Session or Server)
  // This hook automatically handles the "Refresh" bug by checking storage
  const { data: initialData, isLoading: isInitialLoading, isError } = useListingData();

  // 2. Local Form State
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [price, setPrice] = useState('0.00');
  const [images, setImages] = useState<string[]>([]);
  const [category, setCategory] = useState<AiData['category']>(undefined);
  const [specifics, setSpecifics] = useState<ItemSpecific[]>([]);
  const [keywords, setKeywords] = useState('');

  // 3. Fetch Schema (Only runs when category ID exists)
  // This hook uses TanStack Query to cache the response
  const { data: newSchema, isLoading: isSchemaLoading } = useCategorySpecifics(category?.id);

  // --- EFFECT: Initialize Form from AI Data ---
  useEffect(() => {
    if (initialData) {
      setTitle(initialData.title || '');
      setDescription(initialData.description || '');
      setPrice(String(initialData.price_suggestion?.optimal || '0.00'));
      setImages(initialData.images || []);
      setCategory(initialData.category);
      
      const kw = Array.isArray(initialData.keywords) ? initialData.keywords.join(', ') : initialData.keywords;
      setKeywords(String(kw || ''));

      if (initialData.item_specifics) {
        setSpecifics(initialData.item_specifics);
      }
    }
  }, [initialData]);

  // --- EFFECT: Merge Schema when Category Changes ---
  // This ensures that if the category changes (or initially loads),
  // the specific fields (dropdowns vs text) match eBay's rules.
  useEffect(() => {
    if (newSchema && category?.id) {
      console.log("Merging new schema for category:", category.id);
      
      const merged = newSchema.map(schemaItem => {
        // Find if we already have a value for this aspect (case-insensitive)
        const existing = specifics.find(s => s.name.toLowerCase() === schemaItem.name.toLowerCase());
        
return {
  name: schemaItem.name,
  // Keep existing value if present; otherwise choose the correct empty type.
  value: (() => {
    const v = existing?.value;
    if (schemaItem.multi) {
      if (Array.isArray(v)) return v;
      if (typeof v === 'string' && v.trim() !== '') return [v.trim()];
      return [];
    } else {
      if (Array.isArray(v)) return v[0] ?? '';
      return String(v ?? '');
    }
  })(), // 👈  important: close both the IIFE and the property with a comma here
  required: schemaItem.required,
  options: schemaItem.values, // Map 'values' from schema to 'options' for specific
  selectionOnly: schemaItem.selectionOnly,
  multi: schemaItem.multi,
  freeTextAllowed: schemaItem.freeTextAllowed,
};
      
      // Keep custom specifics (ones the user added that aren't in the schema)
      const schemaNames = new Set(newSchema.map(s => s.name.toLowerCase()));
      const customSpecifics = specifics.filter(s => !schemaNames.has(s.name.toLowerCase()));
      
      setSpecifics([...merged, ...customSpecifics]);
    }
  }, [newSchema]); 


  // --- Handlers ---
  const handleSpecificChange = (idx: number, val: string | string[]) => {
    const next = [...specifics];
    next[idx] = { ...next[idx], value: val };
    setSpecifics(next);
  };

  const handleAddSpecific = () => {
    setSpecifics([...specifics, { name: '', value: '', freeTextAllowed: true }]);
  };

  const handleRemoveSpecific = (idx: number) => {
    setSpecifics(specifics.filter((_, i) => i !== idx));
  };

  const handlePublish = async () => {
    const payload = {
        listing_data: {
            title,
            description,
            category,
            item_specifics: specifics,
            price_suggestion: { optimal: price }
        },
        images
    };
    
    try {
        const res = await fetch('/api/publish-listing', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });
        if (!res.ok) throw new Error(await res.text());
        alert("Success! Listing published.");
    } catch (e: any) {
        alert("Error publishing: " + e.message);
    }
  };

  // --- Render ---
  if (isInitialLoading) {
    return (
      <div className="flex items-center justify-center h-screen bg-gray-50">
        <div className="text-center">
          <div className="w-16 h-16 border-4 border-teal-500 border-t-transparent rounded-full animate-spin mx-auto mb-4"></div>
          <h2 className="text-xl font-semibold text-gray-700">Loading your listing...</h2>
        </div>
      </div>
    );
  }

  if (isError || !initialData) {
    return (
      <div className="p-12 text-center">
        <h2 className="text-red-600 text-2xl font-bold mb-4">Failed to load data</h2>
        <p className="mb-6 text-gray-600">Your session may have expired or the data is missing.</p>
        <button onClick={() => navigate('/create-listing')} className="btn btn-primary">Start Over</button>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50 p-6 md:p-12">
      <div className="max-w-6xl mx-auto grid grid-cols-1 lg:grid-cols-3 gap-8">
        
        {/* Left Main Column */}
        <main className="lg:col-span-2 space-y-8">
          <div className="flex items-center justify-between">
            <h1 className="text-3xl font-bold text-gray-900">Edit Listing</h1>
          </div>

          {/* Photos */}
          <section className="card p-6 bg-white shadow rounded-lg">
            <h3 className="text-xl font-semibold mb-4">Photos</h3>
            <div className="grid grid-cols-4 sm:grid-cols-6 gap-4">
              {images.map((img, i) => (
                <div key={i} className={clsx("aspect-square rounded-lg overflow-hidden border-2 bg-gray-100", i === 0 ? "border-teal-500" : "border-transparent")}>
                  <img src={img} alt="" className="w-full h-full object-cover" />
                </div>
              ))}
            </div>
          </section>

          {/* Details */}
          <section className="card p-6 bg-white shadow rounded-lg space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Title</label>
              <input 
                type="text" 
                className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-teal-500 text-lg font-medium"
                value={title} 
                onChange={e => setTitle(e.target.value)} 
                maxLength={80} 
              />
              <div className="text-right text-xs text-gray-500 mt-1">{title.length} / 80</div>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Description</label>
              <textarea 
                rows={8} 
                className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-teal-500"
                value={description} 
                onChange={e => setDescription(e.target.value)} 
              />
            </div>
          </section>

          {/* Specifics Editor */}
          <SpecificsEditor 
            specifics={specifics} 
            onChange={handleSpecificChange}
            onRemove={handleRemoveSpecific}
            onAdd={handleAddSpecific}
            loading={isSchemaLoading}
          />
          
          <section className="card p-6 bg-white shadow rounded-lg">
            <label className="block text-sm font-medium text-gray-700 mb-1">Keywords</label>
            <input 
              type="text" 
              className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-teal-500"
              value={keywords} 
              onChange={e => setKeywords(e.target.value)} 
            />
          </section>
        </main>

        {/* Right Sidebar */}
        <aside className="space-y-6">
          <div className="card p-6 bg-white shadow rounded-lg sticky top-6">
            <h2 className="text-lg font-semibold mb-4">Summary</h2>
            
            <div className="mb-4">
              <label className="block text-xs font-medium text-gray-500 uppercase">Category</label>
              <div className="mt-1 p-2 bg-gray-50 rounded border border-gray-200 text-sm font-medium text-gray-900 break-words">
                  {category?.path || category?.name || 'No Category'}
              </div>
            </div>

            <div className="mb-6">
              <label className="block text-xs font-medium text-gray-500 uppercase">Price</label>
              <div className="relative mt-1">
                <span className="absolute left-3 top-2 text-gray-500">$</span>
                <input 
                  type="text" 
                  className="w-full pl-7 px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-teal-500 text-xl font-bold"
                  value={price} 
                  onChange={e => setPrice(e.target.value)} 
                />
              </div>
            </div>

            <button 
              onClick={handlePublish} 
              className="w-full bg-teal-600 text-white font-bold py-3 px-4 rounded hover:bg-teal-700 transition-colors shadow-lg shadow-teal-500/20"
            >
              Publish to eBay
            </button>
          </div>
        </aside>
      </div>
    </div>
  );
}
