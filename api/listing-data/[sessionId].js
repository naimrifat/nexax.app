// Import the Vercel KV client
import { kv } from '@vercel/kv';

// --- FIX: No more 'let store = {}' ---

export default async function handler(req, res) {
  const { sessionId } = req.query;

  if (req.method === "GET") {
    if (sessionId && typeof sessionId === "string") {
      
      // --- FIX: Get data from Redis (Vercel KV) ---
      const data = await kv.get(sessionId);
      // ------------------------------------------

      if (data) {
        // Data is found, send it back (it will be a string, so we parse)
        return res.status(200).json(JSON.parse(data));
      } else {
        // Session not found in Redis
        return res.status(404).json({ error: "Session not found" });
      }
    }
    // ...
  }
  // ...
}
