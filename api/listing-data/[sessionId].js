import { NextApiRequest, NextApiResponse } from "next";

// Same storage as webhook file
let store: Record<string, any> = {};

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const { sessionId } = req.query;

  if (req.method === "GET") {
    if (sessionId && typeof sessionId === "string" && store[sessionId]) {
      return res.status(200).json(store[sessionId]);
    } else {
      return res.status(404).json({ error: "Session not found" });
    }
  }

  res.setHeader("Allow", ["GET"]);
  res.status(405).end(`Method ${req.method} Not Allowed`);
}
