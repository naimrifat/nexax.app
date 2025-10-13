import type { VercelRequest, VercelResponse } from '@vercel/node';
import { createHash } from 'crypto';

// These values MUST match what you've entered in the eBay developer portal
const VERIFICATION_TOKEN = 'nexax_ebay_deletion_verification_token_2024_secure';
const ENDPOINT_URL = 'https://nexax.app/api/ebay-account-deletion';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  // --- Validation Challenge (GET request) ---
  if (req.method === 'GET') {
    console.log('Received GET request for validation challenge.');
    
    // 1. Get the challenge code from the query parameters
    const challengeCode = req.query.challenge_code as string;
    
    if (!challengeCode) {
      console.error('❌ Missing challenge_code in query parameters.');
      return res.status(400).send('Missing challenge_code');
    }
    
    console.log(`✅ eBay challenge code received: ${challengeCode}`);

    // 2. Create the hash
    const hash = createHash('sha256');
    hash.update(challengeCode);
    hash.update(VERIFICATION_TOKEN);
    hash.update(ENDPOINT_URL);
    const challengeResponse = hash.digest('hex');

    // 3. Respond with the hash
    console.log(`✅ Responding with hash: ${challengeResponse}`);
    res.setHeader('Content-Type', 'application/json');
    return res.status(200).json({
      challengeResponse: challengeResponse
    });
  }

  // --- Account Deletion Notification (POST request) ---
  if (req.method === 'POST') {
    // TODO: You should also verify the signature of POST requests using the X-EBAY-SIGNATURE header.
    // For now, we'll just process the notification.
    
    console.log('🗑️ Received POST request with account deletion notification.');
    console.log(req.body); // Log the full body to inspect it
    
    // Process the actual notification from eBay
    // ... your logic to delete user data ...

    // Tell eBay the notification was received successfully
    return res.status(204).end();
  }

  // Handle other methods
  res.setHeader('Allow', ['GET', 'POST']);
  return res.status(405).end(`Method ${req.method} Not Allowed`);
}
