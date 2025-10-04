import type { VercelRequest, VercelResponse } from '@vercel/node';
import crypto from 'crypto';

export default function handler(req: VercelRequest, res: VercelResponse) {
    // Set CORS headers
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    
    if (req.method === 'OPTIONS') {
        res.status(200).end();
        return;
    }

    // Try both with and without VITE_ prefix
    const privateKey = process.env.IMAGEKIT_PRIVATE_KEY || process.env.VITE_IMAGEKIT_PRIVATE_KEY;
    
    console.log('Private key exists:', !!privateKey);
    
    if (!privateKey) {
        console.error('ImageKit private key not found in env');
        res.status(500).json({ 
            error: 'ImageKit private key not configured',
            checkedVars: ['IMAGEKIT_PRIVATE_KEY', 'VITE_IMAGEKIT_PRIVATE_KEY']
        });
        return;
    }
    
    try {
        const token = crypto.randomBytes(16).toString('hex');
        const expire = Math.floor(Date.now() / 1000) + 3600;
        const signature = crypto
            .createHmac('sha1', privateKey)
            .update(token + expire)
            .digest('hex');

        res.status(200).json({
            token,
            expire,
            signature
        });
    } catch (error: any) {
        console.error('Error generating auth:', error);
        res.status(500).json({ error: error.message });
    }
}
