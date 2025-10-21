// src/pages/ResultsPage.tsx
import React, { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';

type Category = { id: string; name: string };
type CategorySuggestion = Category;
type SpecificPair = { name: string; value: string };

type AiData =
  & {
      title?: string;
      description?: string;
      price_suggestion?: { optimal?: number | string };
      image_url?: string;
      category?: Category;
      category_suggestions?: CategorySuggestion[];
      keywords?: string[] | string;
    }
  & (
    | { item_specifics?: Record<string, string> } // object form
    | { item_specifics?: SpecificPair[] }      // array form
  );

function normalizeSpecifics(s: AiData['item_specifics']): SpecificPair[] {
  if (!s) return [];
  if (Array.isArray(s)) {
    // Clean array form
    return s
      .filter(x => x && typeof x.name === 'string')
      .map(x => ({ name: x.name.trim(), value: String(x.value ?? '').trim() }));
  }
  if (typeof s === 'object') {
    // Object form -> array
    return Object.entries(s).map(([name, value]) => ({
      name: name.trim(),
      value: String(value ?? '').trim(),
    }));
  }
  // Unexpected -> empty
  return [];
}

export default function ResultsPage() {
  const navigate = useNavigate();

  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [price, setPrice] = useState('0.00');
  const [imageUrl, setImageUrl] = useState('');
  const [keywords, setKeywords] = useState('');
  const [category, setCategory] = useState<Category | null>(null);
  const [categorySuggestions, setCategorySuggestions] = useState<CategorySuggestion[]>([]);
  const [specifics, setSpecifics] = useState<SpecificPair[]>([]);

  // Read once on mount
  useEffect(() => {
    // Check for session ID in URL first
    const urlParams = new URLSearchParams(window.location.search);
    const sessionId = urlParams.get('session');
    
    if (sessionId) {
      // Fetch data from API
      fetch(`/api/listing-data/${sessionId}`)
        .then(res => {
          if (!res.ok) {
            throw new Error('Failed to fetch data');
          }
          return res.json();
        })
        .then(data => {
          console.log('Received data from API:', data);
          
          // --- THIS IS THE FIX ---
          // Access all data from the nested 'analysis' object
          const analysis = data.analysis || {}; // Use 'analysis' or an empty object

          setTitle(analysis.title ?? '');
          setDescription(analysis.description ?? '');
          setPrice(
            typeof analysis.price_suggestion?.optimal === 'number'
              ? analysis.price_suggestion.optimal.toFixed(2)
              : (analysis.price_suggestion?.optimal as string) ?? '0.00'
          );
          setImageUrl(analysis.image_url ?? '');
          setCategory(analysis.category ?? null);
          setCategorySuggestions(analysis.category_suggestions ?? []);
          setSpecifics(normalizeSpecifics(analysis.item_specifics));

          const kw = Array.isArray(analysis.keywords) 
            ? analysis.keywords.join(', ') 
            : (analysis.keywords ?? '');
          setKeywords(kw);
          // --- END OF FIX ---

        })
        .catch(error => {
          console.error('Error fetching listing data:', error);
          // Fallback to sessionStorage
          checkSessionStorage();
        });
      return;
    }

    // Fallback to existing sessionStorage logic
    checkSessionStorage();

    function checkSessionStorage() {
      const raw = sessionStorage.getItem('aiListingData');
      if (!raw) {
        navigate('/create-listing', { replace: true });
        return;
      }
      try {
        // This logic also needs to be updated if sessionStorage data
        // has the same 'analysis' wrapper.
        // For now, assuming it's flat as originally written.
        const data: AiData = JSON.parse(raw);

        setTitle(data.title ?? '');
        setDescription(data.description ?? '');
        setPrice(
          typeof data.price_suggestion?.optimal === 'number'
            ? data.price_suggestion.optimal.toFixed(2)
            : (data.price_suggestion?.optimal as string) ?? '0.00'
        );
        setImageUrl(data.image_url ?? '');
        setCategory(data.category ?? null);
        setCategorySuggestions(data.category_suggestions ?? []);
        setSpecifics(normalizeSpecifics((data as any).item_specifics));

        const kw =
          Array.isArray(data.keywords) ? data.keywords.join(', ') : (data.keywords ?? '');
        setKeywords(kw);
      } catch (e) {
        console.error('Bad aiListingData:', e);
      }
    }
  }, [navigate]);

  // Helpers for dynamic specifics
  const updateSpecific = (idx: number, patch: Partial<SpecificPair>) => {
    setSpecifics(prev => {
      const next = [...prev];
      next[idx] = { ...next[idx], ...patch };
      return next;
    });
  };
  const addSpecific = () => setSpecifics(prev => [...prev, { name: '', value: '' }]);
  const removeSpecific = (idx: number) =>
    setSpecifics(prev => prev.filter((_, i) => i !== idx));

  // If you need to send to eBay later as an object:
  const specificsObject = useMemo<Record<string, string>>(() => {
    const obj: Record<string, string> = {};
    for (const s of specifics) {
      if (!s.name.trim()) continue;
      obj[s.name.trim()] = s.value ?? '';
    }
    return obj;
  }, [specifics]);

  return (
    <div style={{ padding: 24, display: 'grid', gridTemplateColumns: '1fr 360px', gap: 24 }}>
      <main>
        <h1>Create eBay Listing</h1>

        <section>
          <h3>Title & Details</h3>
          <input
            placeholder="AI will generate a title here…"
            value={title}
            onChange={e => setTitle(e.target.value)}
            style={{ width: '100%', padding: 12, marginTop: 8 }}
          />
        </section>

        <section style={{ marginTop: 24 }}>
          <h3>Item Details</h3>
          <label>Product Description</label>
          <textarea
            placeholder="AI will generate a description here…"
            value={description}
            onChange={e => setDescription(e.target.value)}
            rows={8}
            style={{ width: '100%', padding: 12, marginTop: 8 }}
          />

          <div style={{ marginTop: 16 }}>
            <h4>Item specifics</h4>
            {specifics.length === 0 && (
              <div style={{ opacity: 0.7, marginBottom: 8 }}>No specifics detected.</div>
            )}
            {specifics.map((s, i) => (
              <div key={i} style={{ display: 'grid', gridTemplateColumns: '1fr 1fr auto', gap: 8, marginBottom: 8 }}>
                <input
                  placeholder="Name (e.g., Brand)"
                  value={s.name}
                  onChange={e => updateSpecific(i, { name: e.target.value })}
                />
                <input
                  placeholder="Value (e.g., Nike)"
                  value={s.value}
                  onChange={e => updateSpecific(i, { value: e.target.value })}
                />
                <button type="button" onClick={() => removeSpecific(i)}>Remove</button>
              </div>
            ))}
            <button type="button" onClick={addSpecific}>+ Add specific</button>
          </div>

          <div style={{ marginTop: 16 }}>
            <label>Keywords</label>
            <input
              placeholder="nike hoodie, therma-fit, black hoodie"
              value={keywords}
              onChange={e => setKeywords(e.D.target.value)}
              style={{ width: '100%', padding: 12, marginTop: 8 }}
            />
          </div>
        </section>

        <section style={{ marginTop: 24 }}>
          <label>Price</label>
          <input
            value={price}
            onChange={e => setPrice(e.target.value)}
            style={{ width: 240, padding: 12, marginTop: 8 }}
          />
        </section>

        <section style={{ marginTop: 24 }}>
          <h4>Category</h4>
          <div style={{ marginBottom: 8 }}>
            <strong>Selected:</strong>{' '}
            {category ? `${category.name} (${category.id})` : 'None'}
          </div>
          {categorySuggestions.length > 0 && (
            <div>
              <div style={{ marginBottom: 6 }}>Suggestions:</div>
              {categorySuggestions.map((c) => (
                <button
                  key={c.id}
                  type="button"
                  onClick={() => setCategory(c)}
                  style={{ marginRight: 6, marginBottom: 6 }}
                >
                  {c.name}
                </button>
              ))}
            </div>
          )}
        </section>
      </main>

      <aside>
        <div style={{ border: '1px solid #ddd', borderRadius: 8, padding: 16 }}>
          <div style={{ height: 180, background: '#f5f5f5', display: 'grid', placeItems: 'center', marginBottom: 12 }}>
            {imageUrl ? <img src={imageUrl} alt="preview" style={{ maxHeight: 180 }} /> : 'Product Photo'}
          </div>
          <div style={{ fontWeight: 600 }}>{title || 'Your Product Title'}</div>
          <div style={{ color: 'crimson', fontWeight: 700, fontSize: 20 }}>US ${price || '0.00'}</div>
        </div>
      </aside>
    </div>
  );
}
