// src/components/CategorySelector.tsx
import React, { useEffect, useState } from 'react';

type CategorySelectorProps = {
  initialCategoryPath?: string;
  initialCategoryId?: string;
  onCategorySelect: (cat: { path: string; id: string }) => void;
  onClose: () => void;
};

export default function CategorySelector({
  initialCategoryPath = '',
  initialCategoryId = '',
  onCategorySelect,
  onClose,
}: CategorySelectorProps) {
  const [path, setPath] = useState(initialCategoryPath);
  const [id, setId] = useState(initialCategoryId);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    setPath(initialCategoryPath || '');
    setId(initialCategoryId || '');
  }, [initialCategoryPath, initialCategoryId]);

  const handleApply = async () => {
    if (!id) return;
    setSubmitting(true);
    try {
      // No async fetches in render — just pass up the values.
      onCategorySelect({ path, id });
    } finally {
      setSubmitting(false);
      onClose();
    }
  };

  const onBackdropClick: React.MouseEventHandler<HTMLDivElement> = (e) => {
    // click outside = close
    if (e.target === e.currentTarget) onClose();
  };

  return (
    <div
      className="fixed inset-0 bg-black/40 flex items-center justify-center z-50"
      onClick={onBackdropClick}
      role="dialog"
      aria-modal="true"
    >
      <div className="w-full max-w-lg bg-white rounded-lg shadow p-5">
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-lg font-semibold">Select a Category</h3>
          <button className="btn btn-outline" onClick={onClose} type="button">Close</button>
        </div>

        <div className="space-y-3">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Category Path (optional)</label>
            <input
              className="w-full px-3 py-2 border border-gray-300 rounded-md"
              placeholder="e.g., Clothing > Men > Hoodies & Sweatshirts"
              value={path}
              onChange={(e) => setPath(e.target.value)}
            />
            <p className="text-xs text-gray-500 mt-1">
              Path is just for display in your UI. eBay publish uses the ID below.
            </p>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Category ID</label>
            <input
              className="w-full px-3 py-2 border border-gray-300 rounded-md"
              placeholder="e.g., 57988"
              value={id}
              onChange={(e) => setId(e.target.value)}
            />
          </div>

          <div className="flex justify-end gap-2 pt-2">
            <button className="btn btn-outline" onClick={onClose} type="button">Cancel</button>
            <button
              className="btn bg-teal-600 text-white hover:bg-teal-700 disabled:opacity-50 disabled:cursor-not-allowed"
              onClick={handleApply}
              type="button"
              disabled={!id || submitting}
            >
              {submitting ? 'Applying…' : 'Apply'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
