// lib/redis-client.js
import { createClient } from 'redis';

// Use a global property to store the client instance for reuse in the serverless environment
// This prevents the app from creating a new connection on every request (which causes Vercel crashes).
let client = global.redisClient;

if (!client) {
  client = createClient({
    url: process.env.REDIS_URL // Uses the Vercel environment variable
  });

  client.on('error', (err) => {
    console.error('Redis Client Error', err);
  });

  // Start connecting immediately, but don't hold up the file import
  client.connect().catch(e => console.error('Initial Redis connection failed:', e));
  
  global.redisClient = client;
}

export default client;
