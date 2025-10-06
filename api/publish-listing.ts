import type { VercelRequest, VercelResponse } from '@vercel/node';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  // Only allow POST requests
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  // Get your new, dedicated webhook URL from environment variables
  const makeWebhookUrl = process.env.VITE_MAKE_PUBLISH_WEBHOOK_URL;

  if (!makeWebhookUrl) {
    return res.status(500).json({ error: 'Webhook URL is not configured.' });
  }

  try {
    // Forward the entire request body to the Make.com webhook
    const makeResponse = await fetch(makeWebhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(req.body) // req.body contains the final listingData
    });

    if (!makeResponse.ok) {
      throw new Error('Failed to trigger the publish webhook.');
    }

    return res.status(200).json({ success: true, message: 'Publishing process initiated.' });

  } catch (error: any) {
    console.error('Error in publish-listing handler:', error);
    return res.status(500).json({ error: error.message });
  }
}
