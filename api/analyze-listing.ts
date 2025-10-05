import type { VercelRequest, VercelResponse } from '@vercel/node';

export const config = {
  api: {
    bodyParser: {
      sizeLimit: '50mb',
    },
  },
  maxDuration: 60,
};

export default async function handler(req: VercelRequest, res: VercelResponse) {
  // Enable CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { images, session_id } = req.body;
    
    if (!images || !Array.isArray(images) || images.length === 0) {
      return res.status(400).json({ error: 'No images provided' });
    }

    console.log(`Processing ${images.length} images for session ${session_id}`);
    
    // Step 1: Download and convert images to base64
    const base64Images = await Promise.all(
      images.slice(0, 12).map(async (url: string, index: number) => {
        try {
          // Add Cloudinary transformation for optimization
          const optimizedUrl = url.includes('cloudinary.com') 
            ? url.replace('/upload/', '/upload/w_1024,h_1024,c_limit,q_auto,f_jpg/')
            : url;
          
          console.log(`Downloading image ${index + 1}/${images.length}`);
          const response = await fetch(optimizedUrl);
          
          if (!response.ok) {
            throw new Error(`Failed to download image: ${response.status}`);
          }
          
          const buffer = await response.arrayBuffer();
          const base64 = Buffer.from(buffer).toString('base64');
          const mimeType = response.headers.get('content-type') || 'image/jpeg';
          
          return `data:${mimeType};base64,${base64}`;
        } catch (error) {
          console.error(`Error processing image ${index + 1}:`, error);
          throw error;
        }
      })
    );

    console.log('All images converted to base64, calling OpenAI...');

    // Step 2: Call OpenAI with base64 images
    const openaiResponse = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'gpt-4o',
        response_format: { type: 'json_object' },
        messages: [
          {
            role: 'system',
            content: `You are an expert eBay product lister. Analyze ALL provided photos together to create a comprehensive listing. 
            Return ONLY valid JSON with no markdown formatting.`
          },
          {
            role: 'user',
            content: [
              ...base64Images.map(img => ({
                type: 'image_url',
                image_url: {
                  url: img,
                  detail: 'low'
                }
              })),
              {
                type: 'text',
                text: `Analyze ALL ${base64Images.length} photos of this item together and return this exact JSON structure:
{
  "title": "SEO-optimized eBay title, maximum 80 characters",
  "description": "Detailed product description with key features, condition, and materials",
  "category": "Most specific eBay category path like 'Clothing, Shoes & Accessories > Women > Dresses'",
  "item_specifics": [
    {"name": "Brand", "value": "exact brand or 'Unbranded'"},
    {"name": "Size", "value": "exact size or 'See photos'"},
    {"name": "Color", "value": "primary color"},
    {"name": "Condition", "value": "New with tags | New without tags | Pre-owned | For parts"},
    {"name": "Material", "value": "material or 'See description'"},
    {"name": "Style", "value": "style if applicable"}
  ],
  "detected": {
    "brand": "visible brand name or null",
    "size": "visible size or null",
    "colors": ["primary color", "secondary color if any"],
    "condition": "New with tags | New without tags | Pre-owned | Good | Fair",
    "materials": ["visible materials"],
    "flaws": ["list any visible defects, stains, holes"] 
  },
  "keywords": ["relevant", "search", "terms", "for", "this", "item"],
  "suggested_price": "price suggestion based on item type and condition, e.g. '29.99'",
  "confidence_score": 0.95
}`
              }
            ]
          }
        ],
        max_tokens: 2048,
        temperature: 0.3
      })
    });

    if (!openaiResponse.ok) {
      const errorData = await openaiResponse.text();
      console.error('OpenAI API error:', errorData);
      throw new Error(`OpenAI API error: ${openaiResponse.status}`);
    }

    const openaiResult = await openaiResponse.json();
    console.log('OpenAI analysis complete');

    // Parse the response
    const analysisContent = openaiResult.choices[0].message.content;
    let parsedAnalysis;
    
    try {
      parsedAnalysis = JSON.parse(analysisContent);
    } catch (parseError) {
      console.error('Failed to parse OpenAI response:', analysisContent);
      throw new Error('Invalid response format from OpenAI');
    }

    // Step 3: Send to Make.com webhook if configured
    if (process.env.VITE_MAKE_WEBHOOK_URL) {
      console.log('Sending results to Make.com webhook...');
      
      try {
        const makeResponse = await fetch(process.env.VITE_MAKE_WEBHOOK_URL, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            session_id: session_id,
            analysis: parsedAnalysis,
            image_urls: images,
            timestamp: new Date().toISOString()
          })
        });

        if (!makeResponse.ok) {
          console.error('Make.com webhook failed:', makeResponse.status);
          // Don't throw - still return results to user even if Make.com fails
        } else {
          console.log('Successfully sent to Make.com');
        }
      } catch (makeError) {
        console.error('Error sending to Make.com:', makeError);
        // Don't throw - still return results to user
      }
    }

    // Return success response
    return res.status(200).json({
      success: true,
      data: parsedAnalysis,
      images_processed: base64Images.length,
      session_id: session_id
    });

  } catch (error: any) {
    console.error('Handler error:', error);
    return res.status(500).json({ 
      error: error.message || 'Internal server error',
      details: process.env.NODE_ENV === 'development' ? error.stack : undefined
    });
  }
}
