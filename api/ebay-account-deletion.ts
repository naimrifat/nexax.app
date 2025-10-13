import type { VercelRequest, VercelResponse } from '@vercel/node';

const VERIFICATION_TOKEN = 'nexax_ebay_deletion_verification_token_2024_secure';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  try {
    // eBay verification challenge
    if (req.body?.challenge_code) {
      console.log('✅ eBay verification challenge received:', req.body.challenge_code);
      
      return res.status(200).json({
        challengeResponse: req.body.challenge_code
      });
    }
    
    // Actual account deletion notification
    if (req.body?.notification) {
      console.log('🗑️ eBay account deletion notification received:', {
        notificationId: req.body.notification?.notificationId,
        eventDate: req.body.notification?.eventDate,
        userId: req.body.notification?.data?.userId
      });
      
      // TODO: Delete user data from your database
      // For now, just log it
      
      return res.status(200).json({ success: true });
    }
    
    return res.status(200).json({ message: 'Endpoint active' });
    
  } catch (error: any) {
    console.error('❌ Error handling eBay notification:', error);
    return res.status(500).json({ error: error.message });
  }
}
