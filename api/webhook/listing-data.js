export default function handler(req, res) {
  console.log('=== WEBHOOK DEBUG ===');
  console.log('Method:', req.method);
  console.log('Headers:', JSON.stringify(req.headers, null, 2));
  console.log('Body type:', typeof req.body);
  console.log('Body content:', JSON.stringify(req.body, null, 2));
  console.log('Raw body:', req.body);
  
  // Handle different content types
  if (req.method !== 'POST') {
    console.log('Wrong method, returning 405');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    let webhookData = req.body;
    
    // If body is a string, try to parse it
    if (typeof webhookData === 'string') {
      console.log('Body is string, parsing...');
      webhookData = JSON.parse(webhookData);
    }
    
    console.log('Parsed webhook data:', webhookData);
    
    // Return success with the data we received
    res.status(200).json({ 
      success: true, 
      sessionId: "test123",
      receivedData: webhookData,
      dataType: typeof webhookData
    });
    
  } catch (error) {
    console.log('Error occurred:', error.message);
    console.log('Error stack:', error.stack);
    res.status(500).json({ 
      error: error.message,
      stack: error.stack 
    });
  }
}
