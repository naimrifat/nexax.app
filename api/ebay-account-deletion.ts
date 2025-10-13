import type { VercelRequest, VercelResponse } from '@vercel/node';
import { createHash } from 'crypto';
import { Message, Config } from '@ebay/event-notification-sdk';

export const config = {
  api: {
    bodyParser: false,
  },
};

const VERIFICATION_TOKEN = 'nexax_ebay_deletion_verification_token_2024_secure';
const ENDPOINT_URL = 'https://www.nexax.app/api/ebay-account-deletion';

async function getRawBody(req: VercelRequest): Promise<string> {
  const chunks = [];
  for await (const chunk of req) {
    chunks.push(typeof chunk === 'string' ? Buffer.from(chunk) : chunk);
  }
  return Buffer.concat(chunks).toString('utf-8');
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  // Handle GET - Challenge Verification
  if (req.method === 'GET') {
    const challengeCode = req.query.challenge_code as string;
    
    if (!challengeCode) { 
      return res.status(400).json({ error: 'Missing challenge_code' }); 
    }
    
    const hash = createHash('sha256');
    hash.update(challengeCode);
    hash.update(VERIFICATION_TOKEN);
    hash.update(ENDPOINT_URL);
    const challengeResponse = hash.digest('hex');
    
    console.log('✅ Challenge verification successful');
    
    res.setHeader('Content-Type', 'application/json');
    return res.status(200).json({ challengeResponse });
  }

  // Handle POST - Deletion Notification
  if (req.method === 'POST') {
    try {
      const rawBody = await getRawBody(req);
      const signatureHeader = req.headers['x-ebay-signature'] as string;
      
      if (!signatureHeader) {
        console.error('❌ Missing X-EBAY-SIGNATURE header');
        return res.status(400).json({ error: 'Missing signature header' });
      }

      // Configure SDK
      const sdkConfig = new Config({
        clientId: process.env.EBAY_CLIENT_ID!,
        clientSecret: process.env.EBAY_CLIENT_SECRET!,
        environment: 'PRODUCTION'
      });

      // Validate signature using SDK
      const message = new Message(sdkConfig);
      const isValid = await message.validate(rawBody, signatureHeader);

      if (!isValid) {
        console.error('❌ Signature verification failed');
        return res.status(401).json({ error: 'Invalid signature' });
      }

      console.log('✅ Signature verified successfully');
      
      const notification = JSON.parse(rawBody);
      
      console.log('🗑️ Account deletion notification:', {
        notificationId: notification.notification?.notificationId,
        eventDate: notification.notification?.eventDate,
        username: notification.notification?.data?.username,
        userId: notification.notification?.data?.userId
      });
      
      // TODO: Implement actual user data deletion logic
      // Example: await deleteUserData(notification.notification.data.userId);
      
      return res.status(204).end();

    } catch (error: any) {
      console.error('❌ Error processing notification:', error);
      return res.status(500).json({ 
        error: 'Error processing notification', 
        message: error.message 
      });
    }
  }

  res.setHeader('Allow', ['GET', 'POST']);
  return res.status(405).end(`Method ${req.method} Not Allowed`);
}
