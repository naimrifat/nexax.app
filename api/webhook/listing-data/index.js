import { createClient } from 'redis';

export default async function handler(req, res) {
  if (req.method === "POST") {
    // 1. Create the client
    const client = createClient({
      url: process.env.REDIS_URL // This uses the secret URL from Vercel
    });
    
    // Add error handling
    client.on('error', (err) => console.error('Redis Client Error', err));

    try {
      // 2. Connect to the database
      await client.connect();

      const data = req.body;
      const sessionId = Date.now().toString() + Math.random().toString(36).substring(2, 8);

      // 3. Save the data to Redis
      // We set it to expire in 1 hour (3600 seconds)
      await client.set(sessionId, JSON.stringify(data), { EX: 3600 });

      console.log("Stored data for session:", sessionId);

      // 4. Return the new session ID
      return res.status(200).json({
        success: true,
        sessionId: sessionId
      });

    } catch (error) {
      console.error("Error saving webhook data:", error);
      return res.status(500).json({ success: false, error: error.message });
    } finally {
      // 5. Always close the connection
      await client.quit();
    }
  }

  res.setHeader("Allow", ["POST"]);
  res.status(405).end(`Method ${req.method} Not Allowed`);
}
