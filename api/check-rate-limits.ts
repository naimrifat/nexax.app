import type { VercelRequest, VercelResponse } from '@vercel/node';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  try {
    // Step 1: Get OAuth token using client credentials
    const clientId = process.env.EBAY_PRODUCTION_APP_ID || process.env.EBAY_CLIENT_ID;
    const clientSecret = process.env.EBAY_PRODUCTION_CERT_ID || process.env.EBAY_CLIENT_SECRET;
    
    if (!clientId || !clientSecret) {
      return res.status(500).json({ error: 'Missing eBay credentials' });
    }
    
    console.log('Getting OAuth token...');
    
    const encodedCreds = Buffer.from(`${clientId}:${clientSecret}`).toString('base64');
    
    const tokenResponse = await fetch('https://api.ebay.com/identity/v1/oauth2/token', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Authorization': `Basic ${encodedCreds}`
      },
      body: 'grant_type=client_credentials&scope=https://api.ebay.com/oauth/api_scope'
    });
    
    if (!tokenResponse.ok) {
      const errorText = await tokenResponse.text();
      return res.status(500).json({ 
        error: 'Failed to get OAuth token', 
        details: errorText 
      });
    }
    
    const tokenData = await tokenResponse.json();
    const accessToken = tokenData.access_token;
    
    console.log('Got OAuth token, checking rate limits...');
    
    // Step 2: Call getRateLimits API
    const rateLimitResponse = await fetch('https://api.ebay.com/developer/analytics/v1_beta/rate_limit/', {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Accept': 'application/json'
      }
    });
    
    if (!rateLimitResponse.ok) {
      const errorText = await rateLimitResponse.text();
      return res.status(500).json({ 
        error: 'Failed to get rate limits', 
        status: rateLimitResponse.status,
        details: errorText 
      });
    }
    
    const rateLimitData = await rateLimitResponse.json();
    
    console.log('Rate limit data:', JSON.stringify(rateLimitData, null, 2));
    
    // Step 3: Find Finding API limits specifically
    const findingApiLimits = rateLimitData.rateLimits?.find((limit: any) => 
      limit.apiName === 'Finding API' || 
      limit.apiContext?.includes('finding') ||
      limit.resources?.some((r: any) => r.name?.includes('findItemsByKeywords'))
    );
    
    return res.status(200).json({
      success: true,
      allLimits: rateLimitData,
      findingApiLimits: findingApiLimits || 'Not found - may indicate no access',
      summary: {
        hasData: !!rateLimitData.rateLimits,
        totalApis: rateLimitData.rateLimits?.length || 0,
        findingApiFound: !!findingApiLimits
      }
    });
    
  } catch (error: any) {
    console.error('Error checking rate limits:', error);
    return res.status(500).json({ 
      error: error.message,
      stack: error.stack 
    });
  }
}
