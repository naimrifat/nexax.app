// Import the Vercel KV client
import { kv } from '@vercel/kv';

export default async function handler(req, res) {
  if (req.method === "POST") {
    try {
      const data = req.body;
      const sessionId = Date.now().toString() + Math.random().toString(36).substring(2, 8);

      // --- FIX: Save data to Redis (Vercel KV) instead of 'store' ---
      // We set an expiration (e.g., 1 hour) so it auto-deletes
      await kv.set(sessionId, JSON.stringify(data), { ex: 3600 });
      // -----------------------------------------------------------

      console.log("Stored data for session:", sessionId);
      return res.status(200).json({
        success: true,
        sessionId: sessionId
      });
    } catch (error) {
      // ... error handling
    }
  }
  // ...
}
