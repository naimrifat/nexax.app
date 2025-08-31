// File: src/api/generate.ts
import type { VercelRequest, VercelResponse } from '@vercel/node';

export default async function handler(req: VercelRequest, res: VercelResponse) {
    // 1. Check if the request is a POST request
    if (req.method !== 'POST') {
        return res.status(405).json({ message: 'Only POST requests allowed' });
    }

    try {
        // 2. Get the image_url from the request body
        const { image_url } = req.body;
        if (!image_url) {
            return res.status(400).json({ message: 'Missing image_url in request body' });
        }

        // 3. Get the secure Make.com webhook URL from environment variables
        const makeWebhookUrl = process.env.MAKE_WEBHOOK_URL;
        if (!makeWebhookUrl) {
            console.error("MAKE_WEBHOOK_URL is not set in environment variables.");
            return res.status(500).json({ message: 'Server configuration error.' });
        }

        // 4. Forward the request to Make.com
        const makeResponse = await fetch(makeWebhookUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ image_url: image_url }),
        });

        if (!makeResponse.ok) {
            console.error("Error from Make.com:", await makeResponse.text());
            return res.status(502).json({ message: 'Error from AI service.' });
        }

        // 5. Send the successful response from Make.com back to the browser
        const resultData = await makeResponse.json();
        return res.status(200).json(resultData);

    } catch (error) {
        console.error("Internal server error:", error);
        return res.status(500).json({ message: 'Internal server error.' });
    }
}
