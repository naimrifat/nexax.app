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
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { images } = req.body; // Cloudinary URLs from frontend
    
    // Step 1: Download and convert to base64 with optimization
    const base64Images = await Promise.all(
      images.slice(0, 12).map(async (url: string) => {
        // Add Cloudinary transformation for smaller size
        const optimizedUrl = url.replace('/upload/', '/upload/w_1024,h_1024,c_limit,q_auto/');
        
        const response = await fetch(optimizedUrl);
        const buffer = await response.arrayBuffer();
        const base64 = Buffer.from(buffer).toString('base64');
        const mimeType = response.headers.get('content-type') || 'image/jpeg';
        return `data:${mimeType};base64,${base64}`;
      })
    );

    // Step 2: Call OpenAI with base64 images
    const openaiResponse = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'gpt-4o', // Use full model for reliability
        response_format: { type: 'json_object' },
        messages: [
          {
            role: 'system',
            content: 'You are an expert eBay product lister. Analyze ALL provided photos together to create a comprehensive listing.'
          },
          {
            role: 'user',
            content: [
              ...base64Images.map(img => ({
                type: 'image_url',
                image_url: {
                  url: img,
                  detail: 'low' // Critical for multiple images
                }
              })),
              {
                type: 'text',
                text: `Analyze ALL photos and return this JSON structure:
{
  "title": "SEO-optimized eBay title, max 80 chars",
  "description": "Detailed product description",
  "category": "eBay category path",
  "item_specifics": [
    {"name": "Brand", "value": "..."},
    {"name": "Size", "value": "..."},
    {"name": "Color", "value": "..."},
    {"name": "Condition", "value": "..."}
  ],
  "detected": {
    "brand": "visible brand or null",
    "size": "visible size or null",
    "colors": ["primary", "secondary"],
    "condition": "New/Used/etc",
    "flaws": ["any visible issues"]
  },
  "keywords": ["relevant", "search", "terms"]
}`
              }
            ]
          }
        ],
        max_tokens: 2048
      })
    });

    const result = await openaiResponse.json();
    
    // Step 3: Send to Make.com for further processing
    if (process.env.VITE_MAKE_WEBHOOK_URL) {
      await fetch(process.env.VITE_MAKE_WEBHOOK_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          session_id: req.body.session_id,
          analysis: result.choices[0].message.content
        })
      });
    }

    return res.status(200).json({
      success: true,
      data: result.choices[0].message.content
    });

  } catch (error: any) {
    console.error('Error:', error);
    return res.status(500).json({ 
      error: error.message,
      details: error.response?.data || 'Unknown error'
    });
  }
}
