import React, { useEffect, useMemo, useRef, useState } from 'react';
import { ChevronRight, ChevronLeft, Search, Check, Loader2, X } from 'lucide-react';

type CategoryNode = {
  id: string;
  name: string;
  hasChildren?: boolean;
};

type ApiCategory = { id: string; name: string; path?: string; hasChildren?: boolean };

type CategorySelectorProps = {
  initialCategoryPath?: string;
  initialCategoryId?: string;
  onCategorySelect: (cat: { id: string; path: string }) => void;
  onClose: () => void;
};

export default function CategorySelector({
  initialCategoryPath = '',
  initialCategoryId = '',
  onCategorySelect,
  onClose,
}: CategorySelectorProps) {
  const [crumbs, setCrumbs] = useState<Array<{ id: string; name: string }>>([]);
  const [items, setItems] = useState<CategoryNode[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string>('');
  const [active, setActive] = useState<CategoryNode | null>(null);

  // Search state
  const [q, setQ] = useState('');
  const [searching, setSearching] = useState(false);
  const [results, setResults] = useState<ApiCategory[]>([]);
  const searchTimer = useRef<number | null>(null);

  // cache results for faster drilldown
  const cacheRef = useRef(new Map<string, CategoryNode[]>());

  const parentId = crumbs.length ? crumbs[crumbs.length - 1].id : '0';
  const breadcrumbText = useMemo(
    () => (crumbs.length ? crumbs.map((c) => c.name).join(' > ') : 'All'),
    [crumbs]
  );

  // ---------------- API helpers ----------------
  const fetchChildren = async (pid: string) => {
    setLoading(true);
    setError('');
    const cached = cacheRef.current.get(pid);
    if (cached) {
      setItems(cached);
      setLoading(false);
      return;
    }
    try {
      const r = await fetch('/api/ebay-categories', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'getCategories', parentCategoryId: pid }),
      });
      if (!r.ok) throw new Error(await r.text());
      const data = await r.json();
      const cats: ApiCategory[] = data?.categories ?? [];
      cacheRef.current.set(
        pid,
        cats.map((c) => ({ id: String(c.id), name: c.name, hasChildren: !!c.hasChildren }))
      );
      setItems(
        cats.map((c) => ({ id: String(c.id), name: c.name, hasChildren: !!c.hasChildren }))
      );
    } catch (e: any) {
      setError(e?.message || 'Failed to load categories');
      setItems([]);
    } finally {
      setLoading(false);
    }
  };

  const runSearch = async (term: string) => {
    if (!term.trim()) {
      setResults([]);
      return;
    }
    setSearching(true);
    setError('');
    try {
      const r = await fetch('/api/ebay-categories', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'searchCategories', query: term }),
      });
      if (!r.ok) throw new Error(await r.text());
      const data = await r.json();
      setResults((data?.categories ?? []) as ApiCategory[]);
    } catch (e: any) {
      setError(e?.message || 'Search failed');
      setResults([]);
    } finally {
      setSearching(false);
    }
  };

  // initial load (root)
  useEffect(() => {
    fetchChildren('0');
  }, []);

  // debounce search
  useEffect(() => {
    if (searchTimer.current) window.clearTimeout(searchTimer.current);
    if (!q.trim()) {
      setResults([]);
      return;
    }
    searchTimer.current = window.setTimeout(() => runSearch(q), 300);
    return () => {
      if (searchTimer.current) window.clearTimeout(searchTimer.current);
    };
  }, [q]);

  // reload when crumbs change
  useEffect(() => {
    fetchChildren(parentId);
    setActive(null);
  }, [parentId]);

  const fullPathFor = (leaf: { id: string; name: string }): string => {
    if (!crumbs.length) return leaf.name;
    return `${crumbs.map((c) => c.name).join(' > ')} > ${leaf.name}`;
  };

  const handleChoose = (node: CategoryNode) => {
    if (node.hasChildren) {
      setCrumbs((prev) => [...prev, { id: node.id, name: node.name }]);
      setActive(null);
    } else {
      onCategorySelect({ id: node.id, path: fullPathFor(node) });
    }
  };

  const handleBack = () => {
    if (!crumbs.length) return;
    setCrumbs((prev) => prev.slice(0, -1));
    setActive(null);
  };

  const handlePickActive = () => {
    if (!active) return;
    onCategorySelect({ id: active.id, path: fullPathFor(active) });
  };

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="text-xs text-gray-500 mb-1">CATEGORY SELECTION</div>
          <div className="flex items-center gap-2">
            <button
              className={`inline-flex items-center gap-1 text-sm ${
                crumbs.length ? 'text-teal-700' : 'text-gray-400'
              } disabled:text-gray-300`}
              onClick={handleBack}
              disabled={!crumbs.length}
            >
              <ChevronLeft className="w-4 h-4" />
              Back
            </button>
            <div className="text-sm text-gray-700 truncate">{breadcrumbText}</div>
          </div>
          {initialCategoryPath && (
            <div className="mt-1 text-xs text-gray-500">
              Current: <span className="font-medium text-gray-700">{initialCategoryPath}</span>
            </div>
          )}
        </div>
        <button
          className="text-gray-500 hover:text-gray-700"
          onClick={onClose}
          aria-label="Close"
        >
          <X className="w-5 h-5" />
        </button>
      </div>

      {/* Search box */}
      <div className="relative">
        <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search for categories..."
          className="w-full pl-9 pr-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-teal-500"
        />
        {q && (
          <button
            className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
            onClick={() => setQ('')}
          >
            <X className="w-4 h-4" />
          </button>
        )}
      </div>

      {/* Search results */}
      {!!q && (
        <div className="border rounded-md">
          <div className="px-3 py-2 text-xs text-gray-500 border-b bg-gray-50 flex items-center gap-2">
            {searching && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
            Search results
          </div>
          <div className="max-h-64 overflow-auto divide-y">
            {searching && results.length === 0 ? (
              <div className="px-3 py-3 text-sm text-gray-500">Searching…</div>
            ) : results.length === 0 ? (
              <div className="px-3 py-3 text-sm text-gray-500">No results.</div>
            ) : (
              results.map((r) => (
                <button
                  key={`${r.id}-${r.path}`}
                  className="w-full text-left px-3 py-2 hover:bg-gray-50"
                  onClick={() =>
                    onCategorySelect({
                      id: String(r.id),
                      path: r.path || r.name,
                    })
                  }
                >
                  <div className="text-sm text-gray-900">{r.path || r.name}</div>
                  <div className="text-xs text-gray-500">ID: {r.id}</div>
                </button>
              ))
            )}
          </div>
        </div>
      )}

      {/* Drilldown list */}
      <div className="border rounded-md">
        <div className="px-3 py-2 text-xs text-gray-500 border-b bg-gray-50">
          {breadcrumbText}
        </div>

        {loading ? (
          <div className="p-6 flex items-center justify-center text-gray-500">
            <Loader2 className="w-5 h-5 animate-spin mr-2" /> Loading…
          </div>
        ) : error ? (
          <div className="p-4 text-sm text-red-600">{error}</div>
        ) : items.length === 0 ? (
          <div className="p-4 text-sm text-gray-500">No categories found.</div>
        ) : (
          <ul className="max-h-72 overflow-auto">
            {items.map((node) => (
              <li key={node.id}>
                <button
                  className="w-full px-3 py-2 flex items-center justify-between hover:bg-gray-50"
                  onClick={() => handleChoose(node)}
                >
                  <div className="min-w-0 pr-3">
                    <div className="text-sm text-gray-900 truncate">{node.name}</div>
                    <div className="text-xs text-gray-500">ID: {node.id}</div>
                  </div>
                  {node.hasChildren ? (
                    <ChevronRight className="w-4 h-4 text-gray-400" />
                  ) : (
                    <Check className="w-4 h-4 text-teal-600 opacity-60" />
                  )}
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* Footer */}
      <div className="flex items-center justify-between">
        <div className="text-xs text-gray-500">
          {initialCategoryId
            ? `Current: ${initialCategoryPath || initialCategoryId}`
            : 'No category selected'}
        </div>
        <div className="flex gap-2">
          <button className="btn btn-outline" onClick={onClose}>
            Cancel
          </button>
          <button
            className={`btn ${
              active ? 'bg-teal-600 text-white hover:bg-teal-700' : 'opacity-50 cursor-not-allowed'
            }`}
            onClick={handlePickActive}
            disabled={!active}
          >
            Select
          </button>
        </div>
      </div>
    </div>
  );
}
