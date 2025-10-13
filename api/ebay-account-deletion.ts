import type { VercelRequest, VercelResponse } from '@vercel/node';
import { createHash } from 'crypto';

// These values MUST match what you've entered in the eBay developer portal
const VERIFICATION_TOKEN = 'nexax_ebay_deletion_verification_token_2024_secure';
// The corrected URL with "www."
const ENDPOINT_URL = 'https://www.nexax.app/api/ebay-account-deletion';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  // --- Validation Challenge (GET request) ---
  if (req.method === 'GET') {
    const challengeCode = req.query.challenge_code as string;

    if (!challengeCode) {
      return res.status(400).send('Missing challenge_code');
    }

    const hash = createHash('sha256');
    hash.update(challengeCode);
    hash.update(VERIFICATION_TOKEN);
    hash.update(ENDPOINT_URL);
    const challengeResponse = hash.digest('hex');

    res.setHeader('Content-Type', 'application/json');
    return res.status(200).json({
      challengeResponse: challengeResponse
    });
  }

  // --- Account Deletion Notification (POST request) ---
  if (req.method === 'POST') {
    // Your production logic here
    return res.status(204).end();
  }

  // Handle any other HTTP methods
  res.setHeader('Allow', ['GET', 'POST']);
  return res.status(405).end(`Method ${req.method} Not Allowed`);
}
