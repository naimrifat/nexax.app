// src/pages/ResultsPage.tsx
import React, { useEffect, useMemo, useState, useCallback, useRef } from 'react';
import { useNavigate } from 'react-router-dom';

type Category = {
  id: string;
  name: string;
  parentId?: string;
  level?: number;
};

type CategoryWithPath = Category & {
  path?: string;
  breadcrumbs?: string[];
};

type ItemSpecific = {
  name: string;
  value: string;
  required?: boolean;
  type?: string;
  options?: string[];
  selectionOnly?: boolean;
  freeTextAllowed?: boolean;
  multi?: boolean;
};

type AiDetected = {
  brand?: string;
  size?: string;
  color?: string;
  condition?: string;
  material?: string;
  style?: string;
  [key: string]: any;
};

type AiData = {
  title?: string;
  description?: string;
  price_suggestion?: { optimal?: number | string };
  image_url?: string;
  images?: string[];
  image_urls?: string[];
  category?: CategoryWithPath;
  category_suggestions?: Category[];
  item_specifics?: ItemSpecific[] | Record<string, string>;
  keywords?: string[] | string;
  detected?: AiDetected;
  data?: any;
  analysis?: any;
};

function normalizeSpecifics(s: AiData['item_specifics']): ItemSpecific[] {
  if (!s) return [];
  if (Array.isArray(s)) {
    return s.filter(x => x && typeof x.name === 'string');
  }
  if (typeof s === 'object') {
    return Object.entries(s).map(([name, value]) => ({
      name,
      value: String(value ?? ''),
    }));
  }
  return [];
}

export default function ResultsPage() {
  const navigate = useNavigate();

  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [price, setPrice] = useState('0.00');

  // Multi-image state
  const [images, setImages] = useState<string[]>([]);
  const [mainImageIndex, setMainImageIndex] = useState(0);

  // legacy single image (used by the small preview card)
  const [imageUrl, setImageUrl] = useState('');

  const [keywords, setKeywords] = useState('');
  const [category, setCategory] = useState<CategoryWithPath | null>(null);
  const [categorySuggestions, setCategorySuggestions] = useState<Category[]>([]);
  const [specifics, setSpecifics] = useState<ItemSpecific[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showCategoryModal, setShowCategoryModal] = useState(false);
  const [loadingSpecifics, setLoadingSpecifics] = useState(false);

  // store AI-detected facts without causing re-renders
  const aiDetectedRef = useRef<AiDetected>({});

  // ---- helpers for images ----
  const setImagesFromAnySource = (rawAnalysis: any, rawRoot: any) => {
    const fromAnalysis =
      (Array.isArray(rawAnalysis?.images) && rawAnalysis.images) ||
      (Array.isArray(rawAnalysis?.image_urls) && rawAnalysis.image_urls) ||
      [];
    const fromRoot =
      (Array.isArray(rawRoot?.images) && rawRoot.images) ||
      (Array.isArray(rawRoot?.image_urls) && rawRoot.image_urls) ||
      [];
    const combined = fromAnalysis.length ? fromAnalysis : fromRoot;
    if (combined && combined.length) {
      setImages(combined);
      setMainImageIndex(0);
      setImageUrl(combined[0]); // keep preview in sync
    } else if (rawAnalysis?.image_url) {
      setImages([rawAnalysis.image_url]);
      setMainImageIndex(0);
      setImageUrl(rawAnalysis.image_url);
    }
  };

  const moveImage = (from: number, to: number) => {
    setImages(prev => {
      if (from < 0 || to < 0 || from >= prev.length || to >= prev.length) return prev;
      const next = [...prev];
      const [moved] = next.splice(from, 1);
      next.splice(to, 0, moved);
      return next;
    });
    setMainImageIndex(to);
  };

  // REMOVED redundant smartFillSpecifics function. Merging logic now in fetchCategorySpecifics.

  // ---- Fetch category specifics ----
  const fetchCategorySpecifics = useCallback(async (categoryId: string) => {
    setLoadingSpecifics(true);
    const existingSpecifics = specifics; // Capture current AI/user values

    try {
      const response = await fetch('/api/ebay-categories', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'getCategorySpecifics',
          categoryId
        })
      });

      if (!response.ok) throw new Error('Failed to fetch category specifics');

      const data = await response.json();
      const existingMap = new Map(existingSpecifics.map(s => [s.name.toLowerCase(), s]));

      const mergedSpecifics: ItemSpecific[] = (data.aspects || []).map((aspect: any) => {
        const name = aspect.name;
        const existing = existingMap.get(name.toLowerCase());
        
        // Merge: Use AI/User value if it exists, otherwise use an empty string
        const value = existing?.value ?? '';
        
        return {
          name,
          value,
          required: !!aspect.required,
          type: aspect.type === 'SelectionOnly' ? 'dropdown' : 'text',
          options: aspect.values || [],
          selectionOnly: aspect.type === 'SelectionOnly',
          freeTextAllowed: aspect.type !== 'SelectionOnly',
          multi: !!aspect.multi,
        }
      });

      // Preserve any custom specifics or specifics that eBay didn't return
      const ebayNames = new Set(mergedSpecifics.map(s => s.name.toLowerCase()));
      const finalSpecifics = [
        ...mergedSpecifics,
        ...existingSpecifics.filter(s => !ebayNames.has(s.name.toLowerCase()))
      ];
      
      setSpecifics(finalSpecifics);

    } catch (error) {
      console.error('Error fetching specifics:', error);
    } finally {
      setLoadingSpecifics(false);
    }
  }, [specifics]); // Now depends on specifics to capture current values for merging

  // ---- Load initial data (once) ----
  useEffect(() => {
    let isMounted = true;

    const loadData = async () => {
      setLoading(true);

      const urlParams = new URLSearchParams(window.location.search);
      const sessionId = urlParams.get('session');

      // 1) Try server-side session first
      if (sessionId) {
        try {
          const res = await fetch(`/api/listing-data/${sessionId}`);
          if (!res.ok) throw new Error('Failed to fetch data from API');

          const root = await res.json();
          const analysis = root.data || root.analysis || root;

          if (!isMounted) return;

          setTitle(analysis.title ?? '');
          setDescription(analysis.description ?? '');
          setPrice(
            typeof analysis.price_suggestion?.optimal === 'number'
              ? analysis.price_suggestion.optimal.toFixed(2)
              : String(analysis.price_suggestion?.optimal ?? '0.00')
          );

          aiDetectedRef.current = analysis.detected || {};

          const kw = Array.isArray(analysis.keywords)
            ? analysis.keywords.join(', ')
            : String(analysis.keywords ?? '');
          setKeywords(kw);

          setCategorySuggestions(analysis.category_suggestions ?? []);

          const initialCategory = analysis.category ?? null;
          setCategory(initialCategory);

          // images
          setImagesFromAnySource(analysis, root);

          const initialSpecifics = normalizeSpecifics(analysis.item_specifics);

          if (initialCategory && initialCategory.id) {
            // Set initial specifics for the fetchCategorySpecifics to merge with
            setSpecifics(initialSpecifics); 
            // fetchCategorySpecifics is called but will use the latest specifics in its closure
          } else {
            setSpecifics(initialSpecifics);
          }

          setLoading(false);
          return;
        } catch (err: any) {
          console.error('Error fetching from API:', err);
          if (isMounted) {
            setError(err.message || 'Failed to load data');
            setLoading(false);
          }
          return;
        }
      }

      // 2) Fallback to client-side sessionStorage
      const raw = sessionStorage.getItem('aiListingData');
      if (!raw) {
        navigate('/create-listing', { replace: true });
        return;
      }

      try {
        const parsed: AiData = JSON.parse(raw);
        const analysis: any = (parsed as any).data || (parsed as any).analysis || parsed;

        if (!isMounted) return;

        setTitle(analysis.title ?? '');
        setDescription(analysis.description ?? '');
        setPrice(
          typeof analysis.price_suggestion?.optimal === 'number'
            ? analysis.price_suggestion.optimal.toFixed(2)
            : String(analysis.price_suggestion?.optimal ?? '0.00')
        );

        aiDetectedRef.current = analysis.detected || {};

        const kw = Array.isArray(analysis.keywords)
          ? analysis.keywords.join(', ')
          : String(analysis.keywords ?? '');
        setKeywords(kw);

        setCategorySuggestions(analysis.category_suggestions ?? []);

        const initialCategory = analysis.category ?? null;
        setCategory(initialCategory);

        setImagesFromAnySource(analysis, parsed);

        const initialSpecifics = normalizeSpecifics(analysis.item_specifics);

        if (initialCategory && initialCategory.id) {
          // Set initial specifics for the fetchCategorySpecifics to merge with
          setSpecifics(initialSpecifics);
          // fetchCategorySpecifics is called but will use the latest specifics in its closure
        } else {
          setSpecifics(initialSpecifics);
        }


        setLoading(false);
      } catch (e: any) {
        console.error('Failed to parse data:', e);
        if (isMounted) {
          setError('Failed to load listing data');
          setLoading(false);
        }
      }
    };

    loadData();

    return () => {
      isMounted = false;
    };
  }, [navigate, fetchCategorySpecifics]);

  // keep small preview image synced with main image
  useEffect(() => {
    if (images.length && mainImageIndex >= 0 && mainImageIndex < images.length) {
      setImageUrl(images[mainImageIndex]);
    }
  }, [images, mainImageIndex]);

  // ---- Category change ----
  const handleCategorySelect = async (newCategory: CategoryWithPath) => {
    setCategory(newCategory);
    setShowCategoryModal(false);
    // fetchCategorySpecifics depends on the specifics state, which is implicitly updated 
    // after the initial load. Since it's in the dependency array of useCallback, 
    // it will correctly capture the current state for merging.
    await fetchCategorySpecifics(newCategory.id);
  };

  const updateSpecific = (idx: number, value: string) => {
    setSpecifics(prev => {
      const next = [...prev];
      next[idx] = { ...next[idx], value };
      return next;
    });
  };

  const addSpecific = () => setSpecifics(prev => [...prev, { name: '', value: '' }]);
  const removeSpecific = (idx: number) => setSpecifics(prev => prev.filter((_, i) => i !== idx));

  const categoryBreadcrumb = useMemo(() => {
    if (!category) return 'No category selected';
    if (category.path) return category.path;
    if (category.breadcrumbs) return category.breadcrumbs.join(' > ');
    return category.name;
  }, [category]);

  // ---- Publish handler (still stubbed to your backend stub) ----
  const handlePublish = async () => {
    try {
      const trimmedTitle = title.trim();
      const trimmedDescription = description.trim();

      if (!trimmedTitle) throw new Error('Title is required.');
      if (!trimmedDescription) throw new Error('Description is required.');
      if (!category) throw new Error('Category is required.');
      if (!images.length) throw new Error('At least one image is required.');

      const normalizedSpecifics = specifics.map(s => ({
        name: s.name,
        value: s.value,
        required: !!s.required,
      }));

      const keywordArray = keywords
        .split(',')
        .map(k => k.trim())
        .filter(Boolean);

      const listing_data = {
        title: trimmedTitle,
        description: trimmedDescription,
        category,
        item_specifics: normalizedSpecifics,
        keywords: keywordArray,
        price_suggestion: { optimal: price },
      };

      const res = await fetch('/api/publish-listing', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          listing_data,
          images,
        }),
      });

      const data = await res.json();

      if (!res.ok || !data.success) {
        const details = data?.error || JSON.stringify(data);
        throw new Error(details);
      }

      alert('Your listing has been sent to eBay! It may take a minute to appear.');
    } catch (err: any) {
      alert(`An error occurred: ${err?.message || String(err)}`);
    }
  };

  // ---- Render ----
  if (loading) {
    return (
      <div style={{ padding: 24, textAlign: 'center' }}>
        <h2>Loading listing data...</h2>
        <h3>If this hangs, your Upstash/Redis connection may be misconfigured.</h3>
      </div>
    );
  }

  if (error) {
    return (
      <div style={{ padding: 24, textAlign: 'center' }}>
        <h2 style={{ color: 'red' }}>{error}</h2>
        <button onClick={() => navigate('/create-listing')}>Go Back</button>
      </div>
    );
  }

  return (
    <div style={{ padding: 24, display: 'grid', gridTemplateColumns: '1fr 360px', gap: 24 }}>
      <main>
        <h1>Your Generated Listing</h1>

        {/* Photos / gallery with reordering */}
        <section style={{ marginBottom: 24 }}>
          <h3>Photos</h3>
          {images.length === 0 ? (
            <div style={{ marginTop: 8, color: '#666' }}>No photos available for this listing.</div>
          ) : (
            <>
              <div
                style={{
                  marginTop: 8,
                  marginBottom: 12,
                  height: 320,
                  borderRadius: 8,
                  overflow: 'hidden',
                  border: '1px solid #ddd',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  background: '#f5f5f5',
                }}
              >
                <img
                  src={images[mainImageIndex]}
                  alt="Main"
                  style={{ maxHeight: '100%', maxWidth: '100%', objectFit: 'contain' }}
                />
              </div>

              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                {images.map((img, idx) => (
                  <div key={idx} style={{ width: 70 }}>
                    <div
                      onClick={() => setMainImageIndex(idx)}
                      style={{
                        borderRadius: 4,
                        overflow: 'hidden',
                        border: idx === mainImageIndex ? '2px solid #0064d2' : '1px solid #ddd',
                        cursor: 'pointer',
                        background: '#fafafa',
                        height: 70,
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                      }}
                    >
                      <img
                        src={img}
                        alt={`Thumb ${idx + 1}`}
                        style={{ maxHeight: '100%', maxWidth: '100%', objectFit: 'cover' }}
                      />
                    </div>
                    <div style={{ display: 'flex', justifyContent: 'center', gap: 4, marginTop: 4 }}>
                      <button
                        type="button"
                        onClick={() => moveImage(idx, idx - 1)}
                        disabled={idx === 0}
                        style={{
                          border: '1px solid #ccc',
                          borderRadius: 3,
                          padding: '0 4px',
