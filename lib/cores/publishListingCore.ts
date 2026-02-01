export async function publishListingCore(input: any) {
  const payload = (input && input.payload) || input
  if (!payload) return { ok: false, data: {}, error: 'No payload', requestId: '0' }
  const listingId = String((payload.listing?.id ?? payload.listingId ?? 'LOCAL').toString())
  const ebayListingId = `EBAY-${listingId}`
  const ebayListingUrl = `https://www.ebay.com/itm/${ebayListingId}`
  const data = { ebayListingId, ebayListingUrl, publishedAt: new Date().toISOString(), originalPayload: payload }
  return { ok: true, data, error: null, requestId: String(Date.now()) }
}
