// Same dataStore reference (this needs to be shared between files)
// In production, you'd use a proper database
const dataStore = new Map();

export default function handler(req, res) {
  // Enable CORS for your domain
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

  const stored = dataStore.get(sessionId);
  
  if (!stored || Date.now() > stored.expires) {
    return res.status(404).json({ error: 'Data not found or expired' });
  }

  res.status(200).json(stored.data);
}
