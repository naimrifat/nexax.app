// src/pages/ListingStyleSettingsPage.tsx
import React, { useEffect, useState } from 'react';

const STORAGE_KEY = 'listing_style_settings_v1';

type ListingStyleSettings = {
  titleStyle: string;
  descriptionStyle: string;
  keywordsStyle: string;
  extraNotes: string;
};

const defaultSettings: ListingStyleSettings = {
  titleStyle:
    'Explain how you want titles built. Example: "Brand + Gender + Item Type + Key Features + Size (80 chars max, no fluff)".',
  descriptionStyle:
    'Explain how you want descriptions structured. Example: short bullet list, then condition sentence, then measurements reminder.',
  keywordsStyle:
    'Explain how you want SEO keywords formatted. Example: "comma-separated, no hashtags, no duplicates".',
  extraNotes:
    'Any extra instructions for how ChatGPT should write your listings (tone, phrases to avoid, marketplaces, etc.).',
};

const ListingStyleSettingsPage: React.FC = () => {
  const [titleStyle, setTitleStyle] = useState('');
  const [descriptionStyle, setDescriptionStyle] = useState('');
  const [keywordsStyle, setKeywordsStyle] = useState('');
  const [extraNotes, setExtraNotes] = useState('');

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [savedMessage, setSavedMessage] = useState<string | null>(null);

  // Load existing settings from localStorage
  useEffect(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        const data: ListingStyleSettings = JSON.parse(raw);
        setTitleStyle(data.titleStyle || '');
        setDescriptionStyle(data.descriptionStyle || '');
        setKeywordsStyle(data.keywordsStyle || '');
        setExtraNotes(data.extraNotes || '');
      } else {
        // first time – show empty, but user sees placeholders
        setTitleStyle('');
        setDescriptionStyle('');
        setKeywordsStyle('');
        setExtraNotes('');
      }
    } catch (e) {
      console.error('Failed to load listing style settings:', e);
    } finally {
      setLoading(false);
    }
  }, []);

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setSavedMessage(null);

    const payload: ListingStyleSettings = {
      titleStyle: titleStyle.trim(),
      descriptionStyle: descriptionStyle.trim(),
      keywordsStyle: keywordsStyle.trim(),
      extraNotes: extraNotes.trim(),
    };

    try {
      // For now: save locally. Later we can replace this with an API call.
      localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
      setSavedMessage('Listing style saved. New listings will follow these instructions.');
    } catch (err) {
      console.error('Failed to save listing style settings:', err);
      setSavedMessage('Error saving settings. Check console for details.');
    } finally {
      setSaving(false);
      setTimeout(() => setSavedMessage(null), 4000);
    }
  };

  if (loading) {
    return (
      <div className="container mx-auto px-4 py-10">
        <h1 className="text-2xl font-semibold mb-4">Listing Style</h1>
        <p className="text-gray-500">Loading your settings…</p>
      </div>
    );
  }

  return (
    <div className="container mx-auto px-4 py-10 max-w-3xl">
      <div className="mb-6">
        <h1 className="text-2xl md:text-3xl font-semibold text-gray-900 mb-2">
          Listing Style Settings
        </h1>
        <p className="text-gray-600 text-sm md:text-base">
          Tell SnapLine exactly how you want your titles, descriptions, and SEO keywords built.
          Future listings will follow these instructions on top of our core logic.
        </p>
      </div>

      <form onSubmit={handleSave} className="space-y-6">
        {/* Title style */}
        <div>
          <div className="flex items-center justify-between mb-1">
            <label className="block text-sm font-medium text-gray-800">
              Title instructions
            </label>
            <span className="text-xs text-gray-400">Used for eBay titles</span>
          </div>
          <textarea
            className="w-full mt-1 px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-2 focus:ring-teal-500 text-sm"
            rows={4}
            placeholder={defaultSettings.titleStyle}
            value={titleStyle}
            onChange={(e) => setTitleStyle(e.target.value)}
          />
          <p className="mt-1 text-xs text-gray-500">
            Example: “Always start with Brand, then Gender, then Item Type, then 2–3 key features,
            then size at the end. Never use emojis. Keep under 80 characters.”
          </p>
        </div>

        {/* Description style */}
        <div>
          <div className="flex items-center justify-between mb-1">
            <label className="block text-sm font-medium text-gray-800">
              Description instructions
            </label>
            <span className="text-xs text-gray-400">Used for main listing description</span>
          </div>
          <textarea
            className="w-full mt-1 px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-2 focus:ring-teal-500 text-sm"
            rows={5}
            placeholder={defaultSettings.descriptionStyle}
            value={descriptionStyle}
            onChange={(e) => setDescriptionStyle(e.target.value)}
          />
          <p className="mt-1 text-xs text-gray-500">
            Example: “Start with a 1–2 sentence hook, then 3–5 bullets (brand, size, color, key
            features), then a short condition note, then a call to check measurements.”
          </p>
        </div>

        {/* Keywords style */}
        <div>
          <div className="flex items-center justify-between mb-1">
            <label className="block text-sm font-medium text-gray-800">
              SEO keywords instructions
            </label>
            <span className="text-xs text-gray-400">Used for keyword list / tags</span>
          </div>
          <textarea
            className="w-full mt-1 px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-2 focus:ring-teal-500 text-sm"
            rows={4}
            placeholder={defaultSettings.keywordsStyle}
            value={keywordsStyle}
            onChange={(e) => setKeywordsStyle(e.target.value)}
          />
          <p className="mt-1 text-xs text-gray-500">
            Example: “Comma-separated list, no duplicates, no brand if already in title, no
            copyrighted names, no emojis or hashtags.”
          </p>
        </div>

        {/* Extra notes */}
        <div>
          <div className="flex items-center justify-between mb-1">
            <label className="block text-sm font-medium text-gray-800">
              Extra global instructions (optional)
            </label>
            <span className="text-xs text-gray-400">Applied to everything</span>
          </div>
          <textarea
            className="w-full mt-1 px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-2 focus:ring-teal-500 text-sm"
            rows={4}
            placeholder={defaultSettings.extraNotes}
            value={extraNotes}
            onChange={(e) => setExtraNotes(e.target.value)}
          />
          <p className="mt-1 text-xs text-gray-500">
            Example: “Write in a friendly but professional tone. No all caps. Never mention AI.
            Don’t guess measurements – only use what’s provided.”
          </p>
        </div>

        {/* Actions */}
        <div className="flex items-center justify-between pt-4 border-t border-gray-200">
          {savedMessage && (
            <div className="text-xs text-teal-700 bg-teal-50 px-3 py-1 rounded-md">
              {savedMessage}
            </div>
          )}
          <div className="ml-auto flex gap-2">
            <button
              type="button"
              className="btn btn-outline"
              onClick={() => {
                setTitleStyle('');
                setDescriptionStyle('');
                setKeywordsStyle('');
                setExtraNotes('');
              }}
            >
              Reset fields
            </button>
            <button
              type="submit"
              className={`btn btn-primary ${saving ? 'opacity-70 cursor-wait' : ''}`}
              disabled={saving}
            >
              {saving ? 'Saving…' : 'Save style'}
            </button>
          </div>
        </div>
      </form>
    </div>
  );
};

export default ListingStyleSettingsPage;
