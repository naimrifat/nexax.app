// Temporary storage
let store = {};

export default async function handler(req, res) {
  if (req.method === "POST") {
    try {
      // Get data from Make.com
      const data = req.body;

      // Create unique session ID
      const sessionId = Date.now().toString() + Math.random().toString(36).substring(2, 8);

      // Save data
      store[sessionId] = data;

      console.log("Stored data for session:", sessionId);

      // Return sessionId to Make.com
      return res.status(200).json({
        success: true,
        sessionId: sessionId
      });
    } catch (error) {
      console.error("Error saving webhook data:", error);
      return res.status(500).json({ success: false, error: error.message });
    }
  }

  res.setHeader("Allow", ["POST"]);
  res.status(405).end(`Method ${req.method} Not Allowed`);
}
