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
    
    const EBAY_APP_ID = process.env.EBAY_SANDBOX_APP_ID;

    if (action === 'getCategories') {
      // Fetch categories from eBay Taxonomy API
      const categories = await fetchEbayCategoriesFromAPI(parentCategoryId);
      return res.status(200).json({ categories });
    }

    if (action === 'searchCategories') {
      // Search categories based on query
      const results = await searchEbayCategoriesAPI(query);
      return res.status(200).json({ categories: results });
    }

    if (action === 'getSuggestedCategories') {
      // Get AI-suggested categories based on keywords - NOW USES REAL EBAY API
      const suggestions = await getSmartCategorySuggestions(title, keywords);
      return res.status(200).json(suggestions);
    }

    if (action === 'getCategorySpecifics') {
      // Get item specifics for a category
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
// REAL EBAY FINDING API IMPLEMENTATION
// ============================================

async function getSmartCategorySuggestions(title: string, keywords: string[]) {
  const EBAY_APP_ID = process.env.EBAY_SANDBOX_APP_ID;
  
  if (!EBAY_APP_ID) {
    console.error('❌ EBAY_SANDBOX_APP_ID not found in environment variables');
    return getFallbackCategory();
  }
  
  try {
    // Combine title and keywords for search
    const searchQuery = `${title} ${keywords.join(' ')}`.trim();
    
    if (!searchQuery) {
      console.log('⚠️ Empty search query, using fallback');
      return getFallbackCategory();
    }
    
    // Call eBay Finding API
    const apiUrl = 
      `https://svcs.sandbox.ebay.com/services/search/FindingService/v1?` +
      `OPERATION-NAME=findItemsByKeywords&` +
      `SERVICE-VERSION=1.0.0&` +
      `SECURITY-APPNAME=${EBAY_APP_ID}&` +
      `RESPONSE-DATA-FORMAT=JSON&` +
      `REST-PAYLOAD&` +
      `keywords=${encodeURIComponent(searchQuery)}&` +
      `paginationInput.entriesPerPage=10`;
    
    console.log('🔍 Calling eBay Finding API...');
    console.log('📝 Search query:', searchQuery);
    
    const response = await fetch(apiUrl);
    
    if (!response.ok) {
      throw new Error(`eBay API returned status ${response.status}`);
    }
    
    const data = await response.json();
    
    // Check for API errors in response
    if (data.errorMessage) {
      console.error('❌ eBay API error:', data.errorMessage);
      return getFallbackCategory();
    }
    
    // Extract categories from search results
    const categories = extractCategoriesFromResults(data);
    
    if (categories.length === 0) {
      console.log('⚠️ No categories found in eBay results, using fallback');
      return getFallbackCategory();
    }
    
    console.log('✅ Found categories:', categories.map(c => c.name));
    
    // Return the most common category as primary, rest as suggestions
    return {
      categoryId: categories[0].id,
      categoryName: categories[0].name,
      suggestions: categories.slice(0, 3) // Top 3 suggestions
    };
    
  } catch (error: any) {
    console.error('❌ Error calling eBay Finding API:', error.message);
    return getFallbackCategory();
  }
}

function extractCategoriesFromResults(data: any) {
  const categoryMap = new Map<string, { id: string; name: string; count: number }>();
  
  try {
    // Navigate eBay's nested response structure
    const searchResult = data?.findItemsByKeywordsResponse?.[0]?.searchResult?.[0];
    const items = searchResult?.item || [];
    
    console.log(`📦 Found ${items.length} items from eBay search`);
    
    if (items.length === 0) {
      return [];
    }
    
    // Count categories from all items
    for (const item of items) {
      const categoryId = item.primaryCategory?.[0]?.categoryId?.[0];
      const categoryName = item.primaryCategory?.[0]?.categoryName?.[0];
      
      if (categoryId && categoryName) {
        if (categoryMap.has(categoryId)) {
          const existing = categoryMap.get(categoryId)!;
          existing.count++;
        } else {
          categoryMap.set(categoryId, {
            id: categoryId,
            name: categoryName,
            count: 1
          });
        }
      }
    }
    
    // Sort by count (most common first)
    const sortedCategories = Array.from(categoryMap.values())
      .sort((a, b) => b.count - a.count)
      .map(cat => ({ id: cat.id, name: cat.name }));
    
    console.log('📊 Category breakdown:', sortedCategories.map(c => `${c.name} (${c.id})`));
    
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
    suggestions: [
      { id: '11450', name: 'Clothing, Shoes & Accessories' }
    ]
  };
}

// ============================================
// PLACEHOLDER FUNCTIONS (Will update in Task 2)
// ============================================

async function fetchEbayCategoriesFromAPI(parentId: string) {
  // Root categories
  if (!parentId || parentId === '0') {
    return [
      { id: '11450', name: 'Clothing, Shoes & Accessories', hasChildren: true },
      { id: '293', name: 'Electronics', hasChildren: true },
      { id: '11700', name: 'Home & Garden', hasChildren: true },
      { id: '888', name: 'Sporting Goods', hasChildren: true },
      { id: '6000', name: 'eBay Motors', hasChildren: true },
      { id: '1', name: 'Collectibles', hasChildren: true },
      { id: '550', name: 'Art', hasChildren: true },
      { id: '2984', name: 'Baby', hasChildren: true }
    ];
  }
  
  // Child categories
  if (parentId === '11450') {
    return [
      { id: '15724', name: 'Women', hasChildren: true },
      { id: '1059', name: 'Men', hasChildren: true },
      { id: '175984', name: 'Kids', hasChildren: true },
      { id: '163224', name: 'Unisex', hasChildren: true }
    ];
  }
  
  return [];
}

async function searchEbayCategoriesAPI(query: string) {
  // TODO: Implement category search logic
  return [];
}

async function getCategorySpecificsFromAPI(categoryId: string) {
  // TODO: Will implement real eBay GetCategorySpecifics API in Task 2
  // For now, return basic structure
  console.log('⚠️ Using mock category specifics - Task 2 will fix this');
  
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
