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
  // Enable CORS for frontend access
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
      images.slice(0, 12).map(async (url: string) => {
        const optimizedUrl = url.includes('cloudinary.com') 
          ? url.replace('/upload/', '/upload/w_1024,h_1024,c_limit,q_auto,f_jpg/')
          : url;
        
        const response = await fetch(optimizedUrl);
        if (!response.ok) {
          throw new Error(`Failed to download image: ${response.status}`);
        }
        
        const buffer = await response.arrayBuffer();
        const base64 = Buffer.from(buffer).toString('base64');
        const mimeType = response.headers.get('content-type') || 'image/jpeg';
        
        return `data:${mimeType};base64,${base64}`;
      })
    );

    console.log('All images converted to base64, calling OpenAI...');

    // Step 2: Call OpenAI with the new, "supercharged" prompt
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
            content: 'You are an expert eBay lister for second-hand clothing. Analyze the user-provided images to generate a complete and accurate eBay listing. Adhere strictly to the requested JSON format.'
          },
          {
            role: 'user',
            content: [
              ...base64Images.map(img => ({
                type: 'image_url',
                image_url: { url: img, detail: 'low' }
              })),
              {
                type: 'text',
                text: `Analyze all photos and return a JSON object with this exact structure. For dropdown fields, provide the most likely value. For multi-select fields, provide an array of strings.

                {
                  "title": "SEO-optimized eBay title, max 80 characters. Include brand, item type, size, and key features.",
                  "description": "A friendly and detailed paragraph describing the item. Mention the material, key features, style, and any visible flaws. End with a call to action like 'Please see the photos for details and measurements.'",
                  "category": {
                    "path": "A likely eBay category path, e.g., 'Clothing, Shoes & Accessories > Women > Women's Clothing > Sweaters'",
                    "id": "The numeric eBay category ID if you know it, otherwise null"
                  },
                  "condition": {
                    "name": "Choose one: 'New with tags', 'New without tags', 'New with defects', 'Pre-owned'",
                    "description": "A brief, honest description of the condition. e.g., 'Excellent pre-owned condition with no visible flaws.' or 'Good condition with minor pilling on the cuffs.'"
                  },
                  "item_specifics": {
                    "Brand": "The brand name of the item",
                    "Size": "The size listed on the tag (e.g., 'L', '12', 'Medium')",
                    "Style": "The specific style (e.g., 'Pullover', 'Cardigan', 'Poncho')",
                    "Color": "The primary color",
                    "Department": "Choose one: 'Women', 'Men', 'Unisex Adults', 'Girls', 'Boys'",
                    "Type": "The item type (e.g., 'Sweater', 'T-Shirt', 'Jeans')",
                    "Material": ["An array of materials, e.g., 'Cotton', 'Polyester'"],
                    "Features": ["An array of features, e.g., 'All Seasons', 'Breathable', 'Pockets'"],
                    "Neckline": "The neckline style, e.g., 'V-Neck', 'Crew Neck'",
                    "SleeveLength": "The sleeve length, e.g., 'Long Sleeve', 'Short Sleeve'",
                    "Pattern": "The pattern, e.g., 'Solid', 'Striped', 'Floral'",
                    "Fit": "e.g., 'Regular', 'Slim', 'Relaxed'",
                    "Occasion": ["An array of occasions, e.g., 'Casual', 'Business', 'Travel'"],
                    "Theme": ["An array of themes, e.g., 'Bohemian', 'Classic', 'Southwestern'"],
                    "Season": ["An array of seasons, e.g., 'Fall', 'Winter', 'Spring', 'Summer'"],
                    "Vintage": "Answer 'Yes' or 'No'"
                  },
                  "keywords": ["An array of 5-10 relevant search keywords"]
                }`
              }
            ]
          }
        ],
        max_tokens: 4096, // Increased for the larger response
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
    
    const analysisContent = openaiResult.choices[0].message.content;
    const parsedAnalysis = JSON.parse(analysisContent);

    // Step 3: Send results to Make.com webhook if configured
    if (process.env.VITE_MAKE_WEBHOOK_URL) {
      console.log('Sending results to Make.com webhook...');
      // Fire-and-forget this request; don't wait for it to complete
      fetch(process.env.VITE_MAKE_WEBHOOK_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          session_id: session_id,
          analysis: parsedAnalysis, // Sending the parsed object directly
          image_urls: images,
          timestamp: new Date().toISOString()
        })
      }).catch(makeError => {
        // Log errors but don't let them block the user response
        console.error('Error sending to Make.com:', makeError);
      });
    }

    // Return success response to the frontend
    return res.status(200).json({
      success: true,
      data: parsedAnalysis,
    });

  } catch (error: any) {
    console.error('Handler error:', error);
    return res.status(500).json({ 
      error: error.message || 'Internal server error'
    });
  }
}
