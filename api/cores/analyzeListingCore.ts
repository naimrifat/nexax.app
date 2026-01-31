import type { Response } from 'node-fetch'

export async function analyzeListingCore(input: any): Promise<any> {
  const payload = input?.payload ?? input
  if (!payload) {
    return { ok: false, data: {}, error: 'No payload', requestId: '0' }
  }
  // Production-grade normalization
  const title = String(payload?.title ?? 'Untitled Listing')
  const description = String(payload?.description ?? '')
  const categoryId = String(payload?.category_id ?? payload?.categoryId ?? payload?.category_id ?? '0')
  const categoryName = String(payload?.categoryName ?? 'Auto Category')

  // Normalize item specifics from different shapes
  let item_specifics: any[] = []
  const rawSpecs = payload?.item_specifics
  if (Array.isArray(rawSpecs)) {
    item_specifics = rawSpecs
  } else if (rawSpecs && typeof rawSpecs === 'object') {
    item_specifics = Object.entries(rawSpecs).map(([name, value]) => ({ name, value: value ?? '', multi: false }))
  }

  // Keywords
  let keywords: any[] = []
  if (Array.isArray(payload?.keywords)) keywords = payload.keywords
  else if (payload?.keywords) keywords = [payload.keywords]

  const data = {
    title,
    description,
    category: { id: categoryId, name: categoryName },
    item_specifics,
    keywords,
  }
  return { ok: true, data, error: null, requestId: String(Date.now()) }
}
