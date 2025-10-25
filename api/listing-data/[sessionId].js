import { createClient } from 'redis';

export default async function handler(req, res) {
  const { sessionId } = req.query;

  if (req.method === "GET") {
    if (!sessionId || typeof sessionId !== "string") {
      return res.status(400).json({ error: "Invalid session ID" });
    }
    
    // 1. Create the client
    const client = createClient({
      url: process.env.REDIS_URL // Uses the secret URL from Vercel
    });

    // Add error handling
    client.on('error', (err) => console.error('Redis Client Error', err));

    try {
      // 2. Connect to the database
      await client.connect();

      // 3. Get the data from Redis using the session ID
      const dataString = await client.get(sessionId);

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
    } finally {
      // 4. Always close the connection
      await client.quit();
    }
  }

  res.setHeader("Allow", ["GET"]);
  res.status(405).end(`Method ${req.method} Not Allowed`);
}
