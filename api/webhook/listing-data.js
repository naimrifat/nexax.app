export default function handler(req, res) {
  // Set CORS headers first
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  
  // Handle preflight requests
  if (req.method === 'OPTIONS') {
    res.status(200).end();
    return;
  }

  console.log('=== WEBHOOK DEBUG ===');
  console.log('Method:', req.method);
  console.log('Body:', req.body);
  
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const webhookData = req.body;
    
    // Transform the data
    const transformedData = {
      title: webhookData.title || '',
      description: webhookData.description || '',
      price_suggestion: { 
        optimal: parseFloat(webhookData.price) || 0 
      },
      image_url: webhookData.image_url || '',
      keywords: webhookData.keywords || '',
      item_specifics: webhookData.item_specifics || [],
      category: webhookData.category_id ? { 
        id: webhookData.category_id, 
        name: 'Auto-detected' 
      } : null
    };

    // Generate session ID
    const sessionId = Date.now().toString() + Math.random().toString(36).substr(2, 9);
    
    // Store data
    global.listingDataStore = global.listingDataStore || new Map();
    global.listingDataStore.set(sessionId, {
      data: transformedData,
      expires: Date.now() + (60 * 60 * 1000)
    });

    console.log('Stored data for session:', sessionId);

    // Return success
    res.status(200).json({ 
      success: true, 
      sessionId: sessionId
    });

  } catch (error) {
    console.error('Webhook error:', error);
    res.status(500).json({ error: error.message });
  }
}
