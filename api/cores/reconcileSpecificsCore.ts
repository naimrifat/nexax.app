import type { Response } from 'node-fetch'

export async function reconcileSpecificsCore(input: any): Promise<any> {
  const payload = input?.payload ?? input
  // Merge from existing specifics if provided; otherwise synthesize an empty array
  const current: any[] = Array.isArray(payload?.item_specifics) ? payload.item_specifics : []
  const item_specifics = current.length ? current : []
  // If there is AI-detected data in payload, attempt a tiny merge (simple normalization)
  const merged = item_specifics.map((s) => {
    if (typeof s === 'object' && s?.name && s?.value != null) return s
    if (typeof s === 'string') return { name: s, value: '' }
    return s
  })
  return { ok: true, data: { item_specifics: merged }, error: null, requestId: String(Date.now()) }
}
