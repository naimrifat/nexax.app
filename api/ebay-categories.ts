import type { VercelRequest, VercelResponse } from '@vercel/node';

let cachedToken: { access_token: string; expires_at: number } | null = null;

async function getOAuthToken(): Promise<string> {
  // Check if we have a valid cached token
  if (cachedToken && cachedToken.expires_at > Date.now()) {
    return cachedToken.access_token;
  }

  const clientId = process.env.EBAY_PRODUCTION_APP_ID || process.env.EBAY_CLIENT_ID;
  const clientSecret = process.env.EBAY_PRODUCTION_CERT_ID || process.env.EBAY_CLIENT_SECRET;

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
    const { action, parentCategoryId, categoryId, keywords, title, query } = req.body;

    if (action === 'getCategories') {
      const categories = await fetchEbayCategoriesFromAPI(parentCategoryId);
      return res.status(200).json({ categories });
    }

    if (action === 'searchCategories') {
      const results = await searchEbayCategoriesAPI(query);
      return res.status(200).json({ categories: results });
    }

    if (action === 'getSuggestedCategories') {
      const suggestions = await getSmartCategorySuggestions(title, keywords);
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
// BROWSE API IMPLEMENTATION (Replacement for Finding API)
// ============================================

async function getSmartCategorySuggestions(title: string, keywords: string[]) {
  try {
    const searchQuery = `${title} ${keywords.join(' ')}`.trim();

    if (!searchQuery) {
      console.log('⚠️ Empty search query');
      return getFallbackCategory();
    }

    console.log('🔍 Calling eBay Browse API...');
    console.log('📝 Search query:', searchQuery);

    // Get OAuth token
    const accessToken = await getOAuthToken();

    // Call Browse API
    const apiUrl = `https://api.ebay.com/buy/browse/v1/item_summary/search?q=${encodeURIComponent(searchQuery)}&limit=10`;

    const response = await fetch(apiUrl, {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'X-EBAY-C-MARKETPLACE-ID': 'EBAY_US',
        'Accept': 'application/json'
      }
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error('❌ Browse API error:', response.status, errorText);
      return getFallbackCategory();
    }

    const data = await response.json();

    // Extract categories from search results
    const categories = extractCategoriesFromBrowseResults(data);

    if (categories.length === 0) {
      console.log('⚠️ No categories found in results');
      return getFallbackCategory();
    }

    console.log('✅ Found categories:', categories.map(c => c.name));

    return {
      categoryId: categories[0].id,
      categoryName: categories[0].name,
      suggestions: categories.slice(0, 3)
    };

  } catch (error: any) {
    console.error('❌ Error:', error.message);
    return getFallbackCategory();
  }
}

function extractCategoriesFromBrowseResults(data: any) {
  const categoryMap = new Map<string, { id: string; name: string; count: number }>();

  try {
    const items = data.itemSummaries || [];

    console.log(`📦 Found ${items.length} items from Browse API`);

    if (items.length === 0) return [];

    // Extract categories from each item
    for (const item of items) {
      // Browse API returns categories in a nested structure
      const categories = item.categories || [];

      for (const category of categories) {
        const categoryId = category.categoryId;
        const categoryName = category.categoryName;

        if (categoryId && categoryName) {
          if (categoryMap.has(categoryId)) {
            categoryMap.get(categoryId)!.count++;
          } else {
            categoryMap.set(categoryId, {
              id: categoryId,
              name: categoryName,
              count: 1
            });
          }
        }
      }
    }

    // Sort by frequency (most common first)
    const sortedCategories = Array.from(categoryMap.values())
      .sort((a, b) => b.count - a.count)
      .map(cat => ({ id: cat.id, name: cat.name }));

    console.log('📊 Categories:', sortedCategories.map(c => `${c.name} (${c.id})`));

    return sortedCategories;

  } catch (error) {
    console.error('❌ Error extracting categories:', error);
    return [];
  }
}

function getFallbackCategory() {
  return {
    categoryId: '11450',
    categoryName: 'Clothing, Shoes & Accessories',
    suggestions: [{ id: '11450', name: 'Clothing, Shoes & Accessories' }]
  };
}

// ============================================
// PLACEHOLDER FUNCTIONS
// ============================================

async function fetchEbayCategoriesFromAPI(parentId: string) {
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
  return [];
}

async function getCategorySpecificsFromAPI(categoryId: string) {
  console.log('⚠️ Using mock - Task 2 will fix this');

  return {
    categoryId,
    aspects: [
      { name: 'Brand', required: true, type: 'FreeText', values: [] },
      { name: 'Size', required: true, type: 'SelectionOnly', values: ['XS', 'S', 'M', 'L', 'XL'] },
      { name: 'Color', required: true, type: 'FreeText', values: [] },
      { name: 'Condition', required: true, type: 'SelectionOnly', values: ['New with tags', 'New without tags', 'Pre-owned'] }
    ]
  };
}
```

---

## ✅ **What Changed:**

1. **Line 5-35:** Added OAuth token generation (Browse API requires OAuth)
2. **Line 100-140:** Replaced Finding API call with Browse API
3. **Line 142-190:** Updated category extraction for Browse API response format
4. **Token caching:** Reuses tokens for 2 hours to avoid hitting rate limits

---

## 🧪 **Test It:**

1. **Save the file**
2. **Push to GitHub** (Vercel auto-deploys)
3. **Upload a product image** to your app
4. **Check Vercel logs** - should see:
```
   🔍 Calling eBay Browse API...
   📦 Found 10 items from Browse API
   📊 Categories: Dresses (63861), Women's Clothing (15724)
   ✅ Found categories: [...]
