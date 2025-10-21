import type { VercelRequest, VercelResponse } from '@vercel/node';

let cachedToken: { access_token: string; expires_at: number } | null = null;

async function getOAuthToken(): Promise<string> {
  // Check if we have a valid cached token
  if (cachedToken && cachedToken.expires_at > Date.now()) {
    return cachedToken.access_token;
  }

  // Use the production env vars you set up
  const clientId = process.env.EBAY_CLIENT_ID;
  const clientSecret = process.env.EBAY_CLIENT_SECRET;

  if (!clientId || !clientSecret) {
    throw new Error('eBay credentials not found');
  }

  const encodedCreds = Buffer.from(`${clientId}:${clientSecret}`).toString('base64');

  const response = await fetch('https://api.ebay.com/identity/v1/oauth2/token', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      'Authorization': `Basic ${encodedCreds}`
    },
    body: 'grant_type=client_credentials&scope=https://api.ebay.com/oauth/api_scope'
  });

  if (!response.ok) {
    throw new Error(`OAuth failed: ${response.status}`);
  }

  const data = await response.json();

  // Cache token (expires in 2 hours, we'll refresh 5 min early)
  cachedToken = {
    access_token: data.access_token,
    expires_at: Date.now() + ((data.expires_in - 300) * 1000)
  };

  return cachedToken.access_token;
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  try {
    const { action, parentCategoryId, categoryId, title, query } = req.body;

    if (action === 'getCategories') {
      const categories = await fetchEbayCategoriesFromAPI(parentCategoryId);
      return res.status(200).json({ categories });
    }

    if (action === 'searchCategories') {
      const results = await searchEbayCategoriesAPI(query);
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
    return res.status(500).json({
      error: 'Failed to fetch eBay data',
      details: error.message
    });
  }
}

// ============================================
// TAXONOMY API IMPLEMENTATION (Correct)
// ============================================

async function getSmartCategorySuggestions(title: string) {
  try {
    const searchQuery = title.trim();

    if (!searchQuery) {
      console.log('⚠️ Empty title, using fallback');
      return getFallbackCategory();
    }

    console.log(`🔍 Calling eBay Taxonomy API for title: "${searchQuery}"`);
    const accessToken = await getOAuthToken();
    
    // Using 0 for EBAY_US marketplace
    const apiUrl = `https://api.ebay.com/commerce/taxonomy/v1/category_tree/0/get_category_suggestions?q=${encodeURIComponent(searchQuery)}`;

    const response = await fetch(apiUrl, {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Accept': 'application/json',
        'Content-Type': 'application/json'
      }
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error('❌ Taxonomy API error:', response.status, errorText);
      return getFallbackCategory();
    }

    const data = await response.json();
    const suggestions = data.categorySuggestions || [];

    if (suggestions.length === 0) {
      console.log('⚠️ No categories found, using fallback');
      return getFallbackCategory();
    }

    const formattedSuggestions = suggestions.map((sug: any) => ({
      id: sug.category.categoryId,
      name: sug.category.categoryName
    }));

    console.log('✅ Found suggestions:', formattedSuggestions.map(c => c.name));

    return {
      categoryId: formattedSuggestions[0].id,
      categoryName: formattedSuggestions[0].name,
      suggestions: formattedSuggestions.slice(0, 3)
    };

  } catch (error: any) {
    console.error('❌ Error in getSmartCategorySuggestions:', error.message);
    return getFallbackCategory();
  }
}

async function getCategorySpecificsFromAPI(categoryId: string) {
  console.log(`Fetching specifics for category ${categoryId}...`);
  try {
    const accessToken = await getOAuthToken();
    
    const apiUrl = `https://api.ebay.com/commerce/taxonomy/v1/category_tree/0/get_item_aspects_for_category?category_id=${categoryId}`;

    const response = await fetch(apiUrl, {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Accept': 'application/json',
        'Content-Type': 'application/json'
      }
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error('❌ Error fetching specifics:', response.status, errorText);
      return { categoryId, aspects: [] };
    }

    const data = await response.json();

    const mappedAspects = data.aspects.map((aspect: any) => ({
      name: aspect.localizedAspectName,
      required: aspect.aspectConstraint.aspectRequired,
      type: aspect.aspectConstraint.aspectMode,
      values: (aspect.aspectValues || []).map((val: any) => val.localizedValue)
    }));

    return {
      categoryId: categoryId,
      aspects: mappedAspects
    };
    
  } catch (error: any) {
    console.error('❌ Error in getCategorySpecificsFromAPI:', error.message);
    return { categoryId, aspects: [] };
  }
}

// ============================================
// PLACEHOLDER & FALLBACK FUNCTIONS
// ============================================

function getFallbackCategory() {
  return {
    categoryId: '11450',
    categoryName: 'Clothing, Shoes & Accessories',
    suggestions: [{ id: '11450', name: 'Clothing, Shoes & Accessories' }]
  };
}

async function fetchEbayCategoriesFromAPI(parentId: string) {
  // You can expand this to use the Taxonomy API as well
  if (!parentId || parentId === '0') {
    return [
      { id: '11450', name: 'Clothing, Shoes & Accessories', hasChildren: true },
      { id: '293', name: 'Electronics', hasChildren: true },
      { id: '11700', name: 'Home & Garden', hasChildren: true }
    ];
  }
  return [];
}

async function searchEbayCategoriesAPI(query: string) {
  // You can also replace this with the Taxonomy API if needed
  return [];
}
