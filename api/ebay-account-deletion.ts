import type { VercelRequest, VercelResponse } from '@vercel/node';
import { createHash } from 'crypto';
import * as jose from 'jose'; // Import the new library

const VERIFICATION_TOKEN = 'nexax_ebay_deletion_verification_token_2024_secure';
const ENDPOINT_URL = 'https://www.nexax.app/api/ebay-account-deletion';

// Create a reusable key object for JWS verification
const secret = new TextEncoder().encode(VERIFICATION_TOKEN);

export default async function handler(req: VercelRequest, res: VercelResponse) {
  // --- Validation Challenge (GET request) ---
  if (req.method === 'GET') {
    // This part is working correctly.
    const challengeCode = req.query.challenge_code as string;
    if (!challengeCode) { return res.status(400).send('Missing challenge_code'); }
    const hash = createHash('sha256');
    hash.update(challengeCode);
    hash.update(VERIFICATION_TOKEN);
    hash.update(ENDPOINT_URL);
    const challengeResponse = hash.digest('hex');
    res.setHeader('Content-Type', 'application/json');
    return res.status(200).json({ challengeResponse: challengeResponse });
  }

  // --- Account Deletion Notification (POST request) ---
  if (req.method === 'POST') {
    try {
      // 1. Get the JWS signature from the header
      const jws = req.headers['x-ebay-signature'] as string;
      if (!jws) {
        console.error('❌ Missing x-ebay-signature header.');
        return res.status(401).send('Signature is missing');
      }

      // 2. Verify the JWS signature using the 'jose' library
      // This will automatically decode the JWS, verify its signature against the
      // payload (req.body), and throw an error if it's invalid.
      const { payload } = await jose.jwtVerify(jws, secret);

      console.log('✅ JWS Signature is valid.');
      console.log('Received payload:', payload);

      // Your logic to delete the user's data from your database goes here.
      // Example: const userId = payload.data.userId; await deleteUser(userId);

      // 3. Respond with 204 No Content to acknowledge receipt
      return res.status(204).end();

    } catch (error: any) {
      // The 'jose' library will throw an error if verification fails
      console.error('❌ Error processing JWS:', error.message);
      return res.status(401).json({ error: 'Signature verification failed.' });
    }
  }

  // Handle any other HTTP methods
  res.setHeader('Allow', ['GET', 'POST']);
  return res.status(405).end(`Method ${req.method} Not Allowed`);
}
