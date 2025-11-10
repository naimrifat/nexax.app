// api/listing-data/[sessionId].js (The Getter)
import redisClient from '../../../lib/redis-client';

export default async function handler(req, res) {
  const { sessionId } = req.query;

  if (req.method === "GET") {
    if (!sessionId || typeof sessionId !== "string") {
      return res.status(400).json({ error: "Invalid session ID" });
    }
    
    // 1. Ensure client is ready
    if (!redisClient.isReady) {
        // This awaits the initial connection if it hasn't completed yet
        await redisClient.connect();
    }

    try {
      // 2. Get the data from Redis using the shared client (NO .connect() or .quit() needed)
      const dataString = await redisClient.get(sessionId);

      if (dataString) {
        // Data was found, send it back to the ResultsPage
        return res.status(200).json(JSON.parse(dataString));
      } else {
        // No data found for this session ID
        return res.status(404).json({ error: "Session not found" });
      }

    } catch (error) {
      console.error("Error fetching from Redis:", error);
      return res.status(500).json({ error: "Failed to retrieve data" });
    }
  }

  res.setHeader("Allow", ["GET"]);
  res.status(405).end(`Method ${req.method} Not Allowed`);
}
