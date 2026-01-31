import type { Response } from 'node-fetch'

export async function analyzeListingCore(input: any): Promise<any> {
  const payload = input?.payload ?? input
  if (!payload) {
    return { ok: false, data: {}, error: 'No payload', requestId: '0' }
  }
  const title = payload?.title ?? 'Untitled Listing'
  const description = payload?.description ?? ''
  const categoryId = String(payload?.category_id ?? payload?.categoryId ?? payload?.category_id ?? '0')
  const categoryName = payload?.categoryName ?? 'Auto Category'
  const item_specifics = Array.isArray(payload?.item_specifics)
    ? payload.item_specifics
    : typeof payload?.item_specifics === 'object' && payload?.item_specifics
    ? Object.entries(payload.item_specifics).map(([name, value]) => ({ name, value: value ?? '', multi: false }))
    : []
  const keywords = Array.isArray(payload?.keywords) ? payload.keywords : payload?.keywords ? [payload.keywords] : []
  const data = {
    title,
    description,
    category: { id: categoryId, name: categoryName },
    item_specifics,
    keywords,
  }
  return { ok: true, data, error: null, requestId: String(Date.now()) }
}
