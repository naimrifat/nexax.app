// api/webhook/listing-data/index.js (The Setter)
import redisClient from '../../../lib/redis-client';

export default async function handler(req, res) {
  if (req.method === "POST") {
    // 1. Ensure client is ready; connect only if it's the first time in this process
    if (!redisClient.isReady) {
      // This awaits the initial connection if it hasn't completed yet
      await redisClient.connect(); 
    }

    try {
      const data = req.body;
      
      if (!data) {
        return res.status(400).json({ success: false, error: "No data received in webhook body" });
      }

      // 2. Create session ID
      const sessionId = Date.now().toString() + Math.random().toString(36).substring(2, 8);

      // 3. Save the data to Redis using the shared client (NO .connect() or .quit() needed)
      await redisClient.set(sessionId, JSON.stringify(data), { EX: 3600 }); // 1 hour expiration

      console.log("Stored data for session:", sessionId);

      // 4. Return the new session ID
      return res.status(200).json({
        success: true,
        sessionId: sessionId
      });

    } catch (error) {
      console.error("Error saving webhook data:", error);
      return res.status(500).json({ success: false, error: error.message });
    }
  }

  res.setHeader("Allow", ["POST"]);
  res.status(405).end(`Method ${req.method} Not Allowed`);
}
