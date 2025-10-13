import type { VercelRequest, VercelResponse } from '@vercel/node';
import { createHash, createVerify, KeyObject } from 'crypto';

// This is new: It tells Vercel to NOT parse the body, so we can get the raw text for verification.
export const config = {
  api: {
    bodyParser: false,
  },
};

const VERIFICATION_TOKEN = 'nexax_ebay_deletion_verification_token_2024_secure';
const ENDPOINT_URL = 'https://www.nexax.app/api/ebay-account-deletion';

// A simple in-memory cache for eBay's public keys to avoid re-fetching them every time.
const keyCache = new Map<string, KeyObject>();

// A helper function to read the raw body from the request stream.
async function getRawBody(req: VercelRequest): Promise<string> {
  const chunks = [];
  for await (const chunk of req) {
    chunks.push(typeof chunk === 'string' ? Buffer.from(chunk) : chunk);
  }
  return Buffer.concat(chunks).toString('utf-8');
}

async function getPublicKey(keyId: string): Promise<KeyObject> {
  if (keyCache.has(keyId)) {
    return keyCache.get(keyId)!;
  }
  
  const response = await fetch(`https://api.ebay.com/commerce/notification/v1/public_key/${keyId}`);
  if (!response.ok) {
    throw new Error(`Failed to fetch public key ${keyId}`);
  }
  
  const keyData = await response.json();
  const publicKey = await createVerify('sha256').verify(keyData.key, keyData.signature, 'base64');
  keyCache.set(keyId, publicKey as unknown as KeyObject);
  return publicKey as unknown as KeyObject;
}

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
      const rawBody = await getRawBody(req);
      const headers = req.headers;

      // 1. Decode the signature header
      const signatureHeader = JSON.parse(Buffer.from(headers['x-ebay-signature'] as string, 'base64').toString('utf-8'));

      // 2. Fetch eBay's public key
      const publicKey = await getPublicKey(signatureHeader.kid);

      // 3. Verify the payload
      const verifier = createVerify('sha256');
      verifier.update(rawBody);
      const isVerified = verifier.verify(publicKey, signatureHeader.signature, 'base64');
      
      if (!isVerified) {
        console.error('❌ Signature verification failed.');
        return res.status(401).send('Verification failed');
      }

      console.log('✅ Signature Verified! Processing notification.');
      const notification = JSON.parse(rawBody);
      console.log(notification);
      
      // Your logic to delete user data goes here

      return res.status(204).end();

    } catch (e: any) {
      console.error("❌ An error occurred during verification:", e.message);
      return res.status(500).send("Error processing notification");
    }
  }

  res.setHeader('Allow', ['GET', 'POST']);
  return res.status(405).end(`Method ${req.method} Not Allowed`);
}
