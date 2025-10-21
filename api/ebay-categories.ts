import type { VercelRequest, VercelResponse } from '@vercel/node';

let cachedToken: { access_token: string; expires_at: number } | null = null;
let cachedCategoryTree: any = null;

async function getOAuthToken(): Promise<string> {
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
    throw new Error('OAuth failed');
  }

  const data = await response.json();

  cachedToken = {
    access_token: data.access_token,
    expires_at: Date.now() + ((data.expires_in - 300) * 1000)
  };

  return cachedToken.access_token;
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  try {
    const { action, categoryId, keywords, title } = req.body;

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
    console.error('Error:', error);
    return res.status(500).json({ error: error.message });
  }
}

async function getCategoryTree(): Promise<any> {
  if (cachedCategoryTree) {
    return cachedCategoryTree;
  }

  const accessToken = await getOAuthToken();

  const response = await fetch('https://api.ebay.com/commerce/taxonomy/v1/category_tree/0', {
    headers: {
      'Authorization': `Bearer ${accessToken}`
    }
  });

  if (!response.ok) {
    throw new Error('Failed to get category tree');
  }

  cachedCategoryTree = await response.json();
  return cachedCategoryTree;
}

async function searchCategoryByKeywords(keywords: string[]): Promise<any[]> {
  const accessToken = await getOAuthToken();
  
  const query = keywords.join(' ');
  
  const response = await fetch(
    `https://api.ebay.com/commerce/taxonomy/v1/category_tree/0/get_category_suggestions?q=${encodeURIComponent(query)}`,
    {
      headers: {
        'Authorization': `Bearer ${accessToken}`
      }
    }
  );

  if (!response.ok) {
    console.error('Taxonomy search failed:', response.status);
    return [];
  }

  const data = await response.json();
  return data.categorySuggestions || [];
}

async function getSmartCategorySuggestions(title: string, keywords: string[]) {
  try {
    console.log('Using Taxonomy API for category suggestion');
    console.log('Title:', title);
    console.log('Keywords:', keywords);

    // Combine title and keywords for search
    const searchTerms = [title, ...keywords].filter(t => t && t.trim());
    
    const suggestions = await searchCategoryByKeywords(searchTerms);

    if (suggestions.length === 0) {
      console.log('No suggestions found, using fallback');
      return getFallbackCategory();
    }

    console.log('Found category suggestions:', suggestions.length);

    const topCategory = suggestions[0].category;

    return {
      categoryId: topCategory.categoryId,
      categoryName: topCategory.categoryName,
      suggestions: suggestions.slice(0, 3).map((s: any) => ({
        id: s.category.categoryId,
        name: s.category.categoryName
      }))
    };

  } catch (error: any) {
    console.error('Error:', error.message);
    return getFallbackCategory();
  }
}

function getFallbackCategory() {
  return {
    categoryId: '11450',
    categoryName: 'Clothing, Shoes & Accessories',
    suggestions: [{ id: '11450', name: 'Clothing, Shoes & Accessories' }]
  };
}

async function getCategorySpecificsFromAPI(categoryId: string) {
  return {
    categoryId,
    aspects: [
      { name: 'Brand', required: true, type: 'FreeText', values: [] },
      { name: 'Size', required: true, type: 'SelectionOnly', values: ['XS', 'S', 'M', 'L', 'XL', 'XXL'] },
      { name: 'Color', required: true, type: 'FreeText', values: [] },
      { name: 'Condition', required: true, type: 'SelectionOnly', values: ['New with tags', 'New without tags', 'Pre-owned'] },
      { name: 'Material', required: false, type: 'FreeText', values: [] },
      { name: 'Style', required: false, type: 'FreeText', values: [] }
    ]
  };
}
