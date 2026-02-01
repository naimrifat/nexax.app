// Production-grade analyzeListing core (JS wrapper for runtime stability)
export async function analyzeListingCore(input) {
  const payload = (input && input.payload) || input
  if (!payload) {
    return { ok: false, data: {}, error: 'No payload', requestId: '0' }
  }
  const title = String(payload.title ?? 'Untitled Listing')
  const description = String(payload.description ?? '')
  const categoryId = String(payload.category_id ?? payload.categoryId ?? '0')
  const categoryName = String(payload.categoryName ?? 'Auto Category')
  let item_specifics = []
  const rawSpecs = payload.item_specifics
  if (Array.isArray(rawSpecs)) {
    item_specifics = rawSpecs
  } else if (rawSpecs && typeof rawSpecs === 'object') {
    item_specifics = Object.entries(rawSpecs).map(([name, value]) => ({ name, value: value ?? '', multi: false }))
  }
  let keywords = []
  if (Array.isArray(payload.keywords)) keywords = payload.keywords
  else if (payload.keywords) keywords = [payload.keywords]
  const data = { title, description, category: { id: categoryId, name: categoryName }, item_specifics, keywords }
  return { ok: true, data, error: null, requestId: String(Date.now()) }
}
