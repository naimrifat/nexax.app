// src/pages/DraftsPage.tsx
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { FileText, Trash2, Edit, Clock, Image as ImageIcon } from 'lucide-react';
import { supabase } from '../../lib/supabaseClient';

type Draft = {
  id: string;
  title: string;
  description: string;
  categoryPath?: string;
  images: string[];
  mainImageIndex: number;
  price: number;
  currency: string;
  savedAt: string; // updated_at preferred
};

type ListingRow = {
  id: string;
  title: string | null;
  description: string | null;
  category_path: string | null;
  price: number | null;
  currency: string | null;
  images: string[] | null;
  listing_json: any;
  updated_at: string | null;
  created_at: string | null;
  status: string | null;
};

function safeJson(value: any, fallback: any) {
  try {
    if (value == null) return fallback;
    if (typeof value === 'string') return JSON.parse(value);
    return value;
  } catch {
    return fallback;
  }
}

async function getWorkspaceIdForAuthedUser(): Promise<string> {
  const { data: authData, error: authErr } = await supabase.auth.getUser();
  if (authErr) throw authErr;

  const uid = authData?.user?.id;
  if (!uid) throw new Error('Not authenticated');

  const { data, error } = await supabase
    .from('users')
    .select('workspace_id')
    .eq('auth_provider_user_id', uid)
    .single();

  if (error) throw error;
  if (!data?.workspace_id) throw new Error('No workspace_id found for this user');

  return data.workspace_id as string;
}

function mapRowToDraft(row: ListingRow): Draft {
  const lj = safeJson(row.listing_json, {});
  const images = Array.isArray(row.images) ? row.images : Array.isArray(lj?.images) ? lj.images : [];

  const mainImageIndex =
    typeof lj?.mainImageIndex === 'number' && Number.isFinite(lj.mainImageIndex) ? lj.mainImageIndex : 0;

  return {
    id: row.id,
    title: row.title?.trim() || lj?.title?.trim() || 'Untitled Draft',
    description: row.description || lj?.description || '',
    categoryPath: row.category_path || lj?.category_path || lj?.category?.path || '',
    images,
    mainImageIndex,
    price: typeof row.price === 'number' ? row.price : Number(lj?.price_suggestion?.optimal ?? 0) || 0,
    currency: row.currency || 'USD',
    savedAt: row.updated_at || row.created_at || new Date().toISOString(),
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
      const workspaceId = await getWorkspaceIdForAuthedUser();

      const { data, error } = await supabase
        .from('listings')
        .select('id,title,description,category_path,price,currency,images,listing_json,updated_at,created_at,status')
        .eq('workspace_id', workspaceId)
        .eq('status', 'draft')
        .order('updated_at', { ascending: false });

      if (error) throw error;

      const rows = Array.isArray(data) ? (data as ListingRow[]) : [];
      const normalized = rows.map(mapRowToDraft);

      console.log('[DraftsPage] loaded drafts:', { count: normalized.length, workspaceId });
      setDrafts(normalized);
    } catch (e: any) {
      console.error('[DraftsPage] load failed:', e);
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
    async (draft: Draft) => {
      // Option A (best): ResultsPage loads by listingId from DB
      navigate(`/results?mode=edit&listingId=${draft.id}`);
    },
    [navigate]
  );

  const handleDeleteDraft = useCallback(
    async (draftId: string) => {
      if (!window.confirm('Are you sure you want to delete this draft?')) return;

      try {
        const { error } = await supabase.from('listings').delete().eq('id', draftId);
        if (error) throw error;

        console.log('✅ Draft deleted:', draftId);
        await fetchDrafts();
      } catch (e: any) {
        console.error('[DraftsPage] delete failed:', e);
        window.alert(e?.message || 'Failed to delete draft');
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

  const countLabel = useMemo(() => `${drafts.length} saved ${drafts.length === 1 ? 'draft' : 'drafts'}`, [drafts.length]);

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
                onClick={fetchDrafts}
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
                  <div className="relative h-48 bg-gray-100">
                    {coverSrc ? (
                      <img src={coverSrc} alt={draft.title} className="w-full h-full object-cover" loading="lazy" />
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

                  <div className="p-4">
                    <h3 className="font-semibold text-gray-900 mb-2 line-clamp-2 min-h-[3rem]">{draft.title}</h3>

                    <div className="flex items-center gap-2 text-sm text-gray-500 mb-3">
                      <Clock className="w-4 h-4" />
                      <span>{formatDate(draft.savedAt)}</span>
                    </div>

                    {draft.categoryPath ? (
                      <div className="text-xs text-gray-500 mb-3 truncate">📁 {draft.categoryPath}</div>
                    ) : null}

                    <div className="text-sm font-semibold text-teal-600 mb-4">
                      {draft.currency} ${draft.price.toFixed(2)}
                    </div>

                    <div className="flex gap-2">
                      <button
                        onClick={() => handleEditDraft(draft)}
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
