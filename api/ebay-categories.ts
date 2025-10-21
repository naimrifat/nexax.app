// ============================================
// TAXONOMY API IMPLEMENTATION (Correct Way)
// ============================================

async function getSmartCategorySuggestions(title: string, keywords: string[]) {
  try {
    const searchQuery = title.trim(); // The title is all you need

    if (!searchQuery) {
      console.log('⚠️ Empty title, using fallback');
      return getFallbackCategory();
    }

    console.log(`🔍 Calling eBay Taxonomy API for title: "${searchQuery}"`);

    // 1. Get OAuth token
    const accessToken = await getOAuthToken();

    // 2. This is the correct API endpoint.
    // The Marketplace ID (0 for US) goes directly into the URL.
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

    // 3. The response is much simpler and more accurate
    const suggestions = data.categorySuggestions || [];

    if (suggestions.length === 0) {
      console.log('⚠️ No categories found, using fallback');
      return getFallbackCategory();
    }

    // 4. Map the API response to the format your UI expects
    const formattedSuggestions = suggestions.map((sug: any) => ({
      id: sug.category.categoryId,
      name: sug.category.categoryName
    }));

    console.log('✅ Found suggestions:', formattedSuggestions.map(c => c.name));

    // Return the top suggestion and the top 3 suggestions
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
