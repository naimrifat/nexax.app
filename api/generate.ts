import type { VercelRequest, VercelResponse } from '@vercel/node';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ message: 'Only POST requests are allowed' });
  }

  try {
    const { image_base64 } = req.body;
    if (!image_base64) {
      return res.status(400).json({ message: 'Missing image_base64 in request body' });
    }

    const imgbbApiKey = process.env.VITE_IMGBB_API_KEY;
    const makeWebhookUrl = process.env.VITE_MAKE_WEBHOOK_URL;

    if (!imgbbApiKey || !makeWebhookUrl) {
      console.error("Missing environment variables on Vercel.");
      return res.status(500).json({ message: 'Server configuration error. Please check Vercel settings.' });
    }

    // Upload image to ImgBB
    const formData = new URLSearchParams();
    formData.append('image', image_base64);

    const imgbbResponse = await fetch(`https://api.imgbb.com/1/upload?key=${imgbbApiKey}`, {
      method: 'POST',
      body: formData,
    });

    if (!imgbbResponse.ok) {
      const errorText = await imgbbResponse.text();
      console.error("Error from ImgBB:", errorText);
      return res.status(502).json({ message: 'Error from image hosting service.' });
    }

    const imgbbData = await imgbbResponse.json();
    if (!imgbbData.success) {
      console.error("ImgBB upload failed:", imgbbData);
      return res.status(500).json({ message: 'Image hosting failed.' });
    }

    const imageUrl = imgbbData.data.url;

    // Send image URL to Make.com
    const makeResponse = await fetch(makeWebhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ image_url: imageUrl }),
    });

    if (!makeResponse.ok) {
      const errorText = await makeResponse.text();
      console.error("Error from Make.com:", errorText);
      return res.status(502).json({ message: 'Error from AI service.' });
    }

    // FIXED: Get raw text first, clean it thoroughly, then parse
    const rawText = await makeResponse.text();
    
    // Debug: Log the problematic area (position 22, line 2)
    console.log("Raw response length:", rawText.length);
    console.log("Character codes around position 22:", 
      rawText.substring(15, 30).split('').map((char, i) => 
        `${i + 15}: '${char}' (${char.charCodeAt(0)})`
      ).join(', ')
    );
    
    // Ultra aggressive cleaning - only keep printable ASCII + basic whitespace
    const ultraClean = rawText
      .split('')
      .map(char => {
        const code = char.charCodeAt(0);
        // Keep: space (32), printable ASCII (33-126), tab (9), newline (10)
        if (code === 32 || (code >= 33 && code <= 126) || code === 9 || code === 10) {
          return char;
        }
        return ''; // Remove everything else
      })
      .join('')
      .replace(/\s+/g, ' ') // collapse multiple spaces
      .trim();

    console.log("Ultra cleaned response (first 100 chars):", ultraClean.substring(0, 100));

    let rawData;
    try {
      rawData = JSON.parse(ultraClean);
    } catch (parseError) {
      console.error("Even ultra clean parsing failed:", parseError);
      console.error("Problem area in ultra clean:", 
        ultraClean.substring(15, 30).split('').map((char, i) => 
          `${i + 15}: '${char}' (${char.charCodeAt(0)})`
        ).join(', ')
      );
      
      // Last resort - try to fix common JSON issues
      let lastResort = ultraClean
        .replace(/([{,]\s*)([a-zA-Z_][a-zA-Z0-9_]*)\s*:/g, '$1"$2":') // Add quotes to unquoted keys
        .replace(/:\s*([^"{\[\s][^,}\]]*[^,}\]\s])\s*([,}\]])/g, ':"$1"$2') // Quote unquoted string values
        .replace(/,\s*([}\]])/g, '$1') // Remove trailing commas
        .replace(/\n/g, '\\n'); // Escape newlines in strings
      
      try {
        rawData = JSON.parse(lastResort);
        console.log("Last resort parsing succeeded!");
      } catch (finalError) {
        console.error("All parsing attempts failed:", finalError);
        console.error("Final attempt content:", lastResort.substring(0, 200));
        return res.status(502).json({ message: 'Invalid response format from AI service.' });
      }
    }

    // Cleaner function to strip Markdown formatting and bad control characters
    const cleanJSONString = (raw: string) => {
      return raw
        .replace(/```json\n?/gi, '')
        .replace(/```/gi, '')
        .replace(/\u0000/g, '')   // null
        .replace(/\u0008/g, '')   // backspace
        .replace(/\r/g, '')       // carriage return
        .trim();
    };

    // Safe parse wrapper
    const safeParse = (str: string, label: string) => {
      try {
        return JSON.parse(str);
      } catch (err) {
        console.error(`Failed to parse ${label}:`, err);
        return null;
      }
    };

    const cleanedTitles = cleanJSONString(rawData.titles_string || '');
    const cleanedSpecifics = cleanJSONString(rawData.specifics_string || '');

    const titles = safeParse(cleanedTitles, 'titles_string');
    const specifics = safeParse(cleanedSpecifics, 'specifics_string');
    const description = rawData.description;

    if (!titles || !specifics || !description) {
      return res.status(400).json({ message: "Invalid or missing data in AI response." });
    }

    // Return clean JSON to frontend
    return res.status(200).json({
      titles,
      specifics,
      description,
    });

  } catch (error) {
    console.error("Internal Server Error:", error);
    return res.status(500).json({ message: 'An internal server error occurred.' });
  }
}
