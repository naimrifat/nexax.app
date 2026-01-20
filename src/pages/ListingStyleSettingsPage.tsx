// src/pages/ListingStyleSettingsPage.tsx
import React, { useEffect, useState } from 'react';
import { Save, Settings2 } from 'lucide-react';
import { supabase } from '../../lib/supabaseClient';
import { useAuth } from '../context/AuthContext';

type ListingStyleSettings = {
  useCustomStyle: boolean;
  titleInstructions: string;
  descriptionInstructions: string;
  extraNotes: string;
};

const STORAGE_KEY = 'listingStyleSettings';

const defaultSettings: ListingStyleSettings = {
  useCustomStyle: false,
  titleInstructions: '',
  descriptionInstructions: '',
  extraNotes: '',
};

const MAX_TITLE = 800;
const MAX_DESCRIPTION = 1200;
const MAX_EXTRA = 800;

function trimAndClip(v: unknown, max: number): string {
  const s = String(v ?? '').trim();
  if (s.length <= max) return s;
  return s.slice(0, max);
}

const ListingStyleSettingsPage: React.FC = () => {
  const { workspaceId } = useAuth();
  const [settings, setSettings] = useState<ListingStyleSettings>(defaultSettings);
  const [saving, setSaving] = useState(false);
  const [savedAt, setSavedAt] = useState<string | null>(null);


  // Load existing settings from Supabase (fallback to localStorage)
  useEffect(() => {
    let cancelled = false;

    const load = async () => {
      // 1) Local fallback (fast)
      try {
        const raw = window.localStorage.getItem(STORAGE_KEY);
        if (raw) {
          const parsed = JSON.parse(raw);
          if (!cancelled) {
            setSettings({
              ...defaultSettings,
              ...parsed,
            });
          }
        }
      } catch (err) {
        console.error('Failed to load listing style settings:', err);
      }

      // 2) Workspace-scoped source of truth
      const wsId = String(workspaceId || '').trim();
      if (!wsId) return;

      try {
        const q = await supabase
          .from('workspace_listing_style')
          .select('enabled,title_instructions,description_instructions,extra_rules,updated_at')
          .eq('workspace_id', wsId)
          .maybeSingle();

        if (q.error) throw q.error;
        const row: any = q.data || null;
        if (!row) return;

        const next: ListingStyleSettings = {
          useCustomStyle: Boolean(row.enabled),
          titleInstructions: String(row.title_instructions || ''),
          descriptionInstructions: String(row.description_instructions || ''),
          extraNotes: String(row.extra_rules || ''),
        };

        // Mirror to localStorage so generation can start quickly.
        try {
          window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
        } catch {
          // ignore
        }

        if (!cancelled) {
          setSettings(next);
          if (row.updated_at) {
            try {
              setSavedAt(new Date(String(row.updated_at)).toLocaleString());
            } catch {
              // ignore
            }
          }
        }
      } catch (err) {
        console.error('Failed to load listing style settings from Supabase:', err);
      }
    };

    load();

    return () => {
      cancelled = true;
    };
  }, [workspaceId]);

  const handleChange = <K extends keyof ListingStyleSettings>(
    key: K,
    value: ListingStyleSettings[K],
  ) => {
    setSettings((prev) => ({
      ...prev,
      [key]: value,
    }));
  };

  const handleSave = async () => {
    try {
      setSaving(true);

      const cleaned: ListingStyleSettings = {
        useCustomStyle: Boolean(settings.useCustomStyle),
        titleInstructions: trimAndClip(settings.titleInstructions, MAX_TITLE),
        descriptionInstructions: trimAndClip(settings.descriptionInstructions, MAX_DESCRIPTION),
        extraNotes: trimAndClip(settings.extraNotes, MAX_EXTRA),
      };

      // Always mirror to localStorage (fast path for generation)
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(cleaned));

      const wsId = String(workspaceId || '').trim();
      if (wsId) {
        const upsertPayload = {
          workspace_id: wsId,
          enabled: cleaned.useCustomStyle,
          title_instructions: cleaned.titleInstructions,
          description_instructions: cleaned.descriptionInstructions,
          extra_rules: cleaned.extraNotes,
        };

        const up = await supabase.from('workspace_listing_style').upsert(upsertPayload, { onConflict: 'workspace_id' });
        if (up.error) throw up.error;
      }

      const ts = new Date().toLocaleString();
      setSavedAt(ts);
      setSettings(cleaned);
    } catch (err) {
      console.error('Failed to save listing style settings:', err);
      alert('Failed to save your settings. Check the console for details.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="min-h-screen bg-gray-50 py-10">
      <div className="container mx-auto px-4 max-w-4xl">
        <div className="mb-8 flex items-center gap-3">
          <div className="p-2 rounded-lg bg-teal-100 text-teal-700">
            <Settings2 className="w-6 h-6" />
          </div>
          <div>
            <h1 className="text-2xl md:text-3xl font-bold text-gray-900">
              Listing Style Settings
            </h1>
            <p className="text-sm text-gray-600 mt-1">
              Tell the AI exactly how you like your titles and descriptions. 
              You can turn your custom style on or off with a single toggle.
            </p>
          </div>
        </div>

        <div className="card p-6 space-y-6">
          {/* Toggle: Use custom style */}
          <div className="flex items-start justify-between gap-4 border-b pb-4">
            <div>
              <h2 className="text-lg font-semibold text-gray-900">
                Use my custom listing style
              </h2>
              <p className="text-sm text-gray-600 mt-1">
                When this is ON, Nexax.app will follow your instructions for titles and
                descriptions. When it&apos;s OFF, Nexax.app will use the default style.
              </p>
            </div>

            <button
              type="button"
              onClick={() =>
                handleChange('useCustomStyle', !settings.useCustomStyle)
              }
              className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${
                settings.useCustomStyle ? 'bg-teal-500' : 'bg-gray-300'
              }`}
            >
              <span
                className={`inline-block h-5 w-5 transform rounded-full bg-white shadow transition-transform ${
                  settings.useCustomStyle ? 'translate-x-5' : 'translate-x-1'
                }`}
              />
            </button>
          </div>

          {/* Title instructions */}
          <div>
            <label className="block text-sm font-semibold text-gray-700 mb-1">
              Title instructions
            </label>
            <p className="text-xs text-gray-500 mb-2">
              Example: &quot;Always start with brand, then gender, then item type, then
              key features. Max 80 characters. No emojis. Use WOMENS/MENS in all caps.&quot;
            </p>
            <textarea
              className="w-full min-h-[120px] rounded-md border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-teal-500"
              placeholder="Describe exactly how you want your eBay titles to look..."
              value={settings.titleInstructions}
              onChange={(e) =>
                handleChange('titleInstructions', e.target.value)
              }
            />
          </div>

          {/* Description instructions */}
          <div>
            <label className="block text-sm font-semibold text-gray-700 mb-1">
              Description instructions
            </label>
            <p className="text-xs text-gray-500 mb-2">
              Example: &quot;Short bullet points only. No condition statements. 
              Mention fit and key features. Under 800 characters.&quot;
            </p>
            <textarea
              className="w-full min-h-[140px] rounded-md border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-teal-500"
              placeholder="Describe how you want your descriptions structured, tone, what to include/avoid..."
              value={settings.descriptionInstructions}
              onChange={(e) =>
                handleChange('descriptionInstructions', e.target.value)
              }
            />
          </div>

          {/* Extra notes */}
          <div>
            <label className="block text-sm font-semibold text-gray-700 mb-1">
              Extra rules or notes (optional)
            </label>
            <p className="text-xs text-gray-500 mb-2">
              Example: &quot;Never mention country of origin. Don&apos;t describe materials
              unless it&apos;s wool, cashmere, leather, or silk.&quot;
            </p>
            <textarea
              className="w-full min-h-[100px] rounded-md border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-teal-500"
              placeholder="Anything else you want the AI to always follow for your listings..."
              value={settings.extraNotes}
              onChange={(e) => handleChange('extraNotes', e.target.value)}
            />
          </div>

          {/* Footer actions */}
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 pt-2">
            <div className="text-xs text-gray-500">
              {savedAt ? (
                <span>Last saved: {savedAt}</span>
              ) : (
                <span>Changes are stored in this browser for now.</span>
              )}
            </div>
            <button
              type="button"
              onClick={handleSave}
              disabled={saving}
              className="btn bg-teal-600 text-white hover:bg-teal-700 inline-flex items-center justify-center gap-2 w-full sm:w-auto"
            >
              <Save className="w-4 h-4" />
              {saving ? 'Saving...' : 'Save settings'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default ListingStyleSettingsPage;
