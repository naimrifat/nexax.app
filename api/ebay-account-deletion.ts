import type { VercelRequest, VercelResponse } from '@vercel/node';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  // We only care about the POST request from the "Send Test Notification" button
  if (req.method === 'POST') {
    console.log('--- TEST NOTIFICATION RECEIVED ---');
    
    try {
      // Log the headers, especially the x-ebay-signature
      console.log('HEADERS:', JSON.stringify(req.headers, null, 2));

      // Log the body
      console.log('BODY:', JSON.stringify(req.body, null, 2));

      console.log('--- END OF REQUEST DETAILS ---');

    } catch (error: any) {
      console.error('❌ FATAL ERROR IN LOGGER:', error);
    }
  }

  // Always respond with 200 OK to get the log
  res.status(200).send('Request details logged.');
}
