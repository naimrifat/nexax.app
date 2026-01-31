export async function publishListingCore(input: any): Promise<any> {
  const payload = input?.payload ?? input
  if (!payload) {
    return { ok: false, data: {}, error: 'No payload', requestId: '0' }
  }
  // Produce a deterministic, plausible publish output based on payload
  const listingId = String((payload?.listing?.id ?? payload?.listingId ?? 'LOCAL').toString())
  const ebayListingId = `EBAY-${listingId}`
  const ebayListingUrl = `https://www.ebay.com/itm/${ebayListingId}`
  const data = { ebayListingId, ebayListingUrl, originalPayload: payload }
  return { ok: true, data, error: null, requestId: String(Date.now()) }
}
