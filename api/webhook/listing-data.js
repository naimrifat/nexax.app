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
    
    // For now, we'll use a simpler approach - store in a global variable
    // In production, you'd use a proper database
    global.listingDataStore = global.listingDataStore || new Map();
    
    global.listingDataStore.set(sessionId, {
      data: transformedData,
      expires: Date.now() + (60 * 60 * 1000) // 1 hour
    });

    console.log('Stored data for session:', sessionId);

    // Return success with session ID
    res.status(200).json({ 
      success: true, 
      sessionId: sessionId
    });

  } catch (error) {
    console.error('Webhook error:', error);
    res.status(500).json({ error: 'Internal server error', details: error.message });
  }
}
