// src/pages/ListingStyleSettingsPage.tsx
import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';

type ListingStyleSettings = {
  useCustomStyle: boolean;
  titleInstructions: string;
  descriptionInstructions: string;
  keywordsInstructions: string;
  itemSpecificsInstructions: string;
  globalInstructions: string;
};

const emptySettings: ListingStyleSettings = {
  useCustomStyle: false,
  titleInstructions: '',
  descriptionInstructions: '',
  keywordsInstructions: '',
  itemSpecificsInstructions: '',
  globalInstructions: '',
};

export default function ListingStyleSettingsPage() {
  const navigate = useNavigate();

  const [settings, setSettings] = useState<ListingStyleSettings>(emptySettings);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [savedMessage, setSavedMessage] = useState<string | null>(null);

  // Load existing settings on mount
  useEffect(() => {
    let cancelled = false;

    const loadSettings = async () => {
      setLoading(true);
      setError(null);
      setSavedMessage(null);

      try {
        const res = await fetch('/api/listing-style-settings', {
          method: 'GET',
          headers: { 'Content-Type': 'application/json' },
        });

        if (res.status === 404) {
          // No settings saved yet – use defaults
          if (!cancelled) {
            setSettings(emptySettings);
            setLoading(false);
          }
          return;
        }

        if (!res.ok) {
          throw new Error(await res.text());
        }

        const data = await res.json();

        const merged: ListingStyleSettings = {
          ...emptySettings,
          ...data,
        };

        if (!cancelled) {
          setSettings(merged);
          setLoading(false);
        }
      } catch (err: any) {
        console.error('Error loading listing style settings:', err);
        if (!cancelled) {
          setError(err?.message || 'Failed to load settings');
          setLoading(false);
        }
      }
    };

    loadSettings();

    return () => {
      cancelled = true;
    };
  }, []);

  const handleChange =
    (field: keyof ListingStyleSettings) =>
    (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
      const value =
        e.target.type === 'checkbox'
          ? (e.target as HTMLInputElement).checked
          : e.target.value;

      setSettings((prev) => ({
        ...prev,
        [field]: value,
      }));
      setSavedMessage(null);
      setError(null);
    };

  const handleSave = async () => {
    setSaving(true);
    setError(null);
    setSavedMessage(null);

    try {
      const res = await fetch('/api/listing-style-settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(settings),
      });

      if (!res.ok) {
        const text = await res.text();
        throw new Error(text || 'Failed to save settings');
      }

      setSavedMessage('Your listing style settings have been saved.');
    } catch (err: any) {
      console.error('Error saving listing style settings:', err);
      setError(err?.message || 'Failed to save settings');
    } finally {
      setSaving(false);
    }
  };

  const handleResetLocal = () => {
    setSettings(emptySettings);
    setSavedMessage(null);
    setError(null);
  };

  if (loading) {
    return (
      <div style={{ padding: 24 }}>
        <h1>Listing Style Settings</h1>
        <p>Loading your settings…</p>
      </div>
    );
  }

  return (
    <div style={{ padding: 24, maxWidth: 960, margin: '0 auto' }}>
      <button
        onClick={() => navigate(-1)}
        style={{
          marginBottom: 16,
          padding: '6px 12px',
          borderRadius: 4,
          border: '1px solid #ddd',
          background: '#f8f8f8',
          fontSize: 13,
          cursor: 'pointer',
        }}
      >
        ← Back
      </button>

      <h1 style={{ fontSize: 24, marginBottom: 8 }}>Listing Style Settings</h1>
      <p style={{ color: '#555', marginBottom: 24 }}>
        Tell the AI exactly how <strong>you</strong> like your titles,
        descriptions, and keywords. We’ll pass these instructions into ChatGPT
        every time we build a listing for you.
      </p>

      {/* Use custom style toggle */}
      <div
        style={{
          padding: 16,
          borderRadius: 8,
          border: '1px solid #ddd',
          marginBottom: 24,
          background: '#f7fbff',
        }}
      >
        <label style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <input
            type="checkbox"
            checked={settings.useCustomStyle}
            onChange={handleChange('useCustomStyle')}
          />
          <span style={{ fontWeight: 600 }}>
            Use my custom listing style for future listings
          </span>
        </label>
        <p style={{ fontSize: 13, color: '#555', marginTop: 8 }}>
          When this is turned on, your instructions below will override the
          default Snaplist prompt. You can still edit each listing individually
          after generation.
        </p>
      </div>

      {/* Title instructions */}
      <section style={{ marginBottom: 24 }}>
        <h2 style={{ fontSize: 18, marginBottom: 4 }}>Title rules</h2>
        <p style={{ fontSize: 13, color: '#555', marginBottom: 8 }}>
          Example: “Always start with brand, then gender, then item, then key
          features. Use all 80 characters when possible. Don’t include emojis or
          condition. Always include size at the end.”
        </p>
        <textarea
          value={settings.titleInstructions}
          onChange={handleChange('titleInstructions')}
          rows={4}
          style={{
            width: '100%',
            padding: 10,
            fontSize: 14,
            borderRadius: 6,
            border: '1px solid #ccc',
          }}
          placeholder="Describe exactly how you want your titles built…"
        />
      </section>

      {/* Description instructions */}
      <section style={{ marginBottom: 24 }}>
        <h2 style={{ fontSize: 18, marginBottom: 4 }}>Description rules</h2>
        <p style={{ fontSize: 13, color: '#555', marginBottom: 8 }}>
          Example: “Short, to the point. 2–3 sentences max. No condition
          statements. Mention fabric only if it’s wool, cashmere, leather or
          silk. No sizing advice.”
        </p>
        <textarea
          value={settings.descriptionInstructions}
          onChange={handleChange('descriptionInstructions')}
          rows={4}
          style={{
            width: '100%',
            padding: 10,
            fontSize: 14,
            borderRadius: 6,
            border: '1px solid #ccc',
          }}
          placeholder="Describe how you want your descriptions written…"
        />
      </section>

      {/* Keywords instructions */}
      <section style={{ marginBottom: 24 }}>
        <h2 style={{ fontSize: 18, marginBottom: 4 }}>SEO keywords rules</h2>
        <p style={{ fontSize: 13, color: '#555', marginBottom: 8 }}>
          Example: “Give 10–15 short search keywords, all lowercase, separated
          by commas on one line. Don’t include style-core aesthetics like
          ‘whimsigoth’ unless explicitly correct.”
        </p>
        <textarea
          value={settings.keywordsInstructions}
          onChange={handleChange('keywordsInstructions')}
          rows={3}
          style={{
            width: '100%',
            padding: 10,
            fontSize: 14,
            borderRadius: 6,
            border: '1px solid #ccc',
          }}
          placeholder="How should we format and choose keywords?"
        />
      </section>

      {/* Item specifics instructions */}
      <section style={{ marginBottom: 24 }}>
        <h2 style={{ fontSize: 18, marginBottom: 4 }}>Item specifics rules</h2>
        <p style={{ fontSize: 13, color: '#555', marginBottom: 8 }}>
          Example: “Always prioritize brand, size, color, material and style.
          Do not guess if uncertain. Prefer eBay dropdown values over free
          text. Leave blank instead of hallucinating.”
        </p>
        <textarea
          value={settings.itemSpecificsInstructions}
          onChange={handleChange('itemSpecificsInstructions')}
          rows={3}
          style={{
            width: '100%',
            padding: 10,
            fontSize: 14,
            borderRadius: 6,
            border: '1px solid #ccc',
          }}
          placeholder="Anything special about how you want specifics filled in?"
        />
      </section>

      {/* Global / overall instructions */}
      <section style={{ marginBottom: 24 }}>
        <h2 style={{ fontSize: 18, marginBottom: 4 }}>Global instructions</h2>
        <p style={{ fontSize: 13, color: '#555', marginBottom: 8 }}>
          Example: “Do not mention condition or shipping in the description
          (I have a standard block). Never invent measurements. Default gender
          to WOMENS unless clearly mens or kids.”
        </p>
        <textarea
          value={settings.globalInstructions}
          onChange={handleChange('globalInstructions')}
          rows={4}
          style={{
            width: '100%',
            padding: 10,
            fontSize: 14,
            borderRadius: 6,
            border: '1px solid #ccc',
          }}
          placeholder="Any other standing rules you want the AI to follow for every listing?"
        />
      </section>

      {/* Error / success messages */}
      {error && (
        <div
          style={{
            marginBottom: 12,
            padding: 10,
            borderRadius: 6,
            border: '1px solid #f5c2c7',
            background: '#f8d7da',
            color: '#842029',
            fontSize: 13,
          }}
        >
          {error}
        </div>
      )}
      {savedMessage && (
        <div
          style={{
            marginBottom: 12,
            padding: 10,
            borderRadius: 6,
            border: '1px solid #c3e6cb',
            background: '#d4edda',
            color: '#155724',
            fontSize: 13,
          }}
        >
          {savedMessage}
        </div>
      )}

      {/* Actions */}
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12 }}>
        <button
          type="button"
          onClick={handleResetLocal}
          style={{
            padding: '10px 20px',
            borderRadius: 4,
            border: '1px solid #ddd',
            background: '#f5f5f5',
            fontSize: 14,
            cursor: 'pointer',
          }}
        >
          Reset fields (local)
        </button>

        <div style={{ display: 'flex', gap: 8 }}>
          <button
            type="button"
            onClick={() => navigate(-1)}
            style={{
              padding: '10px 20px',
              borderRadius: 4,
              border: '1px solid #ddd',
              background: '#f5f5f5',
              fontSize: 14,
              cursor: 'pointer',
            }}
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleSave}
            disabled={saving}
            style={{
              padding: '10px 24px',
              borderRadius: 4,
              border: 'none',
              background: saving ? '#888' : '#0064d2',
              color: 'white',
              fontSize: 14,
              fontWeight: 600,
              cursor: saving ? 'default' : 'pointer',
            }}
          >
            {saving ? 'Saving…' : 'Save settings'}
          </button>
        </div>
      </div>
    </div>
  );
}
