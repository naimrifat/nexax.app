import type { VercelRequest, VercelResponse } from '@vercel/node';

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
// PRODUCTION EBAY FINDING API
// Uses production API for real category data
// ============================================

async function getSmartCategorySuggestions(title: string, keywords: string[]) {
  const EBAY_PRODUCTION_APP_ID = process.env.EBAY_PRODUCTION_APP_ID;
  
  if (!EBAY_PRODUCTION_APP_ID) {
    console.error('❌ EBAY_PRODUCTION_APP_ID not found');
    return getFallbackCategory();
  }
  
  try {
    const searchQuery = `${title} ${keywords.join(' ')}`.trim();
    
    if (!searchQuery) {
      console.log('⚠️ Empty search query');
      return getFallbackCategory();
    }
    
    // PRODUCTION Finding API
    const apiUrl = 
      `https://svcs.ebay.com/services/search/FindingService/v1?` +
      `OPERATION-NAME=findItemsByKeywords&` +
      `SERVICE-VERSION=1.0.0&` +
      `SECURITY-APPNAME=${EBAY_PRODUCTION_APP_ID}&` +
      `RESPONSE-DATA-FORMAT=JSON&` +
      `REST-PAYLOAD&` +
      `keywords=${encodeURIComponent(searchQuery)}&` +
      `paginationInput.entriesPerPage=10`;
    
    console.log('🔍 Calling eBay PRODUCTION Finding API...');
    console.log('📝 Search query:', searchQuery);
    
    const response = await fetch(apiUrl);
    
    if (!response.ok) {
      throw new Error(`eBay API returned status ${response.status}`);
    }
    
    const data = await response.json();
    
    if (data.errorMessage) {
      console.error('❌ eBay API error:', data.errorMessage);
      return getFallbackCategory();
    }
    
    const categories = extractCategoriesFromResults(data);
    
    if (categories.length === 0) {
      console.log('⚠️ No categories found');
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

function extractCategoriesFromResults(data: any) {
  const categoryMap = new Map<string, { id: string; name: string; count: number }>();
  
  try {
    const searchResult = data?.findItemsByKeywordsResponse?.[0]?.searchResult?.[0];
    const items = searchResult?.item || [];
    
    console.log(`📦 Found ${items.length} items`);
    
    if (items.length === 0) return [];
    
    for (const item of items) {
      const categoryId = item.primaryCategory?.[0]?.categoryId?.[0];
      const categoryName = item.primaryCategory?.[0]?.categoryName?.[0];
      
      if (categoryId && categoryName) {
        if (categoryMap.has(categoryId)) {
          categoryMap.get(categoryId)!.count++;
        } else {
          categoryMap.set(categoryId, { id: categoryId, name: categoryName, count: 1 });
        }
      }
    }
    
    const sorted = Array.from(categoryMap.values())
      .sort((a, b) => b.count - a.count)
      .map(cat => ({ id: cat.id, name: cat.name }));
    
    console.log('📊 Categories:', sorted.map(c => `${c.name} (${c.id})`));
    
    return sorted;
    
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
