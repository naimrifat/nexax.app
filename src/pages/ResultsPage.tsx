// src/pages/ResultsPage.tsx
import React, {
  useEffect,
  useMemo,
  useState,
  useCallback,
  useRef,
} from 'react';
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
  category?: CategoryWithPath;
  category_suggestions?: Category[];
  item_specifics?: ItemSpecific[] | Record<string, string>;
  keywords?: string[] | string;
  detected?: AiDetected;
};

function normalizeSpecifics(s: AiData['item_specifics']): ItemSpecific[] {
  if (!s) return [];
  if (Array.isArray(s)) {
    return s.filter((x) => x && typeof x.name === 'string');
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
  const [imageUrl, setImageUrl] = useState('');
  const [keywords, setKeywords] = useState('');
  const [category, setCategory] = useState<CategoryWithPath | null>(null);
  const [categorySuggestions, setCategorySuggestions] = useState<Category[]>(
    []
  );
  const [specifics, setSpecifics] = useState<ItemSpecific[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showCategoryModal, setShowCategoryModal] = useState(false);
  const [loadingSpecifics, setLoadingSpecifics] = useState(false);

  // AI-detected facts from the analysis
  const aiDetectedRef = useRef<AiDetected>({});

  // Smart mapper (still used when fetching category specifics)
  const smartFillSpecifics = useCallback(
    (newSpecifics: ItemSpecific[], aiData: AiDetected): ItemSpecific[] => {
      return newSpecifics.map((field) => {
        let value = '';
        const fieldLower = field.name.toLowerCase();

        if (fieldLower.includes('brand')) {
          value = aiData.brand || '';
        } else if (fieldLower.includes('size')) {
          value = aiData.size || '';
        } else if (fieldLower.includes('color') || fieldLower.includes('colour')) {
          value = aiData.color || '';
        } else if (fieldLower.includes('condition')) {
          value = aiData.condition || '';
        } else if (fieldLower.includes('material')) {
          value = aiData.material || '';
        } else if (fieldLower.includes('style')) {
          value = aiData.style || '';
        }

        if (
          value &&
          field.type === 'dropdown' &&
          field.options &&
          field.options.length > 0
        ) {
          const matchedOption = field.options.find(
            (opt) => opt.toLowerCase() === value.toLowerCase()
          );
          value = matchedOption || '';
        }

        return { ...field, value };
      });
    },
    []
  );

  // Fetch category specifics
  const fetchCategorySpecifics = useCallback(
    async (categoryId: string) => {
      console.log('🔍 Fetching specifics for category:', categoryId);
      setLoadingSpecifics(true);

      try {
        const response = await fetch('/api/ebay-categories', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            action: 'getCategorySpecifics',
            categoryId: categoryId,
          }),
        });

        if (!response.ok) throw new Error('Failed to fetch category specifics');

        const data = await response.json();
        console.log('✅ Category specifics received:', data);

        const newSpecifics: ItemSpecific[] = (data.aspects || []).map(
          (aspect: any) => ({
            name: aspect.name,
            value: '',
            required: aspect.required || false,
            type: aspect.type === 'SelectionOnly' ? 'dropdown' : 'text',
            options: aspect.values || [],
          })
        );

        const filledSpecifics = smartFillSpecifics(
          newSpecifics,
          aiDetectedRef.current
        );
        setSpecifics(filledSpecifics);
      } catch (error) {
        console.error('❌ Error fetching specifics:', error);
      } finally {
        setLoadingSpecifics(false);
      }
    },
    [smartFillSpecifics]
  );

  // Load initial analysis data (once)
  useEffect(() => {
    let isMounted = true;

    const loadData = async () => {
      console.log('📥 Loading initial data...');
      setLoading(true);

      const urlParams = new URLSearchParams(window.location.search);
      const sessionId = urlParams.get('session');

      if (sessionId) {
        try {
          const res = await fetch(`/api/listing-data/${sessionId}`);
          if (!res.ok) throw new Error('Failed to fetch data from API');

          const data = await res.json();
          console.log('🔍 Received data from API:', data);

          if (!isMounted) return;

          const analysis = data.data || data.analysis || data;
          console.log('📦 Analysis object:', analysis);

          setTitle(analysis.title ?? '');
          setDescription(analysis.description ?? '');
          setPrice(
            typeof analysis.price_suggestion?.optimal === 'number'
              ? analysis.price_suggestion.optimal.toFixed(2)
              : String(analysis.price_suggestion?.optimal ?? '0.00')
          );
          setImageUrl(analysis.image_url ?? '');

          aiDetectedRef.current = analysis.detected || {};

          const kw = Array.isArray(analysis.keywords)
            ? analysis.keywords.join(', ')
            : String(analysis.keywords ?? '');
          setKeywords(kw);

          setCategorySuggestions(analysis.category_suggestions ?? []);

          const initialCategory = analysis.category ?? null;
          setCategory(initialCategory);

          if (initialCategory && initialCategory.id) {
            await fetchCategorySpecifics(initialCategory.id);
          } else {
            setSpecifics(normalizeSpecifics(analysis.item_specifics));
          }

          setLoading(false);
          return;
        } catch (err: any) {
          console.error('❌ Error fetching from API:', err);
          if (isMounted) {
            setError(err.message || 'Failed to load data');
            setLoading(false);
          }
          return;
        }
      }

      // Fallback: sessionStorage
      const raw = sessionStorage.getItem('aiListingData');
      if (!raw) {
        navigate('/create-listing', { replace: true });
        return;
      }

      try {
        const data: AiData = JSON.parse(raw);
        const analysis = (data as any).data || (data as any).analysis || data;

        if (!isMounted) return;

        setTitle(analysis.title ?? '');
        setDescription(analysis.description ?? '');
        setPrice(
          typeof analysis.price_suggestion?.optimal === 'number'
            ? analysis.price_suggestion.optimal.toFixed(2)
            : String(analysis.price_suggestion?.optimal ?? '0.00')
        );
        setImageUrl(analysis.image_url ?? '');

        aiDetectedRef.current = analysis.detected || {};

        const kw = Array.isArray(analysis.keywords)
          ? analysis.keywords.join(', ')
          : String(analysis.keywords ?? '');
        setKeywords(kw);

        setCategorySuggestions(analysis.category_suggestions ?? []);

        const initialCategory = analysis.category ?? null;
        setCategory(initialCategory);

        if (initialCategory && initialCategory.id) {
          await fetchCategorySpecifics(initialCategory.id);
        } else {
          setSpecifics(normalizeSpecifics(analysis.item_specifics));
        }

        setLoading(false);
      } catch (e: any) {
        console.error('❌ Failed to parse data:', e);
        if (isMounted) {
          setError('Failed to load listing data');
          setLoading(false);
        }
      }
    };

    loadData();

    return () => {
      isMounted = false;
      console.log('🧹 ResultsPage unmount');
    };
  }, [navigate, fetchCategorySpecifics]);

  // Category change
  const handleCategorySelect = async (newCategory: CategoryWithPath) => {
    console.log('🔄 Category changed to:', newCategory);
    setCategory(newCategory);
    setShowCategoryModal(false);
    await fetchCategorySpecifics(newCategory.id);
  };

  const updateSpecific = (idx: number, value: string) => {
    setSpecifics((prev) => {
      const next = [...prev];
      next[idx] = { ...next[idx], value };
      return next;
    });
  };

  const addSpecific = () =>
    setSpecifics((prev) => [...prev, { name: '', value: '' }]);

  const removeSpecific = (idx: number) =>
    setSpecifics((prev) => prev.filter((_, i) => i !== idx));

  const categoryBreadcrumb = useMemo(() => {
    if (!category) return 'No category selected';
    if (category.path) return category.path;
    if (category.breadcrumbs) return category.breadcrumbs.join(' > ');
    return category.name;
  }, [category]);

  // 🔴 THIS is what talks to /api/publish-listing
  const handlePublish = async () => {
    try {
      if (!title.trim()) {
        alert('Please enter a title before publishing.');
        return;
      }
      if (!description.trim()) {
        alert('Please enter a description before publishing.');
        return;
      }
      if (!category) {
        alert('Please select a category before publishing.');
        return;
      }
      if (!imageUrl) {
        alert('Please upload at least one image before publishing.');
        return;
      }

      const payload = {
        title: title.trim(),
        description: description.trim(),
        price: parseFloat(price || '0') || 0,
        currency: 'USD',
        quantity: 1,
        category: {
          id: category.id,
          name: category.name,
          path: category.path ?? categoryBreadcrumb,
        },
        item_specifics: specifics
          .filter((s) => s.name && String(s.value ?? '').trim() !== '')
          .map((s) => ({ name: s.name, value: s.value })),
        image_urls: [imageUrl],
      };

      console.log('📤 Publishing payload:', payload);

      const res = await fetch('/api/publish-listing', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      const data = await res.json();
      console.log('📥 publish-listing response:', data);

      if (!res.ok || !data.success) {
        alert(`An error occurred: ${JSON.stringify(data)}`);
        return;
      }

      alert('Listing payload accepted by server (stub).');
    } catch (err: any) {
      console.error('❌ handlePublish error:', err);
      alert(`Unexpected error: ${err?.message || String(err)}`);
    }
  };

  if (loading) {
    return (
      <div style={{ padding: 24, textAlign: 'center' }}>
        <h2>Loading listing data...</h2>
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
    <div
      style={{
        padding: 24,
        display: 'grid',
        gridTemplateColumns: '1fr 360px',
        gap: 24,
      }}
    >
      <main>
        <h1>Create eBay Listing</h1>

        <section>
          <h3>Title</h3>
          <input
            placeholder="Enter title..."
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            style={{ width: '100%', padding: 12, marginTop: 8, fontSize: 14 }}
            maxLength={80}
          />
          <div
            style={{
              fontSize: 12,
              color: '#666',
              marginTop: 4,
              textAlign: 'right',
            }}
          >
            {title.length}/80 characters
          </div>
        </section>

        <section style={{ marginTop: 24 }}>
          <h3>Category</h3>
          <div
            style={{
              border: '1px solid #ddd',
              borderRadius: 4,
              padding: 12,
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              background: '#f9f9f9',
              marginTop: 8,
            }}
          >
            <div
              style={{ flex: 1, marginRight: 12, overflow: 'hidden' }}
            >
              <div
                style={{ fontSize: 12, color: '#666', marginBottom: 4 }}
              >
                Selected Category:
              </div>
              <div
                style={{
                  fontWeight: 500,
                  fontSize: 14,
                  whiteSpace: 'nowrap',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                }}
              >
                {categoryBreadcrumb}
              </div>
            </div>
            <button
              type="button"
              onClick={() => setShowCategoryModal(true)}
              style={{
                padding: '8px 16px',
                background: '#0064d2',
                color: 'white',
                border: 'none',
                borderRadius: 4,
                cursor: 'pointer',
                fontSize: 14,
                flexShrink: 0,
              }}
            >
              Change
            </button>
          </div>
        </section>

        <section style={{ marginTop: 24 }}>
          <h3>
            Item Specifics{' '}
            {loadingSpecifics && (
              <span style={{ fontSize: 14, color: '#666' }}>
                (Loading...)
              </span>
            )}
          </h3>
          {specifics.length === 0 && !loadingSpecifics && (
            <div style={{ opacity: 0.7, marginTop: 8 }}>
              No specifics loaded. Select a category first.
            </div>
          )}
          {specifics.map((spec, i) => (
            <div key={i} style={{ marginTop: 12 }}>
              <label
                style={{
                  display: 'block',
                  marginBottom: 4,
                  fontSize: 14,
                  fontWeight: 500,
                }}
              >
                {spec.name}
                {spec.required && (
                  <span style={{ color: 'red', marginLeft: 4 }}>*</span>
                )}
              </label>
              {spec.type === 'dropdown' &&
              spec.options &&
              spec.options.length > 0 ? (
                <select
                  value={spec.value}
                  onChange={(e) => updateSpecific(i, e.target.value)}
                  style={{
                    width: '100%',
                    padding: 10,
                    fontSize: 14,
                    borderRadius: 4,
                    border: '1px solid #ddd',
                  }}
                >
                  <option value="">Select {spec.name}</option>
                  {spec.options.map((opt, idx) => (
                    <option key={idx} value={opt}>
                      {opt}
                    </option>
                  ))}
                </select>
              ) : (
                <input
                  type="text"
                  placeholder={`Enter ${spec.name}`}
                  value={spec.value}
                  onChange={(e) => updateSpecific(i, e.target.value)}
                  style={{
                    width: '100%',
                    padding: 10,
                    fontSize: 14,
                    borderRadius: 4,
                    border: '1px solid #ddd',
                  }}
                />
              )}
            </div>
          ))}
          <button
            type="button"
            onClick={addSpecific}
            style={{ marginTop: 12, padding: '8px 16px', fontSize: 14 }}
          >
            + Add Custom Specific
          </button>
        </section>

        <section style={{ marginTop: 24 }}>
          <h3>Description</h3>
          <textarea
            placeholder="Enter description..."
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            rows={8}
            style={{ width: '100%', padding: 12, marginTop: 8, fontSize: 14 }}
          />
        </section>

        <section style={{ marginTop: 24 }}>
          <h3>Keywords</h3>
          <input
            placeholder="e.g., vintage, designer, rare"
            value={keywords}
            onChange={(e) => setKeywords(e.target.value)}
            style={{ width: '100%', padding: 12, marginTop: 8, fontSize: 14 }}
          />
        </section>

        <section style={{ marginTop: 24 }}>
          <h3>Price</h3>
          <input
            type="number"
            step="0.01"
            value={price}
            onChange={(e) => setPrice(e.target.value)}
            style={{ width: 240, padding: 12, marginTop: 8, fontSize: 14 }}
          />
        </section>

        <div style={{ marginTop: 32, display: 'flex', gap: 12 }}>
          <button
            onClick={handlePublish}
            style={{
              padding: '12px 32px',
              background: '#0064d2',
              color: 'white',
              border: 'none',
              borderRadius: 4,
              cursor: 'pointer',
              fontSize: 16,
              fontWeight: 600,
            }}
          >
            Publish to eBay
          </button>
          <button
            onClick={() => navigate('/create-listing')}
            style={{
              padding: '12px 32px',
              background: '#f0f0f0',
              color: '#333',
              border: '1px solid #ddd',
              borderRadius: 4,
              cursor: 'pointer',
              fontSize: 16,
            }}
          >
            Cancel
          </button>
        </div>
      </main>

      <aside>
        <div
          style={{
            border: '1px solid #ddd',
            borderRadius: 8,
            padding: 16,
            position: 'sticky',
            top: 24,
          }}
        >
          <h4 style={{ marginTop: 0, marginBottom: 12 }}>Preview</h4>
          <div
            style={{
              height: 200,
              background: '#f5f5f5',
              display: 'grid',
              placeItems: 'center',
              marginBottom: 12,
              borderRadius: 4,
            }}
          >
            {imageUrl ? (
              <img
                src={imageUrl}
                alt="preview"
                style={{ maxHeight: 200, maxWidth: '100%', borderRadius: 4 }}
              />
            ) : (
              <div style={{ color: '#999' }}>No image</div>
            )}
          </div>
          <div
            style={{
              fontWeight: 600,
              fontSize: 14,
              marginBottom: 8,
            }}
          >
            {title || 'Your Product Title'}
          </div>
          <div
            style={{
              color: '#c93',
              fontWeight: 700,
              fontSize: 20,
            }}
          >
            US ${price || '0.00'}
          </div>
          <div
            style={{
              fontSize: 12,
              color: '#666',
              marginTop: 8,
            }}
          >
            Category: {category?.name || 'Not selected'}
          </div>
        </div>
      </aside>

      {showCategoryModal && (
        <CategorySelectorModal
          currentCategory={category}
          suggestions={categorySuggestions}
          onSelect={handleCategorySelect}
          onClose={() => setShowCategoryModal(false)}
        />
      )}
    </div>
  );
}

function CategorySelectorModal({
  currentCategory,
  suggestions,
  onSelect,
  onClose,
}: {
  currentCategory: CategoryWithPath | null;
  suggestions: Category[];
  onSelect: (cat: CategoryWithPath) => void;
  onClose: () => void;
}) {
  return (
    <div
      style={{
        position: 'fixed',
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        background: 'rgba(0,0,0,0.5)',
        display: 'grid',
        placeItems: 'center',
        zIndex: 1000,
      }}
    >
      <div
        style={{
          background: 'white',
          borderRadius: 8,
          padding: 24,
          maxWidth: 600,
          width: '90%',
          maxHeight: '80vh',
          overflow: 'auto',
        }}
      >
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            marginBottom: 16,
          }}
        >
          <h3 style={{ margin: 0 }}>Select Category</h3>
          <button
            onClick={onClose}
            style={{
              background: 'none',
              border: 'none',
              fontSize: 24,
              cursor: 'pointer',
              padding: 0,
              width: 32,
              height: 32,
            }}
          >
            ×
          </button>
        </div>

        <div
          style={{
            marginBottom: 16,
            padding: 12,
            background: '#f0f8ff',
            borderRadius: 4,
          }}
        >
          <div
            style={{ fontSize: 12, color: '#666', marginBottom: 4 }}
          >
            Current Category:
          </div>
          <div style={{ fontWeight: 600 }}>
            {currentCategory
              ? currentCategory.path || currentCategory.name
              : 'None'}
          </div>
        </div>

        <h4 style={{ marginTop: 24, marginBottom: 12 }}>
          Suggested Categories:
        </h4>
        {suggestions.length === 0 ? (
          <div style={{ color: '#666', fontStyle: 'italic' }}>
            No suggestions available
          </div>
        ) : (
          <div>
            {suggestions.map((cat) => (
              <div
                key={cat.id}
                onClick={() => onSelect(cat as CategoryWithPath)}
                style={{
                  padding: 12,
                  border: '1px solid #ddd',
                  borderRadius: 4,
                  marginBottom: 8,
                  cursor: 'pointer',
                  background:
                    currentCategory?.id === cat.id ? '#e3f2fd' : 'white',
                  transition: 'background 0.2s',
                }}
                onMouseEnter={(e) =>
                  (e.currentTarget.style.background = '#f5f5f5')
                }
                onMouseLeave={(e) =>
                  (e.currentTarget.style.background =
                    currentCategory?.id === cat.id ? '#e3f2fd' : 'white')
                }
              >
                <div style={{ fontWeight: 500 }}>{cat.name}</div>
                <div
                  style={{
                    fontSize: 12,
                    color: '#666',
                    marginTop: 4,
                  }}
                >
                  ID: {cat.id}
                </div>
              </div>
            ))}
          </div>
        )}

        <div
          style={{
            marginTop: 24,
            paddingTop: 16,
            borderTop: '1px solid #ddd',
            fontSize: 14,
            color: '#666',
          }}
        >
          💡 Tip: Selecting a category will automatically load its required item
          specifics
        </div>
      </div>
    </div>
  );
}
