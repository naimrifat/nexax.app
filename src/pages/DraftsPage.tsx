import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { FileText, Trash2, Edit, Clock, Image as ImageIcon } from 'lucide-react';

interface Draft {
  id: string;
  title: string;
  description: string;
  category: any;
  specifics: any[];
  images: string[];
  mainImageIndex: number;
  price: string;
  keywords: string;
  savedAt: string;
}

export default function DraftsPage() {
  const navigate = useNavigate();
  const [drafts, setDrafts] = useState<Draft[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadDrafts();
  }, []);

  const loadDrafts = () => {
    try {
      const draftsList = JSON.parse(localStorage.getItem('drafts_list') || '[]');
      const loadedDrafts = draftsList
        .map((item: any) => {
          const data = localStorage.getItem(item.id);
          return data ? JSON.parse(data) : null;
        })
        .filter((d: Draft | null) => d !== null)
        .sort((a: Draft, b: Draft) => 
          new Date(b.savedAt).getTime() - new Date(a.savedAt).getTime()
        );

      setDrafts(loadedDrafts);
    } catch (error) {
      console.error('Failed to load drafts:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleLoadDraft = (draft: Draft) => {
    // Store draft data in sessionStorage for ResultsPage to pick up
    sessionStorage.setItem('loadedDraft', JSON.stringify(draft));
    navigate('/results?mode=edit');
  };

  const handleDeleteDraft = (draftId: string) => {
    if (confirm('Are you sure you want to delete this draft?')) {
      try {
        // Remove from localStorage
        localStorage.removeItem(draftId);

        // Update drafts list
        const draftsList = JSON.parse(localStorage.getItem('drafts_list') || '[]');
        const updated = draftsList.filter((d: any) => d.id !== draftId);
        localStorage.setItem('drafts_list', JSON.stringify(updated));

        // Reload drafts
        loadDrafts();

        console.log('✅ Draft deleted:', draftId);
      } catch (error) {
        console.error('Failed to delete draft:', error);
        alert('Failed to delete draft');
      }
    }
  };

  const formatDate = (dateString: string) => {
    const date = new Date(dateString);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffMins = Math.floor(diffMs / 60000);
    const diffHours = Math.floor(diffMs / 3600000);
    const diffDays = Math.floor(diffMs / 86400000);

    if (diffMins < 1) return 'Just now';
    if (diffMins < 60) return `${diffMins} minute${diffMins > 1 ? 's' : ''} ago`;
    if (diffHours < 24) return `${diffHours} hour${diffHours > 1 ? 's' : ''} ago`;
    if (diffDays < 7) return `${diffDays} day${diffDays > 1 ? 's' : ''} ago`;
    
    return date.toLocaleDateString('en-US', { 
      month: 'short', 
      day: 'numeric', 
      year: date.getFullYear() !== now.getFullYear() ? 'numeric' : undefined 
    });
  };

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-teal-600 mx-auto mb-4"></div>
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
              <p className="text-gray-600 mt-2">
                {drafts.length} saved {drafts.length === 1 ? 'draft' : 'drafts'}
              </p>
            </div>
            <button
              onClick={() => navigate('/create-listing')}
              className="btn bg-teal-600 text-white hover:bg-teal-700 px-6 py-3 rounded-lg font-semibold"
            >
              + Create New Listing
            </button>
          </div>
        </div>

        {/* Drafts List */}
        {drafts.length === 0 ? (
          <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-12 text-center">
            <FileText className="w-16 h-16 text-gray-300 mx-auto mb-4" />
            <h3 className="text-xl font-semibold text-gray-900 mb-2">
              No drafts yet
            </h3>
            <p className="text-gray-600 mb-6">
              Start creating a listing and save it as a draft to continue later
            </p>
            <button
              onClick={() => navigate('/create-listing')}
              className="btn bg-teal-600 text-white hover:bg-teal-700 px-6 py-3 rounded-lg font-semibold"
            >
              Create Your First Listing
            </button>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {drafts.map((draft) => (
              <div
                key={draft.id}
                className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden hover:shadow-lg transition-shadow"
              >
                {/* Image */}
                <div className="relative h-48 bg-gray-100">
                  {draft.images && draft.images.length > 0 ? (
                    <img
                      src={draft.images[draft.mainImageIndex || 0]}
                      alt={draft.title}
                      className="w-full h-full object-cover"
                    />
                  ) : (
                    <div className="w-full h-full flex items-center justify-center">
                      <ImageIcon className="w-12 h-12 text-gray-300" />
                    </div>
                  )}
                  {draft.images && draft.images.length > 1 && (
                    <div className="absolute bottom-2 right-2 bg-black/70 text-white text-xs px-2 py-1 rounded">
                      {draft.images.length} photos
                    </div>
                  )}
                </div>

                {/* Content */}
                <div className="p-4">
                  <h3 className="font-semibold text-gray-900 mb-2 line-clamp-2 min-h-[3rem]">
                    {draft.title || 'Untitled Draft'}
                  </h3>

                  <div className="flex items-center gap-2 text-sm text-gray-500 mb-3">
                    <Clock className="w-4 h-4" />
                    <span>{formatDate(draft.savedAt)}</span>
                  </div>

                  {draft.category && (
                    <div className="text-xs text-gray-500 mb-3 truncate">
                      📁 {draft.category.path || draft.category.name || 'No category'}
                    </div>
                  )}

                  <div className="text-sm font-semibold text-teal-600 mb-4">
                    ${draft.price || '0.00'}
                  </div>

                  {/* Actions */}
                  <div className="flex gap-2">
                    <button
                      onClick={() => handleLoadDraft(draft)}
                      className="flex-1 btn bg-teal-600 text-white hover:bg-teal-700 py-2 rounded-lg font-medium flex items-center justify-center gap-2"
                    >
                      <Edit className="w-4 h-4" />
                      Edit
                    </button>
                    <button
                      onClick={() => handleDeleteDraft(draft.id)}
                      className="btn border border-red-300 text-red-600 hover:bg-red-50 py-2 px-4 rounded-lg"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
