import React, { useState, useRef } from 'react';
import { Upload, X, Image as ImageIcon, Sparkles, CheckCircle } from 'lucide-react';
import CategorySelector from '../components/CategorySelector';

// ---------------- Error Boundary with Safe Fallback ----------------
type BoundaryProps = {
  onManualSelect: (c: { path: string; id: string }) => void;
  onClose: () => void;
  children: React.ReactNode;
};

class ErrorBoundary extends React.Component<BoundaryProps, { hasError: boolean; message?: string }> {
  constructor(props: BoundaryProps) {
    super(props);
    this.state = { hasError: false, message: '' };
  }
  static getDerivedStateFromError(error: any) {
    return { hasError: true, message: error?.message ?? 'Category selector crashed' };
  }
  componentDidCatch(error: any, info: any) {
    // Keep this log — it helps debugging in the browser console
    console.error('CategorySelector crashed:', error, info);
  }
  render() {
    if (!this.state.hasError) return this.props.children;

    // Fallback UI: manual category inputs so the app stays usable
    return (
      <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50">
        <div className="w-full max-w-lg bg-white rounded-lg shadow p-5">
          <h3 className="text-lg font-semibold text-red-700 mb-2">Category selector failed to open</h3>
          <p className="text-sm text-red-600 mb-4">
            {this.state.message || 'Unexpected error.'} You can still continue by entering a category manually.
          </p>
          <ManualCategoryForm onApply={this.props.onManualSelect} onCancel={this.props.onClose} />
        </div>
      </div>
    );
  }
}

function ManualCategoryForm({
  onApply,
  onCancel,
}: {
  onApply: (c: { path: string; id: string }) => void;
  onCancel: () => void;
}) {
  const [path, setPath] = useState('');
  const [id, setId] = useState('');
  return (
    <div className="space-y-3">
      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1">Category Path</label>
        <input
          className="w-full px-3 py-2 border border-gray-300 rounded-md"
          placeholder="e.g., Clothing > Men > Hoodies & Sweatshirts"
          value={path}
          onChange={(e) => setPath(e.target.value)}
        />
      </div>
      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1">Category ID</label>
        <input
          className="w-full px-3 py-2 border border-gray-300 rounded-md"
          placeholder="e.g., 57988"
          value={id}
          onChange={(e) => setId(e.target.value)}
        />
      </div>
      <div className="flex justify-end gap-2 pt-2">
        <button className="btn btn-outline" onClick={onCancel} type="button">
          Cancel
        </button>
        <button
          className="btn bg-teal-600 text-white hover:bg-teal-700"
          onClick={() => onApply({ path, id })}
          type="button"
          disabled={!id}
        >
          Apply
        </button>
      </div>
    </div>
  );
}

// ---------------- Home Page ----------------
export default function HomePage() {
  const [photos, setPhotos] = useState<File[]>([]);
  const [photoPreviewUrls, setPhotoPreviewUrls] = useState<string[]>([]);
  const [isDragging, setIsDragging] = useState(false);
  const [status, setStatus] = useState('');
  const [results, setResults] = useState<any>(null);        // raw AI result (kept for reference)
  const [listingData, setListingData] = useState<any>(null); // normalized + editable for UI
  const [isLoading, setIsLoading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [showCategorySelector, setShowCategorySelector] = useState(false);
  const [ebaySpecifics, setEbaySpecifics] = useState<any[]>([]);
  const [loadingSpecifics, setLoadingSpecifics] = useState(false);

  // ---------- Helpers ----------
  const normalizeAiToListing = (raw: any) => {
    const categoryId =
      raw?.category?.id || raw?.category_id || raw?.ebay_category_id || '';
    const categoryPath =
  raw?.category?.path ||
  raw?.category?.name ||
  raw?.category_path ||
  raw?.categoryName || '';
    
    const specificsSource: any[] = Array.isArray(raw?.item_specifics)
      ? raw.item_specifics
      : (raw?.itemSpecifics || []);

    const normalizedSpecifics = specificsSource.map((s: any) => ({
      name: s?.name ?? s?.Name ?? '',
      value: s?.value ?? s?.Value ?? '',
      options: s?.options ?? s?.Values ?? [],
      required: s?.required ?? false,
    }));

    return {
      title: raw?.title ?? '',
      description: raw?.description ?? '',
      category: { id: categoryId, path: categoryPath },
      item_specifics: normalizedSpecifics,
      keywords: raw?.keywords ?? [],
    };
  };

  const fetchEbaySpecifics = async (categoryId: string) => {
    if (!categoryId) return;
    setLoadingSpecifics(true);
    try {
      const response = await fetch('/api/ebay-categories', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'getCategorySpecifics',
          categoryId,
        }),
      });

      if (response.ok) {
        const data = await response.json();
        const aspects: any[] = data?.aspects ?? [];

        const mergedSpecifics = aspects.map((aspect: any) => {
          const existing = (listingData?.item_specifics ?? []).find(
            (s: any) => (s.name ?? s.Name) === aspect.name
          );
          return {
            name: aspect.name,
            value: existing?.value ?? existing?.Value ?? '',
            required: Boolean(aspect.required),
            options: aspect.values ?? [],
          };
        });

        setEbaySpecifics(mergedSpecifics);
        setListingData((prev: any) => ({
          ...(prev ?? {}),
          item_specifics: mergedSpecifics,
        }));
      } else {
        console.error('getCategorySpecifics failed:', await response.text());
      }
    } catch (err) {
      console.error('Failed to fetch eBay specifics:', err);
    } finally {
      setLoadingSpecifics(false);
    }
  };

  // ---------- Form handlers ----------
  const handleCategoryChange = (newCategory: { path: string; id: string }) => {
    setListingData((prevData: any) => ({
      ...(prevData ?? {}),
      category: { path: newCategory.path, id: newCategory.id },
    }));
    setShowCategorySelector(false);
    if (newCategory?.id) fetchEbaySpecifics(newCategory.id);
  };

  const handleInputChange = (field: string, value: any) => {
    setListingData((prevData: any) => ({
      ...(prevData ?? {}),
      [field]: value,
    }));
  };

  const handleItemSpecificsChange = (index: number, value: string) => {
    const current = [...(listingData?.item_specifics ?? [])];
    if (!current[index]) return;
    current[index] = { ...current[index], value };
    setListingData((prevData: any) => ({
      ...(prevData ?? {}),
      item_specifics: current,
    }));
  };

  // ---------- Photo handling ----------
  const handlePhotoUpload = (files: FileList | null) => {
    if (!files) return;
    const newFiles = Array.from(files).filter((f) => f.type.startsWith('image/'));
    if (photos.length + newFiles.length > 12) {
      alert('You can upload a maximum of 12 photos.');
      return;
    }
    const newUrls = newFiles.map((f) => URL.createObjectURL(f));
    setPhotos((prev) => [...prev, ...newFiles]);
    setPhotoPreviewUrls((prev) => [...prev, ...newUrls]);
  };

  const handleFileInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    handlePhotoUpload(e.target.files);
  };

  const removePhoto = (indexToRemove: number) => {
    const url = photoPreviewUrls[indexToRemove];
    if (url) URL.revokeObjectURL(url);
    setPhotos((prev) => prev.filter((_, i) => i !== indexToRemove));
    setPhotoPreviewUrls((prev) => prev.filter((_, i) => i !== indexToRemove));
  };

  const triggerFileInput = () => fileInputRef.current?.click();
  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(true);
  };
  const handleDragLeave = () => setIsDragging(false);
  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    handlePhotoUpload(e.dataTransfer.files);
  };

  // ---------- Submit & AI analysis ----------
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
      const uploadedUrls = await Promise.all(
        photos.map(async (file) => {
          const formData = new FormData();
          formData.append('file', file);
          formData.append('upload_preset', 'ebay_listings');

          const res = await fetch(
            'https://api.cloudinary.com/v1_1/dvhiftzlp/image/upload',
            { method: 'POST', body: formData }
          );

          const data = await res.json();
          if (!res.ok) throw new Error(data?.error?.message ?? 'Image upload failed');
          return data.secure_url as string;
        })
      );

      setStatus('Images uploaded! Analyzing with AI...');

      const analysisResponse = await fetch('/api/analyze-listing', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          session_id: Date.now().toString(),
          images: uploadedUrls,
        }),
      });

      if (!analysisResponse.ok) {
        const errorData = await analysisResponse.json().catch(() => ({}));
        throw new Error(errorData?.error ?? 'Failed to analyze images');
      }

      const analysisResult = await analysisResponse.json();
      const aiData = analysisResult?.data ?? {};
      const normalized = normalizeAiToListing(aiData);

      setStatus('Listing generated successfully!');
      setResults(aiData);            // keep raw
      setListingData(normalized);    // drive UI from normalized
      if (normalized?.category?.id) {
        fetchEbaySpecifics(normalized.category.id);
      }
    } catch (error: any) {
      console.error('Error:', error);
      setStatus(`Error: ${error?.message ?? 'Unknown error'}`);
    } finally {
      setIsLoading(false);
    }
  };

  // ---------- Publish to eBay ----------
  const handlePublishToEbay = async () => {
    if (!listingData) return;
    setStatus('Publishing to eBay...');
    try {
      const response = await fetch('/api/publish-listing', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          listing_data: listingData,     // final, edited data
          images: photoPreviewUrls,      // the images you uploaded
        }),
      });

      if (!response.ok) {
        const msg = await response.text();
        throw new Error(msg || 'Failed to start the publishing process.');
      }

      setStatus('Listing sent to eBay for publishing!');
      alert('Your listing has been sent to eBay! It may take a minute to appear.');
    } catch (error: any) {
      console.error('Error publishing listing:', error);
      setStatus(`Error: ${error?.message ?? 'Unknown error'}`);
      alert(`An error occurred: ${error?.message ?? 'Unknown error'}`);
    }
  };

  // ---------- UI ----------
  return (
    <div className="flex flex-col">
      <section className="py-16 md:py-24 bg-white">
        <div className="container mx-auto px-4">
          <div className="max-w-6xl mx-auto">
            <div className="text-center mb-12">
              <h2 className="text-3xl md:text-4xl font-bold text-gray-900 mb-4">
                Try It Now - Free Demo
              </h2>
              <p className="text-lg text-gray-600 max-w-2xl mx-auto">
                Upload up to 12 photos and see how our AI creates professional listings instantly
              </p>
            </div>

            {!listingData ? (
              <form onSubmit={handleSubmit} className="grid grid-cols-1 lg:grid-cols-2 gap-8">
                {/* Upload */}
                <div className="card p-6">
                  <h3 className="text-xl font-semibold mb-4 flex items-center">
                    <ImageIcon className="w-5 h-5 mr-2 text-teal-600" />
                    Upload Product Photos
                  </h3>

                  <div
                    className={`border-2 border-dashed rounded-lg p-6 text-center mb-4 transition-all cursor-pointer ${
                      isDragging ? 'border-teal-500 bg-teal-50' : 'border-gray-300 hover:border-teal-400'
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
                    <p className="text-gray-500 text-sm">or click to browse</p>
                  </div>

                  {photoPreviewUrls.length > 0 && (
                    <div className="grid grid-cols-4 gap-3 mb-4">
                      {photoPreviewUrls.map((url, index) => (
                        <div key={index} className="relative group aspect-square">
                          <img src={url} alt={`Product ${index + 1}`} className="w-full h-full object-cover rounded-lg" />
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              removePhoto(index);
                            }}
                            className="absolute top-1 right-1 bg-red-500 text-white rounded-full p-0.5 opacity-0 group-hover:opacity-100"
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
                    </div>
                  )}

                  <p className="text-sm text-gray-500 text-center">{photos.length}/12 photos uploaded</p>
                </div>

                {/* AI Generation */}
                <div className="card p-6 bg-gradient-to-br from-teal-500 to-teal-600 text-white">
                  <h3 className="text-xl font-semibold mb-4 flex items-center">
                    <Sparkles className="w-5 h-5 mr-2" /> AI-Powered Generation
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
                      <span className="text-sm">Analyzes up to 12 photos</span>
                    </div>
                  </div>

                  <button
                    type="submit"
                    disabled={isLoading || photos.length === 0}
                    className="btn bg-white text-teal-700 hover:bg-teal-50 w-full py-3 flex items-center justify-center"
                  >
                    <Sparkles className="w-5 h-5 mr-2" />
                    {isLoading ? 'Generating...' : 'Generate Listings'}
                  </button>

                  {status && (
                    <p
                      className={`mt-4 text-center font-medium ${
                        status.includes('Error') ? 'text-yellow-300' : 'text-teal-100'
                      }`}
                    >
                      {status}
                    </p>
                  )}
                </div>
              </form>
            ) : (
              <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
                <div className="lg:col-span-1">
                  <div className="card overflow-hidden">
                    <img
                      src={photoPreviewUrls[0]}
                      alt="Main product"
                      className="w-full h-auto object-cover"
                    />
                  </div>
                </div>

                <div className="lg:col-span-2 space-y-6">
                  <div className="flex items-center justify-between">
                    <h2 className="text-2xl font-bold text-gray-900">Your Generated Listing</h2>
                    <div className="flex items-center gap-3">
                      <button
                        onClick={handlePublishToEbay}
                        disabled={!listingData?.category?.id || loadingSpecifics}
                        className={`btn ${
                          !listingData?.category?.id || loadingSpecifics
                            ? 'opacity-50 cursor-not-allowed'
                            : 'bg-teal-600 text-white hover:bg-teal-700'
                        }`}
                      >
                        Publish to eBay
                      </button>
                      <button
                        onClick={() => {
                          setResults(null);
                          setListingData(null);
                          setPhotos([]);
                          setPhotoPreviewUrls([]);
                          setStatus('');
                        }}
                        className="btn btn-outline"
                      >
                        Create Another
                      </button>
                    </div>
                  </div>

                  {/* Editable form */}
                  <div className="bg-white rounded-lg shadow p-6 space-y-4">
                    <div>
                      <label className="block text-sm font-semibold text-gray-600 mb-1">Title</label>
                      <input
                        type="text"
                        className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-teal-500"
                        value={listingData?.title ?? ''}
                        onChange={(e) => handleInputChange('title', e.target.value)}
                        maxLength={80}
                      />
                      <p className="text-xs text-gray-500 mt-1">
                        {(listingData?.title?.length ?? 0)}/80 characters
                      </p>
                    </div>

                    <div>
                      <label className="block text-sm font-semibold text-gray-600 mb-1">Category</label>
                      <div
                        onClick={() => setShowCategorySelector(true)}
                        className="mt-1 flex cursor-pointer items-center justify-between rounded-md border border-gray-300 bg-white px-3 py-2 text-left shadow-sm hover:bg-gray-50"
                      >
                        <span>
                          {listingData?.category?.path || 'Click to select a category...'}
                        </span>
                        <svg
                          xmlns="http://www.w3.org/2000/svg"
                          width="20"
                          height="20"
                          viewBox="0 0 24 24"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth="2"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          className="text-gray-400"
                        >
                          <path d="m9 18 6-6-6-6" />
                        </svg>
                      </div>
                    </div>

                    <div>
                      <label className="block text-sm font-semibold text-gray-600 mb-1">Description</label>
                      <textarea
                        className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-teal-500"
                        rows={5}
                        value={listingData?.description ?? ''}
                        onChange={(e) => handleInputChange('description', e.target.value)}
                      />
                    </div>

                    {!!(listingData?.item_specifics?.length) && (
                      <div>
                        <label className="block text-sm font-semibold text-gray-600 mb-2">
                          Item Specifics
                        </label>

                        {listingData.item_specifics.map((spec: any, index: number) => (
                          <div key={`${spec?.name ?? 'spec'}-${index}`} className="grid grid-cols-2 gap-2 mb-2">
                            <input
                              type="text"
                              className="px-3 py-2 border border-gray-300 rounded-md bg-gray-50"
                              value={spec?.name ?? ''}
                              readOnly
                            />

                            {Array.isArray(spec?.options) && spec.options.length > 0 ? (
                              <select
                                className="px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-teal-500"
                                value={spec?.value ?? ''}
                                onChange={(e) => handleItemSpecificsChange(index, e.target.value)}
                              >
                                <option value="">Select...</option>
                                {spec.options.map((option: any, i: number) => {
                                  const val = option?.value ?? option; // support string or { value }
                                  return (
                                    <option key={`${val}-${i}`} value={val}>
                                      {val}
                                    </option>
                                  );
                                })}
                              </select>
                            ) : (
                              <input
                                type="text"
                                className="px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-teal-500"
                                value={spec?.value ?? ''}
                                onChange={(e) => handleItemSpecificsChange(index, e.target.value)}
                              />
                            )}
                          </div>
                        ))}
                      </div>
                    )}
                  </div>

                  {/* Category Selector Modal or Safe Fallback */}
                  {showCategorySelector && (
                    <ErrorBoundary
                      onManualSelect={handleCategoryChange}
                      onClose={() => setShowCategorySelector(false)}
                    >
                      <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50">
                        <div className="w-full max-w-3xl bg-white rounded-lg shadow p-5">
                          <CategorySelector
                            initialCategoryPath={listingData?.category?.path || ''}
                            initialCategoryId={listingData?.category?.id || ''}
                            onCategorySelect={handleCategoryChange}
                            onClose={() => setShowCategorySelector(false)}
                          />
                        </div>
                      </div>
                    </ErrorBoundary>
                  )}
                </div>
              </div>
            )}
          </div>
        </div>
      </section>
    </div>
  );
}
