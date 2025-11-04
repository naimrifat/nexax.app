// api/ebay-categories.ts
import type { VercelRequest, VercelResponse } from '@vercel/node';

/**
 * eBay Taxonomy integration for:
 * - Browsing children (full category map)
 * - Searching categories
 * - Smart suggestions (with breadcrumb path)
 * - Fetching item specifics (aspects) for a category
 */

const TREE_ID = 0; // EBAY_US
let cachedToken: { access_token: string; expires_at: number } | null = null;

async function getOAuthToken(): Promise<string> {
  // Use cached token if still valid
  if (cachedToken && cachedToken.expires_at > Date.now()) {
    return cachedToken.access_token;
  }

  const clientId = process.env.EBAY_CLIENT_ID;
  const clientSecret = process.env.EBAY_CLIENT_SECRET;

  if (!clientId || !clientSecret) {
    throw new Error('eBay credentials not found (EBAY_CLIENT_ID / EBAY_CLIENT_SECRET)');
  }

  const encoded = Buffer.from(`${clientId}:${clientSecret}`).toString('base64');
  const resp = await fetch('https://api.ebay.com/identity/v1/oauth2/token', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      'Authorization': `Basic ${encoded}`,
    },
    body: 'grant_type=client_credentials&scope=https://api.ebay.com/oauth/api_scope',
  });

  if (!resp.ok) {
    const text = await resp.text().catch(() => '');
    throw new Error(`OAuth failed: ${resp.status} ${text}`);
  }

  const data = await resp.json();
  cachedToken = {
    access_token: data.access_token,
    // refresh 5 minutes early
    expires_at: Date.now() + (Math.max(0, (data.expires_in ?? 7200) - 300) * 1000),
  };
  return cachedToken.access_token;
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  // CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const { action, parentCategoryId, categoryId, title, query } = req.body || {};

    switch (action) {
      case 'getCategories': {
        const categories = await getChildCategories(parentCategoryId);
        return res.status(200).json({ categories });
      }
      case 'searchCategories': {
        const categories = await searchCategories(query);
        return res.status(200).json({ categories });
      }
      case 'getSuggestedCategories': {
        const suggestions = await getSmartCategorySuggestions(title);
        return res.status(200).json(suggestions);
      }
      case 'getCategorySpecifics': {
        const specifics = await getCategorySpecificsFromAPI(categoryId);
        return res.status(200).json(specifics);
      }
      default:
        return res.status(400).json({ error: 'Invalid action' });
    }
  } catch (err: any) {
    console.error('eBay API error:', err);
    return res.status(500).json({
      error: 'Failed to fetch eBay data',
      details: err?.message ?? String(err),
    });
  }
}

/* =========================
   Category browsing (children)
   ========================= */
async function getChildCategories(parentId?: string) {
  const token = await getOAuthToken();

  // Root children
  if (!parentId || parentId === '0') {
    const resp = await fetch(`https://api.ebay.com/commerce/taxonomy/v1/category_tree/${TREE_ID}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!resp.ok) throw new Error(`Root tree failed: ${resp.status}`);
    const data = await resp.json();
    const nodes = data.rootCategoryNode?.childCategoryTreeNodes || [];
    return nodes.map((n: any) => ({
      id: n?.category?.categoryId,
      name: n?.category?.categoryName,
      hasChildren: Array.isArray(n?.childCategoryTreeNodes) && n.childCategoryTreeNodes.length > 0,
    }));
  }

  // Children of a given node
  const resp = await fetch(
    `https://api.ebay.com/commerce/taxonomy/v1/category_tree/${TREE_ID}/get_category_subtree?category_id=${encodeURIComponent(
      parentId,
    )}`,
    { headers: { Authorization: `Bearer ${token}` } },
  );
  if (!resp.ok) throw new Error(`Subtree failed: ${resp.status}`);
  const data = await resp.json();
  const nodes = data.categorySubtreeNode?.childCategoryTreeNodes || [];
  return nodes.map((n: any) => ({
    id: n?.category?.categoryId,
    name: n?.category?.categoryName,
    hasChildren: Array.isArray(n?.childCategoryTreeNodes) && n.childCategoryTreeNodes.length > 0,
  }));
}

/* =========================
   Category search (suggestions)
   ========================= */
async function searchCategories(q: string) {
  const query = (q || '').trim();
  if (!query) return [];
  const token = await getOAuthToken();

  const resp = await fetch(
    `https://api.ebay.com/commerce/taxonomy/v1/category_tree/${TREE_ID}/get_category_suggestions?q=${encodeURIComponent(
      query,
    )}`,
    { headers: { Authorization: `Bearer ${token}` } },
  );
  if (!resp.ok) return [];

  const data = await resp.json();
  const suggestions = data.categorySuggestions || [];

  return suggestions.map((s: any) => {
    const crumbs = [
      ...(s.categoryTreeNodeAncestors || []).map((a: any) => a.categoryName),
      s.category?.categoryName,
    ].filter(Boolean);
    return {
      id: s.category?.categoryId,
      name: s.category?.categoryName,
      path: crumbs.join(' > '),
    };
  });
}

/* =========================
   Smart suggestion (for auto-select)
   ========================= */
async function getSmartCategorySuggestions(title: string) {
  const q = (title || '').trim();
  if (!q) return getFallbackCategory();

  const token = await getOAuthToken();
  const resp = await fetch(
    `https://api.ebay.com/commerce/taxonomy/v1/category_tree/${TREE_ID}/get_category_suggestions?q=${encodeURIComponent(
      q,
    )}`,
    {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/json',
      },
    },
  );

  if (!resp.ok) {
    const text = await resp.text().catch(() => '');
    console.error('Taxonomy suggestions failed:', resp.status, text);
    return getFallbackCategory();
  }

  const data = await resp.json();
  const sugs = (data.categorySuggestions || []).map((s: any) => {
    const crumbs = [
      ...(s.categoryTreeNodeAncestors || []).map((a: any) => a.categoryName),
      s.category?.categoryName,
    ].filter(Boolean);
    return {
      id: s.category?.categoryId,
      name: s.category?.categoryName,
      path: crumbs.join(' > '),
    };
  });

  if (!sugs.length) return getFallbackCategory();

  return {
    categoryId: sugs[0].id,
    categoryName: sugs[0].name,
    categoryPath: sugs[0].path,
    suggestions: sugs.slice(0, 5),
  };
}

/* =========================
   Category specifics (aspects)
   ========================= */
async function getCategorySpecificsFromAPI(categoryId: string) {
  if (!categoryId) return { categoryId, aspects: [] };
  const token = await getOAuthToken();

  const resp = await fetch(
    `https://api.ebay.com/commerce/taxonomy/v1/category_tree/${TREE_ID}/get_item_aspects_for_category?category_id=${encodeURIComponent(
      categoryId,
    )}`,
    { headers: { Authorization: `Bearer ${token}` } },
  );

  if (!resp.ok) {
    const text = await resp.text().catch(() => '');
    console.error('Aspect fetch failed:', resp.status, text);
    return { categoryId, aspects: [] };
  }

  const data = await resp.json();
  const aspects =
    (data.aspects || []).map((aspect: any) => {
      const constraint = aspect.aspectConstraint || {};
      const mode = constraint.aspectValueSelectionMode || aspect.aspectValueSelectionMode;

      return {
        name: aspect.localizedAspectName,
        required: Boolean(constraint.aspectRequired),
        type: aspect.aspectDataType || 'STRING',
        values: (aspect.aspectValues || []).map((v: any) => v.localizedValue).filter(Boolean),
        multi: constraint.itemToAspectCardinality === 'MULTI',
        selectionOnly: mode === 'SELECTION_ONLY',
        freeTextAllowed: mode !== 'SELECTION_ONLY',
      };
    }) || [];

  return { categoryId, aspects };
}

/* =========================
   Fallback
   ========================= */
function getFallbackCategory() {
  return {
    categoryId: '11450',
    categoryName: 'Clothing, Shoes & Accessories',
    categoryPath: 'Clothing, Shoes & Accessories',
    suggestions: [
      { id: '11450', name: 'Clothing, Shoes & Accessories', path: 'Clothing, Shoes & Accessories' },
    ],
  };
}
