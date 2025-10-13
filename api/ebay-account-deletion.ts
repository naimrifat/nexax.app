import type { VercelRequest, VercelResponse } from '@vercel/node';
import { createHash, timingSafeEqual } from 'crypto';

const VERIFICATION_TOKEN = 'nexax_ebay_deletion_verification_token_2024_secure';
const ENDPOINT_URL = 'https://www.nexax.app/api/ebay-account-deletion';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  // --- Validation Challenge (GET request) ---
  if (req.method === 'GET') {
    // ... (This part is working correctly, no changes needed)
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
      // 1. Get the signature from the headers
      const receivedSignature = req.headers['x-ebay-signature'] as string;
      if (!receivedSignature) {
        console.error('❌ Missing x-ebay-signature header.');
        return res.status(401).send('Missing signature');
      }

      // 2. Calculate the expected signature
      const expectedHash = createHash('sha256');
      // The body needs to be stringified exactly as received
      expectedHash.update(JSON.stringify(req.body));
      expectedHash.update(VERIFICATION_TOKEN);
      expectedHash.update(ENDPOINT_URL);
      const expectedSignature = expectedHash.digest('hex');

      // 3. Securely compare the signatures
      const isValid = timingSafeEqual(
        Buffer.from(receivedSignature),
        Buffer.from(expectedSignature)
      );

      if (!isValid) {
        console.error('❌ Invalid signature.');
        return res.status(401).send('Invalid signature');
      }

      // If the signature is valid, process the notification
      console.log('✅ Signature valid. Processing notification:');
      console.log(JSON.stringify(req.body, null, 2));

      // TODO: Your logic to delete the user's data from your database goes here.
      // Example: const userId = req.body.data.userId; await deleteUser(userId);

      // 4. Respond with 204 No Content to acknowledge receipt
      return res.status(204).end();

    } catch (error: any) {
      console.error('❌ Error processing POST request:', error);
      return res.status(500).json({ error: error.message });
    }
  }

  // Handle any other HTTP methods
  res.setHeader('Allow', ['GET', 'POST']);
  return res.status(405).end(`Method ${req.method} Not Allowed`);
}
