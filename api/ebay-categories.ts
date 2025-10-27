// api/ebay-categories.ts
import type { VercelRequest, VercelResponse } from '@vercel/node';

let cachedToken: { access_token: string; expires_at: number } | null = null;

async function getOAuthToken(): Promise<string> {
  if (cachedToken && cachedToken.expires_at > Date.now()) return cachedToken.access_token;
  const clientId = process.env.EBAY_CLIENT_ID!;
  const clientSecret = process.env.EBAY_CLIENT_SECRET!;
  const encoded = Buffer.from(`${clientId}:${clientSecret}`).toString('base64');

  const r = await fetch('https://api.ebay.com/identity/v1/oauth2/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', Authorization: `Basic ${encoded}` },
    body: 'grant_type=client_credentials&scope=https://api.ebay.com/oauth/api_scope'
  });
  if (!r.ok) throw new Error(`OAuth failed: ${r.status}`);
  const data = await r.json();
  cachedToken = { access_token: data.access_token, expires_at: Date.now() + ((data.expires_in - 300) * 1000) };
  return cachedToken.access_token;
}

const TREE_ID = 0; // EBAY_US

export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  try {
    const { action, parentCategoryId, categoryId, title, query } = req.body || {};

    if (action === 'getCategories') {
      const items = await getChildCategories(parentCategoryId);
      return res.status(200).json({ categories: items });
    }

    if (action === 'searchCategories') {
      const results = await searchCategories(query);
      return res.status(200).json({ categories: results });
    }

    if (action === 'getSuggestedCategories') {
      const suggestions = await getSmartCategorySuggestions(title);
      return res.status(200).json(suggestions);
    }

    if (action === 'getCategorySpecifics') {
      const specifics = await getCategorySpecificsFromAPI(categoryId);
      return res.status(200).json(specifics);
    }

    return res.status(400).json({ error: 'Invalid action' });
  } catch (error: any) {
    console.error('eBay API error:', error);
    return res.status(500).json({ error: 'Failed to fetch eBay data', details: error.message });
  }
}

/** -------- CATEGORY CHILDREN FOR BROWSER --------
 * parentCategoryId is:
 * - empty/undefined/'0' => return root children
 * - otherwise          => return that node’s children
 */
async function getChildCategories(parentId?: string) {
  const token = await getOAuthToken();

  // Top-level nodes
  if (!parentId || parentId === '0') {
    const r = await fetch(`https://api.ebay.com/commerce/taxonomy/v1/category_tree/${TREE_ID}`, {
      headers: { Authorization: `Bearer ${token}` }
    });
    if (!r.ok) throw new Error(`root tree failed: ${r.status}`);
    const data = await r.json();
    const nodes = data.rootCategoryNode?.childCategoryTreeNodes || [];
    return nodes.map((n: any) => ({
      id: n.category?.categoryId,
      name: n.category?.categoryName,
      hasChildren: Array.isArray(n.childCategoryTreeNodes) && n.childCategoryTreeNodes.length > 0
    }));
  }

  // Children for a given node
  const r = await fetch(
    `https://api.ebay.com/commerce/taxonomy/v1/category_tree/${TREE_ID}/get_category_subtree?category_id=${encodeURIComponent(parentId)}`,
    { headers: { Authorization: `Bearer ${token}` } }
  );
  if (!r.ok) throw new Error(`subtree failed: ${r.status}`);
  const data = await r.json();
  const nodes = data.categorySubtreeNode?.childCategoryTreeNodes || [];
  return nodes.map((n: any) => ({
    id: n.category?.categoryId,
    name: n.category?.categoryName,
    hasChildren: Array.isArray(n.childCategoryTreeNodes) && n.childCategoryTreeNodes.length > 0
  }));
}

/** -------- SEARCH USING SUGGESTIONS -------- */
async function searchCategories(q: string) {
  if (!q?.trim()) return [];
  const token = await getOAuthToken();
  const r = await fetch(
    `https://api.ebay.com/commerce/taxonomy/v1/category_tree/${TREE_ID}/get_category_suggestions?q=${encodeURIComponent(q)}`,
    { headers: { Authorization: `Bearer ${token}` } }
  );
  if (!r.ok) return [];
  const data = await r.json();
  const suggestions = data.categorySuggestions || [];
  return suggestions.map((s: any) => {
    const crumbs = [
      ...(s.categoryTreeNodeAncestors || []).map((a: any) => a.categoryName),
      s.category?.categoryName
    ];
    return {
      id: s.category?.categoryId,
      name: s.category?.categoryName,
      path: crumbs.join(' > ')
    };
  });
}

/** -------- SMART CATEGORY FOR AUTO-SELECTION (adds path) -------- */
async function getSmartCategorySuggestions(title: string) {
  const q = (title || '').trim();
  if (!q) return getFallbackCategory();

  const token = await getOAuthToken();
  const r = await fetch(
    `https://api.ebay.com/commerce/taxonomy/v1/category_tree/${TREE_ID}/get_category_suggestions?q=${encodeURIComponent(q)}`,
    { headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' } }
  );
  if (!r.ok) return getFallbackCategory();

  const data = await r.json();
  const sugs = (data.categorySuggestions || []).map((s: any) => {
    const crumbs = [
      ...(s.categoryTreeNodeAncestors || []).map((a: any) => a.categoryName),
      s.category?.categoryName
    ];
    return {
      id: s.category?.categoryId,
      name: s.category?.categoryName,
      path: crumbs.join(' > ') // <— breadcrumb string
    };
  });

  if (!sugs.length) return getFallbackCategory();
  return {
    categoryId: sugs[0].id,
    categoryName: sugs[0].name,
    categoryPath: sugs[0].path,
    suggestions: sugs.slice(0, 5) // include path on each
  };
}

/** -------- CATEGORY SPECIFICS -------- */
async function getCategorySpecificsFromAPI(categoryId: string) {
  const token = await getOAuthToken();
  const r = await fetch(
    `https://api.ebay.com/commerce/taxonomy/v1/category_tree/${TREE_ID}/get_item_aspects_for_category?category_id=${encodeURIComponent(categoryId)}`,
    { headers: { Authorization: `Bearer ${token}` } }
  );
  if (!r.ok) return { categoryId, aspects: [] };
  const data = await r.json();
  return {
    categoryId,
    aspects: (data.aspects || []).map((a: any) => ({
      name: a.localizedAspectName,
      required: a.aspectConstraint?.aspectRequired,
      type: a.aspectConstraint?.aspectMode,
      values: (a.aspectValues || []).map((v: any) => v.localizedValue)
    }))
  };
}

function getFallbackCategory() {
  return {
    categoryId: '11450',
    categoryName: 'Clothing, Shoes & Accessories',
    categoryPath: 'Clothing, Shoes & Accessories',
    suggestions: [{ id: '11450', name: 'Clothing, Shoes & Accessories', path: 'Clothing, Shoes & Accessories' }]
  };
}
