import type { VercelRequest, VercelResponse } from '@vercel/node'

export const config = {
  // Simple health check endpoint
  runtime: 'nodejs14.x',
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'GET') {
    res.status(405).json({ ok: false, status: 'method not allowed' })
    return
  }

  res.status(200).json({ ok: true, status: 'OK', version: 'Phase 3.5', timestamp: new Date().toISOString() })
}
