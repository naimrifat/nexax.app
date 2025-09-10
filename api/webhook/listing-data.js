// Simple in-memory storage (for production, use a database)
const dataStore = new Map();

export default function handler(req, res) {
  // Only allow POST requests
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const webhookData = req.body;
    console.log('Received webhook data:', webhookData);

    // Transform Make.com data to your frontend format
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

    // Generate unique session ID
    const sessionId = Date.now().toString() + Math.random().toString(36).substr(2, 9);
    
    // Store data (expires in 1 hour)
    dataStore.set(sessionId, {
      data: transformedData,
      expires: Date.now() + (60 * 60 * 1000) // 1 hour
    });

    // Clean up expired data
    for (const [key, value] of dataStore.entries()) {
      if (Date.now() > value.expires) {
        dataStore.delete(key);
      }
    }

    // Return success with redirect URL
    res.status(200).json({ 
      success: true, 
      redirectUrl: `https://www.nexax.app/results?session=${sessionId}`
    });

  } catch (error) {
    console.error('Webhook error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
}
