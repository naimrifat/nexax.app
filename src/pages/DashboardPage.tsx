// src/pages/DashboardPage.tsx
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import {
  PlusCircle,
  Search,
  Filter,
  ArrowUp,
  ArrowDown,
  MoreHorizontal,
  Eye,
  Edit,
  Trash,
  ExternalLink,
  Download,
  Copy,
} from "lucide-react";
import TestDbPanel from "../components/TestDbPanel";
import { supabase } from "../../lib/supabaseClient";
import { useAuth } from "../context/AuthContext";

type ListingStatus = "draft" | "active" | "sold" | "ended" | "archived" | string;

type ListingRow = {
  id: string;
  workspace_id: string | null;
  status: ListingStatus | null;
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

type DashboardListing = {
  id: string;
  title: string;
  image: string;
  platforms: string[];
  date: string;
  price: number;
  status: ListingStatus;
  views: number;
  likes: number;
  ebay_listing_url?: string | null;
};

function safeArray(v: unknown): string[] {
  if (Array.isArray(v)) return v.filter((x) => typeof x === "string") as string[];
  return [];
}

function firstString(v: unknown, fallback = ""): string {
  return typeof v === "string" ? v : fallback;
}

function isHostedImageUrl(u: string): boolean {
  const s = String(u || "").trim();
  if (!s) return false;
  if (s.startsWith("blob:")) return false;
  if (s.startsWith("data:")) return false;
  return /^https?:\/\//i.test(s);
}

function pickCoverImage(row: ListingRow): string {
  const lj = row.listing_json || {};
  const colImages = safeArray(row.images).filter(isHostedImageUrl);
  const jsonImages = safeArray(lj?.images || lj?.image_urls).filter(isHostedImageUrl);

  const images = colImages.length ? colImages : jsonImages;
  if (!images.length) return "";

  // NOTE: ResultsPage currently saves ordered images with "main first" and mainImageIndex=0,
  // but we still honor mainImageIndex if present.
  const mainIdx =
    typeof lj?.mainImageIndex === "number" && Number.isFinite(lj.mainImageIndex)
      ? (lj.mainImageIndex as number)
      : 0;

  const idx = Math.max(0, Math.min(mainIdx, images.length - 1));
  return images[idx] || images[0] || "";
}

function normalizeListing(row: ListingRow): DashboardListing {
  const lj = row.listing_json || {};

  const title =
    firstString(row.title, "").trim() ||
    firstString(lj?.title, "").trim() ||
    "Untitled Listing";

  const date = row.updated_at || row.created_at || new Date().toISOString();

  const priceFromRow = typeof row.price === "number" && Number.isFinite(row.price) ? row.price : null;
  const priceFromJson =
    typeof lj?.price_suggestion?.optimal === "number"
      ? Number(lj.price_suggestion.optimal)
      : typeof lj?.price === "number"
        ? Number(lj.price)
        : null;

  const price = priceFromRow ?? priceFromJson ?? 0;

  const marketplace = (row.marketplace ?? lj?.marketplace ?? "ebay") as string;
  const platforms = [marketplace === "ebay" ? "eBay" : marketplace].filter(Boolean);

  const views = typeof lj?.stats?.views === "number" ? lj.stats.views : 0;
  const likes = typeof lj?.stats?.likes === "number" ? lj.stats.likes : 0;

  return {
    id: row.id,
    title,
    image: pickCoverImage(row),
    platforms,
    date,
    price,
    status: (row.status ?? lj?.status ?? "draft") as ListingStatus,
    views,
    likes,
    ebay_listing_url: row.ebay_listing_url ?? lj?.ebay_listing_url ?? null,
  };
}

const DashboardPage: React.FC = () => {
  const { user, workspaceId, isLoading: authLoading } = useAuth();

  const [activeFilter, setActiveFilter] = useState<string>("all");
  const [sortDirection, setSortDirection] = useState<"asc" | "desc">("desc");
  const [searchQuery, setSearchQuery] = useState<string>("");

  const [loading, setLoading] = useState<boolean>(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [listingItems, setListingItems] = useState<DashboardListing[]>([]);

  const canQuery = !!user?.id && !!workspaceId && !authLoading;

  // Prevent overlapping requests and stale updates.
  const inFlightRef = useRef(false);
  const requestSeqRef = useRef(0);

  const fetchListings = useCallback(async () => {
    if (!canQuery) {
      setListingItems([]);
      setLoading(false);
      setLoadError(null);
      return;
    }

    // Avoid overlapping loads (important when navigating back quickly).
    if (inFlightRef.current) return;

    inFlightRef.current = true;
    const seq = ++requestSeqRef.current;

    setLoadError(null);
    setLoading(true);

    let timeoutId: number | undefined;

    try {
      const timeoutPromise = new Promise<never>((_, reject) => {
        timeoutId = window.setTimeout(() => {
          reject(new Error("Dashboard request timed out. Please try again."));
        }, 15000);
      });

      const queryPromise = supabase
        .from("listings")
        .select(
          "id,workspace_id,status,marketplace,title,description,category_path,price,currency,ebay_item_id,ebay_listing_url,listing_json,images,created_at,updated_at"
        )
        .eq("workspace_id", workspaceId)
        .order("updated_at", { ascending: false, nullsFirst: false });

      const { data, error } = await Promise.race([queryPromise, timeoutPromise]);

      if (error) throw error;

      // Only apply the latest response (guards against out-of-order resolution).
      if (seq === requestSeqRef.current) {
        const rows = (data ?? []) as ListingRow[];
        setListingItems(rows.map(normalizeListing));
      }
    } catch (e: any) {
      console.error("[DashboardPage] Failed to load listings:", e);
      if (seq === requestSeqRef.current) {
        setListingItems([]);
        setLoadError(e?.message || "Failed to load listings.");
      }
    } finally {
      if (timeoutId) window.clearTimeout(timeoutId);
      if (seq === requestSeqRef.current) setLoading(false);
      inFlightRef.current = false;
    }
  }, [canQuery, workspaceId]);

  // Fetch deterministically when the page becomes query-ready.
  // This avoids double-fetch loops tied to fetchListings identity.
  useEffect(() => {
    if (!canQuery) {
      setLoading(false);
      return;
    }
    void fetchListings();
    // Intentionally depend only on canQuery. fetchListings is stable given canQuery/workspaceId.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canQuery]);

  const filteredListings = useMemo(() => {
    return listingItems
      .filter((item) => {
        if (activeFilter === "all") return true;
        return item.status === activeFilter;
      })
      .filter((item) => {
        if (!searchQuery) return true;
        return item.title.toLowerCase().includes(searchQuery.toLowerCase());
      })
      .sort((a, b) => {
        const dateA = new Date(a.date).getTime();
        const dateB = new Date(b.date).getTime();
        return sortDirection === "asc" ? dateA - dateB : dateB - dateA;
      });
  }, [listingItems, activeFilter, searchQuery, sortDirection]);

  const toggleSortDirection = () => {
    setSortDirection((d) => (d === "asc" ? "desc" : "asc"));
  };

  const counts = useMemo(() => {
    const all = listingItems.length;
    const active = listingItems.filter((i) => i.status === "active").length;
    const draft = listingItems.filter((i) => i.status === "draft").length;
    const sold = listingItems.filter((i) => i.status === "sold").length;
    return { all, active, draft, sold };
  }, [listingItems]);

  if (!canQuery && authLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-teal-600 mx-auto mb-4" />
          <p className="text-gray-600">Checking session...</p>
        </div>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-teal-600 mx-auto mb-4" />
          <p className="text-gray-600">Loading dashboard...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="container mx-auto px-4 py-8 md:py-12">
      <div className="max-w-6xl mx-auto">
        <div className="flex flex-col md:flex-row md:items-center md:justify-between mb-8 gap-4">
          <h1 className="text-3xl font-bold text-gray-900">Your Listings</h1>

          <div className="flex items-center gap-3">
            <Link to="/create-listing" className="btn btn-primary flex items-center justify-center">
              <PlusCircle className="w-5 h-5 mr-2" />
              Create New Listing
            </Link>

            <button
              type="button"
              onClick={() => void fetchListings()}
              className="btn border border-gray-300 text-gray-700 hover:bg-gray-100 px-4 py-2 rounded-md font-semibold"
            >
              Refresh
            </button>
          </div>
        </div>

        <TestDbPanel />

        {loadError && (
          <div className="mb-6 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-red-700">{loadError}</div>
        )}

        {/* Filters and Search */}
        <div className="bg-white rounded-lg shadow-sm border border-gray-100 p-4 mb-6">
          <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
            <div className="flex flex-wrap gap-2">
              <FilterButton
                label="All"
                isActive={activeFilter === "all"}
                onClick={() => setActiveFilter("all")}
                count={counts.all}
              />
              <FilterButton
                label="Active"
                isActive={activeFilter === "active"}
                onClick={() => setActiveFilter("active")}
                count={counts.active}
              />
              <FilterButton
                label="Drafts"
                isActive={activeFilter === "draft"}
                onClick={() => setActiveFilter("draft")}
                count={counts.draft}
              />
              <FilterButton
                label="Sold"
                isActive={activeFilter === "sold"}
                onClick={() => setActiveFilter("sold")}
                count={counts.sold}
              />
            </div>

            <div className="flex gap-2">
              <div className="relative flex-grow">
                <div className="absolute inset-y-0 left-3 flex items-center pointer-events-none">
                  <Search className="w-4 h-4 text-gray-400" />
                </div>
                <input
                  type="text"
                  placeholder="Search listings..."
                  className="input pl-10"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                />
              </div>

              <button className="btn btn-outline flex items-center" type="button" disabled>
                <Filter className="w-4 h-4 mr-1.5" />
                Filter
              </button>

              <button className="btn btn-outline flex items-center" onClick={toggleSortDirection} type="button">
                {sortDirection === "asc" ? (
                  <ArrowUp className="w-4 h-4 mr-1.5" />
                ) : (
                  <ArrowDown className="w-4 h-4 mr-1.5" />
                )}
                Date
              </button>
            </div>
          </div>
        </div>

        {/* Listings */}
        <div className="space-y-4">
          {filteredListings.length === 0 ? (
            <div className="bg-white rounded-lg shadow-sm border border-gray-100 p-8 text-center">
              <h3 className="text-lg font-semibold text-gray-700 mb-2">No listings found</h3>
              <p className="text-gray-500 mb-4">
                {searchQuery ? "Try a different search term" : "Create your first listing to get started"}
              </p>

              <Link to="/create-listing" className="btn btn-primary inline-flex items-center">
                <PlusCircle className="w-4 h-4 mr-2" />
                Create New Listing
              </Link>
            </div>
          ) : (
            filteredListings.map((listing) => (
              <ListingCard key={listing.id} listing={listing} onRefresh={fetchListings} />
            ))
          )}
        </div>

        {/* Pagination (placeholder) */}
        {filteredListings.length > 0 && (
          <div className="flex justify-center mt-8">
            <nav className="flex items-center space-x-1">
              <button className="btn btn-outline py-1.5 px-3" type="button" disabled>
                Previous
              </button>
              <button
                className="h-9 w-9 rounded-md bg-teal-50 text-teal-700 font-medium flex items-center justify-center"
                type="button"
                disabled
              >
                1
              </button>
              <button className="btn btn-outline py-1.5 px-3" type="button" disabled>
                Next
              </button>
            </nav>
          </div>
        )}
      </div>
    </div>
  );
};

interface FilterButtonProps {
  label: string;
  isActive: boolean;
  onClick: () => void;
  count: number;
}

const FilterButton: React.FC<FilterButtonProps> = ({ label, isActive, onClick, count }) => (
  <button
    className={`px-4 py-2 rounded-md text-sm font-medium flex items-center ${
      isActive ? "bg-teal-50 text-teal-700" : "bg-white text-gray-700 hover:bg-gray-50"
    }`}
    onClick={onClick}
    type="button"
  >
    {label}
    <span
      className={`ml-1.5 px-1.5 py-0.5 rounded-full text-xs ${
        isActive ? "bg-teal-100 text-teal-800" : "bg-gray-100 text-gray-700"
      }`}
    >
      {count}
    </span>
  </button>
);

interface ListingCardProps {
  listing: DashboardListing;
  onRefresh: () => Promise<void> | void;
}

const ListingCard: React.FC<ListingCardProps> = ({ listing, onRefresh }) => {
  const navigate = useNavigate();
  const { workspaceId } = useAuth();
  const [isMenuOpen, setIsMenuOpen] = useState(false);

  const formatDate = (dateString: string) => {
    const date = new Date(dateString);
    return date.toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
      year: "numeric",
    });
  };

  const getStatusBadge = (status: string) => {
    switch (status) {
      case "active":
        return <span className="badge badge-success">Active</span>;
      case "draft":
        return <span className="badge bg-gray-100 text-gray-800">Draft</span>;
      case "sold":
        return <span className="badge bg-purple-100 text-purple-800">Sold</span>;
      default:
        return <span className="badge bg-gray-100 text-gray-800">{status}</span>;
    }
  };

  const handleDelete = async () => {
    setIsMenuOpen(false);
    if (!window.confirm("Are you sure you want to delete this listing?")) return;

    try {
      if (!workspaceId) throw new Error("Missing workspace. Please sign in again.");

      const { error } = await supabase
        .from("listings")
        .delete()
        .eq("id", listing.id)
        .eq("workspace_id", workspaceId);

      if (error) throw error;

      await onRefresh();
    } catch (e: any) {
      console.error("[DashboardPage] delete failed:", e);
      window.alert(e?.message || "Failed to delete.");
    }
  };

  const handleEdit = () => {
    navigate(`/results?mode=edit&listingId=${encodeURIComponent(listing.id)}`);
  };

  const handleView = () => {
    navigate(`/results?mode=edit&listingId=${encodeURIComponent(listing.id)}`);
  };

  const handleDuplicate = async () => {
    setIsMenuOpen(false);

    try {
      if (!workspaceId) throw new Error("Missing workspace. Please sign in again.");

      const { data, error } = await supabase
        .from("listings")
        .select(
          "id,workspace_id,status,marketplace,title,description,category_path,price,currency,ebay_item_id,ebay_listing_url,listing_json,images,created_at,updated_at"
        )
        .eq("id", listing.id)
        .eq("workspace_id", workspaceId)
        .single();

      if (error) throw error;

      const row = data as ListingRow;
      const lj = row.listing_json || {};
      const nowIso = new Date().toISOString();

      const baseTitle = (row.title ?? lj?.title ?? "Untitled").toString().trim();
      const nextTitle = `${baseTitle.slice(0, 70)} (Copy)`;

      const insertPayload: any = {
        workspace_id: workspaceId,
        status: "draft",
        marketplace: row.marketplace ?? "ebay",
        title: nextTitle,
        description: row.description ?? lj?.description ?? "",
        category_path: row.category_path ?? lj?.category_path ?? null,
        price: row.price ?? (typeof lj?.price_suggestion?.optimal === "number" ? lj.price_suggestion.optimal : 0),
        currency: row.currency ?? "USD",
        images: Array.isArray(row.images) ? row.images : safeArray(lj?.images || lj?.image_urls),
        listing_json: {
          ...(lj || {}),
          title: nextTitle,
          status: "draft",
          duplicated_from: row.id,
          duplicated_at: nowIso,
        },
      };

      const ins = await supabase.from("listings").insert(insertPayload).select("id").single();
      if (ins.error) throw ins.error;

      await onRefresh();
      navigate(`/results?mode=edit&listingId=${encodeURIComponent((ins.data as any).id)}`);
    } catch (e: any) {
      console.error("[DashboardPage] duplicate failed:", e);
      window.alert(e?.message || "Failed to duplicate.");
    }
  };

  const handleOpenMarketplace = () => {
    setIsMenuOpen(false);
    if (listing.ebay_listing_url) {
      window.open(listing.ebay_listing_url, "_blank", "noopener,noreferrer");
    } else {
      window.alert("No marketplace URL saved for this listing.");
    }
  };

  const handleDownloadJson = () => {
    setIsMenuOpen(false);
    const blob = new Blob([JSON.stringify(listing, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `listing-${listing.id}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  useEffect(() => {
    if (!isMenuOpen) return;

    const onDoc = (e: MouseEvent) => {
      const target = e.target as HTMLElement | null;
      if (!target) return;
      if (target.closest?.("[data-menu-root]")) return;
      setIsMenuOpen(false);
    };

    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [isMenuOpen]);

  return (
    <div className="bg-white rounded-lg shadow-sm border border-gray-100 overflow-hidden transition-all hover:shadow-md">
      <div className="flex flex-col sm:flex-row">
        <div className="sm:w-48 h-48 sm:h-auto bg-gray-100">
          {listing.image ? (
            <img src={listing.image} alt={listing.title} className="w-full h-full object-cover" loading="lazy" />
          ) : (
            <div className="w-full h-full flex items-center justify-center text-gray-400 text-sm">No image</div>
          )}
        </div>

        <div className="flex-1 p-4 flex flex-col sm:flex-row">
          <div className="flex-1">
            <div className="flex justify-between">
              <h3 className="text-lg font-semibold text-gray-900 mb-1 line-clamp-2">{listing.title}</h3>

              <div className="relative" data-menu-root>
                <button
                  className="p-1 rounded-md hover:bg-gray-100 transition-colors"
                  onClick={() => setIsMenuOpen((v) => !v)}
                  type="button"
                  aria-haspopup="menu"
                  aria-expanded={isMenuOpen}
                >
                  <MoreHorizontal className="w-5 h-5 text-gray-500" />
                </button>

                {isMenuOpen && (
                  <div className="absolute right-0 mt-1 w-56 bg-white rounded-md shadow-lg border border-gray-100 z-10">
                    <div className="py-1">
                      <ActionButton icon={<Eye className="w-4 h-4" />} label="View" onClick={handleView} />
                      <ActionButton icon={<Edit className="w-4 h-4" />} label="Edit" onClick={handleEdit} />
                      <ActionButton
                        icon={<Copy className="w-4 h-4" />}
                        label="Duplicate to Draft"
                        onClick={handleDuplicate}
                      />
                      <ActionButton icon={<Download className="w-4 h-4" />} label="Download JSON" onClick={handleDownloadJson} />
                      <ActionButton
                        icon={<ExternalLink className="w-4 h-4" />}
                        label="Open in Marketplace"
                        onClick={handleOpenMarketplace}
                      />
                      <div className="border-t border-gray-100 my-1" />
                      <ActionButton
                        icon={<Trash className="w-4 h-4 text-red-500" />}
                        label="Delete"
                        labelClass="text-red-500"
                        onClick={handleDelete}
                      />
                    </div>
                  </div>
                )}
              </div>
            </div>

            <div className="flex items-center mb-3">
              <span className="font-medium text-gray-900">${Number(listing.price || 0).toFixed(2)}</span>
              <span className="mx-2 text-gray-300">•</span>
              <span className="text-sm text-gray-500">Updated {formatDate(listing.date)}</span>
            </div>

            <div className="flex flex-wrap gap-1.5 mb-3">
              {listing.platforms.map((platform) => (
                <span key={platform} className="text-xs px-2 py-1 bg-gray-100 text-gray-700 rounded-full">
                  {platform}
                </span>
              ))}
            </div>

            {getStatusBadge(String(listing.status))}
          </div>

          <div className="flex sm:flex-col justify-between sm:justify-center sm:items-end sm:ml-6 mt-4 sm:mt-0 pt-4 sm:pt-0 border-t sm:border-t-0 border-gray-100">
            {String(listing.status) !== "draft" && (
              <div className="flex sm:flex-col sm:items-end gap-3 sm:gap-1 mb-4">
                <div className="text-sm">
                  <span className="text-gray-500">Views:</span>{" "}
                  <span className="font-medium text-gray-900">{listing.views}</span>
                </div>
                <div className="text-sm">
                  <span className="text-gray-500">Likes:</span>{" "}
                  <span className="font-medium text-gray-900">{listing.likes}</span>
                </div>
              </div>
            )}

            <div className="flex sm:flex-col gap-2">
              <button
                onClick={handleView}
                className="btn btn-outline py-1.5 text-sm px-3 flex items-center justify-center"
                type="button"
              >
                <Eye className="w-4 h-4 mr-1.5" />
                View
              </button>

              <button
                onClick={handleEdit}
                className="btn btn-primary py-1.5 text-sm px-3 flex items-center justify-center"
                type="button"
              >
                <Edit className="w-4 h-4 mr-1.5" />
                Edit
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

interface ActionButtonProps {
  icon: React.ReactNode;
  label: string;
  labelClass?: string;
  onClick?: () => void;
}

const ActionButton: React.FC<ActionButtonProps> = ({ icon, label, labelClass = "", onClick }) => (
  <button
    className="w-full text-left px-4 py-2 text-sm text-gray-700 hover:bg-gray-50 flex items-center"
    type="button"
    onClick={onClick}
  >
    <span className="mr-3 text-gray-500">{icon}</span>
    <span className={labelClass}>{label}</span>
  </button>
);

export default DashboardPage;
