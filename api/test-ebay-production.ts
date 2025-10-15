import type { VercelRequest, VercelResponse } from '@vercel/node';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const EBAY_PRODUCTION_APP_ID = process.env.EBAY_PRODUCTION_APP_ID;
  
  console.log('Testing with App ID:', EBAY_PRODUCTION_APP_ID?.substring(0, 20) + '...');
  
  try {
    const apiUrl = 
      `https://svcs.ebay.com/services/search/FindingService/v1?` +
      `OPERATION-NAME=findItemsByKeywords&` +
      `SERVICE-VERSION=1.0.0&` +
      `SECURITY-APPNAME=${EBAY_PRODUCTION_APP_ID}&` +
      `RESPONSE-DATA-FORMAT=JSON&` +
      `REST-PAYLOAD&` +
      `keywords=shirt&` +
      `paginationInput.entriesPerPage=1`;
    
    const response = await fetch(apiUrl);
    const data = await response.json();
    
    return res.status(200).json({
      status: response.status,
      hasError: !!data.errorMessage,
      error: data.errorMessage,
      itemCount: data?.findItemsByKeywordsResponse?.[0]?.searchResult?.[0]?.['@count'] || 0,
      fullResponse: data
    });
    
  } catch (error: any) {
    return res.status(500).json({ error: error.message });
  }
}
