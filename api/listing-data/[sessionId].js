export default function handler(req, res) {
  // Enable CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { sessionId } = req.query;
  
  if (!sessionId) {
    return res.status(400).json({ error: 'Session ID required' });
  }

  // Access the same global store
  global.listingDataStore = global.listingDataStore || new Map();
  
  const stored = global.listingDataStore.get(sessionId);
  
  if (!stored || Date.now() > stored.expires) {
    return res.status(404).json({ error: 'Data not found or expired' });
  }

  console.log('Retrieved data for session:', sessionId);
  res.status(200).json(stored.data);
}
