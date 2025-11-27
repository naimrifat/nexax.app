// api/listing-data/index.js (The Setter)
import redisClient from '../../lib/redis-client';

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', ['POST']);
    return res.status(405).end(`Method ${req.method} Not Allowed`);
  }

  try {
    const { sessionId, data } = req.body || {};

    // Basic validation
    if (!sessionId || typeof sessionId !== 'string') {
      return res.status(400).json({ error: 'Invalid or missing sessionId' });
    }

    if (!data || typeof data !== 'object') {
      return res.status(400).json({ error: 'Invalid or missing data payload' });
    }

    // Ensure Redis client is ready (similar to your GET handler)
    if (!redisClient.isReady) {
      await redisClient.connect();
    }

    // Store JSON string with a TTL (e.g., 1 hour = 3600 seconds)
    const ttlSeconds = 3600;

    await redisClient.set(sessionId, JSON.stringify(data), {
      EX: ttlSeconds,
    });

    return res.status(200).json({
      success: true,
      sessionId,
      ttlSeconds,
    });
  } catch (error) {
    console.error('Error saving listing data to Redis:', error);
    return res.status(500).json({ error: 'Failed to save data' });
  }
}
