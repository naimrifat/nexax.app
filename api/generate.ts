// This file acts as a secure, server-side middleman.

import type { VercelRequest, VercelResponse } from '@vercel/node';

export default async function handler(req: VercelRequest, res: VercelResponse) {
    // 1. Only allow POST requests
    if (req.method !== 'POST') {
        return res.status(405).json({ message: 'Only POST requests are allowed' });
    }

    try {
        // 2. Get the Base64 image data from the browser's request
        const { image_base64 } = req.body; // Correct variable name
        if (!image_base64) { // Correct variable name used here
            return res.status(400).json({ message: 'Missing image_base64 in request body' });
        }

        // 3. Get secret keys securely from Vercel's environment variables
        const imgbbApiKey = process.env.VITE_IMGBB_API_KEY;
        const makeWebhookUrl = process.env.VITE_MAKE_WEBHOOK_URL;

        if (!imgbbApiKey || !makeWebhookUrl) {
            console.error("Missing environment variables on Vercel.");
            return res.status(500).json({ message: 'Server configuration error. Please check Vercel settings.' });
        }

        // 4. Upload the image to ImgBB from the server
        const formData = new URLSearchParams();
        formData.append('image', image_base64); // Correct variable name used here

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

        // 5. Trigger the Make.com scenario with the new image URL
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

        // 6. Send the final, successful response from Make.com back to the browser
        const resultData = await makeResponse.json();
        return res.status(200).json(resultData);

    } catch (error) {
        console.error("Internal Server Error:", error);
        return res.status(500).json({ message: 'An internal server error occurred.' });
    }
}

