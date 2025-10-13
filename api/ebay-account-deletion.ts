import type { VercelRequest, VercelResponse } from '@vercel/node';
import { createHash } from 'crypto';

const VERIFICATION_TOKEN = 'nexax_ebay_deletion_verification_token_2024_secure';
const ENDPOINT_URL = 'https://nexax.app/api/ebay-account-deletion';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  // --- Validation Challenge (GET request) ---
  if (req.method === 'GET') {
    const challengeCode = req.query.challenge_code as string;

    // If the challenge_code EXISTS, handle the validation
    if (challengeCode) {
      console.log(`✅ eBay challenge code received: ${challengeCode}`);

      const hash = createHash('sha256');
      hash.update(challengeCode);
      hash.update(VERIFICATION_TOKEN);
      hash.update(ENDPOINT_URL);
      const challengeResponse = hash.digest('hex');

      console.log(`✅ Responding with hash: ${challengeResponse}`);
      res.setHeader('Content-Type', 'application/json');
      return res.status(200).json({
        challengeResponse: challengeResponse
      });
    } else {
      // If the challenge_code is MISSING, it's a simple "ping".
      // Respond with 200 OK to show the endpoint is live.
      console.log('⚠️ Received a GET request without a challenge_code (likely a ping). Responding 200 OK.');
      return res.status(200).send('Endpoint is active.');
    }
  }

  // --- Account Deletion Notification (POST request) ---
  if (req.method === 'POST') {
    console.log('🗑️ Received POST request with account deletion notification.');
    console.log(req.body); // Log the body to inspect it
    
    // TODO: Verify the X-EBAY-SIGNATURE header for security
    
    // Process the notification...
    
    return res.status(204).end();
  }

  // Handle other methods
  res.setHeader('Allow', ['GET', 'POST']);
  return res.status(405).end(`Method ${req.method} Not Allowed`);
}
