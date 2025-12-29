// src/pages/DraftsPage.tsx
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { FileText, Trash2, Edit, Clock, Image as ImageIcon } from 'lucide-react';
import { supabase } from '../../lib/supabaseClient';

type Draft = {
  id: string; // listings.id (uuid)
  title: string;
  description: string;
  categoryPath: string;
  images: string[];
  mainImageIndex: number;
  price: string;
  savedAt: string;
  marketplace: string;
};

type ListingRow = {
  id: string;
  workspace_id: string | null;
  created_by: string | null;
  status: string | null;
  marketplace: string | null;
  title: string | null;
  description: string | null;
  category_path: string | null;
  price: number | null;
  currency: string | null;
  ebay_item_id: string | null;
  ebay_listing_url: string | null;
  listing_json: any; // jsonb
  images: string[] | null; // text[]
  created_at: string | null;
  updated_at: string | null;
};

function safeArray(v: unknown): string[] {
  if (Array.isArray(v)) return v.filter((x) => typeof x === 'string') as string[];
  return [];
}

function toMoneyString(n: unknown, fallback = '0.00'): string {
  if (typeof n === 'number' && Number.isFinite(n)) return n.toFixed(2);
  const parsed = typeof n === 'string' ? Number(n) : NaN;
  if (Number.isFinite(parsed)) return parsed.toFixed(2);
  return fallback;
}

function normalizeDraftFromRow(row: ListingRow): Draft {
  // listing_json is your canonical payload; images is also stored as a top-level column.
  const lj = row.listing_json || {};

  const imagesFromColumn = safeArray(row.images);
  const imagesFromJson = safeArray(lj?.images) || safeArray(lj?.image_urls);
  const images = imagesFromColumn.length ? imagesFromColumn : imagesFromJson;

  // Prefer explicit mainImageIndex from listing_json.
  // If invalid, default to 0.
  const mainImageIndex =
    typeof lj?.mainImageIndex === 'number' && Number.isFinite(lj.mainImageIndex) ? lj.mainImageIndex : 0;

  const savedAt = row.updated_at || row.created_at || new Date().toISOString();

  // Category path: prefer column, fallback to listing_json, then listing_json.category.path
  const categoryPath =
    (row.category_path ?? lj?.category_path ?? lj?.category?.path ?? lj?.category?.breadcrumbs?.join?.(' > ') ?? '') as string;

  return {
    id: row.id,
    title: (row.title ?? lj?.title ?? 'Untitled Draft') as string,
    description: (row.description ?? lj?.description ?? '') as string,
    categoryPath,
    images,
    mainImageIndex,
    price: toMoneyString(row.price ?? lj?.price ?? lj?.price_suggestion?.optimal ?? '0.00', '0.00'),
    savedAt,
    marketplace: (row.marketplace ?? lj?.marketplace ?? 'ebay') as string,
  };
}

export default function DraftsPage() {
  const navigate = useNavigate();

  const [drafts, setDrafts] = useState<Draft[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const fetchDrafts = useCallback(async () => {
    setLoading(true);
    setLoadError(null);

    try {
const { data: userData, error: userErr } = await supabase.auth.getUser();
if (userErr) throw userErr;

const uid = userData?.user?.id;
if (!uid) throw new Error('Not authenticated');
      
      if (!uid) {
        setDrafts([]);
        setLoadError('You must be logged in to view drafts.');
        return;
      }

      // IMPORTANT:
      // - Do NOT select draft_id or data (those columns do not exist in your table)
      // - Use listing_json and images columns (matches your schema screenshots)
      const { data, error } = await supabase
        .from('listings')
        .select(
          'id,workspace_id,created_by,status,marketplace,title,description,category_path,price,currency,ebay_item_id,ebay_listing_url,listing_json,images,created_at,updated_at'
        )
        .eq('status', 'draft')
        .order('updated_at', { ascending: false, nullsFirst: false });

      if (error) throw error;

      const rows = (data ?? []) as ListingRow[];
      const normalized = rows
        .map(normalizeDraftFromRow)
        .sort((a, b) => new Date(b.savedAt).getTime() - new Date(a.savedAt).getTime());

      setDrafts(normalized);
    } catch (e: any) {
      console.error('[DraftsPage] Failed to load drafts:', e);
      setDrafts([]);
      setLoadError(e?.message || 'Failed to load drafts.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchDrafts();
  }, [fetchDrafts]);

  const handleEditDraft = useCallback(
    (draftId: string) => {
      // Canonical: edit by DB row id
      navigate(`/results?mode=edit&listingId=${encodeURIComponent(draftId)}`);
    },
    [navigate]
  );

  const handleDeleteDraft = useCallback(
    async (draftId: string) => {
      if (!window.confirm('Are you sure you want to delete this draft?')) return;

      try {
        const { error } = await supabase.from('listings').delete().eq('id', draftId);
        if (error) throw error;

        await fetchDrafts();
      } catch (e: any) {
        console.error('[DraftsPage] Failed to delete draft:', e);
        window.alert(e?.message || 'Failed to delete draft.');
      }
    },
    [fetchDrafts]
  );

  const formatDate = useCallback((dateString: string) => {
    const date = new Date(dateString);
    const now = new Date();
    if (Number.isNaN(date.getTime())) return 'Unknown date';

    const diffMs = now.getTime() - date.getTime();
    const diffMins = Math.floor(diffMs / 60000);
    const diffHours = Math.floor(diffMs / 3600000);
    const diffDays = Math.floor(diffMs / 86400000);

    if (diffMins < 1) return 'Just now';
    if (diffMins < 60) return `${diffMins} minute${diffMins !== 1 ? 's' : ''} ago`;
    if (diffHours < 24) return `${diffHours} hour${diffHours !== 1 ? 's' : ''} ago`;
    if (diffDays < 7) return `${diffDays} day${diffDays !== 1 ? 's' : ''} ago`;

    return date.toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: date.getFullYear() !== now.getFullYear() ? 'numeric' : undefined,
    });
  }, []);

  const countLabel = useMemo(() => {
    return `${drafts.length} saved ${drafts.length === 1 ? 'draft' : 'drafts'}`;
  }, [drafts.length]);

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-teal-600 mx-auto mb-4" />
          <p className="text-gray-600">Loading drafts...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50 py-8">
      <div className="container mx-auto px-4 max-w-6xl">
        {/* Header */}
        <div className="mb-8">
          <div className="flex items-center justify-between mb-4">
            <div>
              <h1 className="text-3xl font-bold text-gray-900 flex items-center gap-3">
                <FileText className="w-8 h-8 text-teal-600" />
                My Drafts
              </h1>
              <p className="text-gray-600 mt-2">{countLabel}</p>
            </div>

            <div className="flex items-center gap-3">
              <button
                onClick={() => fetchDrafts()}
                className="btn border border-gray-300 text-gray-700 hover:bg-gray-100 px-4 py-3 rounded-lg font-semibold"
                type="button"
              >
                Refresh
              </button>

              <button
                onClick={() => navigate('/create-listing')}
                className="btn bg-teal-600 text-white hover:bg-teal-700 px-6 py-3 rounded-lg font-semibold"
                type="button"
              >
                + Create New Listing
              </button>
            </div>
          </div>

          {loadError && (
            <div className="mt-2 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-red-700">
              {loadError}
            </div>
          )}
        </div>

        {/* Drafts List */}
        {drafts.length === 0 ? (
          <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-12 text-center">
            <FileText className="w-16 h-16 text-gray-300 mx-auto mb-4" />
            <h3 className="text-xl font-semibold text-gray-900 mb-2">No drafts yet</h3>
            <p className="text-gray-600 mb-6">Start creating a listing and save it as a draft to continue later</p>
            <button
              onClick={() => navigate('/create-listing')}
              className="btn bg-teal-600 text-white hover:bg-teal-700 px-6 py-3 rounded-lg font-semibold"
              type="button"
            >
              Create Your First Listing
            </button>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {drafts.map((draft) => {
              const images = Array.isArray(draft.images) ? draft.images : [];
              const safeIndex =
                typeof draft.mainImageIndex === 'number' && draft.mainImageIndex >= 0
                  ? Math.min(draft.mainImageIndex, Math.max(images.length - 1, 0))
                  : 0;

              const coverSrc = images.length > 0 ? images[safeIndex] : '';

              return (
                <div
                  key={draft.id}
                  className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden hover:shadow-lg transition-shadow"
                >
                  {/* Image */}
                  <div className="relative h-48 bg-gray-100">
                    {coverSrc ? (
                      <img
                        src={coverSrc}
                        alt={draft.title || 'Draft image'}
                        className="w-full h-full object-cover"
                        loading="lazy"
                      />
                    ) : (
                      <div className="w-full h-full flex items-center justify-center">
                        <ImageIcon className="w-12 h-12 text-gray-300" />
                      </div>
                    )}

                    {images.length > 1 && (
                      <div className="absolute bottom-2 right-2 bg-black/70 text-white text-xs px-2 py-1 rounded">
                        {images.length} photos
                      </div>
                    )}
                  </div>

                  {/* Content */}
                  <div className="p-4">
                    <h3 className="font-semibold text-gray-900 mb-2 line-clamp-2 min-h-[3rem]">
                      {draft.title?.trim() ? draft.title : 'Untitled Draft'}
                    </h3>

                    <div className="flex items-center gap-2 text-sm text-gray-500 mb-3">
                      <Clock className="w-4 h-4" />
                      <span>{formatDate(draft.savedAt)}</span>
                    </div>

                    {draft.categoryPath && (
                      <div className="text-xs text-gray-500 mb-3 truncate">📁 {draft.categoryPath}</div>
                    )}

                    <div className="text-sm font-semibold text-teal-600 mb-4">${draft.price || '0.00'}</div>

                    {/* Actions */}
                    <div className="flex gap-2">
                      <button
                        onClick={() => handleEditDraft(draft.id)}
                        className="flex-1 btn bg-teal-600 text-white hover:bg-teal-700 py-2 rounded-lg font-medium flex items-center justify-center gap-2"
                        type="button"
                      >
                        <Edit className="w-4 h-4" />
                        Edit
                      </button>

                      <button
                        onClick={() => handleDeleteDraft(draft.id)}
                        className="btn border border-red-300 text-red-600 hover:bg-red-50 py-2 px-4 rounded-lg"
                        type="button"
                        aria-label="Delete draft"
                        title="Delete draft"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
