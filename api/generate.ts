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

    // FIXED: Get raw text first, handle markdown-wrapped responses
    const rawText = await makeResponse.text();
    
    console.log("Raw response (first 300 chars):", rawText.substring(0, 300));
    
    let rawData;
    try {
      rawData = JSON.parse(rawText);
      console.log("Successfully parsed raw response");
    } catch (parseError) {
      console.log("Direct parsing failed, likely due to markdown wrapping:", parseError.message);
      
      // The AI responses are wrapped in ```json blocks, so we need to clean them first
      try {
        // Clean the entire response by removing markdown blocks and fixing structure
        let cleanedResponse = rawText
          // Remove markdown code block wrappers
          .replace(/```json\s*/g, '')
          .replace(/```\s*/g, '')
          // Fix the JSON structure - the issue is quotes aren't properly escaped
          .replace(/"titles":\s*"([^"]*(?:{[^}]*}[^"]*)*[^"]*)"/g, (match, content) => {
            // Extract just the JSON part and make it a proper object
            const jsonMatch = content.match(/({.*})/s);
            if (jsonMatch) {
              return `"titles": ${jsonMatch[1]}`;
            }
            return `"titles": "${content.replace(/"/g, '\\"')}"`;
          })
          .replace(/"specifics":\s*"([^"]*(?:{[^}]*}[^"]*)*[^"]*)"/g, (match, content) => {
            // Extract just the JSON part and make it a proper object
            const jsonMatch = content.match(/({.*})/s);
            if (jsonMatch) {
              return `"specifics": ${jsonMatch[1]}`;
            }
            return `"specifics": "${content.replace(/"/g, '\\"')}"`;
          })
          // Clean up any remaining issues
          .replace(/\n/g, ' ')
          .replace(/\s+/g, ' ')
          .trim();
          
        console.log("Cleaned response (first 300 chars):", cleanedResponse.substring(0, 300));
        
        rawData = JSON.parse(cleanedResponse);
        console.log("Successfully parsed cleaned response");
        
      } catch (secondError) {
        console.error("Cleaned parsing also failed:", secondError.message);
        
        // Last resort - extract data with regex
        try {
          const titlesMatch = rawText.match(/"titles":\s*"[^"]*({[^}]*})/);
          const specificsMatch = rawText.match(/"specifics":\s*"[^"]*({[^}]*})/);
          const descriptionMatch = rawText.match(/"description":\s*"([^"]*(?:\\.[^"]*)*)"/);
          
          if (titlesMatch && specificsMatch && descriptionMatch) {
            rawData = {
              titles: titlesMatch[1],
              specifics: specificsMatch[1], 
              description: descriptionMatch[1]
            };
            console.log("Successfully extracted data with regex");
          } else {
            throw new Error("Could not extract data with regex");
          }
        } catch (finalError) {
          console.error("All parsing attempts failed:", finalError.message);
          console.error("Raw response:", rawText);
          return res.status(502).json({ message: 'Invalid response format from AI service.' });
        }
      }
    }

    // Function to safely extract JSON from strings that might contain markdown
    const extractJSON = (input: any, label: string) => {
      if (typeof input === 'object' && input !== null) {
        // Already an object, return as-is
        return input;
      }
      
      if (typeof input === 'string') {
        // Clean the string and try to parse
        const cleaned = input
          .replace(/```json\n?/gi, '')
          .replace(/```/gi, '')
          .replace(/[\u0000-\u0008\u000B-\u000C\u000E-\u001F\u007F]/g, '')
          .trim();
          
        try {
          return JSON.parse(cleaned);
        } catch (err) {
          console.error(`Failed to parse ${label}:`, err);
          console.error(`Content was:`, cleaned.substring(0, 200));
          return null;
        }
      }
      
      console.error(`Invalid type for ${label}:`, typeof input);
      return null;
    };

    const titles = extractJSON(rawData.titles, 'titles');
    const specifics = extractJSON(rawData.specifics, 'specifics');
    const description = rawData.description;

    if (!titles || !specifics || !description) {
      console.error("Missing required data:", { 
        titlesPresent: !!titles, 
        specificsPresent: !!specifics, 
        descriptionPresent: !!description,
        rawTitles: rawData.titles,
        rawSpecifics: rawData.specifics,
        rawDescription: rawData.description
      });
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
