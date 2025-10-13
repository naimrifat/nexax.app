import type { VercelRequest, VercelResponse } from '@vercel/node';
import { createHash, createPublicKey, createVerify, KeyObject } from 'crypto';

// Tells Vercel to give us the raw request body for verification.
export const config = {
  api: {
    bodyParser: false,
  },
};

const VERIFICATION_TOKEN = 'nexax_ebay_deletion_verification_token_2024_secure';
const ENDPOINT_URL = 'https://www.nexax.app/api/ebay-account-deletion';

// Caches for tokens and keys to improve performance.
const keyCache = new Map<string, KeyObject>();
let appToken: { access_token: string; expires_at: number } | null = null;

// --- Helper Functions ---

async function getRawBody(req: VercelRequest): Promise<Buffer> {
  const chunks = [];
  for await (const chunk of req) {
    chunks.push(typeof chunk === 'string' ? Buffer.from(chunk) : chunk);
  }
  return Buffer.concat(chunks);
}

async function getAppToken(): Promise<string> {
  if (appToken && appToken.expires_at > Date.now()) {
    return appToken.access_token;
  }
  const clientId = process.env.EBAY_CLIENT_ID;
  const clientSecret = process.env.EBAY_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    throw new Error('eBay client ID or secret is not configured.');
  }
  const encodedCreds = Buffer.from(`${clientId}:${clientSecret}`).toString('base64');
  const response = await fetch('https://api.ebay.com/identity/v1/oauth2/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', Authorization: `Basic ${encodedCreds}` },
    body: 'grant_type=client_credentials&scope=https://api.ebay.com/oauth/api_scope',
  });
  if (!response.ok) {
    throw new Error(`Failed to get eBay access token: ${await response.text()}`);
  }
  const data = await response.json();
  appToken = {
    access_token: data.access_token,
    expires_at: Date.now() + (data.expires_in - 300) * 1000,
  };
  return appToken.access_token;
}

async function getPublicKey(keyId: string): Promise<KeyObject> {
  if (keyCache.has(keyId)) {
    return keyCache.get(keyId)!;
  }

  const token = await getAppToken();
  const response = await fetch(`https://api.ebay.com/commerce/notification/v1/public_key/${keyId}`, {
    headers: { Authorization: `Bearer ${token}` },
  });

  if (!response.ok) {
    throw new Error(`Failed to fetch public key ${keyId}: ${await response.text()}`);
  }
  
  const keyData = await response.json();

  // --- THIS IS THE FIX ---
  // The previous code tried to run a "verify" command here, which was incorrect.
  // The correct step is to import the public key material provided by eBay.
  const publicKey = createPublicKey(keyData.key);
  
  keyCache.set(keyId, publicKey);
  return publicKey;
}

// --- Main Handler ---
export default async function handler(req: VercelRequest, res: VercelResponse) {
  // GET request for initial validation challenge
  if (req.method === 'GET') {
    const challengeCode = req.query.challenge_code as string;
    if (!challengeCode) { return res.status(400).send('Missing challenge_code'); }
    const hash = createHash('sha256');
    hash.update(challengeCode);
    hash.update(VERIFICATION_TOKEN);
    hash.update(ENDPOINT_URL);
    const challengeResponse = hash.digest('hex');
    res.setHeader('Content-Type', 'application/json');
    return res.status(200).json({ challengeResponse });
  }

  // POST request for actual notifications
  if (req.method === 'POST') {
    try {
      const rawBody = await getRawBody(req);
      const signatureHeader = JSON.parse(Buffer.from(req.headers['x-ebay-signature'] as string, 'base64').toString('utf-8'));
      
      const publicKey = await getPublicKey(signatureHeader.kid);

      const verifier = createVerify('sha256');
      verifier.update(rawBody);
      const isVerified = verifier.verify(publicKey, signatureHeader.signature, 'base64');

      if (!isVerified) {
        return res.status(401).send('Verification failed');
      }

      console.log('✅ Signature Verified! Processing notification.');
      const notification = JSON.parse(rawBody.toString('utf-8'));
      console.log(notification);
      
      return res.status(204).end();

    } catch (e: any) {
      console.error("❌ An error occurred during verification:", e);
      return res.status(500).send(`Error processing notification: ${e.message}`);
    }
  }

  res.setHeader('Allow', ['GET', 'POST']);
  return res.status(405).end(`Method ${req.method} Not Allowed`);
}
