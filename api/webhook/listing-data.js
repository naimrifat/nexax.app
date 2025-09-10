export default function handler(req, res) {
  console.log('API called with method:', req.method);
  console.log('Request body:', req.body);
  
  try {
    // Just return success for now
    res.status(200).json({ 
      success: true, 
      sessionId: "test123",
      received: req.body 
    });
  } catch (error) {
    console.log('Error:', error);
    res.status(500).json({ error: error.message });
  }
}
