// src/pages/DraftsPage.tsx
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { FileText, Trash2, Edit, Clock, Image as ImageIcon } from 'lucide-react';
import { supabase } from '../../lib/supabaseClient';

type Draft = {
  id: string;
  title: string;
  description: string;
  category: any;
  specifics: any[];
  images: string[];
  mainImageIndex: number;
  price: string;
  keywords: string;
  savedAt: string; // ISO string expected
};

/**
 * Your Supabase "listings" table may differ.
 * This matches the shape implied by your earlier "backup to Supabase" POST:
 * - id (uuid)
 * - draft_id (string)
 * - title (text)
 * - description (text)
 * - data (text/json)
 * - status (text) e.g. 'draft'
 * - workspace_id (uuid) optional
 * - user_id (uuid) optional
 * - created_at / updated_at timestamps
 */
type ListingRow = {
  id: string;
  draft_id?: string | null;
  title?: string | null;
  description?: string | null;
  data?: any; // could be stringified JSON or jsonb
  status?: string | null;
  created_at?: string | null;
  updated_at?: string | null;
  workspace_id?: string | null;
  user_id?: string | null;
};

function safeJsonParse<T>(raw: unknown, fallback: T): T {
  try {
    if (raw == null) return fallback;
    if (typeof raw === 'string') return JSON.parse(raw) as T;
    // if Supabase returns jsonb, it may already be an object
    return raw as T;
  } catch {
    return fallback;
  }
}

function normalizeDraftFromRow(row: ListingRow): Draft {
  const payload = safeJsonParse<any>(row.data, {});
  const images = Array.isArray(payload?.images) ? payload.images : Array.isArray(payload?.image_urls) ? payload.image_urls : [];

  const mainImageIndex =
    typeof payload?.mainImageIndex === 'number' && Number.isFinite(payload.mainImageIndex) ? payload.mainImageIndex : 0;

  const savedAt =
    (typeof payload?.savedAt === 'string' && payload.savedAt) ||
    row.updated_at ||
    row.created_at ||
    new Date().toISOString();

  return {
    // Prefer the stable DB primary key for delete/edit routes
    id: row.id,
    title: (row.title ?? payload?.title ?? 'Untitled Draft') as string,
    description: (row.description ?? payload?.description ?? '') as string,
    category: payload?.category ?? null,
    specifics: Array.isArray(payload?.specifics) ? payload.specifics : Array.isArray(payload?.item_specifics) ? payload.item_specifics : [],
    images,
    mainImageIndex,
    price: String(payload?.price ?? payload?.price_suggestion?.optimal ?? '0.00'),
    keywords: typeof payload?.keywords === 'string' ? payload.keywords : Array.isArray(payload?.keywords) ? payload.keywords.join(', ') : '',
    savedAt,
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
      // Auth gate
      const { data: sessionData, error: sessionErr } = await supabase.auth.getSession();
      if (sessionErr) throw sessionErr;

      const uid = sessionData?.session?.user?.id;
      if (!uid) {
        setDrafts([]);
        setLoadError('You must be logged in to view drafts.');
        setLoading(false);
        return;
      }

      // Workspace scoping (recommended). If you don't have this RPC, remove this and filter by user_id only.
      let workspaceId: string | null = null;
      try {
        const { data: wsData, error: wsErr } = await supabase.rpc('ensure_user_and_workspace');
        if (wsErr) throw wsErr;
        const row: any = Array.isArray(wsData) ? wsData[0] : wsData;
        workspaceId = row?.workspace_id ?? row?.out_workspace_id ?? null;
      } catch (e) {
        // If RPC isn't available in this env, we still proceed with user scope.
        console.warn('[DraftsPage] ensure_user_and_workspace failed; falling back to user_id scope:', e);
      }

      // Query drafts from DB (REAL DATA)
      // Adjust the table name/columns if yours differ.
      let q = supabase
        .from('listings')
        .select('id,draft_id,title,description,data,status,created_at,updated_at,workspace_id,user_id')
        .eq('status', 'draft')
        .order('updated_at', { ascending: false, nullsFirst: false });

      if (workspaceId) q = q.eq('workspace_id', workspaceId);
      else q = q.eq('user_id', uid);

      const { data, error } = await q;
      if (error) throw error;

      const rows = Array.isArray(data) ? (data as ListingRow[]) : [];
      const normalized = rows
        .map(normalizeDraftFromRow)
        .sort((a, b) => new Date(b.savedAt).getTime() - new Date(a.savedAt).getTime());

      console.log('[DraftsPage] drafts fetched:', { count: normalized.length, scope: workspaceId ? 'workspace' : 'user' });
      setDrafts(normalized);
    } catch (e: any) {
      console.error('[DraftsPage] failed to load drafts:', e);
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
    (draft: Draft) => {
      /**
       * Keep your current flow: ResultsPage expects to load the draft from sessionStorage.
       * If you later change ResultsPage to load by listingId from DB, you can switch to:
       *   navigate(`/results?mode=edit&listingId=${draft.id}`)
       */
      sessionStorage.setItem('loadedDraft', JSON.stringify(draft));
      navigate('/results?mode=edit');
    },
    [navigate]
  );

  const handleDeleteDraft = useCallback(
    async (draftId: string) => {
      if (!window.confirm('Are you sure you want to delete this draft?')) return;

      try {
        // Delete from DB (REAL DATA)
        const { error } = await supabase.from('listings').delete().eq('id', draftId);
        if (error) throw error;

        console.log('✅ Draft deleted:', draftId);

        // Refresh UI
        await fetchDrafts();
      } catch (e: any) {
        console.error('[DraftsPage] failed to delete draft:', e);
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

                    {draft.category && (
                      <div className="text-xs text-gray-500 mb-3 truncate">
                        📁 {draft.category?.path || draft.category?.name || 'No category'}
                      </div>
                    )}

                    <div className="text-sm font-semibold text-teal-600 mb-4">${draft.price || '0.00'}</div>

                    {/* Actions */}
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
