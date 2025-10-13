import type { VercelRequest, VercelResponse } from '@vercel/node';
import { createHash } from 'crypto';

const VERIFICATION_TOKEN = 'nexax_ebay_deletion_verification_token_2024_secure';
const ENDPOINT_URL = 'https://www.nexax.app/api/ebay-account-deletion';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS, GET');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-EBAY-SIGNATURE');
  
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

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
      console.log('📨 Received deletion notification');
      
      const notification = req.body;
      
      // Log the notification details
      console.log('🗑️ Account deletion notification:', {
        notificationId: notification.notification?.notificationId,
        eventDate: notification.notification?.eventDate,
        username: notification.notification?.data?.username,
        userId: notification.notification?.data?.userId
      });
      
      // TODO: Implement actual user data deletion logic here
      // For now, just acknowledge receipt
      // Example: await deleteUserData(notification.notification.data.userId);
      
      console.log('✅ Notification acknowledged');
      
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
