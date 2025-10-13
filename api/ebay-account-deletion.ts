import type { VercelRequest, VercelResponse } from '@vercel/node';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  console.log('--- NEW REQUEST RECEIVED ---');

  try {
    // Log all the important details of the request
    console.log(`METHOD: ${req.method}`);
    console.log(`URL: ${req.url}`);
    console.log('QUERY PARAMETERS:', JSON.stringify(req.query, null, 2));
    console.log('HEADERS:', JSON.stringify(req.headers, null, 2));

    // For POST requests, also log the body
    if (req.method === 'POST') {
      console.log('BODY:', JSON.stringify(req.body, null, 2));
    }
    
    console.log('--- END OF REQUEST DETAILS ---');

    // Always respond with 200 OK to prevent any errors on eBay's side
    res.status(200).send('Request details logged successfully.');

  } catch (error: any) {
    console.error('❌ FATAL ERROR IN LOGGER:', error);
    res.status(500).send('An error occurred while logging.');
  }
}
